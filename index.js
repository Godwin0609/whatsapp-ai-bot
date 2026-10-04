const http = require("http");
const crypto = require("crypto");
const OpenAI = require("openai");
const { Pool } = require("pg");

// ============================================================
// THE SILENT STRATEGIST AI
// ROBOTICS LAYER v2 — SECURE CONTROLLER + SIMULATION MODE
// ============================================================

// ============================================================
// ENVIRONMENT VARIABLES
// ============================================================

const PORT = process.env.PORT || 3000;

const WEBHOOK_VERIFY_TOKEN =
  process.env.WEBHOOK_VERIFY_TOKEN;

const WHATSAPP_ACCESS_TOKEN =
  process.env.WHATSAPP_ACCESS_TOKEN;

const WHATSAPP_PHONE_NUMBER_ID =
  process.env.WHATSAPP_PHONE_NUMBER_ID;

const OPENAI_API_KEY =
  process.env.OPENAI_API_KEY;

const ADMIN_PHONE_NUMBER =
  process.env.ADMIN_PHONE_NUMBER;

const DATABASE_URL =
  process.env.DATABASE_URL;

// New secure robot-controller secret.
// Keep this ONLY in Render Environment Variables.
const ROBOT_CONTROLLER_TOKEN =
  process.env.ROBOT_CONTROLLER_TOKEN;

// ============================================================
// ROBOT CONTROLLER CONFIGURATION
// ============================================================

const ROBOT_CONTROLLER = {
  enabled: Boolean(ROBOT_CONTROLLER_TOKEN),

  mode: "simulation",

  protocol: "authenticated-http",

  version: "2.0.0",

  heartbeatTimeoutMs: 30000,

  lastHeartbeat: null,

  connected: false,

  hardwareConnected: false,
};

// ============================================================
// POSTGRESQL
// ============================================================

if (!DATABASE_URL) {
  console.error(
    "[DATABASE] DATABASE_URL is not configured."
  );

  process.exit(1);
}

const pool = new Pool({
  connectionString: DATABASE_URL,

  ssl: {
    rejectUnauthorized: false,
  },

  max: 5,

  idleTimeoutMillis: 30000,

  connectionTimeoutMillis: 10000,
});

pool.on("error", (error) => {
  console.error(
    "[DATABASE] Unexpected PostgreSQL pool error:",
    error
  );
});

// ============================================================
// OPENAI
// ============================================================

const openai = OPENAI_API_KEY
  ? new OpenAI({
      apiKey: OPENAI_API_KEY,
    })
  : null;

// ============================================================
// POLICY ENGINE
// ============================================================

const POLICY = {
  version: "4.0.0",

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
      version: "2.0.0",
    },
  },
};

// ============================================================
// SYSTEM STATE
// ============================================================

const SYSTEM_STATE = {
  emergencyStop: false,

  version: "4.0.0",
};

// ============================================================
// ROBOT SAFETY LIMITS
// ============================================================

const ROBOT_SAFETY = {
  maximumMoveDistance: 10,

  maximumTurnDegrees: 180,

  minimumBatteryForMovement: 10,

  simulationStepDelayMs: 150,

  batteryUsagePerStep: 1,

  controllerHeartbeatTimeoutMs: 30000,
};

// ============================================================
// ROBOT STATE
// ============================================================

const ROBOT_STATE = {
  id: "silent-strategist-robot-01",

  status: "IDLE",

  battery: 100,

  position: {
    x: 0,
    y: 0,
  },

  orientation: 0,

  destination: null,

  currentCommand: null,

  lastTask: null,

  lastUpdated: new Date().toISOString(),
};

// ============================================================
// CHARGING STATION
// ============================================================

const CHARGING_STATION = {
  x: 5,
  y: 5,
};

// ============================================================
// DATABASE INITIALIZATION
// ============================================================

async function initializeDatabase() {
  console.log(
    "[DATABASE] Connecting to PostgreSQL..."
  );

  await pool.query(`
    CREATE TABLE IF NOT EXISTS audit_events (
      id TEXT PRIMARY KEY,
      timestamp TIMESTAMPTZ NOT NULL,
      type TEXT NOT NULL,
      data JSONB NOT NULL DEFAULT '{}'::jsonb
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_audit_events_timestamp
    ON audit_events (timestamp DESC)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_audit_events_type
    ON audit_events (type)
  `);

  console.log(
    "[DATABASE] PostgreSQL connected."
  );
}

// ============================================================
// AUDIT LOG
// ============================================================

const auditLog = [];

const MAX_AUDIT_LOG_SIZE = 1000;

function recordAuditEvent(type, data = {}) {
  const event = {
    id:
      `AUDIT-${Date.now()}-` +
      `${Math.floor(Math.random() * 10000)}`,

    timestamp:
      new Date().toISOString(),

    type,

    ...data,
  };

  auditLog.push(event);

  if (
    auditLog.length >
    MAX_AUDIT_LOG_SIZE
  ) {
    auditLog.shift();
  }

  console.log(
    "[AUDIT]",
    JSON.stringify(event)
  );

  pool
    .query(
      `
      INSERT INTO audit_events (
        id,
        timestamp,
        type,
        data
      )
      VALUES ($1, $2, $3, $4::jsonb)
      ON CONFLICT (id) DO NOTHING
      `,
      [
        event.id,
        event.timestamp,
        event.type,
        JSON.stringify(data),
      ]
    )
    .catch((error) => {
      console.error(
        "[DATABASE] Failed to persist audit:",
        error.message
      );
    });

  return event;
}

// ============================================================
// WHATSAPP NUMBER NORMALIZATION
// ============================================================

function normalizeWhatsAppNumber(number) {
  if (!number) {
    return "";
  }

  let normalized =
    String(number).replace(/\D/g, "");

  if (normalized.startsWith("0")) {
    normalized =
      "234" +
      normalized.substring(1);
  }

  return normalized;
}

// ============================================================
// ADMIN CHECK
// ============================================================

function isAdmin(sender) {
  const normalizedSender =
    normalizeWhatsAppNumber(sender);

  const normalizedAdmin =
    normalizeWhatsAppNumber(
      ADMIN_PHONE_NUMBER
    );

  return (
    normalizedSender &&
    normalizedAdmin &&
    normalizedSender ===
      normalizedAdmin
  );
}

