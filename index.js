const express = require('express');
const cors = require('cors');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require("@whiskeysockets/baileys");
const QRCode = require('qrcode');
const fs = require('fs');

const app = express();
app.use(cors());
app.use(express.json());

let qrCodeBase64 = null;
let connectionStatus = "Desconectado";
let sock = null;

async function connectToWA() {
    const { state, saveCreds } = await useMultiFileAuthState('./auth_info');
    
    sock = makeWASocket({ 
        auth: state, 
        printQRInTerminal: true,
        connectTimeoutMs: 60000,
        defaultQueryTimeoutMs: 0
    });

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        if (qr) {
            qrCodeBase64 = await QRCode.toDataURL(qr);
            connectionStatus = "Aguardando Leitura";
        }
        
        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            // Se a conexão fechar por erro de sessão (428), limpa a pasta e reinicia
            if (statusCode === 428 || statusCode === 401) {
                console.log("Limpando sessão corrompida...");
                if (fs.existsSync('./auth_info')) fs.rmSync('./auth_info', { recursive: true, force: true });
            }
            connectToWA();
        } else if (connection === 'open') {
            qrCodeBase64 = null;
            connectionStatus = "Conectado";
            console.log("WhatsApp Conectado com Sucesso!");
        }
    });

    sock.ev.on('creds.update', saveCreds);
}

app.get('/status', (req, res) => res.json({ status: connectionStatus, qr: qrCodeBase64 }));

app.post('/send', async (req, res) => {
    let { number, message } = req.body;
    if (!sock || connectionStatus !== "Conectado") return res.status(503).json({ error: "Desconectado" });

    try {
        // LIMPEZA TOTAL DO NÚMERO
        let cleanNumber = String(number).replace(/\D/g, '');
        if (cleanNumber.startsWith('0')) cleanNumber = cleanNumber.substring(1);
        if (!cleanNumber.startsWith('55')) cleanNumber = '55' + cleanNumber;

        const jid = `${cleanNumber}@s.whatsapp.net`;
        console.log(`Enviando para o JID oficial: ${jid}`);

        await sock.sendMessage(jid, { text: message });
        res.json({ success: true, sentTo: cleanNumber });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => { connectToWA(); });
