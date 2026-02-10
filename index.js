const express = require('express');
const cors = require('cors');
const { default: makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion } = require("@whiskeysockets/baileys");
const fs = require('fs');

const app = express();
app.use(cors());
app.use(express.json());

let pairingCode = null;
let connectionStatus = "Desconectado";
let sock = null;

async function connectToWA() {
    // Usamos uma pasta totalmente nova para garantir o reset
    const { state, saveCreds } = await useMultiFileAuthState('./sessao_codigo');
    const { version } = await fetchLatestBaileysVersion();

    sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: false,
        browser: ["Ubuntu", "Chrome", "20.0.04"],
        connectTimeoutMs: 60000,
        syncFullHistory: false
    });

    // SOLICITA O CÓDIGO DE PAREAMENTO (Mude o número abaixo para o SEU número com DDD)
    // Exemplo: 5543991838384
    if (!sock.authState.creds.registered) {
        setTimeout(async () => {
            // COLOQUE O SEU NÚMERO DE WHATSAPP AQUI PARA GERAR O CÓDIGO
            let meuNumero = "5543991838384"; 
            pairingCode = await sock.requestPairingCode(meuNumero);
            connectionStatus = "Aguardando Código: " + pairingCode;
            console.log("DIGITE ESTE CÓDIGO NO SEU CELULAR:", pairingCode);
        }, 5000);
    }

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'open') {
            connectionStatus = "Conectado";
            pairingCode = null;
            console.log("CONECTADO COM SUCESSO!");
        }
        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            if ([401, 408, 515].includes(statusCode)) {
                if (fs.existsSync('./sessao_codigo')) fs.rmSync('./sessao_codigo', { recursive: true, force: true });
            }
            connectToWA();
        }
    });

    sock.ev.on('creds.update', saveCreds);
}

app.get('/status', (req, res) => res.json({ status: connectionStatus, code: pairingCode }));

app.post('/send', async (req, res) => {
    let { number, message } = req.body;
    if (connectionStatus !== "Conectado") return res.status(503).json({ error: "Offline" });
    try {
        let cleanNumber = String(number).replace(/\D/g, '');
        if (!cleanNumber.startsWith('55')) cleanNumber = '55' + cleanNumber;
        await sock.sendMessage(`${cleanNumber}@s.whatsapp.net`, { text: message });
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.listen(process.env.PORT || 3000, () => connectToWA());
