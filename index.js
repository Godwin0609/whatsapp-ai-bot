const { default: makeWASocket, useMultiFileAuthState } =
  require("@whiskeysockets/baileys");

const P = require("pino");
const http = require("http");

const PORT = process.env.PORT || 3000;
const PHONE_NUMBER = process.env.PHONE_NUMBER;

let pairingCode = "Waiting...";
let botStatus = "Starting...";

/* =========================
   WEB SERVER
   ========================= */

const server = http.createServer((req, res) => {
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

        <p>
          <strong>Status:</strong>
          ${botStatus}
        </p>

        <p>
          <strong>Pairing code:</strong>
          ${pairingCode}
        </p>
      </body>
    </html>
  `);
});

server.listen(PORT, () => {
  console.log(`Web server running on port ${PORT}`);
});

/* =========================
   WHATSAPP BOT
   ========================= */

async function startBot() {
  console.log("Starting WhatsApp AI Bot...");

  const { state, saveCreds } =
    await useMultiFileAuthState("auth_info");

  const sock = makeWASocket({
    auth: state,
    logger: P({
      level: "silent"
    }),
    printQRInTerminal: false
  });

  sock.ev.on("creds.update", saveCreds);

  /* =========================
     PAIRING CODE
     ========================= */

  if (!state.creds.registered && PHONE_NUMBER) {
    console.log("Waiting to request pairing code...");

    setTimeout(async () => {
      try {
        const code = await sock.requestPairingCode(
          PHONE_NUMBER
        );

        pairingCode = code;
        botStatus = "Pairing code ready";

        console.log("Pairing code:", code);
      } catch (error) {
        console.error(
          "Pairing code error:",
          error
        );
      }
    }, 3000);
  }

  /* =========================
     CONNECTION STATUS
     ========================= */

  sock.ev.on(
    "connection.update",
    ({
      connection,
      lastDisconnect
    }) => {
      if (connection === "connecting") {
        botStatus = "Connecting to WhatsApp...";
        console.log("Connecting to WhatsApp...");
      }

      if (connection === "open") {
        botStatus = "WhatsApp connected!";
        console.log(
          "WhatsApp AI Bot is connected!"
        );
      }

      if (connection === "close") {
        botStatus = "Connection closed";

        console.log(
          "Connection closed:",
          lastDisconnect?.error?.message ||
            lastDisconnect?.error ||
            "Unknown reason"
        );
      }
    }
  );

  /* =========================
     RECEIVE MESSAGES
     ========================= */

  sock.ev.on(
    "messages.upsert",
    async ({ messages }) => {
      try {
        const message = messages[0];

        if (!message) {
          return;
        }

        if (!message.message) {
          return;
        }

        if (message.key.fromMe) {
          return;
        }

        const text =
          message.message.conversation ||
          message.message.extendedTextMessage?.text ||
          "";

        if (!text) {
          return;
        }

        console.log(
          "Message received:",
          text
        );

        /* =========================
           SIMPLE AI BOT RESPONSES
           ========================= */

        const lowerText =
          text.toLowerCase().trim();

        if (lowerText === "hello") {
          await sock.sendMessage(
            message.key.remoteJid,
            {
              text:
                "Hello! 👋 I'm your WhatsApp AI Bot."
            }
          );

          return;
        }

        if (lowerText === "hi") {
          await sock.sendMessage(
            message.key.remoteJid,
            {
              text:
                "Hi! 👋 How can I help you?"
            }
          );

          return;
        }

        if (lowerText === "help") {
          await sock.sendMessage(
            message.key.remoteJid,
            {
              text:
                "I'm your WhatsApp AI Bot. Send me a message and I'll respond."
            }
          );

          return;
        }

        /* =========================
           DEFAULT RESPONSE
           ========================= */

        await sock.sendMessage(
          message.key.remoteJid,
          {
            text:
              "I received your message: " +
              text
          }
        );
      } catch (error) {
        console.error(
          "Message handling error:",
          error
        );
      }
    }
  );
}

/* =========================
   START BOT
   ========================= */

startBot().catch((error) => {
  console.error(
    "Bot startup error:",
    error
  );
});  
