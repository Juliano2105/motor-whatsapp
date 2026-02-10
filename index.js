const express = require('express');
const cors = require('cors');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require("@whiskeysockets/baileys");
const QRCode = require('qrcode');

const app = express();
app.use(cors());
app.use(express.json());

let qrCodeBase64 = null;
let connectionStatus = "Desconectado";
let sock; // Variável global para manter a conexão ativa

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
            console.log('Conexão fechada. Reconectando:', shouldReconnect);
            if (shouldReconnect) connectToWA();
        } else if (connection === 'open') {
            qrCodeBase64 = null;
            connectionStatus = "Conectado";
            console.log('WhatsApp Conectado com Sucesso!');
        }
    });

    sock.ev.on('creds.update', saveCreds);
}

// Rota de Status
app.get('/status', (req, res) => {
    res.json({ status: connectionStatus, qr: qrCodeBase64 });
});

// Rota de Envio de Mensagens com Trava de Segurança para Brasil (+55)
app.post('/send', async (req, res) => {
    let { number, message } = req.body;

    if (!number || !message) {
        return res.status(400).json({ error: "Número e mensagem são obrigatórios" });
    }

    if (connectionStatus !== "Conectado" || !sock) {
        return res.status(503).json({ error: "WhatsApp não está conectado no servidor" });
    }

    try {
        // 1. Remove espaços, traços e parênteses
        let cleanNumber = number.replace(/\D/g, '');

        // 2. REGRA DE OURO: Se o número não começar com 55, nós adicionamos.
        // Isso impede que o 43 (DDD do PR) seja lido como código de país da Áustria.
        if (!cleanNumber.startsWith('55')) {
            // Se o usuário digitou 11 dígitos (DDD + Numero), adicionamos o 55
            // Se digitou apenas o número, ele ainda tentará formatar como Brasil
            cleanNumber = '55' + cleanNumber;
        }

        const jid = `${cleanNumber}@s.whatsapp.net`;
        
        await sock.sendMessage(jid, { text: message });
        
        console.log(`Mensagem enviada com sucesso para: ${cleanNumber}`);
        res.json({ success: true, sentTo: cleanNumber });
    } catch (err) {
        console.error('Erro interno ao disparar mensagem:', err);
        res.status(500).json({ error: err.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => { 
    console.log(`Servidor rodando na porta ${PORT}`); 
    connectToWA(); 
});
