"use strict";

/*
 * THE SILENT STRATEGIST AI
 * EMBODIMENT INTERFACE
 *
 * Purpose:
 *   Connect one intelligence core to multiple bodies
 *   without rewriting the intelligence core.
 *
 * Architecture:
 *
 *   SILENT STRATEGIST CORE
 *            |
 *      EMBODIMENT INTERFACE
 *            |
 *      +-----+------+
 *      |            |
 *   BODY A       BODY B
 *   Wheeled      Humanoid
 *   Robot        Robot
 *
 * Important principle:
 *   The intelligence core requests CAPABILITIES.
 *   It does NOT directly control motors or hardware.
 */

const EMBODIMENT_INTERFACE_VERSION = "1.0.0";

/*
 * ============================================================
 * CAPABILITY DEFINITIONS
 * ============================================================
 */

const CAPABILITIES = Object.freeze({
  OBSERVE: "OBSERVE",
  MOVE: "MOVE",
  STOP: "STOP",
  TURN: "TURN",
  SPEAK: "SPEAK",
  LISTEN: "LISTEN",
  REPORT_STATUS: "REPORT_STATUS",

  NAVIGATE_TO: "NAVIGATE_TO",
  PICK_UP: "PICK_UP",
  RELEASE: "RELEASE",
  LOOK_AT: "LOOK_AT",
  FOLLOW: "FOLLOW",
  DOCK: "DOCK",
  CHARGE: "CHARGE",

  GRASP: "GRASP",
  ROTATE: "ROTATE",
  LIFT: "LIFT",
  LOWER: "LOWER",
  OPEN: "OPEN",
  CLOSE: "CLOSE",
  POINT: "POINT",
  TRACK: "TRACK",
  SCAN: "SCAN",
  IDENTIFY: "IDENTIFY",
  MEASURE: "MEASURE",
  WAIT: "WAIT",
  SEARCH: "SEARCH",
  APPROACH: "APPROACH",
  AVOID: "AVOID",
  RETURN_HOME: "RETURN_HOME",
  SET_SPEED: "SET_SPEED",
  SET_DIRECTION: "SET_DIRECTION",
  PLAY_SOUND: "PLAY_SOUND",
  DISPLAY: "DISPLAY",
  TAKE_PHOTO: "TAKE_PHOTO",
  RECORD_AUDIO: "RECORD_AUDIO"
});


/*
 * ============================================================
 * COMMAND TYPES
 * ============================================================
 */

const COMMAND_TYPES = Object.freeze({
  OBSERVE: "OBSERVE",
  MOVE: "MOVE",
  STOP: "STOP",
  TURN: "TURN",
  SPEAK: "SPEAK",
  LISTEN: "LISTEN",
  REPORT_STATUS: "REPORT_STATUS",
  NAVIGATE_TO: "NAVIGATE_TO",
  PICK_UP: "PICK_UP",
  RELEASE: "RELEASE",
  LOOK_AT: "LOOK_AT",
  FOLLOW: "FOLLOW",
  DOCK: "DOCK",
  CHARGE: "CHARGE",

  GRASP: "GRASP",
  ROTATE: "ROTATE",
  LIFT: "LIFT",
  LOWER: "LOWER",
  OPEN: "OPEN",
  CLOSE: "CLOSE",
  POINT: "POINT",
  TRACK: "TRACK",
  SCAN: "SCAN",
  IDENTIFY: "IDENTIFY",
  MEASURE: "MEASURE",
  WAIT: "WAIT",
  SEARCH: "SEARCH",
  APPROACH: "APPROACH",
  AVOID: "AVOID",
  RETURN_HOME: "RETURN_HOME",
  SET_SPEED: "SET_SPEED",
  SET_DIRECTION: "SET_DIRECTION",
  PLAY_SOUND: "PLAY_SOUND",
  DISPLAY: "DISPLAY",
  TAKE_PHOTO: "TAKE_PHOTO",
  RECORD_AUDIO: "RECORD_AUDIO"
});

