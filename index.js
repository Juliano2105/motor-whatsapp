const express = require('express');
const cors = require('cors');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require("@whiskeysockets/baileys");
const QRCode = require('qrcode');

const app = express();
app.use(cors());
app.use(express.json());

let qrCodeBase64 = null;
let connectionStatus = "Desconectado";
let sock; // Definido globalmente para ser acessado pela rota /send

async function connectToWA() {
    const { state, saveCreds } = await useMultiFileAuthState('./auth_info');
    
    // Inicializa a conexão
    sock = makeWASocket({ 
        auth: state, 
        printQRInTerminal: true,
        // Adicionado para melhorar a estabilidade da conexão
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

// Rota para verificar o status
app.get('/status', (req, res) => {
    res.json({ status: connectionStatus, qr: qrCodeBase64 });
});

// Rota para envio de mensagens - AGORA CORRIGIDA
app.post('/send', async (req, res) => {
    const { number, message } = req.body;

    if (!number || !message) {
        return res.status(400).json({ error: "Número e mensagem são obrigatórios" });
    }

    if (connectionStatus !== "Conectado" || !sock) {
        return res.status(503).json({ error: "WhatsApp não está conectado" });
    }

    try {
        // Formata o número para o padrão do WhatsApp (remove tudo que não é número)
        const cleanNumber = number.replace(/\D/g, '');
        const jid = `${cleanNumber}@s.whatsapp.net`;
        
        await sock.sendMessage(jid, { text: message });
        
        console.log(`Mensagem enviada para ${cleanNumber}`);
        res.json({ success: true });
    } catch (err) {
        console.error('Erro ao enviar mensagem:', err);
        res.status(500).json({ error: err.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => { 
    console.log(`Servidor rodando na porta ${PORT}`); 
    connectToWA(); 
});