// ============================================================
// SECURE ROBOT CONTROLLER AUTHENTICATION
// ============================================================

function safeTokenCompare(
  suppliedToken,
  expectedToken
) {
  if (
    !suppliedToken ||
    !expectedToken
  ) {
    return false;
  }

  const supplied =
    Buffer.from(
      String(suppliedToken),
      "utf8"
    );

  const expected =
    Buffer.from(
      String(expectedToken),
      "utf8"
    );

  if (
    supplied.length !==
    expected.length
  ) {
    return false;
  }

  return crypto.timingSafeEqual(
    supplied,
    expected
  );
}

function authenticateRobotController(
  req
) {
  if (!ROBOT_CONTROLLER_TOKEN) {
    return {
      authenticated: false,

      reason:
        "Robot controller token is not configured.",
    };
  }

  const authorization =
    req.headers.authorization || "";

  if (
    !authorization.startsWith(
      "Bearer "
    )
  ) {
    return {
      authenticated: false,

      reason:
        "Missing Bearer authentication.",
    };
  }

  const suppliedToken =
    authorization.substring(7).trim();

  if (
    !safeTokenCompare(
      suppliedToken,
      ROBOT_CONTROLLER_TOKEN
    )
  ) {
    return {
      authenticated: false,

      reason:
        "Invalid robot controller credentials.",
    };
  }

  return {
    authenticated: true,
  };
}

// ============================================================
// ROBOT CONTROLLER HEARTBEAT
// ============================================================

function registerRobotHeartbeat() {
  ROBOT_CONTROLLER.lastHeartbeat =
    new Date().toISOString();

  ROBOT_CONTROLLER.connected =
    true;

  recordAuditEvent(
    "ROBOT_CONTROLLER_HEARTBEAT",
    {
      robotId:
        ROBOT_STATE.id,

      mode:
        ROBOT_CONTROLLER.mode,

      hardwareConnected:
        ROBOT_CONTROLLER.hardwareConnected,
    }
  );
}

function getRobotControllerHealth() {
  let heartbeatHealthy = false;

  if (
    ROBOT_CONTROLLER.lastHeartbeat
  ) {
    const age =
      Date.now() -
      new Date(
        ROBOT_CONTROLLER.lastHeartbeat
      ).getTime();

    heartbeatHealthy =
      age <=
      ROBOT_SAFETY
        .controllerHeartbeatTimeoutMs;
  }

  return {
    enabled:
      ROBOT_CONTROLLER.enabled,

    mode:
      ROBOT_CONTROLLER.mode,

    protocol:
      ROBOT_CONTROLLER.protocol,

    version:
      ROBOT_CONTROLLER.version,

    authenticated:
      ROBOT_CONTROLLER.enabled,

    heartbeat:
      heartbeatHealthy
        ? "HEALTHY"
        : "WAITING",

    lastHeartbeat:
      ROBOT_CONTROLLER.lastHeartbeat,

    hardwareConnected:
      ROBOT_CONTROLLER.hardwareConnected,

    emergencyStop:
      SYSTEM_STATE.emergencyStop,
  };
}

// ============================================================
// AUTHORIZATION SYSTEM
// ============================================================

const pendingAuthorizations =
  new Map();

const AUTHORIZATION_TIMEOUT_MS =
  5 * 60 * 1000;

function clearAuthorization(
  sender,
  reason = "cleared"
) {
  const normalizedSender =
    normalizeWhatsAppNumber(sender);

  const existing =
    pendingAuthorizations.get(
      normalizedSender
    );

  if (!existing) {
    return null;
  }

  pendingAuthorizations.delete(
    normalizedSender
  );

  recordAuditEvent(
    "AUTHORIZATION_CLEARED",
    {
      sender: normalizedSender,

      task: existing.task,

      reason,
    }
  );

  return existing;
}

function createAuthorizationRequest(
  sender,
  task,
  originalText,
  command = null
) {
  const normalizedSender =
    normalizeWhatsAppNumber(sender);

  if (
    pendingAuthorizations.has(
      normalizedSender
    )
  ) {
    clearAuthorization(
      sender,
      "replaced_by_new_request"
    );
  }

  const createdAt = Date.now();

  const expiresAt =
    createdAt +
    AUTHORIZATION_TIMEOUT_MS;

  const request = {
    sender: normalizedSender,

    task,

    originalText,

    command,

    createdAt,

    expiresAt,
  };

  pendingAuthorizations.set(
    normalizedSender,
    request
  );

  const audit =
    recordAuditEvent(
      "AUTHORIZATION_PROPOSED",
      {
        sender: normalizedSender,

        task,

        originalText,

        command,

        expiresAt:
          new Date(
            expiresAt
          ).toISOString(),
      }
    );

  return {
    ...request,

    auditId: audit.id,
  };
}

function getPendingAuthorization(
  sender
) {
  const normalizedSender =
    normalizeWhatsAppNumber(sender);

  const request =
    pendingAuthorizations.get(
      normalizedSender
    );

  if (!request) {
    return null;
  }

  if (
    Date.now() >
    request.expiresAt
  ) {
    pendingAuthorizations.delete(
      normalizedSender
    );

    recordAuditEvent(
      "AUTHORIZATION_EXPIRED",
      {
        sender: normalizedSender,

        task: request.task,
      }
    );

    return null;
  }

  return request;
}

// ============================================================
// ROBOT COMMAND PARSER
// ============================================================