const COMMAND_PARAMETERS = Object.freeze({

  OBSERVE: [],

  MOVE: [
    "direction",
    "distance"
  ],

  STOP: [],

  TURN: [
    "direction",
    "degrees"
  ],

  SPEAK: [
    "text"
  ],

  LISTEN: [],

  REPORT_STATUS: [],

  NAVIGATE_TO: [
    "x",
    "y"
  ],

  PICK_UP: [
    "objectId"
  ],

  RELEASE: [],

  LOOK_AT: [
    "target"
  ],

  FOLLOW: [
    "target"
  ],

  DOCK: [],

  CHARGE: [],

  GRASP: [
    "objectId"
  ],

  ROTATE: [
    "degrees"
  ],

  LIFT: [
    "height"
  ],

  LOWER: [
    "height"
  ],

  OPEN: [],

  CLOSE: [],

  POINT: [
    "target"
  ],

  TRACK: [
    "target"
  ],

  SCAN: [
    "area"
  ],

  IDENTIFY: [
    "target"
  ],

  MEASURE: [
    "target",
    "measurement"
  ],

  WAIT: [
    "duration"
  ],

  SEARCH: [
    "target"
  ],

  APPROACH: [
    "target"
  ],

  AVOID: [
    "target"
  ],

  RETURN_HOME: [],

  SET_SPEED: [
    "speed"
  ],

  SET_DIRECTION: [
    "direction"
  ],

  PLAY_SOUND: [
    "sound"
  ],

  DISPLAY: [
    "content"
  ],

  TAKE_PHOTO: [],

  RECORD_AUDIO: [
    "duration"
  ]
});


/*
 * ============================================================
 * EMBODIMENT REGISTRY
 * ============================================================
 *
 * The core should not need to know how a body works internally.
 *
 * A body only needs to expose capabilities.
 */

class EmbodimentRegistry {
  constructor() {
    this.embodiments = new Map();
  }

  register(body) {
    if (!body || !body.id) {
      throw new Error("Embodiment must have an id.");
    }

    if (!Array.isArray(body.capabilities)) {
      throw new Error(
        `Embodiment ${body.id} must define capabilities.`
      );
    }

    this.embodiments.set(body.id, {
      ...body,
      registeredAt: new Date().toISOString()
    });

    return this.get(body.id);
  }

  unregister(bodyId) {
    return this.embodiments.delete(bodyId);
  }

  get(bodyId) {
    return this.embodiments.get(bodyId) || null;
  }

  list() {
    return Array.from(this.embodiments.values());
  }

  has(bodyId) {
    return this.embodiments.has(bodyId);
  }

  supports(bodyId, capability) {
    const body = this.get(bodyId);

    if (!body) {
      return false;
    }

    return body.capabilities.includes(capability);
  }
}


/*
 * ============================================================
 * COMMAND VALIDATION
 * ============================================================
 */

function validateCommand(command) {
  if (!command || typeof command !== "object") {
    return {
      valid: false,
      reason: "Command must be an object."
    };
  }

  if (!command.type) {
    return {
      valid: false,
      reason: "Command type is required."
    };
  }

  if (!Object.values(COMMAND_TYPES).includes(command.type)) {
    return {
      valid: false,
      reason: `Unknown command type: ${command.type}`
    };
  }

  if (!command.bodyId) {
    return {
      valid: false,
      reason: "bodyId is required."
    };
  }

  /*
   * ----------------------------------------------------------
   * COMMAND PARAMETERS
   * ----------------------------------------------------------
   */

const parameterDefinition =
    COMMAND_PARAMETERS[command.type] || [];

const requiredParameters =
    parameterDefinition.required || [];

const parameterTypes =
    parameterDefinition.types || {};

for (const parameter of requiredParameters) {

  if (
    command[parameter] === undefined ||
    command[parameter] === null
  ) {
    return {
      valid: false,
      reason:
        `Missing required parameter: ${parameter}`
    };
  }

  const expectedType =
    parameterTypes[parameter];

  if (
    expectedType &&
    typeof command[parameter] !== expectedType
  ) {
    return {
      valid: false,
      reason:
        `Parameter ${parameter} must be a ${expectedType}.`
    };
  }
}

  return {
    valid: true,
    reason: null
  };
}

/*
 * ============================================================
 * EMBODIMENT INTERFACE
 * ============================================================
 */

class EmbodimentInterface {
  constructor(options = {}) {
    this.version = EMBODIMENT_INTERFACE_VERSION;

    this.registry =
      options.registry || new EmbodimentRegistry();

    /*
     * Human authority is enabled by default.
     *
     * This means the interface is designed so that
     * important actions can require authorization.
     */
    this.humanAuthorityRequired =
      options.humanAuthorityRequired !== false;

    /*
     * Emergency stop always has priority.
     */
    this.emergencyStop = false;

    /*
     * Every command can be recorded here before
     * being sent to a body.
     */
    this.commandHistory = [];
  }


  /*
   * ----------------------------------------------------------
   * REGISTER BODY
   * ----------------------------------------------------------
   */

  registerBody(body) {
    return this.registry.register(body);
  }


  /*
   * ----------------------------------------------------------
   * REMOVE BODY
   * ----------------------------------------------------------
   */

  unregisterBody(bodyId) {
    return this.registry.unregister(bodyId);
  }


