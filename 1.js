const tls = require("tls");
const websocket = require("ws");
const fs = require("fs/promises");
const json = require("extract-json-from-string");
require("dns").setDefaultResultOrder("ipv4first");

try { process.setpriority(process.PRIORITY_HIGH); } catch(e) {}
console.log("[STARTUP] Vanity sniper started. bismillah @stezyxl production")

let vanity, mfa;
const auth = "";
const sw = "";
const ch = "";

const CONNECTION_POOL_SIZE = 3;
const tlsConnections = new Array(CONNECTION_POOL_SIZE);
const tlsConnectionsLength = tlsConnections.length;
let currentConnectionCount = 0;

const guilds = Object.create(null);
const vanityRequestCache = new Map();

const keep = Buffer.from("GET / HTTP/1.1\r\nHost: canary.discord.com\r\nConnection: keep-alive\r\n\r\n");
const patchRequestTemplate = Buffer.from(`PATCH /api/v6/guilds/${sw}/vanity-url HTTP/1.1\r\nHost: canary.discord.com\r\nAuthorization: ${auth}\r\nUser-Agent: Mozilla/5.0\r\nX-Super-Properties: eyJicm93c2VyIjoiQ2hyb21lIiwiYnJvd3Nlcl91c2VyX2FnZW50IjoiQ2hyb21lIiwiY2xpZW50X2J1aWxkX251bWJlciI6MzU1NjI0fQ==\r\nContent-Type: application/json\r\nConnection: keep-alive\r\n`);
const messageRequestPrefix = Buffer.from(`POST /api/v9/channels/${ch}/messages HTTP/1.1\r\nHost: discord.com\r\nAuthorization: ${auth}\r\nContent-Type: application/json\r\nConnection: keep-alive\r\n`);

const msgContentPrefix = Buffer.from("vanity = \\");
const msgContentMid = Buffer.from("\\ \nresponse = \\`");
const msgContentSuffix = Buffer.from("\\ \n\\stezy luvs you\\ ||@everyone||");

const TLS_OPTIONS = {
    host: "canary.discord.com",
    port: 443,
    minVersion: "TLSv1.3",
    ciphers: "TLS_AES_128_GCM_SHA256:TLS_AES_256_GCM_SHA384",
    rejectUnauthorized: false,
    servername: "canary.discord.com",
    ALPNProtocols: ['http/1.1'],
    session: null
};

function patch(vanityCode) {
    let requestBuffer = vanityRequestCache.get(vanityCode);
    if (requestBuffer) return requestBuffer;
    
    const payload = `{"code":"${vanityCode}"}`;
    const payloadLength = Buffer.byteLength(payload);
    const mfaHeader = `X-Discord-MFA-Authorization: ${mfa}\r\nContent-Length: ${payloadLength}\r\n\r\n`;
    
    requestBuffer = Buffer.concat([
        patchRequestTemplate,
        Buffer.from(mfaHeader + payload)
    ]);
    
    vanityRequestCache.set(vanityCode, requestBuffer);
    console.log(`[PATCH] ${vanityCode} patch prepared`);
    return requestBuffer;
}

function webs(token) {
    const ws = new websocket("wss://gateway-us-east1-b.discord.gg", {
        perMessageDeflate: false,
        handshakeTimeout: 5000
    });
    
    ws.onclose = () => setTimeout(() => webs(token), 10);
    ws.onerror = () => {};
    
    const authPayload = JSON.stringify({
        op: 2,
        d: {
            token,
            intents: 513,
            properties: { os: "linux", browser: "firefox", device: "stezy" }
        }
    });
    const heartbeatPayload = JSON.stringify({op: 1, d: null});
    
    ws.onmessage = (message) => {
        try {
            const data = JSON.parse(message.data);
            const {d, op, t} = data;
            
            if (op === 10) {
                ws.send(authPayload);
                setInterval(() => ws.send(heartbeatPayload), d.heartbeat_interval);
            }
                            else if (op === 0 && t === "READY") {
                if (d && d.guilds) {
                    for (const guild of d.guilds) {
                        if (guild.vanity_url_code) guilds[guild.id] = guild.vanity_url_code;
                    }
                    console.log(`[READY] ${Object.keys(guilds).length} sniping`);
                }
            }
            else if (op === 0 && (t === "GUILD_UPDATE" || t === "GUILD_DELETE") && d) {
                const guildId = d.id || d.guild_id;
                const vanityCode = guilds[guildId];
                
                if (vanityCode && vanityCode !== d.vanity_url_code) {
                    vanity = vanityCode;
                    console.log(`[SNIPER] Vanity URL change ${vanityCode} @stezyxl production`);
                    
                    const requestBuffer = patch(vanity);
                    
                    process.nextTick(() => {
                        let requestsSent = 0;
                        
                        for (let i = 0; i < tlsConnectionsLength && requestsSent < 5; i++) {
                            const conn = tlsConnections[i];
                            if (conn && conn.writable) {
                                if (conn.setPriority) conn.setPriority(0);
                                conn.write(requestBuffer);
                                requestsSent++;
                                console.log(`[REQUEST] Patch ${requestsSent}/5 Sent`);
                            }
                        }
                        
                        if (requestsSent < 5) {
                            for (let i = 0; i < 5 - requestsSent; i++) {
                                process.nextTick(() => {
                                    const conn = tlsc();
                                    if (conn && conn.writable) conn.write(requestBuffer);
                                });
                            }
                        }
                    });
                }
            }
        } catch(error) {}
    };
}

