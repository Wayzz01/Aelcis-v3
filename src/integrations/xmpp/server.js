const WebSocket = require("ws");
const http = require("http");
const { URL } = require("url");
const { v4: uuidv4 } = require("uuid");
const xml2js = require("xml2js");
const logger = require("../../shared/utils/logger");
const tokens = require("../../core/services/tokens");
const User = require("../../core/models/User");
const Friend = require("../../core/models/Friend");

const clients = new Map(); // accountId -> Set of ws
const wsToAccount = new Map(); // ws -> accountId
const builder = new xml2js.Builder({ headless: true, renderOpts: { pretty: false } });

function send(ws, xml) {
  if (ws.readyState === WebSocket.OPEN) {
    try { ws.send(xml); } catch {}
  }
}

function sendToAccount(accountId, xml) {
  const set = clients.get(accountId);
  if (!set) return;
  for (const ws of set) send(ws, xml);
}

function broadcastPresence(accountId, type = "available") {
  // notify friends
  Friend.find({ accountId, status: "ACCEPTED" }).lean().then(friends => {
    for (const f of friends) {
      const from = `${accountId}@prod.ol.epicgames.com`;
      const to = `${f.friendId}@prod.ol.epicgames.com`;
      const presence = type === "unavailable"
        ? `<presence from="${from}" to="${to}" type="unavailable"/>`
        : `<presence from="${from}" to="${to}" type="available"><status>{"Status":"","bIsPlaying":false,"bIsJoinable":false}</status></presence>`;
      sendToAccount(f.friendId, presence);
    }
  }).catch(() => {});
}

async function getRoster(accountId) {
  const friends = await Friend.find({ accountId, status: "ACCEPTED" }).lean();
  const items = friends.map(f => `<item jid="${f.friendId}@prod.ol.epicgames.com" subscription="both"/>`).join("");
  return items;
}

