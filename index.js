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
    // Mantemos a pasta sessao_codigo_final para não perder o que já foi feito
    const { state, saveCreds } = await useMultiFileAuthState('./sessao_codigo_final');
    const { version } = await fetchLatestBaileysVersion();

    sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: false,
        browser: ["Ubuntu", "Chrome", "20.0.04"],
        connectTimeoutMs: 120000,
        // CONFIGURAÇÕES CRUCIAL: Bloqueia a sincronização que derruba o servidor
        syncFullHistory: false,
        markOnlineOnConnect: false,
        shouldSyncHistoryMessage: () => false, 
        getMessage: async (key) => { return { conversation: "" } }
    });

    // Pede o código apenas se não estiver conectado e não houver um código na tela
    if (!sock.authState.creds.registered && !pairingCode) {
        setTimeout(async () => {
            try {
                const meuNumero = "5543991838384"; // Verifique se este é seu número
                pairingCode = await sock.requestPairingCode(meuNumero);
                connectionStatus = "Aguardando Código";
                console.log("CÓDIGO FIXO GERADO:", pairingCode);
            } catch (e) {
                console.error("Erro ao gerar código:", e);
                pairingCode = null;
            }
        }, 15000); 
    }

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        
        if (connection === 'open') {
            connectionStatus = "Conectado";
            pairingCode = null;
            console.log("SUCESSO TOTAL!");
        }
        
        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            // Se o erro for de conexão fechada (428) ou stream (515), ele tenta voltar sem mudar o código
            if (statusCode !== DisconnectReason.loggedOut) {
                setTimeout(() => connectToWA(), 5000);
            }
        }
    });

    sock.ev.on('creds.update', saveCreds);
}

app.get('/status', (req, res) => res.json({ status: connectionStatus, code: pairingCode }));

app.post('/send', async (req, res) => {
    let { number, message } = req.body;
    if (connectionStatus !== "Conectado") return res.status(503).json({ error: "Desconectado" });
    try {
        let cleanNumber = String(number).replace(/\D/g, '');
        if (!cleanNumber.startsWith('55')) cleanNumber = '55' + cleanNumber;
        await sock.sendMessage(`${cleanNumber}@s.whatsapp.net`, { text: message });
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => connectToWA());