function parseRobotCommand(text) {
  const original =
    String(text || "").trim();

  const normalized =
    original.toUpperCase();

  if (
    normalized === "ROBOT STATUS" ||
    normalized === "ROBOT STATE"
  ) {
    return {
      type: "STATUS",
    };
  }

  if (
    normalized === "ROBOT STOP"
  ) {
    return {
      type: "STOP",
    };
  }

  if (
    normalized ===
      "ROBOT GO CHARGING" ||
    normalized ===
      "ROBOT GO TO CHARGING STATION" ||
    normalized ===
      "GO TO CHARGING STATION" ||
    normalized ===
      "GO TO THE CHARGING STATION"
  ) {
    return {
      type: "GO_CHARGING",
    };
  }

  const moveMatch =
    normalized.match(
      /^ROBOT\s+MOVE\s+(FORWARD|BACKWARD)\s+(\d+(?:\.\d+)?)$/
    );

  if (moveMatch) {
    return {
      type: "MOVE",

      direction:
        moveMatch[1].toLowerCase(),

      distance:
        Number(moveMatch[2]),
    };
  }

  const turnMatch =
    normalized.match(
      /^ROBOT\s+TURN\s+(LEFT|RIGHT)(?:\s+(\d+(?:\.\d+)?))?$/
    );

  if (turnMatch) {
    return {
      type: "TURN",

      direction:
        turnMatch[1].toLowerCase(),

      degrees:
        turnMatch[2]
          ? Number(turnMatch[2])
          : 90,
    };
  }

  return null;
}

// ============================================================
// ROBOT COMMAND SAFETY VALIDATION
// ============================================================

function validateRobotCommand(
  command
) {
  if (!command) {
    return {
      allowed: false,

      reason:
        "No valid robot command was detected.",
    };
  }

  if (
    SYSTEM_STATE.emergencyStop
  ) {
    return {
      allowed: false,

      reason:
        "Emergency Stop is active.",
    };
  }

  if (
    command.type === "STATUS"
  ) {
    return {
      allowed: true,
    };
  }

  if (
    command.type === "STOP"
  ) {
    return {
      allowed: true,
    };
  }

  if (
    command.type === "MOVE"
  ) {
    if (
      !Number.isFinite(
        command.distance
      )
    ) {
      return {
        allowed: false,

        reason:
          "Invalid movement distance.",
      };
    }

    if (
      command.distance <= 0
    ) {
      return {
        allowed: false,

        reason:
          "Movement distance must be greater than zero.",
      };
    }

    if (
      command.distance >
      ROBOT_SAFETY.maximumMoveDistance
    ) {
      return {
        allowed: false,

        reason:
          `Maximum movement distance is ` +
          `${ROBOT_SAFETY.maximumMoveDistance} units.`,
      };
    }

    if (
      ROBOT_STATE.battery <
      ROBOT_SAFETY.minimumBatteryForMovement
    ) {
      return {
        allowed: false,

        reason:
          `Battery is too low for movement. ` +
          `Current battery: ${ROBOT_STATE.battery}%.`,
      };
    }
  }

  if (
    command.type === "TURN"
  ) {
    if (
      !Number.isFinite(
        command.degrees
      )
    ) {
      return {
        allowed: false,

        reason:
          "Invalid turning angle.",
      };
    }

    if (
      command.degrees <= 0
    ) {
      return {
        allowed: false,

        reason:
          "Turning angle must be greater than zero.",
      };
    }

    if (
      command.degrees >
      ROBOT_SAFETY.maximumTurnDegrees
    ) {
      return {
        allowed: false,

        reason:
          `Maximum turn is ` +
          `${ROBOT_SAFETY.maximumTurnDegrees} degrees.`,
      };
    }
  }

  return {
    allowed: true,
  };
}

// ============================================================
// ROBOT STATUS
// ============================================================

function getRobotStatusText() {
  const controllerHealth =
    getRobotControllerHealth();

  return (
    "🤖 ROBOT STATUS\n\n" +

    `ID: ${ROBOT_STATE.id}\n` +

    `Mode: ${POLICY.capabilities.robotics.mode.toUpperCase()}\n` +

    `Status: ${ROBOT_STATE.status}\n` +

    `Battery: ${ROBOT_STATE.battery}%\n` +

    `Position: (${ROBOT_STATE.position.x}, ${ROBOT_STATE.position.y})\n` +

    `Orientation: ${ROBOT_STATE.orientation}°\n` +

    `Destination: ${
      ROBOT_STATE.destination
        ? `(${ROBOT_STATE.destination.x}, ${ROBOT_STATE.destination.y})`
        : "None"
    }\n` +

    `Last Task: ${
      ROBOT_STATE.lastTask || "None"
    }\n` +

    `Emergency Stop: ${
      SYSTEM_STATE.emergencyStop
        ? "ON"
        : "OFF"
    }\n` +

    "Safety Controller: ACTIVE\n" +

    `Secure Controller: ${
      controllerHealth.enabled
        ? "ACTIVE"
        : "NOT CONFIGURED"
    }\n` +

    `Controller Heartbeat: ${
      controllerHealth.heartbeat
    }\n` +

    `Hardware Connection: ${
      ROBOT_CONTROLLER.hardwareConnected
        ? "CONNECTED"
        : "NOT CONNECTED"
    }\n` +

    "Simulation: ACTIVE"
  );
}

// ============================================================
// ROBOT ROUTE CALCULATOR
// ============================================================

function calculateRobotRoute(
  start,
  destination
) {
  const route = [];

  let currentX = start.x;

  let currentY = start.y;

  while (
    currentX !==
    destination.x
  ) {
    currentX +=
      destination.x >
      currentX
        ? 1
        : -1;

    route.push({
      x: currentX,

      y: currentY,
    });
  }

  while (
    currentY !==
    destination.y
  ) {
    currentY +=
      destination.y >
      currentY
        ? 1
        : -1;

    route.push({
      x: currentX,

      y: currentY,
    });
  }

  return route;
}

// ============================================================
// SIMULATED ROBOT MOVEMENT
// ============================================================

