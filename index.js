const http = require("http");
const OpenAI = require("openai");

// ============================================================
// ENVIRONMENT
// ============================================================

const PORT = process.env.PORT || 3000;

const WEBHOOK_VERIFY_TOKEN = process.env.WEBHOOK_VERIFY_TOKEN;
const WHATSAPP_ACCESS_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN;
const WHATSAPP_PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const ADMIN_PHONE_NUMBER = process.env.ADMIN_PHONE_NUMBER;

// ============================================================
// OPENAI
// ============================================================

const openai = OPENAI_API_KEY
  ? new OpenAI({
      apiKey: OPENAI_API_KEY
    })
  : null;

// ============================================================
// POLICY
// ============================================================

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
      model: "gpt-4o-mini"
    },

    image: {
      enabled: false
    },

    speech: {
      enabled: false
    },

    coding: {
      enabled: false
    },

    research: {
      enabled: false
    },

    robotics: {
      enabled: true,
      mode: "simulation"
    }
  }
};

// ============================================================
// SYSTEM STATE
// ============================================================

const SYSTEM_STATE = {
  emergencyStop: false,
  version: "1.0.0"
};

// ============================================================
// AUDIT LOG
// ============================================================

const auditLog = [];
const MAX_AUDIT_LOG = 1000;

function recordAuditEvent(type, data = {}) {
  const event = {
    timestamp: new Date().toISOString(),
    type,
    ...data
  };

  auditLog.push(event);

  if (auditLog.length > MAX_AUDIT_LOG) {
    auditLog.shift();
  }

  console.log("AUDIT LOG:", JSON.stringify(event, null, 2));

  return event;
}

// ============================================================
// PHONE NUMBER HANDLING
// ============================================================

function normalizeWhatsAppNumber(number) {
  if (!number) {
    return null;
  }

  let value = String(number).trim();

  // Remove spaces, brackets, hyphens and plus signs.
  value = value.replace(/[^\d]/g, "");

  // Nigerian local format:
  // 08117575320 -> 2348117575320
  if (value.startsWith("0")) {
    value = "234" + value.substring(1);
  }

  // Nigerian number already in international format:
  // 2348117575320 -> remains 2348117575320
  if (value.startsWith("234")) {
    return value;
  }

  return value;
}

// ============================================================
// ADMIN AUTHORIZATION
// ============================================================

function isAdmin(sender) {
  const normalizedSender = normalizeWhatsAppNumber(sender);
  const normalizedAdmin = normalizeWhatsAppNumber(ADMIN_PHONE_NUMBER);

  if (!normalizedSender || !normalizedAdmin) {
    return false;
  }

  return normalizedSender === normalizedAdmin;
}

// ============================================================
// EMERGENCY STOP
// ============================================================

function handleControlCommand(sender, text) {
  const command = String(text || "").trim().toUpperCase();

  if (!["STOP", "RESUME", "STATUS"].includes(command)) {
    return null;
  }

  if (!isAdmin(sender)) {
    recordAuditEvent("UNAUTHORIZED_CONTROL_ATTEMPT", {
      sender,
      command
    });

    return "Authorization required. This control command is restricted.";
  }

  if (command === "STOP") {
    SYSTEM_STATE.emergencyStop = true;

    recordAuditEvent("EMERGENCY_STOP_ACTIVATED", {
      sender
    });

    return [
      "🛑 EMERGENCY STOP ACTIVE",
      "",
      "AI execution is stopped.",
      "Robot task execution is stopped.",
      "Control commands remain available.",
      "",
      "Send RESUME to restore normal operation."
    ].join("\n");
  }

  if (command === "RESUME") {
    SYSTEM_STATE.emergencyStop = false;

    recordAuditEvent("EMERGENCY_STOP_RELEASED", {
      sender
    });

    return [
      "✅ SYSTEM RESUMED",
      "",
      "AI execution is available.",
      "Robot task execution is available.",
      "Emergency stop is OFF."
    ].join("\n");
  }

  if (command === "STATUS") {
    recordAuditEvent("STATUS_REQUESTED", {
      sender
    });

    return [
      "🧠 SILENT STRATEGIST STATUS",
      "",
      `System: ONLINE`,
      `Policy Engine: ACTIVE`,
      `AI Router: ACTIVE`,
      `Verification: ACTIVE`,
      `Audit Logging: ACTIVE`,
      `Emergency Stop: ${
        SYSTEM_STATE.emergencyStop ? "ACTIVE" : "OFF"
      }`,
      `Robot Controller: ACTIVE`,
      `Robot Mode: SIMULATION`,
      `Policy Version: ${POLICY.version}`,
      `Robot Battery: ${ROBOT_STATE.battery}%`,
      `Robot Status: ${ROBOT_STATE.status}`
    ].join("\n");
  }

  return null;
}

