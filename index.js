"use strict";

const {
  embodimentInterface,
  CAPABILITIES,
  COMMAND_TYPES,
  createVirtualBody
} = require("./embodiment-interface");

/*
========================================================
THE SILENT STRATEGIST AI
WhatsApp AI + PostgreSQL Audit + Robotics Controller
========================================================

Architecture:
- WhatsApp Cloud API
- OpenAI
- PostgreSQL persistent audit logging
- Human authorization for robot actions
- Emergency stop
- Secure robot controller authentication
- One-time, short-lived controller grants
- Simulation mode
- Health / capability endpoints

Current robot mode:
SIMULATION

IMPORTANT:
Physical robot operation must additionally use a physical
emergency-stop mechanism and local hardware safety controls.
========================================================
*/

const http = require("http");
const crypto = require("crypto");
const OpenAI = require("openai");
const { Pool } = require("pg");

/* ======================================================
   ENVIRONMENT
====================================================== */

const PORT = Number(process.env.PORT || 10000);

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const WHATSAPP_ACCESS_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN;
const WHATSAPP_PHONE_NUMBER_ID =
  process.env.WHATSAPP_PHONE_NUMBER_ID;
const WEBHOOK_VERIFY_TOKEN =
  process.env.WEBHOOK_VERIFY_TOKEN;

const ADMIN_PHONE_NUMBER =
  process.env.ADMIN_PHONE_NUMBER;

const DATABASE_URL =
  process.env.DATABASE_URL;

const ROBOT_CONTROLLER_TOKEN =
  process.env.ROBOT_CONTROLLER_TOKEN;

/* ======================================================
   VERSION / POLICY
====================================================== */

const APP_VERSION = "4.0.0";
const POLICY_VERSION = "4.0.0";

const POLICY = {
  name: "Silent Strategist Safety Policy",
  version: POLICY_VERSION,

  humanAuthorityRequired: true,

  robotics: {
    enabled: true,
    simulationDefault: true,
    physicalExecutionRequiresAuthorization: true,
    emergencyStopAvailable: true,
    controllerAuthenticationRequired: true,
    shortLivedControllerGrants: true
  }
};

/* ======================================================
   OPENAI
====================================================== */

const openai = OPENAI_API_KEY
  ? new OpenAI({
      apiKey: OPENAI_API_KEY
    })
  : null;

/* ======================================================
   POSTGRESQL
====================================================== */

let pool = null;

if (DATABASE_URL) {
  pool = new Pool({
    connectionString: DATABASE_URL,

    ssl: {
      rejectUnauthorized: false
    },

    max: 5,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000
  });
}

/* ======================================================
   ROBOT CONTROLLER
====================================================== */

const ROBOT_CONTROLLER = {
  enabled: Boolean(ROBOT_CONTROLLER_TOKEN),

  mode: "simulation",

  protocol: "authenticated-http",

  version: "2.0.0",

  heartbeatTimeoutMs: 30000,

  lastHeartbeat: null,

  connected: false,

  hardwareConnected: false
};

/* ======================================================
   ROBOT STATE
====================================================== */

const ROBOT = {
  id: "silent-strategist-robot-01",

  mode: "simulation",

  status: "IDLE",

  position: {
    x: 0,
    y: 0
  },

  heading: 0,

  battery: 100,

  charging: false,

  emergencyStop: false,

  lastCommand: null,

  lastCommandAt: null,

  lastAuthorizationId: null,

  controller: {
    authenticated: ROBOT_CONTROLLER.enabled,
    connected: false
  }
};

/* ======================================================
   ROBOT SAFETY
====================================================== */

const ROBOT_SAFETY = {
  emergencyStop: false,

  maxMoveDistance: 20,

  maxTurnDegrees: 360,

  minimumBatteryPercent: 10,

  authorizationRequired: true,

  controllerAuthenticationRequired: true,

  grantLifetimeMs: 60000
};

/* ======================================================
   CAPABILITIES
====================================================== */

const AI_CAPABILITIES = [
  "conversation",
  "reasoning",
  "task classification",
  "policy evaluation",
  "WhatsApp messaging",
  "persistent PostgreSQL audit logging",
  "human authorization",
  "emergency stop",
  "robot status",
  "robot movement simulation",
  "robot charging simulation",
  "secure robot controller",
  "controller heartbeat",
  "short-lived authorization grants"
];

/* ======================================================
   AUTHORIZATION STORAGE
====================================================== */

const pendingAuthorizations = new Map();

const controllerGrants = new Map();

const AUTHORIZATION_TIMEOUT_MS =
  5 * 60 * 1000;

const CONTROLLER_GRANT_TIMEOUT_MS =
  ROBOT_SAFETY.grantLifetimeMs;

/* ======================================================
   DATABASE
====================================================== */

async function initializeDatabase() {
  if (!pool) {
    console.log(
      "[DATABASE] DATABASE_URL not configured. PostgreSQL disabled."
    );

    return;
  }

  console.log("[DATABASE] Connecting to PostgreSQL...");

  const client = await pool.connect();

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS audit_events (
        id BIGSERIAL PRIMARY KEY,
        audit_id TEXT UNIQUE NOT NULL,
        timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        event_type TEXT NOT NULL,
        sender TEXT,
        command TEXT,
        authorization_id TEXT,
        details JSONB
      );
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_audit_events_timestamp
      ON audit_events(timestamp);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_audit_events_type
      ON audit_events(event_type);
    `);

    console.log("[DATABASE] PostgreSQL connected.");
  } finally {
    client.release();
  }
}

/* ======================================================
   AUDIT LOGGING
====================================================== */

async function recordAuditEvent(
  eventType,
  details = {}
) {
  const auditId =
    `AUDIT-${Date.now()}-${crypto
      .randomInt(1000, 9999)}`;

  const event = {
    id: auditId,
    timestamp: new Date().toISOString(),
    eventType,
    ...details
  };

  console.log(
    `[AUDIT] ${JSON.stringify(event)}`
  );

  if (pool) {
    try {
      await pool.query(
        `
        INSERT INTO audit_events
        (
          audit_id,
          timestamp,
          event_type,
          sender,
          command,
          authorization_id,
          details
        )
        VALUES
        (
          $1,
          $2,
          $3,
          $4,
          $5,
          $6,
          $7
        )
        `,
        [
          auditId,
          event.timestamp,
          eventType,
          details.sender || null,
          details.command || null,
          details.authorizationId || null,
          JSON.stringify(details)
        ]
      );
    } catch (error) {
      console.error(
        "[DATABASE] Failed to save audit event:",
        error.message
      );
    }
  }

  return auditId;
}

/* ======================================================
   BASIC HELPERS
====================================================== */

function normalizePhoneNumber(value) {
  if (!value) {
    return "";
  }

  return String(value)
    .replace(/\D/g, "");
}

function isAdmin(sender) {
  return (
    normalizePhoneNumber(sender) ===
    normalizePhoneNumber(ADMIN_PHONE_NUMBER)
  );
}

function safeTokenCompare(
  provided,
  expected
) {
  if (!provided || !expected) {
    return false;
  }

  const providedBuffer =
    Buffer.from(String(provided));

  const expectedBuffer =
    Buffer.from(String(expected));

  if (
    providedBuffer.length !==
    expectedBuffer.length
  ) {
    return false;
  }

  return crypto.timingSafeEqual(
    providedBuffer,
    expectedBuffer
  );
}

function authenticateRobotController(req) {
  if (!ROBOT_CONTROLLER_TOKEN) {
    return false;
  }

  const header =
    req.headers.authorization || "";

  if (!header.startsWith("Bearer ")) {
    return false;
  }

  const token =
    header.slice("Bearer ".length).trim();

  return safeTokenCompare(
    token,
    ROBOT_CONTROLLER_TOKEN
  );
}

function getPath(req) {
  try {
    return new URL(
      req.url,
      `http://${req.headers.host || "localhost"}`
    ).pathname;
  } catch {
    return req.url.split("?")[0];
  }
}

