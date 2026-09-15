const { default: makeWASocket, useMultiFileAuthState } =
  require("@whiskeysockets/baileys");
const P = require("pino");
const qrcode = require("qrcode-terminal");
const http = require("http");

const PORT = process.env.PORT || 3000;

http
  .createServer((req, res) => {
    res.writeHead(200);
    res.end("WhatsApp AI Bot is running");
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

  sock.ev.on("connection.update", ({ connection, qr }) => {
    if (qr) {
      console.log("Scan this QR code with WhatsApp:");
      qrcode.generate(qr, { small: true });
    }

    if (connection === "open") {
      console.log("WhatsApp AI Bot is connected!");
    }

    if (connection === "close") {
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