// ============================================================
// AI CAPABILITY REGISTRY
// ============================================================

const AI_CAPABILITIES = {
  reasoning: {
    name: "Reasoning",
    enabled: true,
    provider: "openai",
    model: "gpt-4o-mini"
  },

  image: {
    name: "Image",
    enabled: false
  },

  speech: {
    name: "Speech",
    enabled: false
  },

  coding: {
    name: "Coding",
    enabled: false
  },

  research: {
    name: "Research",
    enabled: false
  },

  robotics: {
    name: "Robotics",
    enabled: true,
    mode: "simulation"
  }
};

// ============================================================
// TASK CLASSIFIER
// ============================================================

function classifyTask(text) {
  const message = String(text || "").trim();

  if (!message) {
    return {
      type: "unknown",
      capability: null
    };
  }

  const upper = message.toUpperCase();

  if (isRobotCommand(upper)) {
    return {
      type: "robot",
      capability: "robotics"
    };
  }

  return {
    type: "reasoning",
    capability: "reasoning"
  };
}

// ============================================================
// POLICY ENGINE
// ============================================================

function evaluatePolicy(sender, task) {
  if (SYSTEM_STATE.emergencyStop) {
    return {
      allowed: false,
      reason: "Emergency stop is active."
    };
  }

  if (!task || !task.capability) {
    return {
      allowed: false,
      reason: "No valid capability identified."
    };
  }

  const capability = AI_CAPABILITIES[task.capability];

  if (!capability) {
    return {
      allowed: false,
      reason: "Capability does not exist."
    };
  }

  if (!capability.enabled) {
    return {
      allowed: false,
      reason: `Capability '${task.capability}' is disabled.`
    };
  }

  if (task.type === "robot" && !isAdmin(sender)) {
    return {
      allowed: false,
      reason: "Robot control requires administrator authorization."
    };
  }

  return {
    allowed: true,
    reason: "Policy approved."
  };
}

// ============================================================
// AI ROUTER
// ============================================================

function routeAI(task) {
  if (!task || !task.capability) {
    return null;
  }

  const capability = AI_CAPABILITIES[task.capability];

  if (!capability || !capability.enabled) {
    return null;
  }

  if (capability.provider === "openai") {
    return {
      provider: "openai",
      model: capability.model
    };
  }

  return null;
}

// ============================================================
// OPENAI PROVIDER
// ============================================================

async function askOpenAI(text) {
  if (!openai) {
    throw new Error("OPENAI_API_KEY is not configured.");
  }

  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",

    messages: [
      {
        role: "system",
        content:
          "You are the reasoning component of The Silent Strategist AI. Follow the system's policy and human-authority boundaries. Give useful, clear and responsible answers."
      },
      {
        role: "user",
        content: text
      }
    ],

    temperature: 0.7
  });

  return response.choices?.[0]?.message?.content?.trim() || "";
}

// ============================================================
// PROVIDER DISPATCHER
// ============================================================

async function dispatchToProvider(route, text) {
  if (!route) {
    throw new Error("No AI route available.");
  }

  if (route.provider === "openai") {
    return await askOpenAI(text);
  }

  throw new Error(`Unsupported AI provider: ${route.provider}`);
}

// ============================================================
// RESPONSE VERIFICATION
// ============================================================