/* ======================================================
   ROBOT CONTROLLER HEARTBEAT
====================================================== */

function registerRobotHeartbeat() {
  const now = Date.now();

  ROBOT_CONTROLLER.lastHeartbeat =
    now;

  ROBOT_CONTROLLER.connected = true;

  ROBOT.controller.connected = true;

  return getRobotControllerHealth();
}

function getRobotControllerHealth() {
  const now = Date.now();

  const heartbeatFresh =
    ROBOT_CONTROLLER.lastHeartbeat !==
      null &&
    now -
      ROBOT_CONTROLLER.lastHeartbeat <=
      ROBOT_CONTROLLER.heartbeatTimeoutMs;

  if (
    ROBOT_CONTROLLER.lastHeartbeat !== null &&
    !heartbeatFresh
  ) {
    ROBOT_CONTROLLER.connected = false;

    ROBOT.controller.connected = false;
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

    connected:
      ROBOT_CONTROLLER.connected,

    hardwareConnected:
      ROBOT_CONTROLLER.hardwareConnected,

    heartbeatFresh,

    lastHeartbeat:
      ROBOT_CONTROLLER.lastHeartbeat
        ? new Date(
            ROBOT_CONTROLLER.lastHeartbeat
          ).toISOString()
        : null
  };
}

/* ======================================================
   AUTHORIZATION
====================================================== */

function clearAuthorization(
  authorizationId
) {
  const existing =
    pendingAuthorizations.get(
      authorizationId
    );

  if (existing?.timeout) {
    clearTimeout(existing.timeout);
  }

  pendingAuthorizations.delete(
    authorizationId
  );
}

function createAuthorizationRequest(
  sender,
  command
) {
  const authorizationId =
    `AUTH-${Date.now()}-${crypto
      .randomInt(1000, 9999)}`;

  const expiresAt =
    Date.now() +
    AUTHORIZATION_TIMEOUT_MS;

  const timeout =
    setTimeout(() => {
      const existing =
        pendingAuthorizations.get(
          authorizationId
        );

      if (existing) {
        pendingAuthorizations.delete(
          authorizationId
        );

        recordAuditEvent(
          "AUTHORIZATION_EXPIRED",
          {
            sender: existing.sender,
            command: existing.command,
            authorizationId
          }
        ).catch(console.error);
      }
    }, AUTHORIZATION_TIMEOUT_MS);

  pendingAuthorizations.set(
    authorizationId,
    {
      authorizationId,
      sender,
      command,
      createdAt: Date.now(),
      expiresAt,
      timeout
    }
  );

  return authorizationId;
}

function getPendingAuthorization(
  authorizationId
) {
  const pending =
    pendingAuthorizations.get(
      authorizationId
    );

  if (!pending) {
    return null;
  }

  if (Date.now() > pending.expiresAt) {
    clearAuthorization(
      authorizationId
    );

    return null;
  }

  return pending;
}

/* ======================================================
   CONTROLLER GRANTS
====================================================== */

function createControllerGrant(
  authorization
) {
  const grantId =
    crypto.randomBytes(32).toString("hex");

  const issuedAt =
    Date.now();

  const expiresAt =
    issuedAt +
    CONTROLLER_GRANT_TIMEOUT_MS;

  controllerGrants.set(
    grantId,
    {
      grantId,

      authorizationId:
        authorization.authorizationId,

      sender:
        authorization.sender,

      command:
        authorization.command,

      issuedAt,

      expiresAt,

      consumed: false
    }
  );

  setTimeout(() => {
    const grant =
      controllerGrants.get(grantId);

    if (
      grant &&
      !grant.consumed &&
      Date.now() > grant.expiresAt
    ) {
      controllerGrants.delete(
        grantId
      );

      recordAuditEvent(
        "ROBOT_CONTROLLER_GRANT_EXPIRED",
        {
          sender: grant.sender,
          command: grant.command,
          authorizationId:
            grant.authorizationId,
          grantId
        }
      ).catch(console.error);
    }
  }, CONTROLLER_GRANT_TIMEOUT_MS + 1000);

  return grantId;
}

/* ======================================================
   ROBOT COMMAND PARSER
====================================================== */

function parseRobotCommand(text) {
  const normalized =
    String(text || "")
      .trim()
      .toUpperCase()
      .replace(/\s+/g, " ");

  if (
    normalized === "ROBOT STATUS" ||
    normalized === "ROBOT STATE"
  ) {
    return {
      type: "STATUS",
      raw: normalized
    };
  }

  if (
    normalized === "ROBOT STOP"
  ) {
    return {
      type: "STOP",
      raw: normalized
    };
  }

  if (
    normalized === "ROBOT GO CHARGING" ||
    normalized ===
      "ROBOT GO TO CHARGING STATION" ||
    normalized ===
      "GO TO CHARGING STATION" ||
    normalized ===
      "GO TO THE CHARGING STATION"
  ) {
    return {
      type: "GO_CHARGING",
      raw: normalized
    };
  }

  let match =
    normalized.match(
      /^ROBOT MOVE FORWARD ([0-9]+(?:\.[0-9]+)?)$/
    );

  if (match) {
    return {
      type: "MOVE_FORWARD",
      distance: Number(match[1]),
      raw: normalized
    };
  }

  match =
    normalized.match(
      /^ROBOT MOVE BACKWARD ([0-9]+(?:\.[0-9]+)?)$/
    );

  if (match) {
    return {
      type: "MOVE_BACKWARD",
      distance: Number(match[1]),
      raw: normalized
    };
  }

  match =
    normalized.match(
      /^ROBOT TURN LEFT(?: ([0-9]+(?:\.[0-9]+)?))?$/
    );

  if (match) {
    return {
      type: "TURN_LEFT",
      degrees: match[1]
        ? Number(match[1])
        : 90,
      raw: normalized
    };
  }

  match =
    normalized.match(
      /^ROBOT TURN RIGHT(?: ([0-9]+(?:\.[0-9]+)?))?$/
    );

  if (match) {
    return {
      type: "TURN_RIGHT",
      degrees: match[1]
        ? Number(match[1])
        : 90,
      raw: normalized
    };
  }

  return null;
}

/* ======================================================
   ROBOT SAFETY VALIDATION
====================================================== */

