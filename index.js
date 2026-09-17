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

/* =========================
   SEND WHATSAPP MESSAGE
   ========================= */

async function sendWhatsAppMessage(to, text) {
  console.log("STEP 5: Sending WhatsApp reply...");

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

/* =========================
   ASK OPENAI
   ========================= */

async function askOpenAI(message) {
  console.log("STEP 4: Sending message to OpenAI...");

  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content:
          "You are a helpful WhatsApp AI assistant. Answer clearly, naturally, and concisely."
      },
      {
        role: "user",
        content: message
      }
    ]
  });

  const reply = completion.choices[0]?.message?.content;

  console.log("OpenAI reply:", reply);

  if (!reply) {
    throw new Error("OpenAI returned an empty reply");
  }

  return reply;
}

/* =========================
   WEB SERVER
   ========================= */

const server = http.createServer(async (req, res) => {

  /* HEALTH CHECK */

  if (req.method === "GET" && req.url === "/") {
    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8"
    });

    res.end(`
      <h1>The Silent Strategist AI</h1>
      <p>Status: Online</p>
      <p>WhatsApp Cloud API: Ready</p>
    `);

    return;
  }

  /* META WEBHOOK VERIFICATION */

  if (req.method === "GET" && req.url.startsWith("/webhook")) {

    const url = new URL(
      req.url,
      `http://${req.headers.host}`
    );

    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");

    if (mode === "subscribe" && token === VERIFY_TOKEN) {
      console.log("Webhook verified successfully.");

      res.writeHead(200);
      res.end(challenge);

      return;
    }

    res.writeHead(403);
    res.end("Forbidden");

    return;
  }

  /* RECEIVE WHATSAPP WEBHOOK */

  if (req.method === "POST" && req.url === "/webhook") {

    console.log("STEP 1: POST /webhook received");

    let body = "";

    req.on("data", chunk => {
      body += chunk;
    });

    req.on("end", async () => {

      try {

        console.log("STEP 2: Request body received");

        const data = JSON.parse(body);

        console.log(
          "Webhook data:",
          JSON.stringify(data, null, 2)
        );

        const message =
          data.entry?.[0]?.changes?.[0]?.value?.messages?.[0];

        if (!message) {
          console.log(
            "NO MESSAGE FOUND - probably a status/event"
          );

          res.writeHead(200);
          res.end("EVENT_RECEIVED");
          return;
        }

        console.log(
          "STEP 3: Message found:",
          JSON.stringify(message, null, 2)
        );

        if (message.type !== "text") {
          console.log(
            "Message is not text:",
            message.type
          );

          res.writeHead(200);
          res.end("EVENT_RECEIVED");
          return;
        }

        const from = message.from;
        const text = message.text?.body;

        if (!from || !text) {
          console.log(
            "Missing sender or message text"
          );

          res.writeHead(200);
          res.end("EVENT_RECEIVED");
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
         * Tell Meta we received the webhook.
         * Then continue processing the AI reply.
         */

        res.writeHead(200);
        res.end("EVENT_RECEIVED");

        try {

          const aiReply = await askOpenAI(text);

          await sendWhatsAppMessage(
            from,
            aiReply
          );

          console.log(
            "STEP 6: Reply sent successfully!"
          );

        } catch (processingError) {

          console.error(
            "PROCESSING ERROR:",
            processingError
          );
        }

      } catch (error) {

        console.error(
          "WEBHOOK ERROR:",
          error
        );

        if (!res.headersSent) {
          res.writeHead(200);
          res.end("EVENT_RECEIVED");
        }
      }
    });

    return;
  }

  res.writeHead(404);
  res.end("Not found");
});

/* =========================
   START SERVER
   ========================= */

server.listen(PORT, () => {
  console.log(
    `The Silent Strategist AI running on port ${PORT}`
  );
});
