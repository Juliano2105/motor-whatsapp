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
        defaultQueryTimeoutMs: 30000 // Aumentado para esperar a resposta do zap
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
            
            // Se a sessão estiver "podre" (428 ou 401), limpa tudo
            if (statusCode === 428 || statusCode === 401 || statusCode === 440) {
                console.log("Limpando arquivos de sessão antigos...");
                if (fs.existsSync('./auth_info')) fs.rmSync('./auth_info', { recursive: true, force: true });
            }
            connectToWA();
        } else if (connection === 'open') {
            qrCodeBase64 = null;
            connectionStatus = "Conectado";
            console.log("WHATSAPP CONECTADO E PRONTO");
        }
    });

    sock.ev.on('creds.update', saveCreds);
}

app.get('/status', (req, res) => res.json({ status: connectionStatus, qr: qrCodeBase64 }));

// ROTA DE ENVIO COM VALIDAÇÃO DE ENTREGA
app.post('/send', async (req, res) => {
    let { number, message } = req.body;
    
    if (!sock || connectionStatus !== "Conectado") {
        return res.status(503).json({ error: "O servidor não está conectado ao WhatsApp celular." });
    }

    try {
        // Limpeza do número
        let cleanNumber = String(number).replace(/\D/g, '');
        if (!cleanNumber.startsWith('55')) cleanNumber = '55' + cleanNumber;
        
        const jid = `${cleanNumber}@s.whatsapp.net`;

        // 1. Verifica se o número existe antes de enviar (Evita Fantasmas)
        const [result] = await sock.onWhatsApp(jid);
        if (!result || !result.exists) {
            return res.status(404).json({ error: "Este número não existe no WhatsApp." });
        }

        // 2. Tenta enviar e AGUARDA a confirmação do socket
        const sentMsg = await sock.sendMessage(result.jid, { text: message });
        
        if (sentMsg) {
            console.log(`Mensagem entregue para: ${result.jid}`);
            return res.json({ success: true, sentTo: result.jid });
        } else {
            throw new Error("Falha no envio interno");
        }

    } catch (err) {
        console.error("ERRO NO DISPARO:", err.message);
        // Se der erro de conexão fechada, avisa o Lovable corretamente
        res.status(500).json({ error: "Conexão perdida com o celular. Tente reconectar." });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => { connectToWA(); });
