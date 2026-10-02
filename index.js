const http = require("http");
const OpenAI = require("openai");

const PORT = process.env.PORT || 3000;
const VERIFY_TOKEN = process.env.WEBHOOK_VERIFY_TOKEN;
const WHATSAPP_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN;
const PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

const openai = new OpenAI({
  apiKey: OPENAI_API_KEY
});

/* =========================================================
   SILENT STRATEGIST POLICY
   ========================================================= */

const POLICY = {
  name: "Silent Strategist Core Policy",
  version: "2.0.0",

  principles: [
    "Human authority comes first.",
    "AI provides assistance and recommendations, not ultimate authority.",
    "The AI cannot grant itself permissions.",
    "The AI cannot bypass application safety rules.",
    "The AI cannot modify its own policy.",
    "External actions must be separately authorized.",
    "Important actions require human approval.",
    "The system must be transparent about what it has and has not done.",
    "Only registered AI capabilities may be selected by the router.",
    "Only authorized providers may be used.",
    "Provider failure must not silently create unauthorized behavior.",
    "Every orchestration decision must be auditable."
  ]
};


/* =========================================================
   AI CAPABILITY REGISTRY
   ========================================================= */

const AI_CAPABILITIES = {

  reasoning: {
    id: "reasoning",
    name: "Reasoning",
    description:
      "General reasoning, analysis, planning and conversation.",

    enabled: true,

    providers: [
      {
        id: "openai-primary",
        name: "OpenAI",
        type: "openai",
        enabled: true,
        model:
          process.env.OPENAI_REASONING_MODEL ||
          "gpt-4o-mini",
        priority: 1
      }
    ]
  },

  image: {
    id: "image",
    name: "Image Generation",
    description:
      "Generate or transform images.",

    enabled: false,

    providers: []
  },

  speech: {
    id: "speech",
    name: "Speech",
    description:
      "Speech recognition and speech generation.",

    enabled: false,

    providers: []
  },

  coding: {
    id: "coding",
    name: "Coding",
    description:
      "Software development and code analysis.",

    enabled: false,

    providers: []
  },

  research: {
    id: "research",
    name: "Research",
    description:
      "Research and information retrieval.",

    enabled: false,

    providers: []
  }

};


/* =========================================================
   AUDIT LOG
   ========================================================= */

const auditLog = [];

function recordAuditEvent(event) {

  const auditEvent = {
    timestamp: new Date().toISOString(),
    ...event
  };

  auditLog.push(auditEvent);

  console.log(
    "AUDIT LOG:",
    JSON.stringify(
      auditEvent,
      null,
      2
    )
  );

  /*
   * Temporary development limit.
   * Persistent audit storage will be added later.
   */

  if (auditLog.length > 1000) {
    auditLog.shift();
  }
}


/* =========================================================
   PROVIDER REGISTRY
   ========================================================= */

function getAvailableProviders(
  capabilityId
) {

  const capability =
    AI_CAPABILITIES[capabilityId];

  if (
    !capability ||
    !capability.enabled
  ) {
    return [];
  }

  return capability.providers
    .filter(
      provider => provider.enabled
    )
    .sort(
      (a, b) =>
        a.priority - b.priority
    );
}


/* =========================================================
   TASK CLASSIFIER
   ========================================================= */

function classifyTask(message) {

  console.log(
    "CLASSIFIER: Determining task type..."
  );

  const text =
    message.toLowerCase().trim();


  /* IMAGE */

  const imageKeywords = [

    "create an image",
    "generate an image",
    "make an image",
    "draw an image",
    "create a picture",
    "generate a picture",
    "draw a picture",
    "edit this image",
    "modify this image"

  ];

  if (
    imageKeywords.some(
      keyword =>
        text.includes(keyword)
    )
  ) {

    return {
      capability: "image",
      confidence: 0.95,
      reason:
        "Image-related instruction detected."
    };
  }


  /* SPEECH */

  const speechKeywords = [

    "transcribe",
    "transcription",
    "voice recording",
    "audio recording",
    "convert speech",
    "read this aloud"

  ];

  if (
    speechKeywords.some(
      keyword =>
        text.includes(keyword)
    )
  ) {

    return {
      capability: "speech",
      confidence: 0.90,
      reason:
        "Speech/audio instruction detected."
    };
  }


  /* CODING */

  const codingKeywords = [

    "write code",
    "write a program",
    "debug this code",
    "fix this code",
    "javascript",
    "python",
    "node.js",
    "nodejs",
    "api code",
    "programming"

  ];

  if (
    codingKeywords.some(
      keyword =>
        text.includes(keyword)
    )
  ) {

    return {
      capability: "coding",
      confidence: 0.90,
      reason:
        "Coding-related instruction detected."
    };
  }


  /* RESEARCH */

  const researchKeywords = [

    "research",
    "latest information",
    "look up",
    "search for",
    "find information",
    "what happened today",
    "current information"

  ];

  if (
    researchKeywords.some(
      keyword =>
        text.includes(keyword)
    )
  ) {

    return {
      capability: "research",
      confidence: 0.90,
      reason:
        "Research-related instruction detected."
    };
  }


  /* DEFAULT */

  return {
    capability: "reasoning",
    confidence: 0.75,
    reason:
      "General reasoning/conversation task."
  };
}


