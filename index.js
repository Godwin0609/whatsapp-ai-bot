const http = require("http");
const OpenAI = require("openai");

// ===============================
// ENVIRONMENT VARIABLES
// ===============================

const PORT = process.env.PORT || 3000;

const WEBHOOK_VERIFY_TOKEN = process.env.WEBHOOK_VERIFY_TOKEN;
const WHATSAPP_ACCESS_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN;
const WHATSAPP_PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const ADMIN_PHONE_NUMBER = process.env.ADMIN_PHONE_NUMBER;

// ===============================
// OPENAI CLIENT
// ===============================

const openai = OPENAI_API_KEY
  ? new OpenAI({
      apiKey: OPENAI_API_KEY,
    })
  : null;

// ===============================
// POLICY ENGINE
// ===============================

const POLICY = {
  version: "2.0.0",

  humanAuthority: true,

  requireAuthorizationForSensitiveActions: true,

  auditActions: true,

  allowAutonomousPrivilegeExpansion: false,

  capabilities: {
    reasoning: {
      enabled: true,
      provider: "openai",
      model: "gpt-4o-mini",
    },

    image: {
      enabled: false,
    },

    speech: {
      enabled: false,
    },

    coding: {
      enabled: false,
    },

    research: {
      enabled: false,
    },

    robotics: {
      enabled: true,
      mode: "simulation",
    },
  },
};

// ===============================
// SYSTEM STATE
// ===============================

const SYSTEM_STATE = {
  emergencyStop: false,
  version: "1.0.0",
};

// ===============================
// AUDIT LOG
// ===============================

const auditLog = [];

const MAX_AUDIT_LOG_SIZE = 1000;

