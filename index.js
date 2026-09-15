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

  sock.ev.on("connection.update", ({ connection, lastDisconnect }) => {
    if (connection === "open") {
      botStatus = "WhatsApp connected!";
      console.log("WhatsApp AI Bot is connected!");
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
  });

  sock.ev.on("messages.upsert", async ({ messages }) => {
