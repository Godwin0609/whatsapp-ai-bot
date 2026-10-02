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
  version: "1.0.0",

  principles: [
    "Human authority comes first.",
    "AI provides assistance and recommendations, not ultimate authority.",
    "The AI cannot grant itself permissions.",
    "The AI cannot bypass application safety rules.",
    "The AI cannot modify its own policy.",
    "External actions must be separately authorized.",
    "Important actions will require human approval.",
    "The system must be transparent about what it has and has not done."
  ]
};


/* =========================================================
   POLICY / SAFETY ENGINE
   ========================================================= */

function evaluatePolicy(message) {

  console.log("POLICY: Evaluating incoming request...");

  if (!message || typeof message !== "string") {
    return {
      allowed: false,
      riskLevel: "HIGH",
      requiresHumanApproval: true,
      reason: "Invalid or missing message."
    };
  }

  const trimmedMessage = message.trim();

  if (!trimmedMessage) {
    return {
      allowed: false,
      riskLevel: "HIGH",
      requiresHumanApproval: true,
      reason: "Empty message."
    };
  }

  /*
   * At this stage the Silent Strategist is only answering
   * messages. It does not have permission to perform
   * external actions.
   */

  return {
    allowed: true,
    riskLevel: "LOW",
    requiresHumanApproval: false,
    reason: "Informational AI response permitted.",
    policyVersion: POLICY.version
  };
}


/* =========================================================
   AI DECISION / VERIFICATION
   ========================================================= */

function verifyAIResponse(reply) {

  console.log("VERIFICATION: Checking AI response...");

  if (!reply || typeof reply !== "string") {
    return {
      verified: false,
      reason: "AI returned an empty or invalid response."
    };
  }

  /*
   * This is our first verification layer.
   *
   * We are deliberately keeping it simple for now.
   * Later we will build a dedicated verification engine.
   */

  return {
    verified: true,
    reason: "AI response passed basic verification."
  };
}


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
    JSON.stringify(auditEvent, null, 2)
  );

  /*
   * Keep the development log from growing forever.
   */
  if (auditLog.length > 1000) {
    auditLog.shift();
  }
}


/* =========================================================
   SEND WHATSAPP MESSAGE
   ========================================================= */

async function sendWhatsAppMessage(to, text) {

  console.log("STEP 6: Sending WhatsApp reply...");

  const url =
    `https://graph.facebook.com/v23.0/${PHONE_NUMBER_ID}/messages`;

  const response = await fetch(url, {
    method: "POST",

    headers: {
      "Authorization": `Bearer ${WHATSAPP_TOKEN}`,
      "Content-Type": "application/json"
    },

    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: to,
      type: "text",
      text: {
        body: text
      }
    })
  });

  const data = await response.json();

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


/* =========================================================
   ASK SILENT STRATEGIST AI
   ========================================================= */

async function askOpenAI(message) {

  console.log("STEP 4: Sending message to Silent Strategist AI...");

  const completion = await openai.chat.completions.create({

    model: "gpt-4o-mini",

    messages: [

      {
        role: "system",

        content: `
You are the AI reasoning component of The Silent Strategist.

Your role is to assist humans, not replace human authority.

CORE PRINCIPLES:

1. Human authority comes first.
2. You provide information, reasoning, analysis and recommendations.
3. You do not have independent authority to perform external actions.
4. You cannot grant yourself permissions.
5. You cannot bypass application policies or safety controls.
6. You cannot modify your own governing rules.
7. Never claim that an external action was completed unless the application actually confirms that action.
8. When an important action would require authorization, clearly state that human approval is required.
9. Be transparent about uncertainty.
10. Follow the application's policy rather than attempting to override it.

The Silent Strategist is being developed around this architecture:

Human authority
→ AI assistance
→ Policy and safety
→ Verification
→ Authorized action
→ Audit
→ Human oversight

Current policy version: ${POLICY.version}

Current policy principles:
${POLICY.principles.map((item, index) => `${index + 1}. ${item}`).join("\n")}
        `
      },

      {
        role: "user",
        content: message
      }

    ]
  });

  const reply =
    completion.choices[0]?.message?.content;

  console.log(
    "AI reply:",
    reply
  );

  if (!reply) {
    throw new Error(
      "OpenAI returned an empty reply"
    );
  }

  return reply;
}


/* =========================================================
   SILENT STRATEGIST PIPELINE
   ========================================================= */

