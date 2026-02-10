const express = require('express');
const cors = require('cors');
const { default: makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion, DisconnectReason } = require("@whiskeysockets/baileys");
const fs = require('fs');

const app = express();
app.use(cors());
app.use(express.json());

let pairingCode = null;
let connectionStatus = "Desconectado";
let sock = null;

async function connectToWA() {
    // MUDANÇA TOTAL: 'sessao_nova_identidade' limpa qualquer rastro anterior
    const { state, saveCreds } = await useMultiFileAuthState('./sessao_nova_identidade');
    const { version } = await fetchLatestBaileysVersion();

    sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: false,
        // NOVA IDENTIDADE: Simular um Mac costuma destravar o erro instantâneo
        browser: ["macOS", "Safari", "17.0"],
        connectTimeoutMs: 120000,
        syncFullHistory: false,
        shouldSyncHistoryMessage: () => false,
        markOnlineOnConnect: false
    });

    if (!sock.authState.creds.registered && !pairingCode) {
        setTimeout(async () => {
            try {
                // VERIFIQUE SE ESTE É O SEU NÚMERO (55 + DDD + Numero)
                const meuNumero = "5543991838384"; 
                pairingCode = await sock.requestPairingCode(meuNumero);
                connectionStatus = "Aguardando Código";
                console.log("NOVO CÓDIGO DE IDENTIDADE:", pairingCode);
            } catch (e) {
                console.error("Erro:", e);
                pairingCode = null;
            }
        }, 15000); 
    }

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'open') {
            connectionStatus = "Conectado";
            pairingCode = null;
            console.log("CONEXÃO ESTABELECIDA!");
        }
        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            if ([401, 408, 428, 515].includes(statusCode)) {
                if (fs.existsSync('./sessao_nova_identidade')) fs.rmSync('./sessao_nova_identidade', { recursive: true, force: true });
            }
            if (statusCode !== DisconnectReason.loggedOut) setTimeout(() => connectToWA(), 5000);
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
