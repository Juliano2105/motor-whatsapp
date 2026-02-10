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
    // Usamos 'sessao_final_v4' para garantir que o Railway crie um espaço 100% limpo
    const { state, saveCreds } = await useMultiFileAuthState('./sessao_final_v4');
    const { version } = await fetchLatestBaileysVersion();

    sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: false,
        // Identificação como um navegador comum para evitar bloqueios
        browser: ["Ubuntu", "Chrome", "20.0.04"],
        // Aumentamos o tempo de espera para 3 minutos para evitar o erro 'Não foi possível conectar'
        connectTimeoutMs: 180000, 
        defaultQueryTimeoutMs: 0,
        // Bloqueia sincronização de histórico que trava o servidor Railway
        syncFullHistory: false,
        shouldSyncHistoryMessage: () => false,
        markOnlineOnConnect: false
    });

    // Gera o código de 8 dígitos apenas se não estiver conectado
    if (!sock.authState.creds.registered) {
        setTimeout(async () => {
            try {
                // SEU NÚMERO DE WHATSAPP COM DDD
                const meuNumero = "5543991838384"; 
                pairingCode = await sock.requestPairingCode(meuNumero);
                connectionStatus = "Aguardando Código";
                console.log("CÓDIGO PARA PAREAMENTO:", pairingCode);
            } catch (e) {
                console.error("Erro ao gerar código:", e);
                pairingCode = null;
            }
        }, 20000); // Aguarda 20 segundos para o servidor estabilizar antes de pedir o código
    }

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        
        if (connection === 'open') {
            connectionStatus = "Conectado";
            pairingCode = null;
            console.log("SUCESSO: WHATSAPP CONECTADO");
        }
        
        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode || lastDisconnect?.error?.output?.payload?.statusCode;
            console.log(`[LOG] Conexão fechada: ${statusCode}`);
            
            // Se a sessão cair por erro de sincronização ou timeout, tenta voltar
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
    if (connectionStatus !== "Conectado") return res.status(503).json({ error: "Servidor Offline" });
    try {
        let cleanNumber = String(number).replace(/\D/g, '');
        if (!cleanNumber.startsWith('55')) cleanNumber = '55' + cleanNumber;
        await sock.sendMessage(`${cleanNumber}@s.whatsapp.net`, { text: message });
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => connectToWA());