function validateRobotCommand(
  command
) {
  if (!command) {
    return {
      allowed: false,
      reason: "Unknown robot command."
    };
  }

  if (ROBOT.emergencyStop) {
    return {
      allowed: false,
      reason:
        "Emergency stop is active. Resume the robot first."
    };
  }

  switch (command.type) {
    case "STATUS":
      return {
        allowed: true
      };

    case "STOP":
      return {
        allowed: true
      };

    case "GO_CHARGING":
      return {
        allowed: true
      };

    case "MOVE_FORWARD":
    case "MOVE_BACKWARD":
      if (
        !Number.isFinite(command.distance) ||
        command.distance <= 0
      ) {
        return {
          allowed: false,
          reason:
            "Movement distance must be greater than zero."
        };
      }

      if (
        command.distance >
        ROBOT_SAFETY.maxMoveDistance
      ) {
        return {
          allowed: false,
          reason:
            `Maximum movement distance is ${ROBOT_SAFETY.maxMoveDistance}.`
        };
      }

      if (
        ROBOT.battery <
        ROBOT_SAFETY.minimumBatteryPercent
      ) {
        return {
          allowed: false,
          reason:
            "Battery is too low for movement."
        };
      }

      return {
        allowed: true
      };

    case "TURN_LEFT":
    case "TURN_RIGHT":
      if (
        !Number.isFinite(command.degrees) ||
        command.degrees <= 0
      ) {
        return {
          allowed: false,
          reason:
            "Turn angle must be greater than zero."
        };
      }

      if (
        command.degrees >
        ROBOT_SAFETY.maxTurnDegrees
      ) {
        return {
          allowed: false,
          reason:
            `Maximum turn angle is ${ROBOT_SAFETY.maxTurnDegrees} degrees.`
        };
      }

      return {
        allowed: true
      };

    default:
      return {
        allowed: false,
        reason:
          "Unsupported robot command."
      };
  }
}

/* ======================================================
   ROBOT STATUS
====================================================== */

function getRobotStatus() {
  return {
    id: ROBOT.id,

    mode: ROBOT.mode,

    status: ROBOT.status,

    position: {
      x: ROBOT.position.x,
      y: ROBOT.position.y
    },

    heading: ROBOT.heading,

    battery: ROBOT.battery,

    charging: ROBOT.charging,

    emergencyStop:
      ROBOT.emergencyStop,

    lastCommand:
      ROBOT.lastCommand,

    lastCommandAt:
      ROBOT.lastCommandAt,

    lastAuthorizationId:
      ROBOT.lastAuthorizationId,

    controller:
      getRobotControllerHealth()
  };
}

function robotStatusText() {
  const status =
    getRobotStatus();

  return [
    "🤖 ROBOT STATUS",
    "",
    `ID: ${status.id}`,
    `Mode: ${status.mode.toUpperCase()}`,
    `Status: ${status.status}`,
    `Position: (${status.position.x}, ${status.position.y})`,
    `Heading: ${status.heading}°`,
    `Battery: ${status.battery}%`,
    `Charging: ${status.charging ? "YES" : "NO"}`,
    `Emergency Stop: ${status.emergencyStop ? "ON" : "OFF"}`,
    `Controller: ${status.controller.connected ? "CONNECTED" : "WAITING"}`
  ].join("\n");
}

/* ======================================================
   SIMULATION - MOVEMENT
====================================================== */

async function simulateMove(
  direction,
  distance,
  authorizationId
) {
  ROBOT.status = "MOVING";

  ROBOT.lastCommand =
    `MOVE_${direction}`;

  ROBOT.lastCommandAt =
    new Date().toISOString();

  await recordAuditEvent(
    "ROBOT_MOVEMENT_STARTED",
    {
      command:
        `MOVE_${direction}`,
      authorizationId,
      direction,
      distance,
      position: {
        ...ROBOT.position
      }
    }
  );

  const steps =
    Math.ceil(distance);

  for (
    let i = 0;
    i < steps;
    i++
  ) {
    if (ROBOT.emergencyStop) {
      ROBOT.status = "STOPPED";

      await recordAuditEvent(
        "ROBOT_MOVEMENT_INTERRUPTED",
        {
          command:
            `MOVE_${direction}`,
          authorizationId,
          reason:
            "Emergency stop activated."
        }
      );

      return {
        success: false,
        stopped: true
      };
    }

    if (direction === "FORWARD") {
      const radians =
        ROBOT.heading *
        Math.PI /
        180;

      ROBOT.position.x +=
        Math.round(Math.cos(radians));

      ROBOT.position.y +=
        Math.round(Math.sin(radians));
    } else {
      const radians =
        ROBOT.heading *
        Math.PI /
        180;

      ROBOT.position.x -=
        Math.round(Math.cos(radians));

      ROBOT.position.y -=
        Math.round(Math.sin(radians));
    }

    ROBOT.battery =
      Math.max(
        0,
        ROBOT.battery - 1
      );

    await new Promise(
      resolve =>
        setTimeout(resolve, 150)
    );
  }

  ROBOT.status = "IDLE";

  await recordAuditEvent(
    "ROBOT_MOVEMENT_COMPLETED",
    {
      command:
        `MOVE_${direction}`,
      authorizationId,
      direction,
      distance,
      position: {
        ...ROBOT.position
      },
      battery:
        ROBOT.battery
    }
  );

  return {
    success: true,
    position: {
      ...ROBOT.position
    },
    battery:
      ROBOT.battery
  };
}

/* ======================================================
   SIMULATION - TURN
====================================================== */

async function simulateTurn(
  direction,
  degrees,
  authorizationId
) {
  ROBOT.status = "TURNING";

  ROBOT.lastCommand =
    `TURN_${direction}`;

  ROBOT.lastCommandAt =
    new Date().toISOString();

  await recordAuditEvent(
    "ROBOT_TURN_STARTED",
    {
      command:
        `TURN_${direction}`,
      authorizationId,
      direction,
      degrees,
      heading:
        ROBOT.heading
    }
  );

  await new Promise(
    resolve =>
      setTimeout(resolve, 300)
  );

  if (direction === "LEFT") {
    ROBOT.heading -= degrees;
  } else {
    ROBOT.heading += degrees;
  }

  ROBOT.heading =
    ((ROBOT.heading % 360) + 360) % 360;

  ROBOT.status = "IDLE";

  await recordAuditEvent(
    "ROBOT_TURN_COMPLETED",
    {
      command:
        `TURN_${direction}`,
      authorizationId,
      direction,
      degrees,
      heading:
        ROBOT.heading
    }
  );

  return {
    success: true,
    heading:
      ROBOT.heading
  };
}

/* ======================================================
   SIMULATION - CHARGING
====================================================== */

async function simulateCharging(
  authorizationId
) {
  const destination = {
    x: 5,
    y: 5
  };

  ROBOT.status =
    "MOVING_TO_CHARGER";

  ROBOT.charging = false;

  ROBOT.lastCommand =
    "GO_CHARGING";

  ROBOT.lastCommandAt =
    new Date().toISOString();

  const route = [];

  let x =
    ROBOT.position.x;

  let y =
    ROBOT.position.y;

  while (
    x !== destination.x ||
    y !== destination.y
  ) {
    if (ROBOT.emergencyStop) {
      ROBOT.status =
        "STOPPED";

      await recordAuditEvent(
        "ROBOT_CHARGING_INTERRUPTED",
        {
          authorizationId,
          reason:
            "Emergency stop activated."
        }
      );

      return {
        success: false,
        stopped: true
      };
    }

    if (x < destination.x) {
      x++;
    } else if (
      x > destination.x
    ) {
      x--;
    }

    if (y < destination.y) {
      y++;
    } else if (
      y > destination.y
    ) {
      y--;
    }

    route.push({
      x,
      y
    });

    ROBOT.position = {
      x,
      y
    };

    ROBOT.battery =
      Math.max(
        0,
        ROBOT.battery - 1
      );

    await new Promise(
      resolve =>
        setTimeout(resolve, 150)
    );
  }

  await recordAuditEvent(
    "ROBOT_CHARGING_ROUTE_STARTED",
    {
      authorizationId,
      destination,
      routeLength:
        route.length
    }
  );

  ROBOT.status =
    "CHARGING";

  ROBOT.charging = true;

  await new Promise(
    resolve =>
      setTimeout(resolve, 500)
  );

  ROBOT.battery = 100;

  ROBOT.charging = false;

  ROBOT.status = "IDLE";

  const auditId =
    await recordAuditEvent(
      "ROBOT_CHARGING_COMPLETED",
      {
        authorizationId,
        destination,
        position: {
          ...ROBOT.position
        },
        battery:
          ROBOT.battery
      }
    );

  return {
    success: true,
    position: {
      ...ROBOT.position
    },
    battery:
      ROBOT.battery,
    auditId
  };
    }