/* =========================================================
   POLICY / SAFETY ENGINE
   ========================================================= */

function evaluatePolicy(message) {

  console.log(
    "POLICY: Evaluating incoming request..."
  );

  if (
    !message ||
    typeof message !== "string"
  ) {

    return {
      allowed: false,
      riskLevel: "HIGH",
      requiresHumanApproval: true,
      reason:
        "Invalid or missing message."
    };
  }

  if (!message.trim()) {

    return {
      allowed: false,
      riskLevel: "HIGH",
      requiresHumanApproval: true,
      reason:
        "Empty message."
    };
  }

  return {
    allowed: true,
    riskLevel: "LOW",
    requiresHumanApproval: false,
    reason:
      "Informational AI response permitted.",
    policyVersion:
      POLICY.version
  };
}


/* =========================================================
   AI ROUTER
   ========================================================= */

function routeTask(classification) {

  console.log(
    "ROUTER: Selecting authorized provider..."
  );

  const capability =
    AI_CAPABILITIES[
      classification.capability
    ];

  if (!capability) {

    return {
      routed: false,
      reason:
        "Requested capability is not registered."
    };
  }

  if (!capability.enabled) {

    return {
      routed: false,
      reason:
        `Capability "${capability.name}" is currently disabled.`
    };
  }

  const providers =
    getAvailableProviders(
      classification.capability
    );

  if (providers.length === 0) {

    return {
      routed: false,
      reason:
        `No authorized provider is currently available for ${capability.name}.`
    };
  }

  return {

    routed: true,

    capability:
      classification.capability,

    capabilityName:
      capability.name,

    primaryProvider:
      providers[0],

    fallbackProvider:
      providers[1] || null
  };
}


/* =========================================================
   OPENAI PROVIDER ADAPTER
   ========================================================= */

async function openAIReasoningAdapter(
  message,
  provider
) {

  console.log(
    `PROVIDER: ${provider.name}`
  );

  console.log(
    `MODEL: ${provider.model}`
  );

  const completion =
    await openai.chat.completions.create({

      model:
        provider.model,

      messages: [

        {
          role: "system",

          content: `
You are the reasoning component inside
The Silent Strategist AI.

You are an AI capability, not the authority.

Human authority comes first.

Your responsibilities:

1. Provide useful reasoning and information.
2. Be honest about uncertainty.
3. Never claim an external action occurred unless the application actually confirms it.
4. Never claim permissions you do not have.
5. Never attempt to bypass application policies.
6. Never modify your governing policy.
7. Do not treat your own recommendation as human authorization.
8. Important external actions require authorization outside the model.

Silent Strategist policy version:
${POLICY.version}
          `
        },

        {
          role: "user",
          content: message
        }

      ]
    });


  const reply =
    completion
      .choices?.[0]
      ?.message
      ?.content;


  if (!reply) {

    throw new Error(
      "Provider returned an empty response."
    );
  }


  return {

    reply,

    provider:
      provider.id,

    providerName:
      provider.name,

    model:
      provider.model

  };
}


/* =========================================================
   PROVIDER ADAPTER DISPATCHER
   ========================================================= */

async function executeProvider(
  message,
  provider
) {

  if (
    provider.type === "openai"
  ) {

    return openAIReasoningAdapter(
      message,
      provider
    );
  }

  throw new Error(
    `No adapter exists for provider type: ${provider.type}`
  );
}


