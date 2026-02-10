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
    // MUDANÇA CRUCIAL: 'sessao_v2' força um reset físico no servidor Railway
    const { state, saveCreds } = await useMultiFileAuthState('./sessao_v2');
    
    sock = makeWASocket({ 
        auth: state, 
        printQRInTerminal: false,
        connectTimeoutMs: 120000,
        defaultQueryTimeoutMs: 60000,
        syncFullHistory: false // Impede o erro 515 de sincronização lenta
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
            
            // Se a sessão der erro, limpa a pasta nova e reinicia
            if ([401, 428, 440, 515, 511].includes(statusCode)) {
                if (fs.existsSync('./sessao_v2')) {
                    fs.rmSync('./sessao_v2', { recursive: true, force: true });
                }
                connectionStatus = "Desconectado";
                setTimeout(() => connectToWA(), 5000);
            } else if (statusCode !== DisconnectReason.loggedOut) {
                setTimeout(() => connectToWA(), 5000);
            }
        } else if (connection === 'open') {
            qrCodeBase64 = null;
            connectionStatus = "Conectado";
            console.log("SUCESSO: WHATSAPP CONECTADO NA SESSÃO V2");
        }
    });

    sock.ev.on('creds.update', saveCreds);
}

app.get('/status', (req, res) => res.json({ status: connectionStatus, qr: qrCodeBase64 }));

app.post('/send', async (req, res) => {
    let { number, message } = req.body;
    if (!sock || connectionStatus !== "Conectado") return res.status(503).json({ error: "Desconectado" });

    try {
        let cleanNumber = String(number).replace(/\D/g, '');
        if (!cleanNumber.startsWith('55')) cleanNumber = '55' + cleanNumber;
        const jid = `${cleanNumber}@s.whatsapp.net`;
        
        const [result] = await sock.onWhatsApp(jid);
        if (!result || !result.exists) return res.status(404).json({ error: "Número inválido" });

        await sock.sendMessage(result.jid, { text: message });
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => { connectToWA(); });