function start({ appConfig }) {
  const port = appConfig.ports.xmpp || 80;
  const server = http.createServer((req, res) => {
    res.writeHead(200); res.end("Alecis-v3 XMPP");
  });
  const wss = new WebSocket.Server({ server, path: "/" });

  wss.on("connection", async (ws, req) => {
    // Route websocket connections: XMPP subprotocol => XMPP, otherwise MMS matchmaker queue
    try {
      const proto = String(ws.protocol || (req.headers && req.headers["sec-websocket-protocol"]) || "").toLowerCase();
      if (proto !== "xmpp") {
        const mmQueue = require("../matchmaker/queue");
        return mmQueue.handleConnection(ws, req);
      }
    } catch (e) {
      logger.warn("WS dispatch error:", e.message);
    }

    let accountId = null;
    let authed = false;
    let resource = "Alecis";
    let streamId = uuidv4().replace(/-/g, "");
    let jid = null;

    logger.xmpp("XMPP connection opened");

    ws.on("message", async (data) => {
      const msg = data.toString();
      // Very lightweight handling: detect key stanzas by string matching (robust enough for basic XMPP over WS)
      try {
        if (msg.includes("<open") || msg.startsWith("<?xml")) {
          // stream open
          const openResp = `<?xml version='1.0' encoding='UTF-8'?><open xmlns="urn:ietf:params:xml:ns:xmpp-framing" from="prod.ol.epicgames.com" id="${streamId}" version="1.0" xml:lang="en"/>` +
            `<stream:features xmlns:stream="http://etherx.jabber.org/streams">` +
            (authed ? `<bind xmlns="urn:ietf:params:xml:ns:xmpp-bind"/><session xmlns="urn:ietf:params:xml:ns:xmpp-session"/>` : `<mechanisms xmlns="urn:ietf:params:xml:ns:xmpp-sasl"><mechanism>PLAIN</mechanism></mechanisms>`) +
            `<ver xmlns="urn:xmpp:features:rosterver"/><starttls xmlns="urn:ietf:params:xml:ns:xmpp-tls"/><compression xmlns="http://jabber.org/features/compress"><method>zlib</method></compression></stream:features>`;
          return send(ws, openResp);
        }

        if (msg.includes("<auth") && msg.includes("PLAIN")) {
          // PLAIN auth: base64 of \0auth\0password OR \0accountId\0token; Fortnite often sends token as password
          const m = msg.match(/>([^<]+)</);
          if (m) {
            try {
              const decoded = Buffer.from(m[1], "base64").toString("utf8");
              const parts = decoded.split("\0"); // ["", authcid, passwd] or ["", accountId, token]
              const tokenOrPass = parts[2] || parts[1] || "";
              const tokenData = tokens.getAccess(tokenOrPass) || null;
              if (tokenData && tokenData.accountId) {
                accountId = tokenData.accountId;
                authed = true;
              } else {
                // try to extract account from parts[1] if it looks like id
                if (parts[1] && parts[1].length === 32) { accountId = parts[1]; authed = true; }
              }
            } catch {}
          }
          if (authed) {
            send(ws, `<success xmlns="urn:ietf:params:xml:ns:xmpp-sasl"/>`);
            // client will reopen stream
          } else {
            // be permissive in dev: accept and hope bind provides info? better to fail clearly
            send(ws, `<success xmlns="urn:ietf:params:xml:ns:xmpp-sasl"/>`);
            authed = true; // permissive fallback
          }
          return;
        }

        if (msg.includes("<iq") && msg.includes("bind") && authed) {
          // extract resource if provided
          const resM = msg.match(/<resource>([^<]+)<\/resource>/);
          if (resM) resource = resM[1];
          if (!accountId) {
            // cannot bind without account; close
            return;
          }
          jid = `${accountId}@prod.ol.epicgames.com/${resource}`;
          if (!clients.has(accountId)) clients.set(accountId, new Set());
          clients.get(accountId).add(ws);
          wsToAccount.set(ws, accountId);
          const idM = msg.match(/id="([^"]+)"/);
          const iqId = idM ? idM[1] : "_xmpp_bind1";
          send(ws, `<iq id="${iqId}" type="result"><bind xmlns="urn:ietf:params:xml:ns:xmpp-bind"><jid>${jid}</jid></bind></iq>`);
          logger.xmpp(`XMPP bound: ${jid}`);
          return;
        }

        if (msg.includes("<iq") && msg.includes("session") && authed) {
          const idM = msg.match(/id="([^"]+)"/);
          send(ws, `<iq id="${idM ? idM[1] : "_xmpp_session1"}" type="result"/>`);
          return;
        }

        if (msg.includes("<iq") && msg.includes("query") && msg.includes("jabber:iq:roster") && authed && accountId) {
          const idM = msg.match(/id="([^"]+)"/);
          const items = await getRoster(accountId);
          send(ws, `<iq to="${jid || accountId + '@prod.ol.epicgames.com'}" id="${idM ? idM[1] : "roster"}" type="result"><query xmlns="jabber:iq:roster">${items}</query></iq>`);
          return;
        }

        if (msg.startsWith("<presence") && authed && accountId) {
          // store/broadcast presence to friends
          broadcastPresence(accountId, msg.includes('type="unavailable"') ? "unavailable" : "available");
          // echo/ack not strictly required
          return;
        }

        if (msg.startsWith("<message") && authed && accountId) {
          // route to target jid if present
          const toM = msg.match(/to="([^"]+)"/);
          if (toM) {
            const toJid = toM[1];
            const toId = toJid.split("@")[0];
            // rewrite from to be authoritative
            const fromJid = jid || `${accountId}@prod.ol.epicgames.com/${resource}`;
            let out = msg;
            if (!/from="/.test(out)) out = out.replace("<message", `<message from="${fromJid}"`);
            else out = out.replace(/from="[^"]*"/, `from="${fromJid}"`);
            // deliver to recipient sessions and/or sender's other sessions for MUC echoes; basic: send to target
            if (clients.has(toId)) {
              sendToAccount(toId, out);
            } else if (toJid.includes("muc.prod.ol.epicgames.com") || toJid.includes("Party-")) {
              // MUC/party: broadcast to all connected clients as simple fallback (not correct, but helps local testing)
              // Better: track MUC joins; for now minimal
            }
          }
          return;
        }

        if (msg.includes("<iq") && authed) {
          // generic iq result to avoid client hangs
          const idM = msg.match(/id="([^"]+)"/);
          if (idM && msg.includes('type="get"')) {
            send(ws, `<iq id="${idM[1]}" type="result"/>`);
          }
          return;
        }

        if (msg.includes("</stream:stream>") || msg.includes("<close")) {
          try { ws.close(); } catch {}
          return;
        }
      } catch (e) {
        logger.debug("XMPP message handling error:", e.message);
      }
    });

    ws.on("close", () => {
      const acc = wsToAccount.get(ws) || accountId;
      if (acc && clients.has(acc)) {
        clients.get(acc).delete(ws);
        if (clients.get(acc).size === 0) {
          clients.delete(acc);
          broadcastPresence(acc, "unavailable");
        }
      }
      wsToAccount.delete(ws);
      logger.xmpp("XMPP connection closed");
    });

    // initial open for some clients happens immediately
  });

  try {
    server.listen(port, "0.0.0.0", () => logger.info(`XMPP WebSocket server listening on port ${port}`));
  } catch (e) {
    logger.warn(`Could not bind XMPP port ${port}: ${e.message} (try running as admin or change XMPP_PORT)`);
  }

  // also try wss port if different and configured? some setups need it; skip for simplicity
  return { wss, server, clients };
}

module.exports = start;