async function simulateMove(
  sender,
  command,
  authorizationId
) {
  ROBOT_STATE.status =
    "MOVING";

  ROBOT_STATE.currentCommand =
    command;

  ROBOT_STATE.lastTask =
    JSON.stringify(command);

  ROBOT_STATE.lastUpdated =
    new Date().toISOString();

  recordAuditEvent(
    "ROBOT_MOVEMENT_STARTED",
    {
      sender:
        normalizeWhatsAppNumber(
          sender
        ),

      command,

      authorizationId:
        authorizationId || null,
    }
  );

  const steps =
    Math.ceil(command.distance);

  for (
    let i = 0;
    i < steps;
    i++
  ) {
    if (
      SYSTEM_STATE.emergencyStop
    ) {
      ROBOT_STATE.status =
        "STOPPED";

      ROBOT_STATE.currentCommand =
        null;

      recordAuditEvent(
        "ROBOT_MOVEMENT_INTERRUPTED",
        {
          sender:
            normalizeWhatsAppNumber(
              sender
            ),

          reason:
            "Emergency Stop activated.",
        }
      );

      return (
        "🛑 ROBOT MOVEMENT INTERRUPTED\n\n" +
        "Emergency Stop was activated."
      );
    }

    await new Promise(
      (resolve) =>
        setTimeout(
          resolve,
          ROBOT_SAFETY
            .simulationStepDelayMs
        )
    );

    const movement =
      command.direction ===
      "forward"
        ? 1
        : -1;

    const radians =
      (ROBOT_STATE.orientation *
        Math.PI) /
      180;

    ROBOT_STATE.position.x +=
      Math.round(
        Math.sin(radians) *
          movement
      );

    ROBOT_STATE.position.y +=
      Math.round(
        Math.cos(radians) *
          movement
      );

    ROBOT_STATE.battery =
      Math.max(
        0,

        ROBOT_STATE.battery -
          ROBOT_SAFETY
            .batteryUsagePerStep
      );

    ROBOT_STATE.lastUpdated =
      new Date().toISOString();

    console.log(
      `[ROBOT] Position: ` +
        `(${ROBOT_STATE.position.x}, ` +
        `${ROBOT_STATE.position.y}) ` +
        `Battery: ${ROBOT_STATE.battery}%`
    );
  }

  ROBOT_STATE.status =
    "IDLE";

  ROBOT_STATE.currentCommand =
    null;

  ROBOT_STATE.lastUpdated =
    new Date().toISOString();

  const audit =
    recordAuditEvent(
      "ROBOT_MOVEMENT_COMPLETED",
      {
        sender:
          normalizeWhatsAppNumber(
            sender
  ),

        command,

        position:
          ROBOT_STATE.position,

        battery:
          ROBOT_STATE.battery,

        authorizationId:
          authorizationId || null,
      }
    );

  return (
    "✅ ROBOT MOVEMENT COMPLETED\n\n" +
    `Direction: ${command.direction}\n` +
    `Distance: ${command.distance}\n` +
    `Position: (${ROBOT_STATE.position.x}, ${ROBOT_STATE.position.y})\n` +
    `Battery: ${ROBOT_STATE.battery}%\n` +
    `Audit ID: ${audit.id}`
  );
}

// ============================================================
// SIMULATED ROBOT TURN
// ============================================================

async function simulateTurn(
  sender,
  command,
  authorizationId
) {
  ROBOT_STATE.status =
    "TURNING";

  ROBOT_STATE.currentCommand =
    command;

  ROBOT_STATE.lastTask =
    JSON.stringify(command);

  await new Promise(
    (resolve) =>
      setTimeout(
        resolve,
        ROBOT_SAFETY
          .simulationStepDelayMs
      )
  );

  if (
    SYSTEM_STATE.emergencyStop
  ) {
    ROBOT_STATE.status =
      "STOPPED";

    ROBOT_STATE.currentCommand =
      null;

    recordAuditEvent(
      "ROBOT_TURN_INTERRUPTED",
      {
        sender:
          normalizeWhatsAppNumber(
            sender
          ),

        reason:
          "Emergency Stop activated.",
      }
    );

    return (
      "🛑 ROBOT TURN INTERRUPTED\n\n" +
      "Emergency Stop was activated."
    );
  }

  if (
    command.direction ===
    "left"
  ) {
    ROBOT_STATE.orientation -=
      command.degrees;
  } else {
    ROBOT_STATE.orientation +=
      command.degrees;
  }

  ROBOT_STATE.orientation =
    ((ROBOT_STATE.orientation %
      360) +
      360) %
    360;

  ROBOT_STATE.status =
    "IDLE";

  ROBOT_STATE.currentCommand =
    null;

  ROBOT_STATE.lastUpdated =
    new Date().toISOString();

  const audit =
    recordAuditEvent(
      "ROBOT_TURN_COMPLETED",
      {
        sender:
          normalizeWhatsAppNumber(
            sender
          ),

        command,

        orientation:
          ROBOT_STATE.orientation,

        authorizationId:
          authorizationId || null,
      }
    );

  return (
    "✅ ROBOT TURN COMPLETED\n\n" +
    `Direction: ${command.direction}\n` +
    `Degrees: ${command.degrees}\n` +
    `Orientation: ${ROBOT_STATE.orientation}°\n` +
    `Audit ID: ${audit.id}`
  );
    }
// ============================================================
// ROBOT CHARGING SIMULATION
// ============================================================

