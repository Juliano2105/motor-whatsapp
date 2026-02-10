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
    // MUDANÇA PARA 'sessao_v3' - Isso reseta o acesso antigo fisicamente no servidor
    const { state, saveCreds } = await useMultiFileAuthState('./sessao_v3');
    const { version } = await fetchLatestBaileysVersion();
    
    sock = makeWASocket({ 
        version,
        auth: state, 
        printQRInTerminal: false,
        // Altera como o servidor se identifica para o celular
        browser: ["Sistema_Novo", "Chrome", "1.0.0"],
        connectTimeoutMs: 180000, 
        defaultQueryTimeoutMs: 0,
        syncFullHistory: false
    });

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        if (qr) {
            qrCodeBase64 = await QRCode.toDataURL(qr);
            connectionStatus = "Aguardando Leitura";
        }
        
        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode || lastDisconnect?.error?.output?.payload?.statusCode;
            console.log(`[LOG] Erro detectado: ${statusCode}`);
            
            // Se der erro de tempo ou autenticação, limpa a V3 e reinicia
            if ([401, 408, 428, 515].includes(statusCode)) {
                if (fs.existsSync('./sessao_v3')) fs.rmSync('./sessao_v3', { recursive: true, force: true });
                connectionStatus = "Desconectado";
                setTimeout(() => connectToWA(), 5000);
            } else if (statusCode !== DisconnectReason.loggedOut) {
                setTimeout(() => connectToWA(), 5000);
            }
        } else if (connection === 'open') {
            qrCodeBase64 = null;
            connectionStatus = "Conectado";
            console.log("CONEXÃO ESTABELECIDA COM SUCESSO");
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