function verifyAIResponse(response) {
  if (!response || typeof response !== "string") {
    return {
      verified: false,
      reason: "Empty or invalid AI response."
    };
  }

  if (response.length > 10000) {
    return {
      verified: false,
      reason: "Response exceeds safety length limit."
    };
  }

  return {
    verified: true,
    reason: "Response passed basic verification."
  };
}

// ============================================================
// ROBOT CONTROLLER
// ============================================================

const ROBOT_STATE = {
  id: "silent-strategist-robot-01",

  position: {
    x: 0,
    y: 0
  },

  battery: 100,

  status: "IDLE",

  destination: null,

  lastTask: null
};

const ROBOT_LOCATIONS = {
  chargingStation: {
    name: "Charging Station",
    x: 5,
    y: 5
  }
};

function getRobotStatus() {
  return {
    id: ROBOT_STATE.id,

    position: {
      ...ROBOT_STATE.position
    },

    battery: ROBOT_STATE.battery,

    status: ROBOT_STATE.status,

    destination: ROBOT_STATE.destination,

    lastTask: ROBOT_STATE.lastTask
  };
}

function isRobotCommand(text) {
  const upper = String(text || "").trim().toUpperCase();

  return (
    upper === "GO TO CHARGING STATION" ||
    upper === "GO TO THE CHARGING STATION"
  );
}

function calculateRobotRoute(start, destination) {
  const route = [];

  let x = start.x;
  let y = start.y;

  while (x !== destination.x) {
    x += x < destination.x ? 1 : -1;

    route.push({
      x,
      y
    });
  }

  while (y !== destination.y) {
    y += y < destination.y ? 1 : -1;

    route.push({
      x,
      y
    });
  }

  return route;
}

async function executeRobotTask(sender, text) {
  if (!isAdmin(sender)) {
    recordAuditEvent("ROBOT_UNAUTHORIZED", {
      sender,
      task: text
    });

    return "Authorization required. Robot control is restricted to the administrator.";
  }

  if (SYSTEM_STATE.emergencyStop) {
    return "🛑 Robot task blocked. Emergency stop is active.";
  }

  if (ROBOT_STATE.battery < 10) {
    recordAuditEvent("ROBOT_TASK_BLOCKED_LOW_BATTERY", {
      sender,
      battery: ROBOT_STATE.battery
    });

    return `🔋 Robot task blocked. Battery is too low: ${ROBOT_STATE.battery}%.`;
  }

  const destination = ROBOT_LOCATIONS.chargingStation;

  ROBOT_STATE.destination = destination.name;
  ROBOT_STATE.lastTask = text;
  ROBOT_STATE.status = "PLANNING";

  const route = calculateRobotRoute(
    ROBOT_STATE.position,
    destination
  );

  recordAuditEvent("ROBOT_TASK_PLANNED", {
    sender,
    task: text,
    destination,
    routeLength: route.length
  });

  ROBOT_STATE.status = "MOVING";

  for (const step of route) {
    if (SYSTEM_STATE.emergencyStop) {
      ROBOT_STATE.status = "STOPPED";

      recordAuditEvent("ROBOT_TASK_INTERRUPTED", {
        sender,
        reason: "Emergency stop activated.",
        position: ROBOT_STATE.position
      });

      return [
        "🛑 ROBOT STOPPED",
        "",
        "Emergency stop was activated during movement.",
        `Current position: (${ROBOT_STATE.position.x}, ${ROBOT_STATE.position.y})`,
        `Battery: ${ROBOT_STATE.battery}%`
      ].join("\n");
    }

    ROBOT_STATE.position = {
      x: step.x,
      y: step.y
    };

    ROBOT_STATE.battery = Math.max(
      0,
      ROBOT_STATE.battery - 1
    );

    await new Promise((resolve) =>
      setTimeout(resolve, 150)
    );
  }

  const reachedDestination =
    ROBOT_STATE.position.x === destination.x &&
    ROBOT_STATE.position.y === destination.y;

  if (!reachedDestination) {
    ROBOT_STATE.status = "ERROR";

    recordAuditEvent("ROBOT_VERIFICATION_FAILED", {
      sender,
      position: ROBOT_STATE.position,
      destination
    });

    return "❌ Robot verification failed. Destination was not reached.";
  }

  ROBOT_STATE.status = "CHARGING";

  recordAuditEvent("ROBOT_DESTINATION_VERIFIED", {
    sender,
    destination,
    position: ROBOT_STATE.position
  });

  // Simulation of charging.
  ROBOT_STATE.battery = 100;

  ROBOT_STATE.status = "IDLE";

  recordAuditEvent("ROBOT_TASK_COMPLETED", {
    sender,
    task: text,
    destination,
    finalPosition: ROBOT_STATE.position,
    battery: ROBOT_STATE.battery
  });

  return [
    "🤖 ROBOT TASK COMPLETE",
    "",
    `Destination: ${destination.name}`,
    `Position: (${ROBOT_STATE.position.x}, ${ROBOT_STATE.position.y})`,
    `Battery: ${ROBOT_STATE.battery}%`,
    "Verification: PASSED",
    "Status: IDLE",
    "",
    "Task recorded in audit log."
  ].join("\n");
}