async function simulateCharging(
  sender,
  authorizationId
) {
  const route =
    calculateRobotRoute(
      ROBOT_STATE.position,
      CHARGING_STATION
    );

  ROBOT_STATE.status =
    "MOVING";

  ROBOT_STATE.destination =
    CHARGING_STATION;

  ROBOT_STATE.currentCommand =
    {
      type: "GO_CHARGING",
    };

  recordAuditEvent(
    "ROBOT_CHARGING_ROUTE_STARTED",
    {
      sender:
        normalizeWhatsAppNumber(
          sender
        ),

      destination:
        CHARGING_STATION,

      routeLength:
        route.length,

      authorizationId:
        authorizationId || null,
    }
  );

  for (
    const step of route
  ) {
    if (
      SYSTEM_STATE.emergencyStop
    ) {
      ROBOT_STATE.status =
        "STOPPED";

      ROBOT_STATE.destination =
        null;

      ROBOT_STATE.currentCommand =
        null;

      recordAuditEvent(
        "ROBOT_CHARGING_ROUTE_INTERRUPTED",
        {
          sender:
            normalizeWhatsAppNumber(
              sender
            ),

          reason:
            "Emergency Stop activated.",
        }
      );

      return (
        "🛑 ROBOT CHARGING ROUTE INTERRUPTED\n\n" +
        `Position: (${ROBOT_STATE.position.x}, ${ROBOT_STATE.position.y})`
      );
    }

    await new Promise(
      (resolve) =>
        setTimeout(
          resolve,
          ROBOT_SAFETY
            .simulationStepDelayMs
        )
    );

    ROBOT_STATE.position = {
      x: step.x,
      y: step.y,
    };

    ROBOT_STATE.battery =
      Math.max(
        0,

        ROBOT_STATE.battery -
          ROBOT_SAFETY
            .batteryUsagePerStep
      );
  }

  ROBOT_STATE.status =
    "CHARGING";

  ROBOT_STATE.currentCommand =
    null;

  await new Promise(
    (resolve) =>
      setTimeout(
        resolve,
        500
      )
  );

  ROBOT_STATE.battery =
    100;

  ROBOT_STATE.status =
    "IDLE";

  ROBOT_STATE.destination =
    null;

  ROBOT_STATE.lastUpdated =
    new Date().toISOString();

  const audit =
    recordAuditEvent(
      "ROBOT_CHARGING_COMPLETED",
      {
        sender:
          normalizeWhatsAppNumber(
            sender
          ),

        destination:
          CHARGING_STATION,

        finalPosition:
          ROBOT_STATE.position,

        battery:
          ROBOT_STATE.battery,

        authorizationId:
          authorizationId || null,
      }
    );

  return (
    "🔋 ROBOT CHARGING COMPLETED\n\n" +
    "Destination reached.\n" +
    `Position: (${ROBOT_STATE.position.x}, ${ROBOT_STATE.position.y})\n` +
    `Battery: ${ROBOT_STATE.battery}%\n` +
    `Audit ID: ${audit.id}`
  );
}

// ============================================================
// ROBOT EXECUTION
// ============================================================

async function executeRobotCommand(
  sender,
  command,
  options = {}
) {
  const normalizedSender =
    normalizeWhatsAppNumber(sender);

  if (!isAdmin(sender)) {
    recordAuditEvent(
      "UNAUTHORIZED_ROBOT_EXECUTION_ATTEMPT",
      {
        sender:
          normalizedSender,

        command,
      }
    );

    return (
      "⛔ Robot command denied.\n\n" +
      "Administrator authorization is required."
    );
  }

  if (
    !options.authorized
  ) {
    recordAuditEvent(
      "ROBOT_EXECUTION_BLOCKED_NO_AUTHORIZATION",
      {
        sender:
          normalizedSender,

        command,
      }
    );

    return (
      "⛔ Robot action requires explicit human authorization."
    );
  }

  const safety =
    validateRobotCommand(
      command
    );

  if (!safety.allowed) {
    recordAuditEvent(
      "ROBOT_COMMAND_REJECTED",
      {
        sender:
          normalizedSender,

        command,

        reason:
          safety.reason,
      }
    );

    return (
      "⛔ ROBOT COMMAND REJECTED\n\n" +
      `Reason: ${safety.reason}`
    );
  }

  if (
    command.type === "STATUS"
  ) {
    recordAuditEvent(
      "ROBOT_STATUS_REQUESTED",
      {
        sender:
          normalizedSender,
      }
    );

    return getRobotStatusText();
  }

  if (
    command.type === "STOP"
  ) {
    ROBOT_STATE.status =
      "STOPPED";

    ROBOT_STATE.currentCommand =
      null;

    recordAuditEvent(
      "ROBOT_STOPPED",
      {
        sender:
          normalizedSender,
      }
    );

    return (
      "🛑 ROBOT STOPPED\n\n" +
      "Simulation movement has stopped."
    );
  }

  if (
    command.type === "MOVE"
  ) {
    return await simulateMove(
      sender,
      command,
      options.authorizationId
    );
  }

  if (
    command.type === "TURN"
  ) {
    return await simulateTurn(
      sender,
      command,
      options.authorizationId
    );
  }

  if (
    command.type ===
    "GO_CHARGING"
  ) {
    return await simulateCharging(
      sender,
      options.authorizationId
    );
  }

  return (
    "⚠️ Robot command is not implemented."
  );
      }
  // ============================================================
// ROBOT CONTROLLER DISPATCH
// ============================================================

async function robotControllerDispatch(
  sender,
  command,
  authorizationId
) {
  recordAuditEvent(
    "ROBOT_CONTROLLER_DISPATCH",
    {
      robotId:
        ROBOT_STATE.id,

      sender:
        normalizeWhatsAppNumber(
          sender
        ),

      command,

      authorizationId:
        authorizationId || null,

      mode:
        ROBOT_CONTROLLER.mode,
    }
  );

  if (
    ROBOT_CONTROLLER.mode ===
    "simulation"
  ) {
    return await executeRobotCommand(
      sender,
      command,
      {
        authorized: true,

        authorizationId,
      }
    );
  }

  return (
    "⚠️ Hardware controller mode is not enabled."
  );
}

// ============================================================
// ROBOT COMMAND HELP
// ============================================================

function robotHelp() {
  return (
    "🤖 SILENT STRATEGIST ROBOT COMMANDS\n\n" +

    "ROBOT STATUS\n" +
    "Check robot state.\n\n" +

    "ROBOT MOVE FORWARD 2\n" +
    "Move forward 2 simulation units.\n\n" +

    "ROBOT MOVE BACKWARD 2\n" +
    "Move backward 2 simulation units.\n\n" +

    "ROBOT TURN LEFT 90\n" +
    "Turn left 90 degrees.\n\n" +

    "ROBOT TURN RIGHT 90\n" +
    "Turn right 90 degrees.\n\n" +

    "ROBOT GO CHARGING\n" +
    "Navigate to the charging station.\n\n" +

    "STOP\n" +
    "Activate the system Emergency Stop.\n\n" +

    "RESUME\n" +
    "Release Emergency Stop.\n\n" +

    "Every executable robot action requires administrator approval."
  );
}

// ============================================================
// CONTROL COMMANDS
// ============================================================

function isControlCommand(text) {
  const command =
    String(text || "")
      .trim()
      .toUpperCase();

  return (
    command === "STOP" ||
    command === "RESUME" ||
    command === "STATUS" ||
    command === "APPROVE" ||
    command === "DENY"
  );
}

// ============================================================
// CONTROL COMMAND HANDLER
// ============================================================

