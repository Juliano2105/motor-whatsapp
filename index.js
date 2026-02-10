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

// FUNÇÃO PARA LIMPAR TUDO ANTES DE COMEÇAR
function clearAuth() {
    if (fs.existsSync('./auth_info')) {
        console.log("Limpando pasta de autenticação para evitar erros...");
        fs.rmSync('./auth_info', { recursive: true, force: true });
    }
}

async function connectToWA() {
    // Se o status for Desconectado por erro, limpamos a pasta fisicamente
    const { state, saveCreds } = await useMultiFileAuthState('./auth_info');
    
    sock = makeWASocket({ 
        auth: state, 
        printQRInTerminal: false,
        connectTimeoutMs: 120000,
        defaultQueryTimeoutMs: 60000,
        syncFullHistory: false // Conecta muito mais rápido
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
            
            // Erros que exigem limpeza imediata (incluindo o 515 que você teve)
            if ([401, 428, 440, 515, 511].includes(statusCode)) {
                clearAuth();
                connectionStatus = "Desconectado";
                setTimeout(() => connectToWA(), 5000);
            } else if (statusCode !== DisconnectReason.loggedOut) {
                setTimeout(() => connectToWA(), 5000);
            }
        } else if (connection === 'open') {
            qrCodeBase64 = null;
            connectionStatus = "Conectado";
            console.log("WHATSAPP CONECTADO COM SUCESSO!");
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
        if (!result || !result.exists) return res.status(404).json({ error: "Número inexistente" });

        await sock.sendMessage(result.jid, { text: message });
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => { 
    // Opcional: descomente a linha abaixo se quiser resetar toda vez que o servidor ligar
    // clearAuth(); 
    connectToWA(); 
});