// ============================================================
// ORCHESTRATOR
// ============================================================

async function processMessage(sender, text) {
  if (SYSTEM_STATE.emergencyStop) {
    return "🛑 Emergency stop is active. Send RESUME to restore normal AI execution.";
  }

  const task = classifyTask(text);

  recordAuditEvent("TASK_CLASSIFIED", {
    sender,
    text,
    task
  });

  const policyResult = evaluatePolicy(sender, task);

  recordAuditEvent("POLICY_EVALUATED", {
    sender,
    task,
    allowed: policyResult.allowed,
    reason: policyResult.reason
  });

  if (!policyResult.allowed) {
    return `Request blocked: ${policyResult.reason}`;
  }

  // Robot tasks are handled by the robot controller.
  if (task.type === "robot") {
    return await executeRobotTask(sender, text);
  }

  const route = routeAI(task);

  recordAuditEvent("AI_ROUTE_SELECTED", {
    sender,
    task,
    route
  });

  try {
    const response = await dispatchToProvider(
      route,
      text
    );

    const verification = verifyAIResponse(response);

    recordAuditEvent("AI_RESPONSE_VERIFICATION", {
      sender,
      verified: verification.verified,
      reason: verification.reason
    });

    if (!verification.verified) {
      return "The AI response failed verification and was not released.";
    }

    recordAuditEvent("AI_RESPONSE_APPROVED", {
      sender
    });

    return response;
  } catch (error) {
    recordAuditEvent("AI_PROVIDER_ERROR", {
      sender,
      error: error.message
    });

    throw error;
  }
}

// ============================================================
// WHATSAPP SENDER
// ============================================================

async function sendWhatsAppMessage(to, text) {
  const recipient = normalizeWhatsAppNumber(to);

  if (!recipient) {
    throw new Error("Invalid WhatsApp recipient number.");
  }

  if (!WHATSAPP_ACCESS_TOKEN) {
    throw new Error("WHATSAPP_ACCESS_TOKEN is not configured.");
  }

  if (!WHATSAPP_PHONE_NUMBER_ID) {
    throw new Error("WHATSAPP_PHONE_NUMBER_ID is not configured.");
  }

  const url =
    `https://graph.facebook.com/v23.0/` +
    `${WHATSAPP_PHONE_NUMBER_ID}/messages`;

  const payload = {
    messaging_product: "whatsapp",

    recipient_type: "individual",

    to: recipient,

    type: "text",

    text: {
      preview_url: false,
      body: text
    }
  };

  console.log("WhatsApp outgoing recipient:", recipient);

  const response = await fetch(url, {
    method: "POST",

    headers: {
      Authorization: `Bearer ${WHATSAPP_ACCESS_TOKEN}`,
      "Content-Type": "application/json"
    },

    body: JSON.stringify(payload)
  });

  const responseText = await response.text();

  let data;

  try {
    data = JSON.parse(responseText);
  } catch {
    data = {
      raw: responseText
    };
  }

  console.log(
    "WhatsApp API response:",
    JSON.stringify(data, null, 2)
  );

  if (!response.ok) {
    throw new Error(
      `WhatsApp API failed: ${JSON.stringify(data)}`
    );
  }

  return data;
}