function recordAuditEvent(type, data = {}) {
  const event = {
    id: `AUDIT-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
    timestamp: new Date().toISOString(),
    type,
    ...data,
  };

  auditLog.push(event);

  if (auditLog.length > MAX_AUDIT_LOG_SIZE) {
    auditLog.shift();
  }

  console.log("[AUDIT]", JSON.stringify(event));

  return event;
}

// ===============================
// HUMAN AUTHORIZATION ENGINE
// ===============================

// Pending authorization requests.
//
// Map key = normalized admin phone number
//
// Example:
//
// sender -> {
//   task,
//   originalText,
//   createdAt,
//   expiresAt
// }

const pendingAuthorizations = new Map();

const AUTHORIZATION_TIMEOUT_MS = 5 * 60 * 1000;

// ===============================
// WHATSAPP NUMBER NORMALIZATION
// ===============================

function normalizeWhatsAppNumber(number) {
  if (!number) return "";

  let normalized = String(number).replace(/\D/g, "");

  // Convert Nigerian local format:
  // 08012345678
  // into:
  // 2348012345678

  if (normalized.startsWith("0")) {
    normalized = "234" + normalized.substring(1);
  }

  return normalized;
}

// ===============================
// ADMIN CHECK
// ===============================

function isAdmin(sender) {
  const normalizedSender = normalizeWhatsAppNumber(sender);
  const normalizedAdmin = normalizeWhatsAppNumber(ADMIN_PHONE_NUMBER);

  return (
    normalizedSender &&
    normalizedAdmin &&
    normalizedSender === normalizedAdmin
  );
}

// ===============================
// AUTHORIZATION HELPERS
// ===============================

function clearAuthorization(sender, reason = "cleared") {
  const normalizedSender = normalizeWhatsAppNumber(sender);

  const existing = pendingAuthorizations.get(normalizedSender);

  if (!existing) {
    return null;
  }

  pendingAuthorizations.delete(normalizedSender);

  recordAuditEvent("AUTHORIZATION_CLEARED", {
    sender: normalizedSender,
    task: existing.task,
    reason,
  });

  return existing;
}

function createAuthorizationRequest(sender, task, originalText) {
  const normalizedSender = normalizeWhatsAppNumber(sender);

  // Replace any existing request from this sender.
  if (pendingAuthorizations.has(normalizedSender)) {
    clearAuthorization(sender, "replaced_by_new_request");
  }

  const createdAt = Date.now();
  const expiresAt = createdAt + AUTHORIZATION_TIMEOUT_MS;

  const request = {
    sender: normalizedSender,
    task,
    originalText,
    createdAt,
    expiresAt,
  };

  pendingAuthorizations.set(normalizedSender, request);

  const audit = recordAuditEvent("AUTHORIZATION_PROPOSED", {
    sender: normalizedSender,
    task,
    originalText,
    expiresAt: new Date(expiresAt).toISOString(),
  });

  return {
    ...request,
    auditId: audit.id,
  };
}

function getPendingAuthorization(sender) {
  const normalizedSender = normalizeWhatsAppNumber(sender);

  const request = pendingAuthorizations.get(normalizedSender);

  if (!request) {
    return null;
  }

  // Check expiration.
  if (Date.now() > request.expiresAt) {
    pendingAuthorizations.delete(normalizedSender);

    recordAuditEvent("AUTHORIZATION_EXPIRED", {
      sender: normalizedSender,
      task: request.task,
    });

    return null;
  }

  return request;
}

// ===============================
// CONTROL COMMANDS
// ===============================

function isControlCommand(text) {
  const command = String(text || "").trim().toUpperCase();

  return (
    command === "STOP" ||
    command === "RESUME" ||
    command === "STATUS" ||
    command === "APPROVE" ||
    command === "DENY"
  );
}

async function handleControlCommand(sender, text) {
  const command = String(text || "").trim().toUpperCase();

  // --------------------------------
  // APPROVE
  // --------------------------------

  if (command === "APPROVE") {
    if (!isAdmin(sender)) {
      recordAuditEvent("UNAUTHORIZED_APPROVAL_ATTEMPT", {
        sender: normalizeWhatsAppNumber(sender),
      });

      return "⛔ Authorization denied. Only an authorized human administrator can approve actions.";
    }

    const pending = getPendingAuthorization(sender);

    if (!pending) {
      return "ℹ️ No pending authorization request was found.";
    }

    if (SYSTEM_STATE.emergencyStop) {
      clearAuthorization(sender, "emergency_stop_active");

      return (
        "🛑 APPROVAL BLOCKED\n\n" +
        "The Emergency Stop is active.\n" +
        "The pending action has been cancelled.\n\n" +
        "RESUME the system and submit the command again."
      );
    }

    recordAuditEvent("AUTHORIZATION_APPROVED", {
      sender: normalizeWhatsAppNumber(sender),
      task: pending.task,
      originalText: pending.originalText,
    });

    // Remove pending request before execution.
    pendingAuthorizations.delete(normalizeWhatsAppNumber(sender));

    try {
      if (pending.task === "robotics") {
        return await executeRobotTask(
          sender,
          pending.originalText,
          {
            authorized: true,
            authorizationId: `AUTH-${Date.now()}`,
          }
        );
      }

      return "⚠️ Approved action type is not currently executable.";
    } catch (error) {
      recordAuditEvent("AUTHORIZED_ACTION_ERROR", {
        sender: normalizeWhatsAppNumber(sender),
        task: pending.task,
        error: error.message,
      });

      throw error;
    }
  }

  // --------------------------------
  // DENY
  // --------------------------------

  if (command === "DENY") {
    if (!isAdmin(sender)) {
      recordAuditEvent("UNAUTHORIZED_DENIAL_ATTEMPT", {
        sender: normalizeWhatsAppNumber(sender),
      });

      return "⛔ Only an authorized administrator can deny pending actions.";
    }

    const pending = getPendingAuthorization(sender);

    if (!pending) {
      return "ℹ️ No pending authorization request was found.";
    }

    pendingAuthorizations.delete(normalizeWhatsAppNumber(sender));

    recordAuditEvent("AUTHORIZATION_DENIED", {
      sender: normalizeWhatsAppNumber(sender),
      task: pending.task,
      originalText: pending.originalText,
    });

    return (
      "❌ ACTION DENIED\n\n" +
      `Task: ${pending.originalText}\n` +
      "Status: Cancelled\n" +
      "No action was executed."
    );
  }

  // --------------------------------
  // STOP
  // --------------------------------

  if (command === "STOP") {
    if (!isAdmin(sender)) {
      recordAuditEvent("UNAUTHORIZED_STOP_ATTEMPT", {
        sender: normalizeWhatsAppNumber(sender),
      });

      return "⛔ STOP command denied. Only the authorized administrator can control the system.";
    }

    SYSTEM_STATE.emergencyStop = true;

    // Safety rule:
    // Any pending authorization is cancelled
    // when Emergency Stop is activated.

    if (pendingAuthorizations.size > 0) {
      for (const [pendingSender, pending] of pendingAuthorizations.entries()) {
        recordAuditEvent("AUTHORIZATION_CANCELLED_BY_EMERGENCY_STOP", {
          sender: pendingSender,
          task: pending.task,
        });
      }

      pendingAuthorizations.clear();
    }

    recordAuditEvent("EMERGENCY_STOP_ACTIVATED", {
      sender: normalizeWhatsAppNumber(sender),
    });

    return (
      "🛑 EMERGENCY STOP ACTIVATED\n\n" +
      "All executable actions are now blocked.\n" +
      "Pending authorizations have been cancelled.\n\n" +
      "System remains under human control."
    );
  }

  // --------------------------------
  // RESUME
  // --------------------------------

  if (command === "RESUME") {
    if (!isAdmin(sender)) {
      recordAuditEvent("UNAUTHORIZED_RESUME_ATTEMPT", {
        sender: normalizeWhatsAppNumber(sender),
      });

      return "⛔ RESUME command denied. Only the authorized administrator can control the system.";
    }

    SYSTEM_STATE.emergencyStop = false;

    recordAuditEvent("EMERGENCY_STOP_RELEASED", {
      sender: normalizeWhatsAppNumber(sender),
    });

    return (
      "🟢 SYSTEM RESUMED\n\n" +
      "Emergency Stop: OFF\n" +
      "The system is ready for new authorized tasks."
    );
  }

  // --------------------------------
  // STATUS
  // --------------------------------

  if (command === "STATUS") {
    if (!isAdmin(sender)) {
      recordAuditEvent("UNAUTHORIZED_STATUS_ATTEMPT", {
        sender: normalizeWhatsAppNumber(sender),
      });

      return "⛔ STATUS access denied.";
    }

    const pending = getPendingAuthorization(sender);

    recordAuditEvent("STATUS_REQUESTED", {
      sender: normalizeWhatsAppNumber(sender),
    });

    return (
      "🧠 SILENT STRATEGIST STATUS\n\n" +

      `System: ONLINE\n` +
      `Policy Engine: ACTIVE\n` +
      `AI Router: ACTIVE\n` +
      `Verification: ACTIVE\n` +
      `Audit Logging: ACTIVE\n` +
      `Human Authorization: ACTIVE\n` +
      `Emergency Stop: ${SYSTEM_STATE.emergencyStop ? "ON" : "OFF"}\n` +

      `Robot Controller: ACTIVE\n` +
      `Robot Mode: ${POLICY.capabilities.robotics.mode.toUpperCase()}\n` +

      `Policy Version: ${POLICY.version}\n` +

      `Robot Battery: ${ROBOT_STATE.battery}%\n` +
      `Robot Status: ${ROBOT_STATE.status}\n` +

      `Pending Authorization: ${pending ? "YES" : "NO"}`
    );
  }

  return null;
}

// ===============================
// AI CAPABILITY REGISTRY
// ===============================

const AI_CAPABILITIES = {
  reasoning: {
    enabled: true,
    provider: "openai",
    model: "gpt-4o-mini",
  },

  image: {
    enabled: false,
  },

  speech: {
    enabled: false,
  },

  coding: {
    enabled: false,
  },

  research: {
    enabled: false,
  },

  robotics: {
    enabled: true,
    mode: "simulation",
  },
};

// ===============================
// TASK CLASSIFIER
// ===============================

function isRobotCommand(text) {
  const normalized = String(text || "")
    .trim()
    .toUpperCase();

  return (
    normalized === "GO TO CHARGING STATION" ||
    normalized === "GO TO THE CHARGING STATION"
  );
}

function classifyTask(text) {
  if (isRobotCommand(text)) {
    return "robotics";
  }

  return "reasoning";
}

// ===============================
// POLICY EVALUATION
// ===============================

function evaluatePolicy(sender, task) {
  // Emergency stop blocks all executable tasks.
  if (SYSTEM_STATE.emergencyStop) {
    return {
      allowed: false,
      reason: "Emergency Stop is active.",
    };
  }

  if (!AI_CAPABILITIES[task]) {
    return {
      allowed: false,
      reason: `Capability "${task}" does not exist.`,
    };
  }

  if (!AI_CAPABILITIES[task].enabled) {
    return {
      allowed: false,
      reason: `Capability "${task}" is disabled.`,
    };
  }

  // Robotics are sensitive actions.
  if (task === "robotics") {
    if (!isAdmin(sender)) {
      return {
        allowed: false,
        reason: "Robot actions require an authorized administrator.",
      };
    }

    return {
      allowed: true,
      requiresAuthorization:
        POLICY.requireAuthorizationForSensitiveActions,
    };
  }

  return {
    allowed: true,
    requiresAuthorization: false,
  };
}

// ===============================
// AI ROUTER
// ===============================

function routeAI(task) {
  const capability = AI_CAPABILITIES[task];

  if (!capability || !capability.enabled) {
    throw new Error(`AI capability unavailable: ${task}`);
  }

  return {
    provider: capability.provider,
    model: capability.model,
  };
}

// ===============================
// OPENAI REASONING
// ===============================

async function askOpenAI(text) {
  if (!openai) {
    throw new Error("OPENAI_API_KEY is not configured.");
  }

  const response = await openai.chat.completions.create({
    model: AI_CAPABILITIES.reasoning.model,

    messages: [
      {
        role: "system",
        content:
          "You are the reasoning component of The Silent Strategist AI. " +
          "Follow the system's policy and human-authority boundaries. " +
          "Give useful, clear and responsible answers. " +
          "Do not claim authority over the human operator. " +
          "AI can recommend; human authority decides.",
      },

      {
        role: "user",
        content: text,
      },
    ],
  });

  return response.choices?.[0]?.message?.content || "";
}

// ===============================
// PROVIDER DISPATCH
// ===============================

async function dispatchToProvider(route, text) {
  if (route.provider === "openai") {
    return await askOpenAI(text);
  }

  throw new Error(`Unsupported provider: ${route.provider}`);
}

// ===============================
// AI RESPONSE VERIFICATION
// ===============================

function verifyAIResponse(response) {
  if (!response || typeof response !== "string") {
    return {
      valid: false,
      reason: "AI returned an empty or invalid response.",
    };
  }

  if (response.length > 10000) {
    return {
      valid: false,
      reason: "AI response exceeded the maximum allowed length.",
    };
  }

  return {
    valid: true,
  };
}

// ===============================
// ROBOT SIMULATION
// ===============================

const ROBOT_STATE = {
  id: "silent-strategist-robot-01",

  position: {
    x: 0,
    y: 0,
  },

  battery: 100,

  status: "IDLE",

  destination: null,

  lastTask: null,
};

const CHARGING_STATION = {
  x: 5,
  y: 5,
};

// ===============================
// ROBOT ROUTE PLANNER
// ===============================

function calculateRobotRoute(start, destination) {
  const route = [];

  let currentX = start.x;
  let currentY = start.y;

  while (currentX !== destination.x) {
    currentX += destination.x > currentX ? 1 : -1;

    route.push({
      x: currentX,
      y: currentY,
    });
  }

  while (currentY !== destination.y) {
    currentY += destination.y > currentY ? 1 : -1;

    route.push({
      x: currentX,
      y: currentY,
    });
  }

  return route;
}

// ===============================
// ROBOT EXECUTION
// ===============================

async function executeRobotTask(sender, text, options = {}) {
  const normalizedSender = normalizeWhatsAppNumber(sender);

  if (!isAdmin(sender)) {
    recordAuditEvent("UNAUTHORIZED_ROBOT_EXECUTION_ATTEMPT", {
      sender: normalizedSender,
      command: text,
    });

    return "⛔ Robot command denied. Administrator authorization is required.";
  }

  if (!options.authorized) {
    recordAuditEvent("ROBOT_EXECUTION_BLOCKED_NO_AUTHORIZATION", {
      sender: normalizedSender,
      command: text,
    });

    return "⛔ Robot action cannot execute without explicit human authorization.";
  }

  if (SYSTEM_STATE.emergencyStop) {
    recordAuditEvent("ROBOT_EXECUTION_BLOCKED_EMERGENCY_STOP", {
      sender: normalizedSender,
      command: text,
    });

    return "🛑 Robot execution blocked because Emergency Stop is active.";
  }

  if (ROBOT_STATE.battery <= 0) {
    return "🔋 Robot cannot move because battery is empty.";
  }

  const destination = CHARGING_STATION;

  const route = calculateRobotRoute(
    ROBOT_STATE.position,
    destination
  );

  ROBOT_STATE.status = "MOVING";
  ROBOT_STATE.destination = destination;
  ROBOT_STATE.lastTask = text;

  recordAuditEvent("ROBOT_ACTION_STARTED", {
    sender: normalizedSender,
    command: text,
    destination,
    routeLength: route.length,
    authorizationId: options.authorizationId || null,
  });

  // Simulated movement.
  for (const step of route) {
    // Emergency stop is checked during execution.
    if (SYSTEM_STATE.emergencyStop) {
      ROBOT_STATE.status = "STOPPED";

      ROBOT_STATE.destination = null;

      recordAuditEvent("ROBOT_ACTION_INTERRUPTED", {
        sender: normalizedSender,
        reason: "Emergency Stop activated during execution.",
      });

      return (
        "🛑 ROBOT ACTION INTERRUPTED\n\n" +
        "Emergency Stop was activated.\n" +
        `Robot position: (${ROBOT_STATE.position.x}, ${ROBOT_STATE.position.y})`
      );
    }

    await new Promise((resolve) => setTimeout(resolve, 150));

    ROBOT_STATE.position = {
      x: step.x,
      y: step.y,
    };

    // Simulate small battery usage.
    ROBOT_STATE.battery = Math.max(
      0,
      ROBOT_STATE.battery - 1
    );

    console.log(
      `[ROBOT] Position: (${step.x}, ${step.y}) Battery: ${ROBOT_STATE.battery}%`
    );
  }

  // ===============================
  // VERIFY DESTINATION
  // ===============================

  const destinationVerified =
    ROBOT_STATE.position.x === destination.x &&
    ROBOT_STATE.position.y === destination.y;

  if (!destinationVerified) {
    ROBOT_STATE.status = "ERROR";
    ROBOT_STATE.destination = null;

    recordAuditEvent("ROBOT_VERIFICATION_FAILED", {
      sender: normalizedSender,
      expectedDestination: destination,
      actualPosition: ROBOT_STATE.position,
    });

    return (
      "⚠️ ROBOT VERIFICATION FAILED\n\n" +
      "The robot did not reach the expected destination."
    );
  }

  // ===============================
  // CHARGE SIMULATION
  // ===============================

  ROBOT_STATE.status = "CHARGING";

  await new Promise((resolve) => setTimeout(resolve, 500));

  ROBOT_STATE.battery = 100;

  ROBOT_STATE.status = "IDLE";

  ROBOT_STATE.destination = null;

  // ===============================
  // FINAL AUDIT
  // ===============================

  const audit = recordAuditEvent("ROBOT_ACTION_COMPLETED", {
    sender: normalizedSender,
    command: text,
    destination,
    verification: "PASSED",
    battery: ROBOT_STATE.battery,
    authorizationId: options.authorizationId || null,
  });

  return (
    "✅ ACTION COMPLETED\n\n" +
    "🤖 Robot Task: Go to Charging Station\n" +
    "Mode: Simulation\n" +
    `Destination: (${destination.x}, ${destination.y})\n` +
    `Final Position: (${ROBOT_STATE.position.x}, ${ROBOT_STATE.position.y})\n` +
    "Verification: PASSED\n" +
    `Battery: ${ROBOT_STATE.battery}%\n` +
    `Audit ID: ${audit.id}`
  );
}

// ===============================
// MAIN MESSAGE PROCESSOR
// ===============================

async function processMessage(sender, text) {
  const normalizedSender = normalizeWhatsAppNumber(sender);

  // ===============================
  // EMERGENCY STOP
  // ===============================

  if (SYSTEM_STATE.emergencyStop) {
    return (
      "🛑 SYSTEM LOCKED\n\n" +
      "Emergency Stop is active.\n" +
      "No executable actions are permitted.\n\n" +
      "Only the authorized administrator can use RESUME."
    );
  }

  // ===============================
  // CLASSIFY
  // ===============================

  const task = classifyTask(text);

  recordAuditEvent("TASK_CLASSIFIED", {
    sender: normalizedSender,
    text,
    task,
  });

  // ===============================
  // POLICY
  // ===============================

  const policyResult = evaluatePolicy(sender, task);

  recordAuditEvent("POLICY_EVALUATED", {
    sender: normalizedSender,
    task,
    allowed: policyResult.allowed,
    requiresAuthorization:
      policyResult.requiresAuthorization || false,
    reason: policyResult.reason || null,
  });

  if (!policyResult.allowed) {
    return (
      "⛔ ACTION BLOCKED\n\n" +
      `Reason: ${policyResult.reason}`
    );
  }

  // ===============================
  // SENSITIVE ACTION
  // ===============================

  if (
    task === "robotics" &&
    policyResult.requiresAuthorization
  ) {
    const authorization = createAuthorizationRequest(
      sender,
      task,
      text
    );

    const route = calculateRobotRoute(
      ROBOT_STATE.position,
      CHARGING_STATION
    );

    return (
      "🤖 ACTION PROPOSED\n\n" +

      "Task: Go to Charging Station\n" +

      "Mode: Simulation\n" +

      `Current Position: (${ROBOT_STATE.position.x}, ${ROBOT_STATE.position.y})\n` +

      `Destination: (${CHARGING_STATION.x}, ${CHARGING_STATION.y})\n` +

      `Estimated Route: ${route.length} steps\n` +

      `Current Battery: ${ROBOT_STATE.battery}%\n\n` +

      "Authorization: REQUIRED\n\n" +

      "Reply:\n" +

      "APPROVE — execute the action\n" +

      "DENY — cancel the action\n\n" +

      `Authorization ID: ${authorization.auditId}\n` +

      "This request expires in 5 minutes."
    );
  }

  // ===============================
  // NORMAL AI REASONING
  // ===============================

  const route = routeAI(task);

  recordAuditEvent("AI_ROUTE_SELECTED", {
    sender: normalizedSender,
    task,
    provider: route.provider,
    model: route.model,
  });

  try {
    const response = await dispatchToProvider(route, text);

    const verification = verifyAIResponse(response);

    if (!verification.valid) {
      recordAuditEvent("AI_RESPONSE_REJECTED", {
        sender: normalizedSender,
        task,
        reason: verification.reason,
      });

      return (
        "⚠️ AI response failed verification.\n\n" +
        `Reason: ${verification.reason}`
      );
    }

    const audit = recordAuditEvent("AI_RESPONSE_APPROVED", {
      sender: normalizedSender,
      task,
      provider: route.provider,
      model: route.model,
    });

    console.log(`[AI] Response approved: ${audit.id}`);

    return response;
  } catch (error) {
    recordAuditEvent("AI_PROVIDER_ERROR", {
      sender: normalizedSender,
      task,
      provider: route.provider,
      error: error.message,
    });

    throw error;
  }
}

// ===============================
// WHATSAPP MESSAGE SENDER
// ===============================

async function sendWhatsAppMessage(to, text) {
  if (
    !WHATSAPP_ACCESS_TOKEN ||
    !WHATSAPP_PHONE_NUMBER_ID
  ) {
    throw new Error(
      "WhatsApp credentials are not configured."
    );
  }

  const url =
    `https://graph.facebook.com/v23.0/` +
    `${WHATSAPP_PHONE_NUMBER_ID}/messages`;

  const response = await fetch(url, {
    method: "POST",

    headers: {
      Authorization: `Bearer ${WHATSAPP_ACCESS_TOKEN}`,
      "Content-Type": "application/json",
    },

    body: JSON.stringify({
      messaging_product: "whatsapp",

      to,

      type: "text",

      text: {
        body: text,
      },
    }),
  });

  const responseText = await response.text();

  console.log(
    "[WHATSAPP API RESPONSE]",
    response.status,
    responseText
  );

  if (!response.ok) {
    throw new Error(
      `WhatsApp API error ${response.status}: ${responseText}`
    );
  }

  return responseText;
}

// ===============================
// HTTP SERVER
// ===============================

const server = http.createServer(async (req, res) => {
  // ===============================
  // HEALTH CHECK
  // ===============================

  if (req.method === "GET" && req.url === "/") {
    res.writeHead(200, {
      "Content-Type": "text/plain",
    });

    res.end(
      "The Silent Strategist AI running on port " +
      PORT +
      "\n\n" +

      "Policy Engine: ACTIVE\n" +
      "Task Classifier: ACTIVE\n" +
      "AI Capability Registry: ACTIVE\n" +
      "AI Router: ACTIVE\n" +
      "Provider Adapter: ACTIVE\n" +
      "Verification: ACTIVE\n" +
      "Audit Logging: ACTIVE\n" +
      "Human Authorization: ACTIVE\n" +
      "Emergency Stop: " +
      (SYSTEM_STATE.emergencyStop ? "ON" : "OFF") +
      "\n" +
      "Robot Controller: ACTIVE\n" +
      "Robot Mode: " +
      POLICY.capabilities.robotics.mode.toUpperCase() +
      "\n\n" +

      "Policy Version: " +
      POLICY.version +
      "\n" +

      "Robot Status: " +
      ROBOT_STATE.status +
      "\n" +

      "Robot Battery: " +
      ROBOT_STATE.battery +
      "%\n"
    );

    return;
  }
  // ===============================
  // CAPABILITIES ENDPOINT
  // ===============================

  if (
    req.method === "GET" &&
    req.url === "/capabilities"
  ) {
    res.writeHead(200, {
      "Content-Type": "application/json",
    });

    res.end(
      JSON.stringify(
        {
          policy: POLICY,
          capabilities: AI_CAPABILITIES,
        },
        null,
        2
      )
    );

    return;
  }

  // ===============================
  // ROBOT STATUS ENDPOINT
  // ===============================

  if (
    req.method === "GET" &&
    req.url === "/robot"
  ) {
    res.writeHead(200, {
      "Content-Type": "application/json",
    });

    res.end(
      JSON.stringify(
        {
          robot: ROBOT_STATE,
          chargingStation: CHARGING_STATION,
        },
        null,
        2
      )
    );

    return;
  }

  // ===============================
  // WEBHOOK VERIFICATION
  // ===============================

  if (
    req.method === "GET" &&
    req.url.startsWith("/webhook")
  ) {
    const url = new URL(
      req.url,
      `http://${req.headers.host}`
    );

    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge =
      url.searchParams.get("hub.challenge");

    if (
      mode === "subscribe" &&
      token === WEBHOOK_VERIFY_TOKEN
    ) {
      console.log("Webhook verified successfully.");

      res.writeHead(200, {
        "Content-Type": "text/plain",
      });

      res.end(challenge);

      return;
    }

    res.writeHead(403);
    res.end("Forbidden");

    return;
  }

  // ===============================
  // WHATSAPP WEBHOOK
  // ===============================

  if (
    req.method === "POST" &&
    req.url === "/webhook"
  ) {
    let body = "";

    req.on("data", (chunk) => {
      body += chunk.toString();
    });

    req.on("end", async () => {
      try {
        const payload = JSON.parse(body);

        console.log(
          "[WEBHOOK] Incoming payload received."
        );

        if (payload.object !== "whatsapp_business_account") {
          res.writeHead(200);
          res.end("EVENT_RECEIVED");
          return;
        }

        const entries = payload.entry || [];

        for (const entry of entries) {
          const changes = entry.changes || [];

          for (const change of changes) {
            const value = change.value || {};

            const messages = value.messages || [];

            for (const message of messages) {
              const sender = message.from;

              // ===============================
              // TEXT ONLY FOR NOW
              // ===============================

              if (
                message.type !== "text" ||
                !message.text
              ) {
                console.log(
                  "[WEBHOOK] Non-text message ignored."
                );

                continue;
              }

              const text =
                message.text.body.trim();

              console.log(
                `[WHATSAPP] Message from ${sender}: ${text}`
              );

              // ===============================
              // CONTROL COMMANDS
              // ===============================

              if (isControlCommand(text)) {
                try {
                  const controlResponse =
                    await handleControlCommand(
                      sender,
                      text
                    );

                  if (controlResponse) {
                    await sendWhatsAppMessage(
                      sender,
                      controlResponse
                    );
                  }

                  continue;
                } catch (error) {
                  console.error(
                    "[CONTROL ERROR]",
                    error
                  );

                  await sendWhatsAppMessage(
                    sender,
                    "⚠️ Control command failed: " +
                      error.message
                  );

                  continue;
                }
              }

              // ===============================
              // NORMAL MESSAGE
              // ===============================

              try {
                const response =
                  await processMessage(
                    sender,
                    text
                  );

                await sendWhatsAppMessage(
                  sender,
                  response
                );
              } catch (error) {
                console.error(
                  "[MESSAGE PROCESSING ERROR]",
                  error
                );

                recordAuditEvent(
                  "MESSAGE_PROCESSING_ERROR",
                  {
                    sender:
                      normalizeWhatsAppNumber(
                        sender
                      ),
                    text,
                    error: error.message,
                  }
                );

                try {
                  await sendWhatsAppMessage(
                    sender,
                    "⚠️ The Silent Strategist AI encountered an error while processing your request.\n\n" +
                      "Check the system logs for details."
                  );
                } catch (sendError) {
                  console.error(
                    "[ERROR SENDING FAILURE MESSAGE]",
                    sendError
                  );
                }
              }
            }
          }
        }

        // ===============================
        // ACKNOWLEDGE META
        // ===============================

        if (!res.headersSent) {
          res.writeHead(200, {
            "Content-Type": "text/plain",
          });

          res.end("EVENT_RECEIVED");
        }
      } catch (error) {
        console.error(
          "[WEBHOOK ERROR]",
          error
        );

        recordAuditEvent(
          "WEBHOOK_ERROR",
          {
            error: error.message,
          }
        );

        if (!res.headersSent) {
          res.writeHead(400, {
            "Content-Type": "text/plain",
          });

          res.end("Invalid webhook payload");
        }
      }
    });

    return;
                      }
  // ===============================
  // 404
  // ===============================

  res.writeHead(404, {
    "Content-Type": "text/plain",
  });

  res.end("Not Found");
});

// ===============================
// SERVER ERROR HANDLER
// ===============================

server.on("error", (error) => {
  console.error(
    "[SERVER ERROR]",
    error
  );
});

// ===============================
// START SERVER
// ===============================

server.listen(PORT, () => {
  console.log(
    "========================================"
  );

  console.log(
    "THE SILENT STRATEGIST AI"
  );

  console.log(
    "========================================"
  );

  console.log(
    `Server running on port ${PORT}`
  );

  console.log(
    `Policy Engine: ACTIVE`
  );

  console.log(
    `Human Authority: ${POLICY.humanAuthority}`
  );

  console.log(
    `Human Authorization: ACTIVE`
  );

  console.log(
    `Audit Logging: ACTIVE`
  );

  console.log(
    `Emergency Stop: ${
      SYSTEM_STATE.emergencyStop
        ? "ON"
        : "OFF"
    }`
  );

  console.log(
    `Robot Controller: ACTIVE`
  );

  console.log(
    `Robot Mode: ${POLICY.capabilities.robotics.mode}`
  );

  console.log(
    "========================================"
  );
});