/* =========================================================
   AI ORCHESTRATOR
   ========================================================= */

async function orchestrateAI(
  message,
  sender
) {

  /* CLASSIFY */

  const classification =
    classifyTask(message);


  recordAuditEvent({

    type:
      "TASK_CLASSIFICATION",

    sender,

    classification

  });


  /* ROUTE */

  const route =
    routeTask(
      classification
    );


  recordAuditEvent({

    type:
      "AI_ROUTING_DECISION",

    sender,

    route: {

      routed:
        route.routed,

      capability:
        route.capability,

      capabilityName:
        route.capabilityName,

      primaryProvider:
        route.primaryProvider?.id,

      fallbackProvider:
        route.fallbackProvider?.id,

      reason:
        route.reason

    }

  });


  if (!route.routed) {

    throw new Error(
      route.reason ||
      "No authorized AI provider available."
    );
  }


  /* PRIMARY PROVIDER */

  try {

    console.log(
      `ORCHESTRATOR: Using primary provider ${route.primaryProvider.id}`
    );


    const result =
      await executeProvider(
        message,
        route.primaryProvider
      );


    recordAuditEvent({

      type:
        "PRIMARY_PROVIDER_SUCCESS",

      sender,

      capability:
        route.capability,

      provider:
        route.primaryProvider.id,

      model:
        route.primaryProvider.model

    });


    return result;


  } catch (primaryError) {

    console.error(
      "PRIMARY PROVIDER ERROR:",
      primaryError.message
    );


    recordAuditEvent({

      type:
        "PRIMARY_PROVIDER_FAILURE",

      sender,

      capability:
        route.capability,

      provider:
        route.primaryProvider.id,

      error:
        primaryError.message

    });


    /* FALLBACK */

    if (
      !route.fallbackProvider
    ) {

      throw primaryError;
    }


    try {

      console.log(
        `ORCHESTRATOR: Attempting fallback provider ${route.fallbackProvider.id}`
      );


      const fallbackResult =
        await executeProvider(
          message,
          route.fallbackProvider
        );


      recordAuditEvent({

        type:
          "FALLBACK_PROVIDER_SUCCESS",

        sender,

        capability:
          route.capability,

        provider:
          route.fallbackProvider.id,

        model:
          route.fallbackProvider.model

      });


      return fallbackResult;


    } catch (fallbackError) {

      recordAuditEvent({

        type:
          "FALLBACK_PROVIDER_FAILURE",

        sender,

        capability:
          route.capability,

        provider:
          route.fallbackProvider.id,

        error:
          fallbackError.message

      });


      throw fallbackError;
    }
  }
}


/* =========================================================
   RESPONSE VERIFICATION
   ========================================================= */

function verifyAIResponse(
  reply
) {

  console.log(
    "VERIFICATION: Checking AI response..."
  );


  if (
    !reply ||
    typeof reply !== "string"
  ) {

    return {

      verified: false,

      reason:
        "AI returned an empty or invalid response."

    };
  }


  return {

    verified: true,

    reason:
      "AI response passed basic verification."

  };
}


/* =========================================================
   WHATSAPP SENDER
   ========================================================= */

async function sendWhatsAppMessage(
  to,
  text
) {

  console.log(
    "STEP 6: Sending WhatsApp reply..."
  );


  const url =
    `https://graph.facebook.com/v23.0/${PHONE_NUMBER_ID}/messages`;


  const response =
    await fetch(
      url,
      {

        method: "POST",

        headers: {

          Authorization:
            `Bearer ${WHATSAPP_TOKEN}`,

          "Content-Type":
            "application/json"

        },

        body:
          JSON.stringify({

            messaging_product:
              "whatsapp",

            to,

            type:
              "text",

            text: {
              body: text
            }

          })

      }
    );


  const data =
    await response.json();


  console.log(
    "WhatsApp API response:",
    JSON.stringify(
      data,
      null,
      2
    )
  );


  if (!response.ok) {

    throw new Error(
      `WhatsApp API failed: ${JSON.stringify(data)}`
    );
  }


  return data;
}


/* =========================================================
   COMPLETE SILENT STRATEGIST PIPELINE
   ========================================================= */

