const { default: makeWASocket, useMultiFileAuthState } =
  require("@whiskeysockets/baileys");
const P = require("pino");
const http = require("http");

const PORT = process.env.PORT || 3000;
const PHONE_NUMBER = process.env.PHONE_NUMBER;

let pairingCode = "Waiting...";
let botStatus = "Starting...";

http
  .createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/html" });

    res.end(`
      <html>
        <body>
          <h1>WhatsApp AI Bot</h1>
          <p>Status: ${botStatus}</p>
          <p>Pairing code: ${pairingCode}</p>
        </body>
      </html>
    `);
  })
  .listen(PORT, () => {
    console.log(`Web server running on port ${PORT}`);
  });

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState("auth_info");

  const sock = makeWASocket({
    auth: state,
    logger: P({ level: "silent" }),
    printQRInTerminal: false
  });

  sock.ev.on("creds.update", saveCreds);

  if (!state.creds.registered && PHONE_NUMBER) {
    setTimeout(async () => {
      try {
        const code = await sock.requestPairingCode(PHONE_NUMBER);
        pairingCode = code;
        botStatus = "Pairing code ready";
        console.log("Pairing code:", code);
      } catch (error) {
        console.error("Pairing code error:", error);
      }
    }, 3000);
  }

  sock.ev.on("connection.update", ({ connection }) => {
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
