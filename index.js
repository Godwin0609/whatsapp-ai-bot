const { default: makeWASocket, useMultiFileAuthState } =
  require("@whiskeysockets/baileys");
const P = require("pino");
const http = require("http");

const PORT = process.env.PORT || 3000;

let pairingCode = "Waiting...";
let botStatus = "Starting...";

const server = http.createServer((req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8"
  });

  res.end(`
    <!DOCTYPE html>
    <html>
    <head>
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <title>WhatsApp AI Bot</title>
      <style>
        body {
          font-family: Arial, sans-serif;
          text-align: center;
          padding: 40px 20px;
        }
        .code {
          font-size: 32px;
          font-weight: bold;
          letter-spacing: 5px;
          margin: 25px 0;
        }
      </style>
    </head>
    <body>
      <h1>WhatsApp AI Bot</h1>
      <p>Status: ${botStatus}</p>
      <p>Pairing code:</p>
      <div class="code">${pairingCode}</div>
      <p>
        On WhatsApp, go to:<br>
        <b>Settings → Linked Devices → Link a Device → Link with phone number</b>
      </p>
    </body>
    </html>
  `);
});

server.listen(PORT, () => {
  console.log(`Web server running on port ${PORT}`);
});

async function startBot() {
  const { state, saveCreds } =
    await useMultiFileAuthState("auth_info");

  const sock = makeWASocket({
    auth: state,
    logger: P({ level: "silent" }),
    printQRInTerminal: false
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async ({ connection }) => {

    if (connection === "open") {
      botStatus = "WhatsApp connected!";
      console.log("WhatsApp AI Bot is connected!");
    }

    if (connection === "close") {
      botStatus = "Connection closed";
      console.log("Connection closed.");
    }
  });

  sock.ev.on("messages.upsert", async ({ messages }) => {
    const message = messages[0];

    if (!message.message || message.key.fromMe) return;

    const text =
      message.message.conversation ||
      message.message.extendedTextMessage?.text ||
      "";

    if (!text) return;

    console.log("Message received:", text);

    if (text.toLowerCase() === "hello") {
      await sock.sendMessage(message.key.remoteJid, {
        text: "Hello! 👋 I'm your WhatsApp AI Bot."
      });
    }
  });
}

startBot().catch(console.error);