/* ======================================================
   VIRTUAL BODY A
   EXISTING SIMULATED WHEELED ROBOT
====================================================== */

const VIRTUAL_BODY_A_ID =
  "silent-strategist-robot-01";

const virtualBodyA =
  createVirtualBody({
    id: VIRTUAL_BODY_A_ID,

    name:
      "Silent Strategist Virtual Wheeled Robot",

    type:
      "virtual-wheeled-robot",

    capabilities: [
      CAPABILITIES.OBSERVE,
      CAPABILITIES.MOVE,
      CAPABILITIES.STOP,
      CAPABILITIES.TURN,
      CAPABILITIES.REPORT_STATUS,
      CAPABILITIES.CHARGE
    ],

    initialState: {
      mode: "simulation",
      status: ROBOT.status,
      position: {
        ...ROBOT.position
      },
      heading: ROBOT.heading,
      battery: ROBOT.battery,
      charging: ROBOT.charging
    },

    safetyCheck(body, command) {
      let legacyCommand = null;

      if (command.type === COMMAND_TYPES.MOVE) {
        legacyCommand = {
          type:
            command.direction === "BACKWARD"
              ? "MOVE_BACKWARD"
              : "MOVE_FORWARD",

          distance:
            Number(command.distance)
        };
      }

      if (command.type === COMMAND_TYPES.TURN) {
        legacyCommand = {
          type:
            command.direction === "LEFT"
              ? "TURN_LEFT"
              : "TURN_RIGHT",

          degrees:
            Number(command.degrees)
        };
      }

      if (command.type === COMMAND_TYPES.CHARGE) {
        legacyCommand = {
          type: "GO_CHARGING"
        };
      }

      if (command.type === COMMAND_TYPES.STOP) {
        legacyCommand = {
          type: "STOP"
        };
      }

      if (!legacyCommand) {
        return {
          safe: false,
          reason:
            "Virtual Body A cannot translate this command."
        };
      }

      const result =
        validateRobotCommand(legacyCommand);

      return {
        safe: result.allowed === true,
        reason: result.reason || null
      };
    },

    async execute(body, command) {

      if (command.type === COMMAND_TYPES.OBSERVE) {
        return {
          success: true,
          observation: getRobotStatus()
        };
      }

      if (
        command.type ===
        COMMAND_TYPES.REPORT_STATUS
      ) {
        return {
          success: true,
          status: getRobotStatus()
        };
      }

      if (command.type === COMMAND_TYPES.STOP) {
        ROBOT.emergencyStop = true;
        ROBOT.status = "STOPPED";
        ROBOT.charging = false;

        await recordAuditEvent(
          "EMBODIMENT_BODY_A_STOPPED",
          {
            command: "STOP",
            authorizationId:
              command.authorizationId || null
          }
        );

        return {
          success: true,
          stopped: true
        };
      }

      if (
        command.type ===
        COMMAND_TYPES.MOVE
      ) {
        const direction =
          command.direction === "BACKWARD"
            ? "BACKWARD"
            : "FORWARD";

        return simulateMove(
          direction,
          Number(command.distance),
          command.authorizationId
        );
      }

      if (
        command.type ===
        COMMAND_TYPES.TURN
      ) {
        const direction =
          command.direction === "LEFT"
            ? "LEFT"
            : "RIGHT";

        return simulateTurn(
          direction,
          Number(command.degrees),
          command.authorizationId
        );
      }

      if (
        command.type ===
        COMMAND_TYPES.CHARGE
      ) {
        return simulateCharging(
          command.authorizationId
        );
      }

      return {
        success: false,
        reason:
          "Virtual Body A does not implement this command."
      };
    },

    async observe() {
      return getRobotStatus();
    },

    async getStatus() {
      return getRobotStatus();
    }
  });


/*
 * Register Body A with the shared embodiment interface.
 */

embodimentInterface.registerBody(
  virtualBodyA
);

console.log(
  `[EMBODIMENT] Registered ${virtualBodyA.name}`
);
/* ======================================================
   ROBOT EXECUTION
====================================================== */

async function executeRobotCommand(
  command,
  authorizationId
) {
  const validation =
    validateRobotCommand(command);

  if (!validation.allowed) {
    await recordAuditEvent(
      "ROBOT_COMMAND_REJECTED",
      {
        command:
          command?.raw || null,
        authorizationId,
        reason:
          validation.reason
      }
    );

    return {
      success: false,
      reason:
        validation.reason
    };
  }

  if (command.type === "STATUS") {
    return {
      success: true,
      status:
        getRobotStatus()
    };
  }

  if (command.type === "STOP") {
    ROBOT.emergencyStop = true;

    ROBOT.status =
      "STOPPED";

    ROBOT.charging = false;

    await recordAuditEvent(
      "ROBOT_STOPPED",
      {
        command: "STOP",
        authorizationId
      }
    );

    return {
      success: true,
      stopped: true
    };
  }

  ROBOT.lastAuthorizationId =
    authorizationId;

  if (
    command.type ===
    "GO_CHARGING"
  ) {
    return simulateCharging(
      authorizationId
    );
  }

  if (
    command.type ===
    "MOVE_FORWARD"
  ) {
    return simulateMove(
      "FORWARD",
      command.distance,
      authorizationId
    );
  }

  if (
    command.type ===
    "MOVE_BACKWARD"
  ) {
    return simulateMove(
      "BACKWARD",
      command.distance,
      authorizationId
    );
  }

  if (
    command.type ===
    "TURN_LEFT"
  ) {
    return simulateTurn(
      "LEFT",
      command.degrees,
      authorizationId
    );
  }

  if (
    command.type ===
    "TURN_RIGHT"
  ) {
    return simulateTurn(
      "RIGHT",
      command.degrees,
      authorizationId
    );
  }

  return {
    success: false,
    reason:
      "Command execution is not implemented."
  };
}

/* ======================================================
   CONTROLLER GRANT CONSUMPTION
====================================================== */

