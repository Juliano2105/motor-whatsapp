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
        defaultQueryTimeoutMs: 60000 // Aumentado para evitar quedas
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
            else connectionStatus = "Desconectado";
        } else if (connection === 'open') {
            qrCodeBase64 = null;
            connectionStatus = "Conectado";
            console.log("CONECTADO COM SUCESSO AO WHATSAPP");
        }
    });
    sock.ev.on('creds.update', saveCreds);
}

app.get('/status', (req, res) => res.json({ status: connectionStatus, qr: qrCodeBase64 }));

// ROTA DE ENVIO COM LIMPEZA ATÔMICA
app.post('/send', async (req, res) => {
    let { number, message } = req.body;
    
    try {
        // 1. Converte para texto e remove TUDO que não for dígito
        let rawNumber = String(number).replace(/\D/g, '');

        // 2. Se o número começar com 0 (comum em alguns cadastros), remove o 0
        if (rawNumber.startsWith('0')) rawNumber = rawNumber.substring(1);

        // 3. Garante o 55 (Brasil). Se tiver menos de 12 dígitos, falta o 55.
        // Um número com DDD + Numero tem 10 ou 11 dígitos.
        if (rawNumber.length <= 11) {
            rawNumber = '55' + rawNumber;
        }

        // 4. Monta o JID final sem NENHUM espaço ou caractere especial
        const jid = `${rawNumber}@s.whatsapp.net`;
        
        console.log(`[LOG DE DISPARO] Enviando para: ${jid}`);

        await sock.sendMessage(jid, { text: message });
        
        res.json({ success: true, jidSent: jid });
    } catch (err) {
        console.error("ERRO NO WHATSAPP:", err);
        res.status(500).json({ error: err.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => { connectToWA(); });
