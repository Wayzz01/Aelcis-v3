const express = require("express");
const crypto = require("crypto");
const config = require("../../shared/utils/config");
const { verifyToken } = require("../middleware/auth");
const Ban = require("../../core/models/Ban");
const gsRegistry = require("../../core/services/gameserverRegistry");
const mmState = require("../../core/services/matchmakingState");
const logger = require("../../shared/utils/logger");

const router = express.Router();

gsRegistry.startPruneLoop();

function checkGameApiKey(req) {
  const key = req.headers["x-api-key"] || req.headers["authorization"]?.replace(/^bearer\s+/i, "") || req.query.apiKey || (req.body && req.body.apiKey);
  return !config.gameApiKey || key === config.gameApiKey;
}

async function isBanned(accountId, playlist) {
  try {
    const now = new Date();
    const bans = await Ban.find({ accountId, active: true, $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }] }).lean();
    for (const b of bans) {
      if (b.type === "permanent" || b.type === "matchmaking") return { banned: true, reason: b.reason, type: b.type };
      if (b.type === "competitive" && /arena|hype|showdown|tournament|competitive|hype/i.test(String(playlist || ""))) {
        return { banned: true, reason: b.reason, type: b.type };
      }
    }
  } catch {}
  return { banned: false };
}

function getQueryParam(req, ...names) {
  for (const n of names) {
    if (req.query[n] != null && req.query[n] !== "") return req.query[n];
  }
  return undefined;
}

function parseBucketInfo(req) {
  const bucketId = String(getQueryParam(req, "bucketId", "bucketID") || "");
  const parts = bucketId.split(":");
  const buildUniqueId = parts[0] || "0";
  // Common forms: NetCL:PlaylistHash:Region:PlaylistName OR NetCL:Region:PlaylistName
  let playlist = getQueryParam(req, "player.option.playlistName", "playlist", "playlistName");
  let region = getQueryParam(req, "player.option.region", "region");
  if (!playlist && parts.length >= 4) playlist = parts[3];
  if (!playlist && parts.length === 3) playlist = parts[2];
  if (!region && parts.length >= 4) region = parts[2];
  if (!region && parts.length === 3) region = parts[1];
  playlist = String(playlist || "Playlist_DefaultSolo").trim();
  region = String(region || "EU").trim().toUpperCase();
  return { bucketId, buildUniqueId, playlist, region };
}

