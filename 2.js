"use strict";

const fs = require("fs");
const tls = require("tls");
const WebSocket = require("ws");
const extractJsonFromString = require("extract-json-from-string");

const config = JSON.parse(fs.readFileSync("config.json"));
const {
  discordToken,
  guildId,
  channelId,
  gatewayUrl,
  os,
  browser,
  device
} = config;

let vanity;
let mfaToken = "";
const guilds = {};
const tlsPool = [];
const POOL_SIZE = 100000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000;
let sessionTicket;

const vanityRequestCache = new Map();
const clearVanityCache = () => vanityRequestCache.clear();

const patchRequestTemplate =
  `PATCH /api/v6/guilds/${guildId}/vanity-url HTTP/1.1\r\n` +
  `Host: canary.discord.com\r\n` +
  `Authorization: ${discordToken}\r\n` +
  `User-Agent: Mozilla/5.0\r\n` +
  `X-Super-Properties: eyJicm93c2VyIjoiQ2hyb21lIiwiYnJvd3Nlcl91c2VyX2FnZW50IjoiQ2hyb21lIiwiY2xpZW50X2J1aWxkX251bWJlciI6MzU1NjI0fQ==\r\n` +
  `Content-Type: application/json\r\n` +
  `Connection: close\r\n`;

function patchVanityRequest(vanityCode) {
  let requestBuffer = vanityRequestCache.get(vanityCode);
  if (requestBuffer) return requestBuffer;

  const payload = `{"code":"${vanityCode}"}`;
  const payloadLength = Buffer.byteLength(payload);
  const mfaHeader = `X-Discord-MFA-Authorization: ${mfaToken}\r\nContent-Length: ${payloadLength}\r\n\r\n`;

  requestBuffer = Buffer.concat([
    Buffer.from(patchRequestTemplate + mfaHeader),
    Buffer.from(payload)
  ]);

  vanityRequestCache.set(vanityCode, requestBuffer);
  return requestBuffer;
}

const updateMFA = () => {
  try {
    const latest = JSON.parse(fs.readFileSync('mfa.json', 'utf8')).token || "";
    if (mfaToken !== latest) {
      mfaToken = latest;
      clearVanityCache();
    }
  } catch {}
};

const createSingleTLS = (index) => {
  const socket = tls.connect({
    host: "canary.discord.com",
    port: 443,
    session: sessionTicket
  }, () => {
    sessionTicket = socket.getSession();
  });

  socket.setNoDelay(true); // 
  socket.setMaxListeners(0); // 

  socket.on("data", async (data) => {
    const ext = extractJsonFromString(data.toString());
    const find = ext.find((e) => e.code) || ext.find((e) => e.message);
    if (find) {
      console.log(JSON.stringify(find, null, 2));

      const requestBody = JSON.stringify({
        content: `@everyone ${vanity}\n\`\`\`json\n${JSON.stringify(find, null, 2)}\n\`\`\``,
      });

      const contentLength = Buffer.byteLength(requestBody);
      const requestHeader = [
        `POST /api/v9/channels/${channelId}/messages HTTP/1.1`,
        "Host: discord.com",
        `Authorization: ${discordToken}`,
        "Content-Type: application/json",
        `Content-Length: ${contentLength}`,
        "",
        "",
      ].join("\r\n");

      socket.write(requestHeader + requestBody);
    }
  });

  socket.on("error", () => {
    setTimeout(() => {
      tlsPool[index] = createSingleTLS(index);
    }, 1000);
  });

  socket.on("end", () => {
    setTimeout(() => {
      tlsPool[index] = createSingleTLS(index);
    }, 1000);
  });

  return socket;
};

const createTLSPool = () => {
  for (let i = 0; i < POOL_SIZE; i++) {
    tlsPool.push(createSingleTLS(i));
  }
};

const sendParallelRequests = (requestData) => {
  const requestBuffer = patchVanityRequest(JSON.parse(requestData.body).code);

  // Tüm TLS soketlerine anında gönder
  for (let i = 0; i < POOL_SIZE; i++) {
    const socket = tlsPool[i];
    if (socket && socket.writable) {
      socket.write(requestBuffer);
    }
  }
};

createTLSPool(); 
updateMFA();
setInterval(updateMFA, 10000);

const websocket = new WebSocket(gatewayUrl);

websocket.onclose = () => process.exit();

websocket.onmessage = async (message) => {
  const { d, op, t } = JSON.parse(message.data);

  if (t === "GUILD_UPDATE") {
    const find = guilds[d.guild_id];
    if (find && find !== d.vanity_url_code) {
      const requestBody = JSON.stringify({ code: find });
      sendParallelRequests({ body: requestBody });
      vanity = `guild patch ${find}`;
      console.log(`[VANITY] UP ${find} @stezy`);
    }
  } else if (t === "GUILD_DELETE") {
    const find = guilds[d.guild_id];
    if (find) {
      const requestBody = JSON.stringify({ code: find });
      sendParallelRequests({ body: requestBody });
      vanity = `guild delete ${find}`;
      console.log(`[VANITY] DT: ${find} @stezy`);
      delete guilds[d.guild_id];
    }
  } else if (t === "READY") {
    d.guilds.forEach((guild) => {
      if (guild.vanity_url_code) {
        guilds[guild.id] = guild.vanity_url_code;
      }
    });
    console.log(`[READY] Monitoring: ${Object.keys(guilds).length} URL`);
  }

  if (op === 10) {
    websocket.send(JSON.stringify({
      op: 2,
      d: {
        token: discordToken,
        intents: 1 << 0,
        properties: { os, browser, device },
      },
    }));
    setInterval(() => websocket.send(JSON.stringify({ op: 1, d: null })), d.heartbeat_interval);
  } else if (op === 7) {
    process.exit();
  }
};

setInterval(() => {
  for (let i = 0; i < POOL_SIZE; i++) {
    setTimeout(() => {
      if (tlsPool[i] && tlsPool[i].writable) {
        tlsPool[i].write("GET / HTTP/1.1\r\nHost: canary.discord.com\r\n\r\n");
      }
    }, i * 25);
  }
}, 7500);

console.log(`started with ${POOL_SIZE} TLS connections!`);
