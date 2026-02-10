const express = require('express');
const cors = require('cors');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require("@whiskeysockets/baileys");
const QRCode = require('qrcode');
const fs = require('fs'); // Necessário para apagar arquivos

const app = express();
app.use(cors());
app.use(express.json());

let qrCodeBase64 = null;
let connectionStatus = "Desconectado";
let sock; 

async function connectToWA() {
    const { state, saveCreds } = await useMultiFileAuthState('./auth_info');
    
    sock = makeWASocket({ 
        auth: state, 
        printQRInTerminal: true,
        defaultQueryTimeoutMs: undefined 
    });

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        if (qr) {
            qrCodeBase64 = await QRCode.toDataURL(qr);
            connectionStatus = "Aguardando Leitura";
        }
        
        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) connectToWA();
            else connectionStatus = "Desconectado";
        } else if (connection === 'open') {
            qrCodeBase64 = null;
            connectionStatus = "Conectado";
        }
    });

    sock.ev.on('creds.update', saveCreds);
}

// NOVA ROTA: LIMPEZA PROFUNDA DE SESSÃO
app.post('/reset-session', async (req, res) => {
    try {
        connectionStatus = "Limpando...";
        if (sock) sock.logout();
        
        // Apaga a pasta de autenticação para forçar novo QR Code
        if (fs.existsSync('./auth_info')) {
            fs.rmSync('./auth_info', { recursive: true, force: true });
        }
        
        res.json({ success: true, message: "Sessão apagada. O servidor vai reiniciar." });
        setTimeout(() => process.exit(0), 1000); // Reinicia o servidor
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/status', (req, res) => {
    res.json({ status: connectionStatus, qr: qrCodeBase64 });
});

app.post('/send', async (req, res) => {
    let { number, message } = req.body;
    if (!number || !message) return res.status(400).json({ error: "Dados incompletos" });
    if (connectionStatus !== "Conectado" || !sock) return res.status(503).json({ error: "WhatsApp Desconectado" });

    try {
        let cleanNumber = number.toString().replace(/\D/g, '');
        if (!cleanNumber.startsWith('55')) cleanNumber = '55' + cleanNumber;
        const jid = `${cleanNumber}@s.whatsapp.net`;
        await sock.sendMessage(jid, { text: message });
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => { connectToWA(); });