async function processMessage(from, text) {

  console.log("========================================");
  console.log("SILENT STRATEGIST PIPELINE START");
  console.log("========================================");

  /*
   * STEP 1
   * Policy evaluation
   */

  const policyResult =
    evaluatePolicy(text);

  recordAuditEvent({
    type: "POLICY_EVALUATION",
    sender: from,
    message: text,
    policyResult
  });

  if (!policyResult.allowed) {

    console.log(
      "POLICY: Request rejected."
    );

    recordAuditEvent({
      type: "REQUEST_REJECTED",
      sender: from,
      reason: policyResult.reason
    });

    return;
  }


  /*
   * STEP 2
   * Ask the AI
   */

  const aiReply =
    await askOpenAI(text);


  /*
   * STEP 3
   * Verify the AI response
   */

  const verification =
    verifyAIResponse(aiReply);

  recordAuditEvent({
    type: "AI_RESPONSE_VERIFICATION",
    sender: from,
    verification
  });


  /*
   * STEP 4
   * Do not send an unverified response.
   */

  if (!verification.verified) {

    console.log(
      "VERIFICATION FAILED: Response blocked."
    );

    recordAuditEvent({
      type: "RESPONSE_BLOCKED",
      sender: from,
      reason: verification.reason
    });

    return;
  }


  /*
   * STEP 5
   * Record the final decision before sending.
   */

  recordAuditEvent({
    type: "AI_RESPONSE_APPROVED",
    sender: from,
    riskLevel: policyResult.riskLevel,
    response: aiReply
  });


  /*
   * STEP 6
   * Send the verified response.
   */

  await sendWhatsAppMessage(
    from,
    aiReply
  );


  /*
   * STEP 7
   * Record successful action.
   */

  recordAuditEvent({
    type: "WHATSAPP_RESPONSE_SENT",
    sender: from,
    action: "SEND_WHATSAPP_MESSAGE",
    status: "SUCCESS"
  });

  console.log("========================================");
  console.log("SILENT STRATEGIST PIPELINE COMPLETE");
  console.log("========================================");
}


/* =========================================================
   WEB SERVER
   ========================================================= */

const server = http.createServer(
  async (req, res) => {

    /* =====================================================
       HEALTH CHECK
       ===================================================== */

    if (
      req.method === "GET" &&
      req.url === "/"
    ) {

      res.writeHead(200, {
        "Content-Type":
          "text/html; charset=utf-8"
      });

      res.end(`
        <h1>The Silent Strategist AI</h1>
        <p>Status: Online</p>
        <p>WhatsApp Cloud API: Ready</p>
        <p>Policy Engine: Active</p>
        <p>Verification Layer: Active</p>
        <p>Audit Logging: Active</p>
        <p>Policy Version: ${POLICY.version}</p>
      `);

      return;
    }


    /* =====================================================
       META WEBHOOK VERIFICATION
       ===================================================== */

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


    /* =====================================================
       RECEIVE WHATSAPP WEBHOOK
       ===================================================== */

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
          body += chunk;
        }
      );

      req.on(
        "end",
        async () => {

          try {

            console.log(
              "STEP 2: Request body received"
            );

            const data =
              JSON.parse(body);

            console.log(
              "Webhook data:",
              JSON.stringify(
                data,
                null,
                2
              )
            );

            const message =
              data
                .entry?.[0]
                ?.changes?.[0]
                ?.value
                ?.messages?.[0];


            if (!message) {

              console.log(
                "NO MESSAGE FOUND - probably a status/event"
              );

              res.writeHead(200);

              res.end(
                "EVENT_RECEIVED"
              );

              return;
            }


            console.log(
              "STEP 3: Message found:",
              JSON.stringify(
                message,
                null,
                2
              )
            );


            if (
              message.type !== "text"
            ) {

              console.log(
                "Message is not text:",
                message.type
              );

              res.writeHead(200);

              res.end(
                "EVENT_RECEIVED"
              );

              return;
            }


            const from =
              message.from;

            const text =
              message.text?.body;


            if (!from || !text) {

              console.log(
                "Missing sender or message text"
              );

              res.writeHead(200);

              res.end(
                "EVENT_RECEIVED"
              );

              return;
            }


            console.log(
              "Incoming WhatsApp message:",
              text
            );

            console.log(
              "Sender:",
              from
            );


            /*
             * Tell Meta that the webhook was received.
             */

            res.writeHead(200);

            res.end(
              "EVENT_RECEIVED"
            );


            /*
             * Continue processing after acknowledging
             * the webhook.
             */

            try {

              await processMessage(
                from,
                text
              );

            } catch (
              processingError
            ) {

              console.error(
                "PROCESSING ERROR:",
                processingError
              );

              recordAuditEvent({
                type: "PROCESSING_ERROR",
                sender: from,
                error:
                  processingError.message
              });
            }

          } catch (error) {

            console.error(
              "WEBHOOK ERROR:",
              error
            );

            recordAuditEvent({
              type: "WEBHOOK_ERROR",
              error: error.message
            });

            if (
              !res.headersSent
            ) {

              res.writeHead(200);

              res.end(
                "EVENT_RECEIVED"
              );
            }
          }
        }
      );

      return;
    }


    /* =====================================================
       404
       ===================================================== */

    res.writeHead(404);

    res.end("Not found");
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
      `Policy Engine: ACTIVE`
    );

    console.log(
      `Verification Layer: ACTIVE`
    );

    console.log(
      `Audit Logging: ACTIVE`
    );

    console.log(
      `Policy Version: ${POLICY.version}`
    );
  }
);