function getMatchmakerServiceUrl(req) {
  const cfg = config.matchmaker || {};
  const explicit = cfg.serviceUrl || config.matchmakerServiceUrl || cfg.ip || config.matchmakerIP;
  if (explicit) {
    const s = String(explicit);
    if (/^wss?:\/\//i.test(s)) return s;
    return `ws://${s}`;
  }
  const host = (req && (req.hostname || (req.headers && req.headers.host && String(req.headers.host).split(":")[0]))) || "127.0.0.1";
  const port = (config.ports && config.ports.xmpp) ? config.ports.xmpp : 80;
  return `ws://${host}:${port}`;
}

// Matchmaking ticket (Epic MMS flow for 12.41)
async function handleTicketRequest(req, res) {
  const accountId = req.params.accountId || req.accountId || (req.user && (req.user.accountId || req.user.account_id));
  const { bucketId, buildUniqueId, playlist, region } = parseBucketInfo(req);
  const ban = await isBanned(accountId, playlist);
  if (ban.banned) {
    return res.status(403).json({
      errorCode: "errors.com.epicgames.fortnite.player_banned_from_sub_game",
      errorMessage: `Banned from matchmaking: ${ban.reason || ban.type}`,
      messageVars: [],
      numericErrorCode: 28004,
      originatingService: "fortnite",
      intent: "prod-live",
    });
  }

  mmState.setPending(accountId, { playlist, region, bucketId, buildUniqueId });
  logger.match(`[mm] ticket requested account=${accountId} playlist=${playlist} region=${region} bucket=${bucketId}`);

  const serviceUrl = getMatchmakerServiceUrl(req);
  const payload = "player";
  const signatureSource = `${accountId}:${bucketId}:${playlist}:${region}`;
  const signature = crypto.createHash("sha256").update(signatureSource).digest("hex");

  return res.json({
    serviceUrl,
    ticketType: "mms-player",
    payload,
    signature,
  });
}

router.get("/fortnite/api/game/v2/matchmakingservice/ticket/player/:accountId", verifyToken, handleTicketRequest);
router.get("/fortnite/api/game/v2/matchmakingservice/ticket/player/*", verifyToken, handleTicketRequest);
router.get("/fortnite/api/matchmakingservice/ticket/player/:accountId", verifyToken, handleTicketRequest);
router.get("/fortnite/api/matchmakingservice/ticket/player/*", verifyToken, handleTicketRequest);

// Session find
router.get("/fortnite/api/matchmaking/session/findPlayer/:accountId", verifyToken, async (req, res) => {
  const { accountId } = req.params;
  const session = mmState.getSessionForAccount(accountId);
  if (session) return res.json(session);

  // If a pending/ticket exists but no session assigned yet, tell client to keep searching
  const pending = mmState.getPending(accountId);
  if (pending) return res.status(204).end();

  // Fallback: try to provide a session if a ready gameserver exists (helps some flows)
  const gs = gsRegistry.findBestServer("Playlist_DefaultSolo", "EU");
  if (!gs) return res.status(404).json({
    errorCode: "errors.com.epicgames.fortnite.matchmaking_session_not_found",
    errorMessage: "No ready gameserver found",
    numericErrorCode: 12101,
    originatingService: "fortnite",
    intent: "prod-live",
  });
  const fallback = mmState.buildSession({ playlist: gs.playlist || "Playlist_DefaultSolo", region: gs.region || "EU", server: gs });
  return res.json(fallback);
});

// Gameserver heartbeat/registration (auto-detect ready servers on PC/network)
// Send every ~5 seconds: { ip, port, playlist, region, status: "ready" }
router.post(["/api/matchmaking/heartbeat", "/api/matchmaking/servers/heartbeat", "/api/gameservers/heartbeat", "/fortnite/api/matchmaking/servers/heartbeat"], (req, res) => {
  if (!checkGameApiKey(req)) return res.status(401).json({ ok: false, error: "Invalid API key" });
  const body = req.body && typeof req.body === "object" ? req.body : {};
  // allow query params as fallback
  const payload = { ...req.query, ...body };
  const reqIp = (req.headers["x-forwarded-for"] || req.ip || req.socket?.remoteAddress || "").toString().split(",")[0].trim();
  const result = gsRegistry.upsertHeartbeat(payload, reqIp);
  if (!result.ok) return res.status(400).json(result);
  return res.json({ ok: true, intervalMs: gsRegistry.HEARTBEAT_INTERVAL_MS, timeoutMs: gsRegistry.HEARTBEAT_TIMEOUT_MS, server: result.server, readyServers: gsRegistry.getReadyServers().length });
});

router.get(["/api/matchmaking/servers", "/api/gameservers"], (req, res) => {
  if (!checkGameApiKey(req)) return res.status(401).json({ ok: false, error: "Invalid API key" });
  return res.json({ ok: true, servers: gsRegistry.listServers(), ready: gsRegistry.getReadyServers() });
});

// Some clients call findPlayer without accountId in path the same way; allow wildcard
router.get("/fortnite/api/matchmaking/session/findPlayer/*", verifyToken, async (req, res) => {
  const accountId = req.accountId || (req.user && (req.user.accountId || req.user.account_id));
  if (accountId) {
    const session = mmState.getSessionForAccount(accountId);
    if (session) return res.json(session);
    const pending = mmState.getPending(accountId);
    if (pending) return res.status(204).end();
  }
  return res.status(204).end();
});

// Session endpoints
router.get("/fortnite/api/matchmaking/session/:sessionId", (req, res) => {
  const stored = mmState.getSessionById(req.params.sessionId);
  if (stored) return res.json(stored);
  // Unknown session id: best-effort fallback (keeps client from hard-failing in some flows)
  const gs = gsRegistry.findBestServer("Playlist_DefaultSolo", "EU") || { ip: "127.0.0.1", port: 7777, region: "EU", playlist: "Playlist_DefaultSolo" };
  const fallback = mmState.buildSession({ sessionId: req.params.sessionId, playlist: gs.playlist || "Playlist_DefaultSolo", region: gs.region || "EU", server: gs });
  return res.json(fallback);
});
router.post("/fortnite/api/matchmaking/session/:sessionId/join", (req, res) => res.status(204).end());
router.post("/fortnite/api/matchmaking/session/:sessionId/heartbeat", (req, res) => res.status(204).end());
router.post("/fortnite/api/matchmaking/session/:sessionId/players", (req, res) => res.status(204).end());
router.delete("/fortnite/api/matchmaking/session/:sessionId/players", (req, res) => res.status(204).end());
router.put("/fortnite/api/matchmaking/session/:sessionId", (req, res) => res.status(204).end());
router.delete("/fortnite/api/matchmaking/session/:sessionId", (req, res) => res.status(204).end());

// MMS / stats stubs
router.get("/fortnite/api/matchmaking/session/matchMakingRequest", (req, res) => res.json([]));
router.get("/fortnite/api/game/v2/matchmaking/account/:accountId/session/:sessionId", (req, res) => res.json({ accountId: req.params.accountId, sessionId: req.params.sessionId, key: "none" }));
router.post("/fortnite/api/game/v2/matchmaking/account/:accountId/session/:sessionId", (req, res) => res.json({}));

module.exports = router;