async function consumeControllerGrantAndExecute(
  grantId
) {
  const grant =
    controllerGrants.get(grantId);

  if (!grant) {
    await recordAuditEvent(
      "ROBOT_CONTROLLER_GRANT_REJECTED",
      {
        grantId,
        reason:
          "Grant not found."
      }
    );

    return {
      success: false,
      reason:
        "Authorization grant not found."
    };
  }

  if (grant.consumed) {
    await recordAuditEvent(
      "ROBOT_CONTROLLER_GRANT_REJECTED",
      {
        grantId,
        authorizationId:
          grant.authorizationId,
        reason:
          "Grant already consumed."
      }
    );

    return {
      success: false,
      reason:
        "Authorization grant has already been consumed."
    };
  }

  if (
    Date.now() >
    grant.expiresAt
  ) {
    controllerGrants.delete(
      grantId
    );

    await recordAuditEvent(
      "ROBOT_CONTROLLER_GRANT_REJECTED",
      {
        grantId,
        authorizationId:
          grant.authorizationId,
        reason:
          "Grant expired."
      }
    );

    return {
      success: false,
      reason:
        "Authorization grant has expired."
    };
  }

  if (ROBOT.emergencyStop) {
    return {
      success: false,
      reason:
        "Emergency stop is active."
    };
  }

  grant.consumed = true;
  controllerGrants.delete(grantId);

  await recordAuditEvent(
    "ROBOT_CONTROLLER_GRANT_CONSUMED",
    {
      grantId,
      authorizationId:
        grant.authorizationId,
      command:
        grant.command
    }
  );

  const legacyCommand =
    parseRobotCommand(
      grant.command
    );

  if (!legacyCommand) {
    return {
      success: false,
      reason:
        "Stored command could not be parsed."
    };
  }

  let embodimentCommand = null;

  if (
    legacyCommand.type ===
    "MOVE_FORWARD"
  ) {
    embodimentCommand = {
      type:
        COMMAND_TYPES.MOVE,
      bodyId:
        VIRTUAL_BODY_A_ID,
      direction:
        "FORWARD",
      distance:
        legacyCommand.distance
    };
  }

  if (
    legacyCommand.type ===
    "MOVE_BACKWARD"
  ) {
    embodimentCommand = {
      type:
        COMMAND_TYPES.MOVE,
      bodyId:
        VIRTUAL_BODY_A_ID,
      direction:
        "BACKWARD",
      distance:
        legacyCommand.distance
    };
  }

  if (
    legacyCommand.type ===
    "TURN_LEFT"
  ) {
    embodimentCommand = {
      type:
        COMMAND_TYPES.TURN,
      bodyId:
        VIRTUAL_BODY_A_ID,
      direction:
        "LEFT",
      degrees:
        legacyCommand.degrees
    };
  }

  if (
    legacyCommand.type ===
    "TURN_RIGHT"
  ) {
    embodimentCommand = {
      type:
        COMMAND_TYPES.TURN,
      bodyId:
        VIRTUAL_BODY_A_ID,
      direction:
        "RIGHT",
      degrees:
        legacyCommand.degrees
    };
  }

  if (
    legacyCommand.type ===
    "GO_CHARGING"
  ) {
    embodimentCommand = {
      type:
        COMMAND_TYPES.CHARGE,
      bodyId:
        VIRTUAL_BODY_A_ID
    };
  }

  if (
    legacyCommand.type ===
    "STOP"
  ) {
    embodimentCommand = {
      type:
        COMMAND_TYPES.STOP,
      bodyId:
        VIRTUAL_BODY_A_ID
    };
  }

  if (!embodimentCommand) {
    return {
      success: false,
      reason:
        `Command ${legacyCommand.type} is not yet connected to the embodiment interface.`
    };
  }

  ROBOT.lastAuthorizationId =
    grant.authorizationId;

  const result =
    await embodimentInterface.sendCommand(
      embodimentCommand,
      {
        approved: true,
        authorizationId:
          grant.authorizationId
      }
    );

  await recordAuditEvent(
    result.success
      ? "EMBODIMENT_COMMAND_COMPLETED"
      : "EMBODIMENT_COMMAND_FAILED",
    {
      grantId,
      authorizationId:
        grant.authorizationId,
      command:
        grant.command,
      bodyId:
        VIRTUAL_BODY_A_ID,
      embodimentCommand,
      result
    }
  );

  return {
    success:
      result.success === true,

    reason:
      result.success
        ? null
        : (
            result.result?.reason ||
            result.error ||
            "Embodiment execution failed."
          ),

    bodyId:
      result.bodyId ||
      VIRTUAL_BODY_A_ID,

    command:
      result.command ||
      embodimentCommand.type,

    result:
      result.result || result
  };
    }
/* ======================================================
   ROBOT HELP
====================================================== */

function robotHelp() {
  return [
    "🤖 ROBOT COMMANDS",
    "",
    "ROBOT STATUS",
    "ROBOT GO TO CHARGING STATION",
    "ROBOT MOVE FORWARD 5",
    "ROBOT MOVE BACKWARD 5",
    "ROBOT TURN LEFT 90",
    "ROBOT TURN RIGHT 90",
    "",
    "Every physical action requires human authorization.",
    "",
    "Global safety controls:",
    "STOP",
    "RESUME",
    "STATUS"
  ].join("\n");
}

/* ======================================================
   GLOBAL CONTROL COMMANDS
====================================================== */

function isControlCommand(text) {
  const normalized =
    String(text || "")
      .trim()
      .toUpperCase();

  return [
    "APPROVE",
    "DENY",
    "STOP",
    "RESUME",
    "STATUS"
  ].includes(normalized);
}

