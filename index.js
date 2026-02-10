const express = require('express');
const cors = require('cors');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require("@whiskeysockets/baileys");
const QRCode = require('qrcode');
const fs = require('fs');

const app = express();
app.use(cors());
app.use(express.json());

let qrCodeBase64 = null;
let connectionStatus = "Desconectado";
let sock = null;

async function connectToWA() {
    // 1. Forçamos a pasta 'sessao_v2' para garantir que não usemos lixo do passado
    const { state, saveCreds } = await useMultiFileAuthState('./sessao_v2');
    const { version } = await fetchLatestBaileysVersion();
    
    sock = makeWASocket({ 
        version,
        auth: state, 
        printQRInTerminal: false,
        // CONFIGURAÇÕES PARA EVITAR O ERRO 408 (TIMEOUT)
        connectTimeoutMs: 180000, // 3 minutos para dar tempo de parear
        defaultQueryTimeoutMs: 0, 
        keepAliveIntervalMs: 10000,
        syncFullHistory: false,
        qrTimeout: 120000 // QR Code dura 2 minutos antes de expirar
    });

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        if (qr) {
            qrCodeBase64 = await QRCode.toDataURL(qr);
            connectionStatus = "Aguardando Leitura";
        }
        
        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode || lastDisconnect?.error?.output?.payload?.statusCode;
            console.log(`[LOG] Conexão encerrada. Código: ${statusCode}`);
            
            // Se der erro crítico (incluindo o 408 de timeout), limpa e reinicia
            if ([401, 408, 428, 515].includes(statusCode)) {
                console.log("Reiniciando sessão por erro de tempo ou autenticação...");
                if (fs.existsSync('./sessao_v2')) fs.rmSync('./sessao_v2', { recursive: true, force: true });
                connectionStatus = "Desconectado";
                setTimeout(() => connectToWA(), 5000);
            } else if (statusCode !== DisconnectReason.loggedOut) {
                setTimeout(() => connectToWA(), 5000);
            }
        } else if (connection === 'open') {
            qrCodeBase64 = null;
            connectionStatus = "Conectado";
            console.log("--- WHATSAPP CONECTADO COM SUCESSO ---");
        }
    });

    sock.ev.on('creds.update', saveCreds);
}

app.get('/status', (req, res) => res.json({ status: connectionStatus, qr: qrCodeBase64 }));

app.post('/send', async (req, res) => {
    let { number, message } = req.body;
    if (!sock || connectionStatus !== "Conectado") return res.status(503).json({ error: "Offline" });
    try {
        let cleanNumber = String(number).replace(/\D/g, '');
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