async function handleControlCommand(
  sender,
  text
) {
  const command =
    String(text || "")
      .trim()
      .toUpperCase();

  if (
    command === "APPROVE"
  ) {
    if (!isAdmin(sender)) {
      recordAuditEvent(
        "UNAUTHORIZED_APPROVAL_ATTEMPT",
        {
          sender:
            normalizeWhatsAppNumber(
              sender
            ),
        }
      );

      return (
        "⛔ Authorization denied.\n\n" +
        "Only the authorized administrator can approve actions."
      );
    }

    const pending =
      getPendingAuthorization(
        sender
      );

    if (!pending) {
      return (
        "ℹ️ No pending authorization request was found."
      );
    }

    if (
      SYSTEM_STATE.emergencyStop
    ) {
      clearAuthorization(
        sender,
        "emergency_stop_active"
      );

      return (
        "🛑 APPROVAL BLOCKED\n\n" +
        "Emergency Stop is active.\n" +
        "The pending action has been cancelled.\n\n" +
        "Use RESUME and submit the command again."
      );
    }

    recordAuditEvent(
      "AUTHORIZATION_APPROVED",
      {
        sender:
          normalizeWhatsAppNumber(
            sender
          ),

        task:
          pending.task,

        originalText:
          pending.originalText,

        command:
          pending.command,
      }
    );

    pendingAuthorizations.delete(
      normalizeWhatsAppNumber(
        sender
      )
    );

    if (
      pending.task ===
      "robotics"
    ) {
      return await robotControllerDispatch(
        sender,

        pending.command,

        `AUTH-${Date.now()}`
      );
    }

    return (
      "⚠️ Approved action type is not executable."
    );
  }

  if (
    command === "DENY"
  ) {
    if (!isAdmin(sender)) {
      recordAuditEvent(
        "UNAUTHORIZED_DENIAL_ATTEMPT",
        {
          sender:
            normalizeWhatsAppNumber(
              sender
            ),
        }
      );

      return (
        "⛔ Only the authorized administrator can deny pending actions."
      );
    }

    const pending =
      getPendingAuthorization(
        sender
      );

    if (!pending) {
      return (
        "ℹ️ No pending authorization request was found."
      );
    }

    pendingAuthorizations.delete(
      normalizeWhatsAppNumber(
        sender
      )
    );

    recordAuditEvent(
      "AUTHORIZATION_DENIED",
      {
        sender:
          normalizeWhatsAppNumber(
            sender
          ),

        task:
          pending.task,

        originalText:
          pending.originalText,

        command:
          pending.command,
      }
    );

    return (
      "❌ ACTION DENIED\n\n" +
      `Task: ${pending.originalText}\n` +
      "Status: Cancelled\n" +
      "No robot action was executed."
    );
  }

  if (
    command === "STOP"
  ) {
    if (!isAdmin(sender)) {
      recordAuditEvent(
        "UNAUTHORIZED_STOP_ATTEMPT",
        {
          sender:
            normalizeWhatsAppNumber(
              sender
            ),
        }
      );

      return (
        "⛔ STOP command denied.\n\n" +
        "Only the authorized administrator can control the system."
      );
    }

    SYSTEM_STATE.emergencyStop =
      true;

    ROBOT_STATE.status =
      "STOPPED";

    ROBOT_STATE.currentCommand =
      null;

    for (
      const [
        pendingSender,
        pending,
      ] of pendingAuthorizations.entries()
    ) {
      recordAuditEvent(
        "AUTHORIZATION_CANCELLED_BY_EMERGENCY_STOP",
        {
          sender:
            pendingSender,

          task:
            pending.task,
        }
      );
    }

    pendingAuthorizations.clear();

    recordAuditEvent(
      "EMERGENCY_STOP_ACTIVATED",
      {
        sender:
          normalizeWhatsAppNumber(
            sender
          ),
      }
    );

    return (
      "🛑 EMERGENCY STOP ACTIVATED\n\n" +
      "All executable actions are blocked.\n" +
      "Robot simulation has been stopped.\n" +
      "Pending authorizations have been cancelled.\n\n" +
      "Use RESUME to release the system."
    );
  }

  if (
    command === "RESUME"
  ) {
    if (!isAdmin(sender)) {
      recordAuditEvent(
        "UNAUTHORIZED_RESUME_ATTEMPT",
        {
          sender:
            normalizeWhatsAppNumber(
              sender
            ),
        }
      );

      return (
        "⛔ RESUME command denied."
      );
    }

    SYSTEM_STATE.emergencyStop =
      false;

    ROBOT_STATE.status =
      "IDLE";

    recordAuditEvent(
      "EMERGENCY_STOP_RELEASED",
      {
        sender:
          normalizeWhatsAppNumber(
            sender
          ),
      }
    );

    return (
      "🟢 SYSTEM RESUMED\n\n" +
      "Emergency Stop: OFF\n" +
      "Robot Controller: READY\n" +
      "Simulation: ACTIVE"
    );
  }

  if (
    command === "STATUS"
  ) {
    if (!isAdmin(sender)) {
      recordAuditEvent(
        "UNAUTHORIZED_STATUS_ATTEMPT",
        {
          sender:
            normalizeWhatsAppNumber(
              sender
            ),
        }
      );

      return (
        "⛔ STATUS access denied."
      );
    }

    const pending =
      getPendingAuthorization(
        sender
      );

    recordAuditEvent(
      "STATUS_REQUESTED",
      {
        sender:
          normalizeWhatsAppNumber(
            sender
          ),
      }
    );
    return (
      "🧠 SILENT STRATEGIST STATUS\n\n" +

      "System: ONLINE\n" +

      "Policy Engine: ACTIVE\n" +

      "AI Router: ACTIVE\n" +

      "Verification: ACTIVE\n" +

      "Audit Logging: ACTIVE\n" +

      "Persistent Storage: PostgreSQL\n" +

      "Human Authorization: ACTIVE\n" +

      `Emergency Stop: ${
        SYSTEM_STATE.emergencyStop
          ? "ON"
          : "OFF"
      }\n` +

      "Robot Controller: ACTIVE\n" +

      `Robot Mode: ${
        POLICY.capabilities
          .robotics.mode
          .toUpperCase()
      }\n` +

      `Robot Status: ${
        ROBOT_STATE.status
      }\n` +

      `Robot Battery: ${
        ROBOT_STATE.battery
      }%\n` +

      `Robot Position: (${
        ROBOT_STATE.position.x
      }, ${
        ROBOT_STATE.position.y
      })\n` +

      `Robot Orientation: ${
        ROBOT_STATE.orientation
      }°\n` +

      `Controller Security: ${
        ROBOT_CONTROLLER.enabled
          ? "ACTIVE"
          : "NOT CONFIGURED"
      }\n` +

      `Controller Heartbeat: ${
        getRobotControllerHealth()
          .heartbeat
      }\n` +

      `Pending Authorization: ${
        pending
          ? "YES"
          : "NO"
      }\n` +

      `Policy Version: ${
        POLICY.version
      }`
    );
  }

  return null;
}

