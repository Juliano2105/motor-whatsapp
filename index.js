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
        connectTimeoutMs: 60000,
        defaultQueryTimeoutMs: 30000
    });

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        if (qr) {
            qrCodeBase64 = await QRCode.toDataURL(qr);
            connectionStatus = "Aguardando Leitura";
        }
        
        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            console.log("Conexão fechada por erro:", statusCode);
            
            if (statusCode === 428 || statusCode === 401 || statusCode === 440 || statusCode === 515) {
                console.log("Limpando arquivos de sessão antigos...");
                if (fs.existsSync('./auth_info')) fs.rmSync('./auth_info', { recursive: true, force: true });
            }
            
            // Delay de 5 segundos antes de reconectar para evitar loop
            setTimeout(() => connectToWA(), 5000);
        } else if (connection === 'open') {
            qrCodeBase64 = null;
            connectionStatus = "Conectado";
            console.log("WHATSAPP CONECTADO E PRONTO");
        }
    });

    sock.ev.on('creds.update', saveCreds);
}

app.get('/status', (req, res) => res.json({ status: connectionStatus, qr: qrCodeBase64 }));

app.post('/send', async (req, res) => {
    let { number, message } = req.body;
    
    if (!sock || connectionStatus !== "Conectado") {
        return res.status(503).json({ error: "O servidor não está conectado ao WhatsApp celular." });
    }

    try {
        let cleanNumber = String(number).replace(/\D/g, '');
        if (!cleanNumber.startsWith('55')) cleanNumber = '55' + cleanNumber;
        
        const jid = `${cleanNumber}@s.whatsapp.net`;

        const [result] = await sock.onWhatsApp(jid);
        if (!result || !result.exists) {
            return res.status(404).json({ error: "Este número não existe no WhatsApp." });
        }

        const sentMsg = await sock.sendMessage(result.jid, { text: message });
        
        if (sentMsg) {
            console.log(`Mensagem entregue para: ${result.jid}`);
            return res.json({ success: true, sentTo: result.jid, messageId: sentMsg.key?.id || null });
        } else {
            throw new Error("Falha no envio interno");
        }

    } catch (err) {
        console.error("ERRO NO DISPARO:", err.message);
        res.status(500).json({ error: "Conexão perdida com o celular. Tente reconectar." });
    }
});

app.post('/disconnect', async (req, res) => {
    try {
        if (sock) {
            await sock.logout();
            sock = null;
        }
        if (fs.existsSync('./auth_info')) fs.rmSync('./auth_info', { recursive: true, force: true });
        connectionStatus = "Desconectado";
        qrCodeBase64 = null;
        res.json({ success: true, message: "Desconectado com sucesso" });
        setTimeout(() => connectToWA(), 3000);
    } catch (err) {
        console.error("Erro ao desconectar:", err.message);
        connectionStatus = "Desconectado";
        if (fs.existsSync('./auth_info')) fs.rmSync('./auth_info', { recursive: true, force: true });
        res.json({ success: true, message: "Sessão limpa" });
        setTimeout(() => connectToWA(), 3000);
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => { console.log(`Servidor rodando na porta ${PORT}`); connectToWA(); });