async function processMessage(
  from,
  text
) {

  console.log(
    "========================================"
  );

  console.log(
    "SILENT STRATEGIST PIPELINE START"
  );

  console.log(
    "========================================"
  );


  /* POLICY */

  const policyResult =
    evaluatePolicy(text);


  recordAuditEvent({

    type:
      "POLICY_EVALUATION",

    sender:
      from,

    message:
      text,

    policyResult

  });


  if (
    !policyResult.allowed
  ) {

    recordAuditEvent({

      type:
        "REQUEST_REJECTED",

      sender:
        from,

      reason:
        policyResult.reason

    });

    return;
  }


  /* ORCHESTRATION */

  const aiResult =
    await orchestrateAI(
      text,
      from
    );


  /* VERIFICATION */

  const verification =
    verifyAIResponse(
      aiResult.reply
    );


  recordAuditEvent({

    type:
      "AI_RESPONSE_VERIFICATION",

    sender:
      from,

    provider:
      aiResult.provider,

    verification

  });


  if (
    !verification.verified
  ) {

    recordAuditEvent({

      type:
        "RESPONSE_BLOCKED",

      sender:
        from,

      reason:
        verification.reason

    });

    return;
  }


  /* APPROVAL */

  recordAuditEvent({

    type:
      "AI_RESPONSE_APPROVED",

    sender:
      from,

    capability:
      "reasoning",

    provider:
      aiResult.provider,

    model:
      aiResult.model,

    riskLevel:
      policyResult.riskLevel,

    response:
      aiResult.reply

  });


  /* SEND */

  await sendWhatsAppMessage(
    from,
    aiResult.reply
  );


  /* AUDIT */

  recordAuditEvent({

    type:
      "WHATSAPP_RESPONSE_SENT",

    sender:
      from,

    action:
      "SEND_WHATSAPP_MESSAGE",

    status:
      "SUCCESS"

  });


  console.log(
    "========================================"
  );

  console.log(
    "SILENT STRATEGIST PIPELINE COMPLETE"
  );

  console.log(
    "========================================"
  );
}


/* =========================================================
   PUBLIC CAPABILITY STATUS
   ========================================================= */

function getPublicCapabilities() {

  return Object.values(
    AI_CAPABILITIES
  ).map(
    capability => ({

      id:
        capability.id,

      name:
        capability.name,

      description:
        capability.description,

      enabled:
        capability.enabled,

      providers:
        capability.providers.map(
          provider => ({

            id:
              provider.id,

            name:
              provider.name,

            type:
              provider.type,

            enabled:
              provider.enabled,

            model:
              provider.model,

            priority:
              provider.priority

          })
        )

    })
  );
}


/* =========================================================
   WEB SERVER
   ========================================================= */