  /*
   * ----------------------------------------------------------
   * GET BODY
   * ----------------------------------------------------------
   */

  getBody(bodyId) {
    return this.registry.get(bodyId);
  }


  /*
   * ----------------------------------------------------------
   * LIST BODIES
   * ----------------------------------------------------------
   */

  listBodies() {
    return this.registry.list();
  }


  /*
   * ----------------------------------------------------------
   * CHECK CAPABILITY
   * ----------------------------------------------------------
   */

  bodySupports(bodyId, capability) {
    return this.registry.supports(bodyId, capability);
  }


  /*
   * ----------------------------------------------------------
   * EMERGENCY STOP
   * ----------------------------------------------------------
   */

  activateEmergencyStop(reason = "Emergency stop activated.") {
    this.emergencyStop = true;

    /*
     * Immediately send STOP to every registered body.
     */
    for (const body of this.registry.list()) {
      if (
        body.capabilities &&
        body.capabilities.includes(CAPABILITIES.STOP) &&
        typeof body.execute === "function"
      ) {
        try {
          body.execute({
            type: COMMAND_TYPES.STOP,
            bodyId: body.id,
            reason,
            emergency: true,
            timestamp: new Date().toISOString()
          });
        } catch (error) {
          /*
           * Emergency stop must continue attempting
           * to stop other bodies even if one fails.
           */
        }
      }
    }

    return {
      success: true,
      emergencyStop: true,
      reason
    };
  }


  /*
   * ----------------------------------------------------------
   * RESET EMERGENCY STOP
   * ----------------------------------------------------------
   *
   * This does NOT automatically move a body.
   * It only clears the global interface stop state.
   */

  resetEmergencyStop() {
    this.emergencyStop = false;

    return {
      success: true,
      emergencyStop: false
    };
  }


  /*
   * ----------------------------------------------------------
   * SEND COMMAND
   * ----------------------------------------------------------
   *
   * This is the main bridge between the AI core and bodies.
   */

  async sendCommand(command, authorization = null) {

    /*
     * STEP 1:
     * Validate command structure.
     */

    const validation = validateCommand(command);

    if (!validation.valid) {
      return {
        success: false,
        stage: "VALIDATION",
        error: validation.reason
      };
    }


    /*
     * STEP 2:
     * Emergency stop has absolute priority.
     */

    if (
      this.emergencyStop &&
      command.type !== COMMAND_TYPES.STOP
    ) {
      return {
        success: false,
        stage: "EMERGENCY_STOP",
        error: "Command rejected because emergency stop is active."
      };
    }


    /*
     * STEP 3:
     * Find target body.
     */

    const body = this.registry.get(command.bodyId);

    if (!body) {
      return {
        success: false,
        stage: "BODY_LOOKUP",
        error: `Embodiment not found: ${command.bodyId}`
      };
    }


    /*
     * STEP 4:
     * Verify capability.
     */

    if (
      !body.capabilities.includes(command.type)
    ) {
      return {
        success: false,
        stage: "CAPABILITY_CHECK",
        error:
          `Body ${body.id} does not support capability ${command.type}.`
      };
    }


    /*
     * STEP 5:
     * Human authorization.
     *
     * STOP remains executable.
     */

    if (
      this.humanAuthorityRequired &&
      command.type !== COMMAND_TYPES.STOP
    ) {
      if (!authorization || authorization.approved !== true) {
        return {
          success: false,
          stage: "AUTHORIZATION",
          error: "Human authorization is required."
        };
      }
    }


    /*
     * STEP 6:
     * Safety validation.
     *
     * A body may optionally provide its own safetyCheck().
     */

    if (typeof body.safetyCheck === "function") {
      const safetyResult =
        await body.safetyCheck(command);

      if (!safetyResult || safetyResult.safe !== true) {
        return {
          success: false,
          stage: "SAFETY",
          error:
            safetyResult?.reason ||
            "Command rejected by embodiment safety system."
        };
      }
    }


    /*
     * STEP 7:
     * Execute.
     */

    if (typeof body.execute !== "function") {
      return {
        success: false,
        stage: "EXECUTION",
        error:
          `Embodiment ${body.id} does not provide an execute() function.`
      };
    }

    const timestamp =
      new Date().toISOString();

    const executionCommand = {
      ...command,
      timestamp,
      authorizationId:
        authorization?.authorizationId || null
    };


    let result;

    try {
      result =
        await body.execute(executionCommand);
    } catch (error) {
      result = {
        success: false,
        error: error.message
      };
    }


    /*
     * STEP 8:
     * Record command history.
     */

    const record = {
      timestamp,
      bodyId: command.bodyId,
      command: command.type,
      authorizationId:
        authorization?.authorizationId || null,
      success: result?.success === true,
      result
    };

    this.commandHistory.push(record);


    /*
     * Keep memory bounded.
     */

    if (this.commandHistory.length > 1000) {
      this.commandHistory.shift();
    }


    return {
      success: result?.success === true,
      stage: "EXECUTION",
      bodyId: body.id,
      command: command.type,
      result
    };
  }