async function handleControlCommand(
  sender,
  text
) {
  const command =
    String(text || "")
      .trim()
      .toUpperCase();

  if (!isAdmin(sender)) {
    await recordAuditEvent(
      "CONTROL_COMMAND_REJECTED",
      {
        sender,
        command,
        reason:
          "Unauthorized sender."
      }
    );

    return {
      handled: true,
      response:
        "⛔ You are not authorized to control this system."
    };
  }

  /* --------------------------------------------------
     APPROVE
  -------------------------------------------------- */

  if (command === "APPROVE") {
    let selected = null;

    for (
      const authorization of
      pendingAuthorizations.values()
    ) {
      if (
        authorization.sender ===
        sender
      ) {
        if (
          !selected ||
          authorization.createdAt >
            selected.createdAt
        ) {
          selected =
            authorization;
        }
      }
    }

    if (!selected) {
      return {
        handled: true,
        response:
          "⚠️ No pending authorization request was found."
      };
    }

    const pending =
      getPendingAuthorization(
        selected.authorizationId
      );

    if (!pending) {
      return {
        handled: true,
        response:
          "⚠️ That authorization has expired."
      };
    }

    if (ROBOT.emergencyStop) {
      return {
        handled: true,
        response:
          "🛑 Emergency stop is active. Use RESUME before approving robot actions."
      };
    }

    await recordAuditEvent(
      "AUTHORIZATION_APPROVED",
      {
        sender,
        command:
          pending.command,
        authorizationId:
          pending.authorizationId
      }
    );

    clearAuthorization(
      pending.authorizationId
    );

    const grantId =
      createControllerGrant(
        pending
      );

    await recordAuditEvent(
      "ROBOT_CONTROLLER_GRANT_ISSUED",
      {
        sender,
        command:
          pending.command,
        authorizationId:
          pending.authorizationId,
        grantId,
        expiresAt:
          new Date(
            Date.now() +
              CONTROLLER_GRANT_TIMEOUT_MS
          ).toISOString()
      }
    );

    /*
    In simulation mode, the server itself consumes
    the one-time controller grant.

    In a future physical deployment, the authenticated
    robot controller can consume the same grant through
    POST /robot/controller/command.
    */

    const result =
      await consumeControllerGrantAndExecute(
        grantId
      );

    if (!result.success) {
      return {
        handled: true,
        response:
          `❌ Robot execution failed.\n\n${result.reason}`
      };
    }

    if (
      pending.command
        .toUpperCase()
        .includes("CHARGING")
    ) {
      return {
        handled: true,
        response: [
          "🔋 ROBOT CHARGING COMPLETED",
          "",
          "Destination reached.",
          `Position: (${ROBOT.position.x}, ${ROBOT.position.y})`,
          `Battery: ${ROBOT.battery}%`,
          `Audit ID: ${result.auditId || "recorded"}`
        ].join("\n")
      };
    }

    return {
      handled: true,
      response: [
        "✅ ROBOT ACTION COMPLETED",
        "",
        `Command: ${pending.command}`,
        `Position: (${ROBOT.position.x}, ${ROBOT.position.y})`,
        `Heading: ${ROBOT.heading}°`,
        `Battery: ${ROBOT.battery}%`
      ].join("\n")
    };
  }

  /* --------------------------------------------------
     DENY
  -------------------------------------------------- */

  if (command === "DENY") {
    let selected = null;

    for (
      const authorization of
      pendingAuthorizations.values()
    ) {
      if (
        authorization.sender ===
        sender
      ) {
        if (
          !selected ||
          authorization.createdAt >
            selected.createdAt
        ) {
          selected =
            authorization;
        }
      }
    }

    if (!selected) {
      return {
        handled: true,
        response:
          "⚠️ No pending authorization request was found."
      };
    }

    clearAuthorization(
      selected.authorizationId
    );

    await recordAuditEvent(
      "AUTHORIZATION_DENIED",
      {
        sender,
        command:
          selected.command,
        authorizationId:
          selected.authorizationId
      }
    );

    return {
      handled: true,
      response:
        "🛡️ Robot action denied. No command was executed."
    };
}
  /* --------------------------------------------------
     EMERGENCY STOP
  -------------------------------------------------- */

  if (command === "STOP") {
    ROBOT.emergencyStop = true;

    ROBOT.status =
      "STOPPED";

    ROBOT.charging = false;
       
    await embodimentInterface.activateEmergencyStop(
      "Admin emergency stop."
    );

    for (
      const authorizationId of
      pendingAuthorizations.keys()
    ) {
      clearAuthorization(
        authorizationId
      );
    }

    controllerGrants.clear();

    const auditId =
      await recordAuditEvent(
        "EMERGENCY_STOP_ACTIVATED",
        {
          sender,
          reason:
            "Administrator emergency stop."
        }
      );

    return {
      handled: true,
      response: [
        "🛑 EMERGENCY STOP ACTIVE",
        "",
        "All pending robot authorizations were cancelled.",
        "All controller grants were invalidated.",
        "Robot execution is blocked.",
        "",
        `Audit ID: ${auditId}`,
        "",
        "Reply RESUME when it is safe to continue."
      ].join("\n")
    };
  }

  /* --------------------------------------------------
     RESUME
  -------------------------------------------------- */

  if (command === "RESUME") {
    ROBOT.emergencyStop = false;

    if (
      ROBOT.status ===
      "STOPPED"
    ) {
      ROBOT.status = "IDLE";
    }
   
      embodimentInterface.resetEmergencyStop();

    const auditId =
      await recordAuditEvent(
        "EMERGENCY_STOP_CLEARED",
        {
          sender
        }
      );

    return {
      handled: true,
      response: [
        "🟢 ROBOT SYSTEM RESUMED",
        "",
        "Emergency stop cleared.",
        "No robot action has been authorized automatically.",
        "",
        `Audit ID: ${auditId}`
      ].join("\n")
    };
  }

  /* --------------------------------------------------
     STATUS
  -------------------------------------------------- */

  if (command === "STATUS") {
    await recordAuditEvent(
      "SYSTEM_STATUS_REQUESTED",
      {
        sender
      }
    );

    return {
      handled: true,
      response:
        robotStatusText()
    };
  }

  return {
    handled: false
  };
}

/* ======================================================
   TASK CLASSIFICATION
====================================================== */

function classifyTask(text) {
  const normalized =
    String(text || "")
      .trim()
      .toUpperCase();

  const robotCommand =
    parseRobotCommand(
      normalized
    );

  if (robotCommand) {
    return {
      category: "robotics",
      command:
        robotCommand.type,
      robotCommand
    };
  }

  if (
    normalized.includes("ROBOT") ||
    normalized.includes("CHARGING STATION")
  ) {
    return {
      category: "robotics",
      command:
        "UNKNOWN_ROBOT_COMMAND"
    };
  }

  return {
    category: "conversation",
    command: "CHAT"
  };
}

/* ======================================================
   POLICY
====================================================== */

function evaluatePolicy(
  task
) {
  if (
    task.category ===
    "robotics"
  ) {
    if (
      task.command ===
      "STATUS"
    ) {
      return {
        allowed: true,
        requiresAuthorization: false
      };
    }

    return {
      allowed: true,
      requiresAuthorization:
        ROBOT_SAFETY.authorizationRequired
    };
  }

  return {
    allowed: true,
    requiresAuthorization: false
  };
      }
/* ======================================================
   AI ROUTING
====================================================== */

async function askOpenAI(
  sender,
  message
) {
  if (!openai) {
    return [
      "The Silent Strategist AI is online,",
      "but the OpenAI API key is not configured."
    ].join(" ");
  }

  try {
    const completion =
      await openai.chat.completions.create(
        {
          model:
            process.env.OPENAI_MODEL ||
            "gpt-4o-mini",

          messages: [
            {
              role: "system",
              content: `
You are The Silent Strategist AI.

You operate under a strict safety-first architecture.

Human authority is required before physical robotics actions.

Never claim that a physical action happened unless
the robot controller actually reported successful execution.

Current robot mode:
${ROBOT.mode}

Current robot status:
${ROBOT.status}

Current battery:
${ROBOT.battery}%

Keep responses clear, disciplined and useful.
`
            },

            {
              role: "user",
              content:
                message
            }
          ],

          temperature: 0.4,

          max_tokens: 500
        }
      );

    return (
      completion.choices?.[0]?.message?.content ||
      "I received your message."
    );
  } catch (error) {
    console.error(
      "[OPENAI] Error:",
      error.message
    );

    return [
      "⚠️ AI service temporarily unavailable.",
      "The core safety and robot-control systems remain protected."
    ].join("\n");
  }
}

/* ======================================================
   AI RESPONSE VERIFICATION
====================================================== */

function verifyAIResponse(
  response
) {
  if (!response) {
    return "No response generated.";
  }

  return String(response)
    .trim()
    .slice(0, 4000);
}

/* ======================================================
   PROCESS MESSAGE
====================================================== */