function qwe() {
    console.log(`[TLS] Emptying connection pool (boyut: ${CONNECTION_POOL_SIZE})`);
    for (let i = 0; i < CONNECTION_POOL_SIZE; i++) tlsc();
}

function tlsc() {
    const connection = tls.connect(TLS_OPTIONS);
    
    connection.setNoDelay(true);
    connection.setKeepAlive(true, 1000);
    if (connection.setPriority) connection.setPriority(0);
    if (connection.socket && connection.socket.setNoDelay) connection.socket.setNoDelay(true);
    
    if (connection.socket) {
        if (connection.socket.setRecvBufferSize) connection.socket.setRecvBufferSize(1024*256);
        if (connection.socket.setSendBufferSize) connection.socket.setSendBufferSize(1024*256);
    }
    
    const handleDisconnect = () => {
        const idx = tlsConnections.indexOf(connection);
        if (idx !== -1) {
            tlsConnections[idx] = null;
            currentConnectionCount--;
        }
        process.nextTick(tlsc);
    };
    
    connection.on("error", handleDisconnect);
    connection.on("end", handleDisconnect);
    
    connection.on("secureConnect", () => {
        if (currentConnectionCount < tlsConnectionsLength) {
            for (let i = 0; i < tlsConnectionsLength; i++) {
                if (!tlsConnections[i]) {
                    tlsConnections[i] = connection;
                    currentConnectionCount++;
                    console.log(`[TLS] New connection added (${currentConnectionCount}/${tlsConnectionsLength})`);
                    break;
                }
            }
            connection.write(keep);
        }
    });
    
    connection.on("data", (data) => {
        if (data.indexOf('{') === -1 || data.indexOf('}') === -1) return;
        
        const ext = json(data.toString());
        if (!ext || !ext.length) return;
        
        let find;
        for (let i = 0; i < ext.length; i++) {
            if (ext[i].code || ext[i].message) {
                find = ext[i];
                break;
            }
        }
        
        if (find) {
            console.log(`[RESPONSE] Vanity ${vanity} response ${JSON.stringify(find)} @stezyxl production`);
            let jsonResp;
            if (find === true) jsonResp = 'true';
            else if (find === false) jsonResp = 'false';
            else if (Object.keys(find).length === 0) jsonResp = '{}';
            else jsonResp = JSON.stringify(find);
            
            const msgParts = [
                msgContentPrefix,
                Buffer.from(vanity),
                msgContentMid,
                Buffer.from(jsonResp),
                msgContentSuffix
            ];
            
            const msgContent = Buffer.concat(msgParts).toString();
            const requestBody = JSON.stringify({content: msgContent});
            const contentLength = Buffer.byteLength(requestBody);
            const fullRequest = Buffer.concat([
                messageRequestPrefix,
                Buffer.from(`Content-Length: ${contentLength}\r\n\r\n${requestBody}`)
            ]);
            
            if (connection.writable) connection.write(fullRequest);
        }
    });
    
    return connection;
}

async function mfa2() {
    try {
        const jsonData = JSON.parse(await fs.readFile('mfa.json', 'utf8'));
        const newToken = jsonData.token || "";
        if (mfa !== newToken) {
            console.log("[MFA] MFA updated @stezyxl production");
            mfa = newToken;
            vanityRequestCache.clear();
        }
    } catch(err) {}
}

async function main() {
    console.log("[INIT] Vanity sniper starting @stezyxl production");
    await mfa2();
    qwe();
    webs(auth);
    console.log("[INIT] Setup completed @stezyxl production");
    setInterval(mfa2, 10000);
}

setInterval(() => {
    for (let i = 0; i < tlsConnectionsLength; i++) {
        const conn = tlsConnections[i];
        if (conn && conn.writable) conn.write(keep);
    }
}, 2000);

process.nextTick(main);