// ============================================================
// HTTP SERVER
// ============================================================

const server = http.createServer(async (req, res) => {
  try {
    // --------------------------------------------------------
    // HEALTH CHECK
    // --------------------------------------------------------

    if (req.method === "GET" && req.url === "/") {
      res.writeHead(200, {
        "Content-Type": "text/plain"
      });

      res.end(
        [
          "The Silent Strategist AI running on port " + PORT,
          "",
          "Policy Engine: ACTIVE",
          "Task Classifier: ACTIVE",
          "AI Capability Registry: ACTIVE",
          "AI Router: ACTIVE",
          "Provider Adapter Layer: ACTIVE",
          "Verification Layer: ACTIVE",
          "Audit Logging: ACTIVE",
          "Emergency Stop: ACTIVE",
          "Robot Controller: ACTIVE",
          "",
          `Policy Version: ${POLICY.version}`,
          `Emergency Stop: ${
            SYSTEM_STATE.emergencyStop
              ? "ACTIVE"
              : "OFF"
          }`,
          `Robot Status: ${ROBOT_STATE.status}`,
          `Robot Battery: ${ROBOT_STATE.battery}%`
        ].join("\n")
      );

      return;
    }

    // --------------------------------------------------------
    // CAPABILITIES
    // --------------------------------------------------------

    if (
      req.method === "GET" &&
      req.url === "/capabilities"
    ) {
      res.writeHead(200, {
        "Content-Type": "application/json"
      });

      res.end(
        JSON.stringify(
          AI_CAPABILITIES,
          null,
          2
        )
      );

      return;
    }

    // --------------------------------------------------------
    // ROBOT STATUS
    // --------------------------------------------------------

    if (
      req.method === "GET" &&
      req.url === "/robot"
    ) {
      res.writeHead(200, {
        "Content-Type": "application/json"
      });

      res.end(
        JSON.stringify(
          getRobotStatus(),
          null,
          2
        )
      );

      return;
    }

    // --------------------------------------------------------
    // WEBHOOK VERIFICATION
    // --------------------------------------------------------

    if (
      req.method === "GET" &&
      req.url.startsWith("/webhook")
    ) {
      const url = new URL(
        req.url,
        `http://${req.headers.host}`
      );

      const mode =
        url.searchParams.get("hub.mode");

      const token =
        url.searchParams.get("hub.verify_token");

      const challenge =
        url.searchParams.get("hub.challenge");

      if (
        mode === "subscribe" &&
        token === WEBHOOK_VERIFY_TOKEN
      ) {
        console.log(
          "Webhook verified successfully."
        );

        res.writeHead(200, {
          "Content-Type": "text/plain"
        });

        res.end(challenge);

        return;
      }

      res.writeHead(403);
      res.end("Forbidden");

      return;
    }

    // --------------------------------------------------------
    // WEBHOOK POST
    // --------------------------------------------------------

    if (
      req.method === "POST" &&
      req.url === "/webhook"
    ) {
      console.log(
        "STEP 1: POST /webhook received"
      );

      let body = "";

      req.on("data", (chunk) => {
        body += chunk.toString();
      });

      req.on("end", async () => {
        try {
          const payload = JSON.parse(body);

          console.log(
            "Webhook payload received:",
            JSON.stringify(
              payload,
              null,
              2
            )
          );

          const entries =
            payload.entry || [];

          for (const entry of entries) {
            const changes =
              entry.changes || [];

            for (const change of changes) {
              const value =
                change.value || {};

              const messages =
                value.messages || [];

              for (const message of messages) {
                if (message.type !== "text") {
                  continue;
                }

                const sender =
                  message.from;

                const text =
                  message.text?.body || "";

                console.log(
                  "WhatsApp sender:",
                  sender
                );

                console.log(
                  "WhatsApp message:",
                  text
                );

                // ------------------------------------------------
                // CONTROL COMMANDS
                // ------------------------------------------------

                const command =
                  String(text)
                    .trim()
                    .toUpperCase();

                if (
                  ["STOP", "RESUME", "STATUS"]
                    .includes(command)
                ) {
                  const controlResponse =
                    handleControlCommand(
                      sender,
                      text
                    );

                  if (controlResponse) {
                    console.log(
                      "STEP 6: Sending WhatsApp reply..."
                    );

                    try {
                      await sendWhatsAppMessage(
                        sender,
                        controlResponse
                      );
                    } catch (error) {
                      console.error(
                        "CONTROL RESPONSE ERROR:",
                        error.message
                      );

                      recordAuditEvent(
                        "CONTROL_RESPONSE_ERROR",
                        {
                          sender,
                          error: error.message
                        }
                      );
                    }

                    continue;
                  }
                }

                // ------------------------------------------------
                // ROBOT COMMANDS
                // ------------------------------------------------

                if (isRobotCommand(text)) {
                  try {
                    const robotResponse =
                      await executeRobotTask(
                        sender,
                        text
                      );

                    console.log(
                      "STEP 6: Sending WhatsApp reply..."
                    );

                    await sendWhatsAppMessage(
                      sender,
                      robotResponse
                    );
                  } catch (error) {
                    console.error(
                      "ROBOT RESPONSE ERROR:",
                      error.message
                    );

                    recordAuditEvent(
                      "ROBOT_RESPONSE_ERROR",
                      {
                        sender,
                        error: error.message
                      }
                    );
                  }

                  continue;
                }

                // ------------------------------------------------
                // NORMAL AI MESSAGE
                // ------------------------------------------------

                try {
                  const reply =
                    await processMessage(
                      sender,
                      text
                    );

                  console.log(
                    "STEP 6: Sending WhatsApp reply..."
                  );

                  await sendWhatsAppMessage(
                    sender,
                    reply
                  );
                } catch (error) {
                  console.error(
                    "MESSAGE PROCESSING ERROR:",
                    error.message
                  );

                  recordAuditEvent(
                    "MESSAGE_PROCESSING_ERROR",
                    {
                      sender,
                      error: error.message
                    }
                  );

                  // Try to notify the user.
                  try {
                    await sendWhatsAppMessage(
                      sender,
                      "The Silent Strategist encountered an internal processing error. Check the system logs."
                    );
                  } catch (sendError) {
                    console.error(
                      "ERROR RESPONSE SEND FAILED:",
                      sendError.message
                    );
                  }
                }
              }
            }
          }

          // Acknowledge Meta immediately.
          res.writeHead(200, {
            "Content-Type": "text/plain"
          });

          res.end("EVENT_RECEIVED");
        } catch (error) {
          console.error(
            "Webhook processing error:",
            error
          );

          res.writeHead(400, {
            "Content-Type": "text/plain"
          });

          res.end("Bad Request");
        }
      });

      return;
    }

    // --------------------------------------------------------
    // 404
    // --------------------------------------------------------

    res.writeHead(404, {
      "Content-Type": "text/plain"
    });

    res.end("Not Found");
  } catch (error) {
    console.error(
      "Server error:",
      error
    );

    if (!res.headersSent) {
      res.writeHead(500, {
        "Content-Type": "text/plain"
      });

      res.end("Internal Server Error");
    }
  }
});

// ============================================================
// START SERVER
// ============================================================

server.listen(PORT, () => {
  console.log(
    `The Silent Strategist AI running on port ${PORT}`
  );

  console.log(
    "Policy Engine: ACTIVE"
  );

  console.log(
    "Task Classifier: ACTIVE"
  );

  console.log(
    "AI Capability Registry: ACTIVE"
  );

  console.log(
    "AI Router: ACTIVE"
  );

  console.log(
    "Provider Adapter Layer: ACTIVE"
  );

  console.log(
    "Verification Layer: ACTIVE"
  );

  console.log(
    "Audit Logging: ACTIVE"
  );

  console.log(
    "Emergency Stop: ACTIVE"
  );

  console.log(
    "Robot Controller: ACTIVE"
  );

  console.log(
    `Policy Version: ${POLICY.version}`
  );
});