async function processMessage(
  sender,
  message
) {
  const text =
    String(message || "").trim();

  if (!text) {
    return "Please send a message.";
  }

  const normalized =
    text.toUpperCase();

  if (
    normalized ===
      "ROBOT HELP" ||
    normalized ===
      "ROBOT COMMANDS"
  ) {
    return robotHelp();
  }

  const task =
    classifyTask(text);

  await recordAuditEvent(
    "TASK_CLASSIFIED",
    {
      sender,
      command:
        task.command,
      category:
        task.category,
      message:
        text
    }
  );

  const policy =
    evaluatePolicy(task);

  await recordAuditEvent(
    "POLICY_EVALUATED",
    {
      sender,
      command:
        task.command,
      allowed:
        policy.allowed,
      requiresAuthorization:
        policy.requiresAuthorization
    }
  );

  if (!policy.allowed) {
    return "⛔ Request blocked by the safety policy.";
  }

  /* --------------------------------------------------
     ROBOTICS
  -------------------------------------------------- */

  if (
    task.category ===
    "robotics"
  ) {
    if (
      task.command ===
      "UNKNOWN_ROBOT_COMMAND"
    ) {
      return [
        "⚠️ Unknown robot command.",
        "",
        robotHelp()
      ].join("\n");
    }

    if (
      task.command ===
      "STATUS"
    ) {
      return robotStatusText();
    }

    const command =
      task.robotCommand;

    const validation =
      validateRobotCommand(
        command
      );

    if (!validation.allowed) {
      return [
        "⛔ ROBOT COMMAND BLOCKED",
        "",
        validation.reason
      ].join("\n");
    }

    if (
      policy.requiresAuthorization
    ) {
      if (!isAdmin(sender)) {
        await recordAuditEvent(
          "AUTHORIZATION_REJECTED",
          {
            sender,
            command:
              command.raw,
            reason:
              "Sender is not administrator."
          }
        );

        return [
          "⛔ ROBOT CONTROL DENIED",
          "",
          "Only the authorized administrator can approve robot actions."
        ].join("\n");
      }

      const authorizationId =
        createAuthorizationRequest(
          sender,
          command.raw
        );

      await recordAuditEvent(
        "AUTHORIZATION_PROPOSED",
        {
          sender,
          command:
            command.raw,
          authorizationId
        }
      );

      return [
        "🤖 ROBOT ACTION PROPOSED",
        "",
        `Task: ${command.raw}`,
        `Mode: ${ROBOT.mode.toUpperCase()}`,
        `Current Position: (${ROBOT.position.x}, ${ROBOT.position.y})`,
        `Battery: ${ROBOT.battery}%`,
        "",
        "Human Authorization: REQUIRED",
        "",
        "Reply:",
        "APPROVE — execute",
        "DENY — cancel",
        "",
        `Authorization ID: ${authorizationId}`,
        "This authorization expires in 5 minutes."
      ].join("\n");
    }

    return "Robot command received.";
          }
  /* --------------------------------------------------
     GENERAL AI
  -------------------------------------------------- */

  const response =
    await askOpenAI(
      sender,
      text
    );

  return verifyAIResponse(
    response
  );
}

/* ======================================================
   WHATSAPP SEND
====================================================== */

async function sendWhatsAppMessage(
  recipient,
  message
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
    `https://graph.facebook.com/v23.0/${WHATSAPP_PHONE_NUMBER_ID}/messages`;

  const response =
    await fetch(url, {
      method: "POST",

      headers: {
        "Authorization":
          `Bearer ${WHATSAPP_ACCESS_TOKEN}`,

        "Content-Type":
          "application/json"
      },

      body: JSON.stringify({
        messaging_product:
          "whatsapp",

        to:
          recipient,

        type:
          "text",

        text: {
          body:
            String(message)
              .slice(0, 4096)
        }
      })
    });

  const data =
    await response.json()
      .catch(() => ({}));

  if (!response.ok) {
    throw new Error(
      `WhatsApp API ${response.status}: ${JSON.stringify(data)}`
    );
  }

  return data;
}

/* ======================================================
   HTTP HELPERS
====================================================== */