// ============================================================
// AI CAPABILITY REGISTRY
// ============================================================

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

// ============================================================
// TASK CLASSIFICATION
// ============================================================

function classifyTask(text) {
  const robotCommand =
    parseRobotCommand(text);

  if (robotCommand) {
    return {
      task: "robotics",

      command:
        robotCommand,
    };
  }

  return {
    task: "reasoning",

    command: null,
  };
}

// ============================================================
// POLICY EVALUATION
// ============================================================

function evaluatePolicy(
  sender,
  task
) {
  if (
    SYSTEM_STATE.emergencyStop
  ) {
    return {
      allowed: false,

      reason:
        "Emergency Stop is active.",
    };
  }

  if (
    !AI_CAPABILITIES[task]
  ) {
    return {
      allowed: false,

      reason:
        `Capability "${task}" does not exist.`,
    };
  }

  if (
    !AI_CAPABILITIES[task]
      .enabled
  ) {
    return {
      allowed: false,

      reason:
        `Capability "${task}" is disabled.`,
    };
  }

  if (
    task === "robotics"
  ) {
    if (!isAdmin(sender)) {
      return {
        allowed: false,

        reason:
          "Robot actions require an authorized administrator.",
      };
    }

    return {
      allowed: true,

      requiresAuthorization:
        POLICY
          .requireAuthorizationForSensitiveActions,
    };
  }

  return {
    allowed: true,

    requiresAuthorization: false,
  };
}

// ============================================================
// AI ROUTER
// ============================================================

function routeAI(task) {
  const capability =
    AI_CAPABILITIES[task];

  if (
    !capability ||
    !capability.enabled
  ) {
    throw new Error(
      `AI capability unavailable: ${task}`
    );
  }

  return {
    provider:
      capability.provider,

    model:
      capability.model,
  };
}

// ============================================================
// OPENAI REASONING
// ============================================================

async function askOpenAI(text) {
  if (!openai) {
    throw new Error(
      "OPENAI_API_KEY is not configured."
    );
  }

  const response =
    await openai.chat.completions.create(
      {
        model:
          AI_CAPABILITIES
            .reasoning
            .model,

        messages: [
          {
            role: "system",

            content:
              "You are the reasoning component of The Silent Strategist AI. " +
              "Follow the system policy and human-authority boundaries. " +
              "Give useful, clear and responsible answers. " +
              "Do not claim authority over the human operator. " +
              "AI can recommend; human authority decides. " +
              "Robotics commands are handled by the dedicated robotics layer.",
          },

          {
            role: "user",

            content: text,
          },
        ],
      }
    );

  return (
    response
      .choices?.[0]
      ?.message?.content ||
    ""
  );
}

// ============================================================
// PROVIDER DISPATCH
// ============================================================

async function dispatchToProvider(
  route,
  text
) {
  if (
    route.provider ===
    "openai"
  ) {
    return await askOpenAI(
      text
    );
  }

  throw new Error(
    `Unsupported provider: ${route.provider}`
  );
}
// ============================================================
// AI RESPONSE VERIFICATION
// ============================================================

function verifyAIResponse(
  response
) {
  if (
    !response ||
    typeof response !==
      "string"
  ) {
    return {
      valid: false,

      reason:
        "AI returned an empty or invalid response.",
    };
  }

  if (
    response.length >
    10000
  ) {
    return {
      valid: false,

      reason:
        "AI response exceeded the maximum allowed length.",
    };
  }

  return {
    valid: true,
  };
}

// ============================================================
// MAIN MESSAGE PROCESSOR
// ============================================================

