const express = require('express');
const cors = require('cors');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require("@whiskeysockets/baileys");
const QRCode = require('qrcode');

const app = express();
app.use(cors());
app.use(express.json());

let qrCodeBase64 = null;
let connectionStatus = "Desconectado";

async function connectToWA() {
    const { state, saveCreds } = await useMultiFileAuthState('./auth_info');
    const sock = makeWASocket({ auth: state, printQRInTerminal: true });

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr) {
            qrCodeBase64 = await QRCode.toDataURL(qr);
            connectionStatus = "Aguardando Leitura";
        }
        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) connectToWA();
        } else if (connection === 'open') {
            qrCodeBase64 = null;
            connectionStatus = "Conectado";
        }
    });

    sock.ev.on('creds.update', saveCreds);

    app.get('/status', (req, res) => res.json({ status: connectionStatus, qr: qrCodeBase64 }));
    app.post('/send', async (req, res) => {
        const { number, message } = req.body;
        try {
            const jid = `${number.replace(/\D/g, '')}@s.whatsapp.net`;
            await sock.sendMessage(jid, { text: message });
            res.json({ success: true });
        } catch (err) { res.status(500).json({ error: err.message }); }
    });
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => { console.log(`Rodando na porta ${PORT}`); connectToWA(); });