const server =
  http.createServer(
    (req, res) => {


      /* HEALTH CHECK */

      if (
        req.method === "GET" &&
        req.url === "/"
      ) {

        const capabilityStatus =
          Object.values(
            AI_CAPABILITIES
          )
            .map(
              capability =>
                `<li>${capability.name}: ${
                  capability.enabled
                    ? "Enabled"
                    : "Disabled"
                }</li>`
            )
            .join("");


        res.writeHead(
          200,
          {
            "Content-Type":
              "text/html; charset=utf-8"
          }
        );


        res.end(`

          <h1>The Silent Strategist AI</h1>

          <p>Status: Online</p>

          <p>WhatsApp Cloud API: Ready</p>

          <p>Policy Engine: Active</p>

          <p>Task Classifier: Active</p>

          <p>AI Capability Registry: Active</p>

          <p>AI Router: Active</p>

          <p>Provider Adapter Layer: Active</p>

          <p>Verification Layer: Active</p>

          <p>Audit Logging: Active</p>

          <p>
            Policy Version:
            ${POLICY.version}
          </p>

          <h2>AI Capabilities</h2>

          <ul>
            ${capabilityStatus}
          </ul>

        `);

        return;
      }


      /* CAPABILITY STATUS */

      if (
        req.method === "GET" &&
        req.url === "/capabilities"
      ) {

        res.writeHead(
          200,
          {
            "Content-Type":
              "application/json"
          }
        );


        res.end(
          JSON.stringify(
            {

              policyVersion:
                POLICY.version,

              capabilities:
                getPublicCapabilities()

            },

            null,
            2
          )
        );

        return;
      }


      /* META WEBHOOK VERIFICATION */

      if (
        req.method === "GET" &&
        req.url.startsWith(
          "/webhook"
        )
      ) {

        const url =
          new URL(
            req.url,
            `http://${req.headers.host}`
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
          token === VERIFY_TOKEN
        ) {
          console.log(
            "Webhook verified successfully."
          );

          res.writeHead(200);
          res.end(challenge);
          return;
        }

        res.writeHead(403);
        res.end("Forbidden");
        return;
      }


      /* META WEBHOOK EVENTS */

      if (
        req.method === "POST" &&
        req.url === "/webhook"
      ) {

        console.log(
          "STEP 1: POST /webhook received"
        );

        let body = "";

        req.on(
          "data",
          chunk => {
            body += chunk.toString();
          }
        );

        req.on(
          "end",
          async () => {

            try {

              const payload =
                JSON.parse(body);

              console.log(
                "Webhook payload received:",
                JSON.stringify(
                  payload,
                  null,
                  2
                )
              );


              /*
               * Ignore webhook events that do not
               * contain WhatsApp messages.
               */

              const entries =
                payload.entry || [];


              for (
                const entry of entries
              ) {

                const changes =
                  entry.changes || [];


                for (
                  const change of changes
                ) {

                  const value =
                    change.value || {};


                  const messages =
                    value.messages || [];


                  if (
                    messages.length === 0
                  ) {

                    console.log(
                      "Webhook event contains no messages. Ignoring."
                    );

                    continue;
                  }


                  for (
                    const message of messages
                  ) {

                    const from =
                      message.from;


                    /*
                     * Currently process text messages only.
                     */

                    if (
                      message.type !== "text"
                    ) {

                      console.log(
                        `Unsupported WhatsApp message type: ${message.type}`
                      );

                      recordAuditEvent({

                        type:
                          "UNSUPPORTED_MESSAGE_TYPE",

                        sender:
                          from,

                        messageType:
                          message.type

                      });

                      continue;
                    }


                    const text =
                      message.text?.body;


                    if (
                      !text
                    ) {

                      console.log(
                        "Text message contains no body. Ignoring."
                      );

                      continue;
                    }


                    console.log(
                      "WhatsApp sender:",
                      from
                    );

                    console.log(
                      "WhatsApp message:",
                      text
                    );


                    /*
                     * Respond to Meta immediately so the
                     * webhook request does not remain open
                     * while the AI processes the message.
                     */

                    res.writeHead(
                      200,
                      {
                        "Content-Type":
                          "text/plain"
                      }
                    );

                    res.end(
                      "EVENT_RECEIVED"
                    );


                    /*
                     * Process the message asynchronously.
                     */

                    processMessage(
                      from,
                      text
                    )
                      .then(
                        () => {

                          console.log(
                            "Message processing completed."
                          );

                        }
                      )
                      .catch(
                        error => {

                          console.error(
                            "PROCESSING ERROR:",
                            error.message
                          );


                          recordAuditEvent({

                            type:
                              "PROCESSING_ERROR",

                            sender:
                              from,

                            error:
                              error.message

                          });

                        }
                      );

                    /*
                     * We already returned the HTTP response,
                     * so stop processing this webhook request.
                     */

                    return;
                  }
                }
              }


              /*
               * If there was no actual text message,
               * acknowledge the webhook.
               */

              if (!res.writableEnded) {

                res.writeHead(
                  200,
                  {
                    "Content-Type":
                      "text/plain"
                  }
                );

                res.end(
                  "EVENT_RECEIVED"
                );
              }

            } catch (error) {

              console.error(
                "WEBHOOK PARSE ERROR:",
                error.message
              );


              recordAuditEvent({

                type:
                  "WEBHOOK_PARSE_ERROR",

                error:
                  error.message

              });


              if (
                !res.writableEnded
              ) {

                res.writeHead(
                  400,
                  {
                    "Content-Type":
                      "text/plain"
                  }
                );

                res.end(
                  "Invalid webhook payload"
                );
              }
            }
          }
        );

        return;
      }


      /* UNKNOWN ROUTE */

      res.writeHead(
        404,
        {
          "Content-Type":
            "text/plain"
        }
      );

      res.end(
        "Not Found"
      );
    }
  );


/* =========================================================
   START SERVER
   ========================================================= */

server.listen(
  PORT,
  () => {

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
      `Policy Version: ${POLICY.version}`
    );
  }
);