async function processMessage(
  sender,
  text
) {
  const normalizedSender =
    normalizeWhatsAppNumber(
      sender
    );

  const classification =
    classifyTask(text);

  const task =
    classification.task;

  const command =
    classification.command;

  recordAuditEvent(
    "TASK_CLASSIFIED",
    {
      sender:
        normalizedSender,

      text,

      task,

      command,
    }
  );

  if (
    String(text)
      .trim()
      .toUpperCase() ===
    "ROBOT HELP"
  ) {
    return robotHelp();
  }

  const policyResult =
    evaluatePolicy(
      sender,
      task
    );

  recordAuditEvent(
    "POLICY_EVALUATED",
    {
      sender:
        normalizedSender,

      task,

      allowed:
        policyResult.allowed,

      requiresAuthorization:
        policyResult
          .requiresAuthorization ||
        false,

      reason:
        policyResult.reason ||
        null,
    }
  );

  if (
    !policyResult.allowed
  ) {
    return (
      "⛔ ACTION BLOCKED\n\n" +
      `Reason: ${policyResult.reason}`
    );
  }

  if (
    task === "robotics" &&
    command?.type === "STATUS"
  ) {
    recordAuditEvent(
      "ROBOT_STATUS_REQUESTED",
      {
        sender:
          normalizedSender,
      }
    );

    return getRobotStatusText();
  }

  if (
    task === "robotics" &&
    policyResult
      .requiresAuthorization
  ) {
    const safety =
      validateRobotCommand(
        command
      );

    if (!safety.allowed) {
      recordAuditEvent(
        "ROBOT_COMMAND_REJECTED",
        {
          sender:
            normalizedSender,

          command,

          reason:
            safety.reason,
        }
      );

      return (
        "⛔ ROBOT COMMAND REJECTED\n\n" +
        `Reason: ${safety.reason}`
      );
    }

    const authorization =
      createAuthorizationRequest(
        sender,

        task,

        text,

        command
      );

    let description =
      "Robot action";

    if (
      command.type ===
      "MOVE"
    ) {
      description =
        `Move ${command.direction} ` +
        `${command.distance} units`;
    }

    if (
      command.type ===
      "TURN"
    ) {
      description =
        `Turn ${command.direction} ` +
        `${command.degrees} degrees`;
    }

    if (
      command.type ===
      "GO_CHARGING"
    ) {
      description =
        "Go to charging station";
    }

    return (
      "🤖 ROBOT ACTION PROPOSED\n\n" +

      `Task: ${description}\n` +

      "Mode: SIMULATION\n" +

      `Current Position: (${
        ROBOT_STATE.position.x
      }, ${
        ROBOT_STATE.position.y
      })\n` +

      `Battery: ${
        ROBOT_STATE.battery
      }%\n\n` +

      "Human Authorization: REQUIRED\n\n" +

      "Reply:\n" +

      "APPROVE — execute\n" +

      "DENY — cancel\n\n" +

      `Authorization ID: ${
        authorization.auditId
      }\n` +

      "This authorization expires in 5 minutes."
    );
  }

  const route =
    routeAI(task);

  recordAuditEvent(
    "AI_ROUTE_SELECTED",
    {
      sender:
        normalizedSender,

      task,

      provider:
        route.provider,

      model:
        route.model,
    }
  );

  try {
    const response =
      await dispatchToProvider(
        route,
        text
      );

    const verification =
      verifyAIResponse(
        response
      );

    if (
      !verification.valid
    ) {
      recordAuditEvent(
        "AI_RESPONSE_REJECTED",
        {
          sender:
            normalizedSender,

          task,

          reason:
            verification.reason,
        }
      );

      return (
        "⚠️ AI response failed verification.\n\n" +
        `Reason: ${verification.reason}`
      );
    }

    const audit =
      recordAuditEvent(
        "AI_RESPONSE_APPROVED",
        {
          sender:
            normalizedSender,

          task,

          provider:
            route.provider,

          model:
            route.model,
        }
      );

    console.log(
      `[AI] Response approved: ${audit.id}`
    );

    return response;
  } catch (error) {
    recordAuditEvent(
      "AI_PROVIDER_ERROR",
      {
        sender:
          normalizedSender,

        task,

        provider:
          route.provider,

        error:
          error.message,
      }
    );

    throw error;
  }
}

// ============================================================
// WHATSAPP MESSAGE SENDER
// ============================================================

async function sendWhatsAppMessage(
  to,
  text
) {
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
    `${WHATSAPP_PHONE_NUMBER_ID}` +
    `/messages`;

  const response =
    await fetch(
      url,
      {
        method: "POST",

        headers: {
          Authorization:
            `Bearer ${WHATSAPP_ACCESS_TOKEN}`,

          "Content-Type":
            "application/json",
        },

        body: JSON.stringify(
          {
            messaging_product:
              "whatsapp",

            to,

            type: "text",

            text: {
              body: text,
            },
          }
        ),
      }
    );

  const responseText =
    await response.text();

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

// ============================================================
// HTTP BODY READER
// ============================================================

function readRequestBody(req) {
  return new Promise(
    (resolve, reject) => {
      let body = "";

      req.on(
        "data",
        (chunk) => {
          body +=
            chunk.toString();

          if (
            body.length >
            100000
          ) {
            reject(
              new Error(
                "Request body is too large."
              )
            );

            req.destroy();
          }
        }
      );

      req.on(
        "end",
        () => resolve(body)
      );

      req.on(
        "error",
        reject
      );
    }
  );
}

// ============================================================
// JSON RESPONSE HELPER
// ============================================================

function sendJSON(
  res,
  statusCode,
  payload
) {
  res.writeHead(
    statusCode,
    {
      "Content-Type":
        "application/json",

      "Cache-Control":
        "no-store",
    }
  );

  res.end(
    JSON.stringify(
      payload,
      null,
      2
    )
  );
    }
// ============================================================
// HTTP SERVER
// ============================================================

const server =
  http.createServer(
    async (req, res) => {

      // ======================================================
      // HEALTH CHECK
      // ======================================================

      if (
        req.method === "GET" &&
        req.url === "/"
      ) {
        res.writeHead(
          200,
          {
            "Content-Type":
              "text/plain",
          }
        );

        res.end(
          "THE SILENT STRATEGIST AI\n\n" +

          "Server: ONLINE\n" +

          `Policy Engine: ACTIVE\n` +

          `Human Authority: ${
            POLICY.humanAuthority
          }\n` +

          "Human Authorization: ACTIVE\n" +

          "AI Router: ACTIVE\n" +

          "Verification: ACTIVE\n" +

          "Audit Logging: ACTIVE\n" +

          "Persistent Storage: POSTGRESQL\n" +

          `Emergency Stop: ${
            SYSTEM_STATE.emergencyStop
              ? "ON"
              : "OFF"
          }\n` +

          "Robot Controller: ACTIVE\n" +

          `Robot Mode: ${
            POLICY.capabilities
              .robotics.mode
              .toUpperCase()
          }\n` +

          `Secure Controller: ${
            ROBOT_CONTROLLER.enabled
              ? "ACTIVE"
              : "NOT CONFIGURED"
          }\n` +

          `Robot Status: ${
            ROBOT_STATE.status
          }\n` +

          `Robot Battery: ${
            ROBOT_STATE.battery
          }%\n` +

          `Robot Position: (${
            ROBOT_STATE.position.x
          }, ${
            ROBOT_STATE.position.y
          })\n`
        );

        return;
      }

      // ======================================================
      // CAPABILITIES
      // ======================================================

      if (
        req.method === "GET" &&
        req.url ===
          "/capabilities"
      ) {
        sendJSON(
          res,
          200,
          {
            policy:
              POLICY,

            capabilities:
              AI_CAPABILITIES,

            robotics: {
              mode:
                "simulation",

              controller:
                getRobotControllerHealth(),

              safety:
                ROBOT_SAFETY,

              robot:
                ROBOT