function readRequestBody(
  req
) {
  return new Promise(
    (resolve, reject) => {
      let body = "";

      req.on(
        "data",
        chunk => {
          body += chunk;

          if (
            body.length >
            2 * 1024 * 1024
          ) {
            reject(
              new Error(
                "Request body too large."
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

function sendJSON(
  res,
  statusCode,
  data
) {
  const body =
    JSON.stringify(data);

  res.writeHead(
    statusCode,
    {
      "Content-Type":
        "application/json; charset=utf-8",

      "Cache-Control":
        "no-store"
    }
  );

  res.end(body);
}

function sendText(
  res,
  statusCode,
  text
) {
  res.writeHead(
    statusCode,
    {
      "Content-Type":
        "text/plain; charset=utf-8"
    }
  );

  res.end(text);
}

/* ======================================================
   WEBHOOK HANDLING
====================================================== */

async function handleIncomingWhatsApp(
  payload
) {
  if (
    !payload ||
    !Array.isArray(
      payload.entry
    )
  ) {
    return;
  }

  for (
    const entry of payload.entry
  ) {
    const changes =
      Array.isArray(entry.changes)
        ? entry.changes
        : [];

    for (
      const change of changes
    ) {
      const value =
        change.value || {};

      const messages =
        Array.isArray(
          value.messages
        )
          ? value.messages
          : [];

      for (
        const message of messages
      ) {
        const sender =
          message.from;

        const text =
          message.text?.body;

        if (
          !sender ||
          !text
        ) {
          continue;
        }

        console.log(
          `[WHATSAPP] Message from ${sender}: ${text}`
        );

        await recordAuditEvent(
          "WHATSAPP_MESSAGE_RECEIVED",
          {
            sender,
            message: text
          }
        );

        let response;

        if (
          isControlCommand(text)
        ) {
          const control =
            await handleControlCommand(
              sender,
              text
            );

          if (control.handled) {
            response =
              control.response;
          }
        }

        if (!response) {
          response =
            await processMessage(
              sender,
              text
            );
        }

        await sendWhatsAppMessage(
          sender,
          response
        );

        await recordAuditEvent(
          "WHATSAPP_RESPONSE_SENT",
          {
            sender,
            response
          }
        );
      }
    }
  }
}

/* ======================================================
   HTTP SERVER
====================================================== */

const server =
  http.createServer(
    async (req, res) => {
      try {
        const path =
          getPath(req);

        /* ----------------------------------------------
           ROOT
        ---------------------------------------------- */

        if (
          req.method === "GET" &&
          path === "/"
        ) {
          return sendJSON(
            res,
            200,
            {
              name:
                "The Silent Strategist AI",

              version:
                APP_VERSION,

              status:
                "online",

              robotMode:
                ROBOT.mode
            }
          );
              }
        /* ----------------------------------------------
           HEALTH
        ---------------------------------------------- */

        if (
          req.method === "GET" &&
          path === "/health"
        ) {
          return sendJSON(
            res,
            200,
            {
              status:
                "ok",

              version:
                APP_VERSION,

              database:
                Boolean(pool),

              robot:
                getRobotStatus(),

              controller:
                getRobotControllerHealth()
            }
          );
        }

        /* ----------------------------------------------
           CAPABILITIES
        ---------------------------------------------- */

        if (
          req.method === "GET" &&
          path === "/capabilities"
        ) {
          return sendJSON(
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
                  getRobotStatus()
              }
            }
          );
        }
                /* ----------------------------------------------
           EMBODIMENT BODY A STATUS
        ---------------------------------------------- */

        if (
          req.method === "GET" &&
          path === "/embodiment/body-a/status"
        ) {
          const status =
            await embodimentInterface.getStatus(
              "silent-strategist-robot-01"
            );

          return sendJSON(
            res,
            status.success ? 200 : 404,
            status
          );
        }

        /* ----------------------------------------------
           ROBOT STATUS
        ---------------------------------------------- */

        if (
          req.method === "GET" &&
          path === "/robot"
        ) {
          return sendJSON(
            res,
            200,
            {
              robot:
                getRobotStatus(),

              safety:
                ROBOT_SAFETY,

              controller:
                getRobotControllerHealth()
            }
          );
        }

        /* ----------------------------------------------
           ROBOT CONTROLLER STATUS
        ---------------------------------------------- */

        if (
          req.method === "GET" &&
          path ===
            "/robot/controller/status"
        ) {
          if (
            !authenticateRobotController(
              req
            )
          ) {
            await recordAuditEvent(
              "ROBOT_CONTROLLER_AUTH_FAILED",
              {
                endpoint:
                  path,
                method:
                  req.method
              }
            );

            return sendJSON(
              res,
              401,
              {
                error:
                  "Unauthorized."
              }
            );
          }

          return sendJSON(
            res,
            200,
            {
              controller:
                getRobotControllerHealth(),

              robot:
                getRobotStatus()
            }
          );
        }

        /* ----------------------------------------------
           ROBOT CONTROLLER HEARTBEAT
        ---------------------------------------------- */

        if (
          req.method === "POST" &&
          path ===
            "/robot/controller/heartbeat"
        ) {
          if (
            !authenticateRobotController(
              req
            )
          ) {
            await recordAuditEvent(
              "ROBOT_CONTROLLER_AUTH_FAILED",
              {
                endpoint:
                  path,
                method:
                  req.method
              }
            );

            return sendJSON(
              res,
              401,
              {
                error:
                  "Unauthorized."
              }
            );
          }

          const health =
            registerRobotHeartbeat();

          await recordAuditEvent(
            "ROBOT_CONTROLLER_HEARTBEAT",
            {
              controller:
                health
            }
          );

          return sendJSON(
            res,
            200,
            {
              ok: true,

              controller:
                health
            }
          );
        }

        /* ----------------------------------------------
           ROBOT CONTROLLER COMMAND
        ---------------------------------------------- */

        if (
          req.method === "POST" &&
          path ===
            "/robot/controller/command"
        ) {
          if (
            !authenticateRobotController(
              req
            )
          ) {
            await recordAuditEvent(
              "ROBOT_CONTROLLER_AUTH_FAILED",
              {
                endpoint:
                  path,
                method:
                  req.method
              }
            );

            return sendJSON(
              res,
              401,
              {
                error:
                  "Unauthorized."
              }
            );
          }

          const rawBody =
            await readRequestBody(
              req
            );

          let body;

          try {
            body =
              rawBody
                ? JSON.parse(rawBody)
                : {};
          } catch {
            return sendJSON(
              res,
              400,
              {
                error:
                  "Invalid JSON."
              }
            );
          }

          /*
          The controller does NOT accept arbitrary
          movement commands.

          It must receive a server-issued,
          short-lived, one-time authorization grant.

          This prevents possession of the controller
          token alone from becoming robot authority.
          */

          const grantId =
            body.grantId;

          if (!grantId) {
            return sendJSON(
              res,
              400,
              {
                error:
                  "grantId is required."
              }
            );
          }

          const grant =
            controllerGrants.get(
              grantId
            );

          if (
            body.command &&
            grant &&
            String(body.command)
              .trim()
              .toUpperCase() !==
              String(grant.command)
                .trim()
                .toUpperCase()
          ) {
            await recordAuditEvent(
              "ROBOT_CONTROLLER_COMMAND_REJECTED",
              {
                grantId,
                reason:
                  "Command does not match authorization grant."
              }
            );

            return sendJSON(
              res,
              403,
              {
                error:
                  "Command does not match authorization grant."
              }
            );
          }

          const result =
            await consumeControllerGrantAndExecute(
              grantId
            );

          if (!result.success) {
            return sendJSON(
              res,
              403,
              {
                ok: false,

                error:
                  result.reason
              }
            );
          }

          return sendJSON(
            res,
            200,
            {
              ok: true,

              result,

              robot:
                getRobotStatus()
            }
          );
                }
                  /* ----------------------------------------------
           META WEBHOOK VERIFICATION
        ---------------------------------------------- */

        if (
          req.method === "GET" &&
          path === "/webhook"
        ) {
          const url =
            new URL(
              req.url,
              `http://${req.headers.host || "localhost"}`
            );

          const mode =
            url.searchParams.get(
              "hub.mode"
            );

          const token =
            url.searchParams.get(
              "hub.verify_token"
            );

          const challenge =
            url.searchParams.get(
              "hub.challenge"
            );

          if (
            mode === "subscribe" &&
            safeTokenCompare(
              token,
              WEBHOOK_VERIFY_TOKEN
            )
          ) {
            await recordAuditEvent(
              "WEBHOOK_VERIFIED",
              {}
            );

            return sendText(
              res,
              200,
              challenge || ""
            );
          }

          await recordAuditEvent(
            "WEBHOOK_VERIFICATION_FAILED",
            {}
          );

          return sendText(
            res,
            403,
            "Forbidden"
          );
        }

        /* ----------------------------------------------
           META WEBHOOK PAYLOAD
        ---------------------------------------------- */

        if (
          req.method === "POST" &&
          path === "/webhook"
        ) {
          console.log(
            "[WEBHOOK] Incoming payload received."
          );

          const rawBody =
            await readRequestBody(
              req
            );

          let payload;

          try {
            payload =
              JSON.parse(rawBody);
          } catch {
            await recordAuditEvent(
              "WEBHOOK_INVALID_JSON",
              {}
            );

            return sendJSON(
              res,
              400,
              {
                error:
                  "Invalid JSON."
              }
            );
          }

          /*
          Respond quickly enough for Meta,
          then process the payload.
          */

          sendJSON(
            res,
            200,
            {
              received: true
            }
          );

          try {
            await handleIncomingWhatsApp(
              payload
            );
          } catch (error) {
            console.error(
              "[WEBHOOK] Processing error:",
              error
            );

            await recordAuditEvent(
              "WEBHOOK_PROCESSING_ERROR",
              {
                error:
                  error.message
              }
            );
          }

          return;
        }

        /* ----------------------------------------------
           404
        ---------------------------------------------- */

        return sendJSON(
          res,
          404,
          {
            error:
              "Not found."
          }
        );
      } catch (error) {
        console.error(
          "[SERVER] Request error:",
          error
        );

        if (!res.headersSent) {
          sendJSON(
            res,
            500,
            {
              error:
                "Internal server error."
            }
          );
        }
      }
    }
  );
/* ======================================================
   STARTUP
====================================================== */

async function startServer() {
  try {
    await initializeDatabase();

    server.listen(
      PORT,
      () => {
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
          `Application Version: ${APP_VERSION}`
        );

        console.log(
          `Policy Engine: ACTIVE`
        );

        console.log(
          `Human Authority: ${POLICY.humanAuthorityRequired}`
        );

        console.log(
          `Human Authorization: ACTIVE`
        );

        console.log(
          `Audit Logging: ${pool ? "ACTIVE" : "DISABLED"}`
        );

        console.log(
          `Persistent Storage: ${
            pool
              ? "POSTGRESQL"
              : "NONE"
          }`
        );

        console.log(
          `Emergency Stop: ${
            ROBOT.emergencyStop
              ? "ON"
              : "OFF"
          }`
        );

        console.log(
          `Robot Controller: ${
            ROBOT_CONTROLLER.enabled
              ? "ACTIVE"
              : "NOT CONFIGURED"
          }`
        );

        console.log(
          `Robot Mode: ${ROBOT.mode}`
        );

        console.log(
          `Robot ID: ${ROBOT.id}`
        );

        console.log(
          "========================================"
        );
      }
    );
  } catch (error) {
    console.error(
      "[STARTUP] Fatal startup error:",
      error
    );

    process.exit(1);
  }
}

/* ======================================================
   PROCESS SAFETY
====================================================== */

process.on(
  "unhandledRejection",
  error => {
    console.error(
      "[PROCESS] Unhandled rejection:",
      error
    );
  }
);

process.on(
  "uncaughtException",
  error => {
    console.error(
      "[PROCESS] Uncaught exception:",
      error
    );
  }
);

/* ======================================================
   START
====================================================== */

startServer();