  /*
   * ----------------------------------------------------------
   * OBSERVE
   * ----------------------------------------------------------
   */

  async observe(bodyId) {
    const body = this.registry.get(bodyId);

    if (!body) {
      return {
        success: false,
        error: `Embodiment not found: ${bodyId}`
      };
    }

    if (
      !body.capabilities.includes(
        CAPABILITIES.OBSERVE
      )
    ) {
      return {
        success: false,
        error:
          `Body ${bodyId} does not support OBSERVE.`
      };
    }

    if (typeof body.observe !== "function") {
      return {
        success: false,
        error:
          `Body ${bodyId} does not provide observe().`
      };
    }

    try {
      const observation =
        await body.observe();

      return {
        success: true,
        bodyId,
        observation,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      return {
        success: false,
        bodyId,
        error: error.message
      };
    }
  }


  /*
   * ----------------------------------------------------------
   * STATUS
   * ----------------------------------------------------------
   */

  async getStatus(bodyId) {
    const body = this.registry.get(bodyId);

    if (!body) {
      return {
        success: false,
        error: `Embodiment not found: ${bodyId}`
      };
    }

    if (typeof body.getStatus === "function") {
      return {
        success: true,
        bodyId,
        status: await body.getStatus()
      };
    }

    return {
      success: true,
      bodyId,
      status: {
        id: body.id,
        name: body.name,
        type: body.type,
        capabilities: body.capabilities,
        connected: body.connected !== false
      }
    };
  }


  /*
   * ----------------------------------------------------------
   * SYSTEM STATUS
   * ----------------------------------------------------------
   */

  getSystemStatus() {
    return {
      interfaceVersion:
        this.version,

      emergencyStop:
        this.emergencyStop,

      humanAuthorityRequired:
        this.humanAuthorityRequired,

      embodimentCount:
        this.registry.list().length,

      embodiments:
        this.registry.list().map(body => ({
          id: body.id,
          name: body.name,
          type: body.type,
          capabilities: body.capabilities,
          connected: body.connected !== false
        }))
    };
  }


  /*
   * ----------------------------------------------------------
   * COMMAND HISTORY
   * ----------------------------------------------------------
   */

  getCommandHistory(limit = 50) {
    return this.commandHistory
      .slice(-limit);
  }
}


/*
 * ============================================================
 * VIRTUAL BODY FACTORY
 * ============================================================
 *
 * This allows us to create simulated bodies without changing
 * the intelligence core.
 *
 * Later, the same interface can connect to real hardware.
 */

function createVirtualBody(options = {}) {

  const {
    id,
    name,
    type = "virtual",
    capabilities = [],
    initialState = {},
    execute,
    observe,
    safetyCheck,
    getStatus
  } = options;


  if (!id) {
    throw new Error(
      "Virtual body requires an id."
    );
  }


  return {

    id,

    name:
      name || id,

    type,

    capabilities,

    connected: true,

    state: {
      ...initialState
    },


    async execute(command) {

      if (typeof execute === "function") {
        return execute(this, command);
      }

      /*
       * Default virtual execution.
       */

      this.state.lastCommand =
        command.type;

      this.state.lastCommandAt =
        command.timestamp;

      return {
        success: true,
        simulated: true,
        command: command.type
      };
    },


    async observe() {

      if (typeof observe === "function") {
        return observe(this);
      }

      return {
        ...this.state
      };
    },


    async safetyCheck(command) {

      if (typeof safetyCheck === "function") {
        return safetyCheck(this, command);
      }

      return {
        safe: true
      };
    },


    async getStatus() {

      if (typeof getStatus === "function") {
        return getStatus(this);
      }

      return {
        ...this.state
      };
    }
  };
      }
/*
 * ============================================================
 * CREATE THE SHARED INTERFACE
 * ============================================================
 */

const embodimentInterface =
  new EmbodimentInterface({
    humanAuthorityRequired: true
  });


/*
 * ============================================================
 * EXPORTS
 * ============================================================
 */

module.exports = {
  EMBODIMENT_INTERFACE_VERSION,
  CAPABILITIES,
  COMMAND_TYPES,
  COMMAND_PARAMETERS,
  EmbodimentRegistry,
  EmbodimentInterface,
  createVirtualBody,
  embodimentInterface
};
