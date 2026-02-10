const express = require('express');
const cors = require('cors');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require("@whiskeysockets/baileys");
const QRCode = require('qrcode');

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
        } else if (connection === 'open') {
            qrCodeBase64 = null;
            connectionStatus = "Conectado";
            console.log('WhatsApp Conectado com Sucesso!');
        }
    });

    sock.ev.on('creds.update', saveCreds);
}

app.get('/status', (req, res) => {
    res.json({ status: connectionStatus, qr: qrCodeBase64 });
});

// ROTA DE ENVIO COM FORMATAÇÃO RÍGIDA BRASIL
app.post('/send', async (req, res) => {
    let { number, message } = req.body;

    if (!number || !message) {
        return res.status(400).json({ error: "Número e mensagem são obrigatórios" });
    }

    if (connectionStatus !== "Conectado" || !sock) {
        return res.status(503).json({ error: "WhatsApp não está conectado" });
    }

    try {
        // 1. Limpeza total: remove TUDO que não for número (espaços, +, -, parênteses)
        let cleanNumber = number.toString().replace(/\D/g, '');

        // 2. Lógica de correção de DDI (55)
        // Se o número tiver 10 ou 11 dígitos (DDD + Número), adicionamos o 55 na frente
        if (cleanNumber.length === 10 || cleanNumber.length === 11) {
            cleanNumber = '55' + cleanNumber;
        } 
        // Se o número tiver 8 ou 9 dígitos (sem DDD), ele ainda vai dar erro, 
        // então o ideal é sempre enviar com DDD.

        const jid = `${cleanNumber}@s.whatsapp.net`;
        
        console.log(`Tentando enviar para JID formatado: ${jid}`);
        
        await sock.sendMessage(jid, { text: message });
        
        res.json({ success: true, sentTo: cleanNumber });
    } catch (err) {
        console.error('Erro no disparo:', err);
        res.status(500).json({ error: err.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => { 
    console.log(`Servidor rodando na porta ${PORT}`); 
    connectToWA(); 
});
