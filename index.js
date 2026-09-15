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
   SEND MESSAGE TO WHATSAPP
   ========================= */

async function sendWhatsAppMessage(to, text) {
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

  if (!response.ok) {
    console.error("WhatsApp API error:", data);
    throw new Error("WhatsApp API request failed");
  }

  return data;
}

/* =========================
   ASK OPENAI
   ========================= */

async function askOpenAI(message) {
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

  return completion.choices[0].message.content;
}

/* =========================
   WEB SERVER
   ========================= */

const server = http.createServer(async (req, res) => {

  /* =========================
     HEALTH CHECK
     ========================= */

  if (req.method === "GET" && req.url === "/") {
    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8"
    });

    res.end(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>WhatsApp AI Bot</title>
          <meta name="viewport" content="width=device-width, initial-scale=1">
        </head>
        <body>
          <h1>WhatsApp AI Bot</h1>
          <p>Status: Online</p>
          <p>WhatsApp Cloud API: Ready</p>
        </body>
      </html>
    `);

    return;
  }

  /* =========================
     META WEBHOOK VERIFICATION
     ========================= */

  if (req.method === "GET" && req.url.startsWith("/webhook")) {

    const url = new URL(req.url, `http://${req.headers.host}`);

    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");

    if (mode === "subscribe" && token === VERIFY_TOKEN) {
      console.log("Webhook verified successfully.");

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

  /* =========================
     RECEIVE WHATSAPP WEBHOOK
     ========================= */

  if (req.method === "POST" && req.url === "/webhook") {

    let body = "";

    req.on("data", chunk => {
      body += chunk;
    });

    req.on("end", async () => {

      try {
        const data = JSON.parse(body);

        console.log(
          "Webhook received:",
          JSON.stringify(data, null, 2)
        );

        const message =
          data.entry?.[0]?.changes?.[0]?.value?.messages?.[0];

        if (!message) {
          res.writeHead(200);
          res.end("EVENT_RECEIVED");
          return;
        }

        if (message.type !== "text") {
          res.writeHead(200);
          res.end("EVENT_RECEIVED");
          return;
        }

        const from = message.from;
        const text = message.text?.body;

        if (!from || !text) {
          res.writeHead(200);
          res.end("EVENT_RECEIVED");
          return;
        }

        console.log("WhatsApp message:", text);

        /* =========================
           ASK OPENAI
           ========================= */

        const aiReply = await askOpenAI(text);

        console.log("AI reply:", aiReply);

        /* =========================
           SEND RESPONSE
           ========================= */

        await sendWhatsAppMessage(
          from,
          aiReply
        );

        console.log("Reply sent successfully.");

        res.writeHead(200);
        res.end("EVENT_RECEIVED");

      } catch (error) {

        console.error(
          "Webhook processing error:",
          error
        );

        res.writeHead(200);
        res.end("EVENT_RECEIVED");
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
    `WhatsApp AI Bot running on port ${PORT}`
  );
});
