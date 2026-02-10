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
        connectTimeoutMs: 120000, // 2 minutos de timeout para conexões lentas
        defaultQueryTimeoutMs: 60000,
        keepAliveIntervalMs: 30000
    });

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        if (qr) {
            qrCodeBase64 = await QRCode.toDataURL(qr);
            connectionStatus = "Aguardando Leitura";
        }
        
        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            console.log("Conexão fechada. Status:", statusCode);
            
            // Se o erro for de sessão perdida ou expirada (401, 428, 440)
            if ([401, 428, 440, 515].includes(statusCode)) {
                console.log("Limpando sessão antiga para gerar novo QR Code...");
                if (fs.existsSync('./auth_info')) {
                    fs.rmSync('./auth_info', { recursive: true, force: true });
                }
                connectionStatus = "Desconectado";
                setTimeout(() => connectToWA(), 5000);
            } else if (statusCode !== DisconnectReason.loggedOut) {
                // Tenta reconectar em outros casos de queda de sinal
                setTimeout(() => connectToWA(), 5000);
            }
        } else if (connection === 'open') {
            qrCodeBase64 = null;
            connectionStatus = "Conectado";
            console.log("WHATSAPP CONECTADO E PRONTO PARA ENVIO");
        }
    });

    sock.ev.on('creds.update', saveCreds);
}

app.get('/status', (req, res) => res.json({ status: connectionStatus, qr: qrCodeBase64 }));

app.post('/send', async (req, res) => {
    let { number, message } = req.body;
    
    // Verifica se o socket está pronto
    if (!sock || connectionStatus !== "Conectado") {
        return res.status(503).json({ error: "O servidor não está conectado ao WhatsApp celular." });
    }

    try {
        let cleanNumber = String(number).replace(/\D/g, '');
        if (!cleanNumber.startsWith('55')) cleanNumber = '55' + cleanNumber;
        const jid = `${cleanNumber}@s.whatsapp.net`;

        // Verifica se o número existe antes de enviar para evitar chats fantasmas
        const [result] = await sock.onWhatsApp(jid);
        if (!result || !result.exists) {
            return res.status(404).json({ error: "Este número não possui WhatsApp." });
        }

        await sock.sendMessage(result.jid, { text: message });
        console.log(`Mensagem enviada para: ${result.jid}`);
        res.json({ success: true, sentTo: result.jid });
    } catch (err) {
        console.error("ERRO NO ENVIO:", err.message);
        res.status(500).json({ error: "Erro de conexão no disparo. Tente novamente." });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => { connectToWA(); });
