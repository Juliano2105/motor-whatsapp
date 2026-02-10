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
    // 1. Inicia autenticação limpa
    const { state, saveCreds } = await useMultiFileAuthState('./auth_info');
    
    sock = makeWASocket({ 
        auth: state, 
        printQRInTerminal: false, // Evita avisos de depreciação nos logs
        connectTimeoutMs: 120000,
        defaultQueryTimeoutMs: 60000,
        keepAliveIntervalMs: 20000
    });

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        if (qr) {
            qrCodeBase64 = await QRCode.toDataURL(qr);
            connectionStatus = "Aguardando Leitura";
        }
        
        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode || lastDisconnect?.error?.output?.payload?.statusCode;
            console.log(`[AVISO] Conexão encerrada. Código: ${statusCode}`);
            
            // SE DETECTAR ERRO 515 OU SESSÃO EXPIRADA, LIMPA TUDO
            if ([401, 428, 440, 515].includes(statusCode)) {
                console.log("Detectado erro crítico. Limpando pasta de sessão...");
                if (fs.existsSync('./auth_info')) {
                    fs.rmSync('./auth_info', { recursive: true, force: true });
                }
                connectionStatus = "Desconectado";
                // Reinicia do zero absoluto após 5 segundos
                setTimeout(() => connectToWA(), 5000);
            } else if (connectionStatus !== "Desconectado") {
                // Tenta reconectar em casos simples de queda de internet
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
    
    if (!sock || connectionStatus !== "Conectado") {
        return res.status(503).json({ error: "O servidor não está conectado. Por favor, gere um novo QR Code." });
    }

    try {
        let cleanNumber = String(number).replace(/\D/g, '');
        if (!cleanNumber.startsWith('55')) cleanNumber = '55' + cleanNumber;
        const jid = `${cleanNumber}@s.whatsapp.net`;

        // Verifica existência antes para não criar conversas fantasmas
        const [result] = await sock.onWhatsApp(jid);
        if (!result || !result.exists) {
            return res.status(404).json({ error: "Número não encontrado." });
        }

        await sock.sendMessage(result.jid, { text: message });
        console.log(`[OK] Enviado para: ${result.jid}`);
        res.json({ success: true, sentTo: result.jid });
    } catch (err) {
        console.error("[ERRO]", err.message);
        res.status(500).json({ error: "Erro interno no disparo. Verifique a conexão do celular." });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => { connectToWA(); });
