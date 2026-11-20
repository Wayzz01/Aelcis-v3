const config = require("../../shared/utils/config");
const logger = require("../../shared/utils/logger");

const HEARTBEAT_INTERVAL_MS = 5000;
const HEARTBEAT_TIMEOUT_MS = 15000;

// key -> server record
const servers = new Map();

function now() { return Date.now(); }

function normalizeRegion(region) {
  return String(region || "EU").toUpperCase();
}

function normalizePlaylist(playlist) {
  const raw = String(playlist || "Playlist_DefaultSolo").trim();
  if (!raw) return "Playlist_DefaultSolo";
  if (/showdown|arena/i.test(raw)) {
    if (/trio/i.test(raw)) return "Playlist_ShowdownAlt_Trios";
    if (/duo/i.test(raw)) return "Playlist_ShowdownAlt_Duos";
    if (/solo/i.test(raw)) return "Playlist_ShowdownAlt_Solo";
  }
  const lower = raw.toLowerCase();
  if (lower === "playlist_playgroundv2" || lower === "playlist_creative_playonly" || lower === "playlist_playground") {
    return "Playlist_PlaygroundV2";
  }
  return raw;
}

function keyOf(ip, port) {
  return `${ip}:${port}`;
}

function isReadyStatus(status) {
  const s = String(status || "ready").toLowerCase();
  return s === "ready" || s === "online" || s === "available" || s === "waiting";
}

function upsertHeartbeat(payload = {}, reqIp = "") {
  const ip = String(payload.ip || payload.address || payload.serverAddress || reqIp || "127.0.0.1").trim();
  const port = Number(payload.port || payload.serverPort || 7777);
  if (!ip || !Number.isFinite(port) || port <= 0) {
    return { ok: false, error: "ip and valid port are required" };
  }

  const key = keyOf(ip, port);
  const prev = servers.get(key) || {};
  const record = {
    ...prev,
    key,
    ip,
    port,
    region: normalizeRegion(payload.region || prev.region),
    playlist: normalizePlaylist(payload.playlist || payload.playlistName || prev.playlist),
    status: String(payload.status || prev.status || "ready").toLowerCase(),
    sessionId: payload.sessionId || prev.sessionId || "",
    maxPlayers: Number.isFinite(Number(payload.maxPlayers)) ? Number(payload.maxPlayers) : (prev.maxPlayers ?? 100),
    openPlayers: Number.isFinite(Number(payload.openPlayers)) ? Number(payload.openPlayers) : (prev.openPlayers ?? 100),
    currentPlayers: Number.isFinite(Number(payload.currentPlayers)) ? Number(payload.currentPlayers) : prev.currentPlayers,
    lastHeartbeat: now(),
    registeredAt: prev.registeredAt || now(),
    source: "heartbeat",
  };
  servers.set(key, record);
  try {
    logger.match(`[heartbeat] ${record.ip}:${record.port} playlist=${record.playlist} region=${record.region} status=${record.status} ready=${getReadyServers().length}/${servers.size}`);
  } catch {}
  return { ok: true, server: record };
}

function removeStale() {
  const cutoff = now() - HEARTBEAT_TIMEOUT_MS;
  let removed = 0;
  for (const [key, s] of servers.entries()) {
    if ((s.lastHeartbeat || 0) < cutoff) {
      servers.delete(key);
      removed++;
      try { logger.match(`[heartbeat] removed stale gameserver ${s.ip}:${s.port} playlist=${s.playlist} region=${s.region}`); } catch {}
    }
  }
  return removed;
}

function heartbeatTick() {
  removeStale();
  const ready = getReadyServers();
  try {
    if (ready.length) {
      const list = ready.map(s => `${s.ip}:${s.port}(${s.playlist}/${s.region})`).join(", ");
      logger.match(`[heartbeat] tick: ${ready.length} ready server(s): ${list}`);
    } else {
      logger.match(`[heartbeat] tick: 0 ready servers`);
    }
  } catch {}
}

function getReadyServers() {
  return Array.from(servers.values()).filter(s => isReadyStatus(s.status));
}

function listServers() {
  return Array.from(servers.values());
}

function findBestServer(playlist, region) {
  const ready = getReadyServers();
  let candidates = ready;

  if (playlist) {
    const p = String(playlist).toLowerCase();
    const exact = candidates.filter(s => String(s.playlist || "").toLowerCase() === p);
    const wildcard = candidates.filter(s => ["*", "any", "all", ""].includes(String(s.playlist || "").toLowerCase()));
    if (exact.length) candidates = exact;
    else if (wildcard.length) candidates = wildcard;
    // if no playlist-specific match, keep all ready candidates as fallback
  }

  if (region) {
    const r = normalizeRegion(region);
    const reg = candidates.filter(s => normalizeRegion(s.region) === r || ["*", "ANY", "ALL", ""].includes(normalizeRegion(s.region)));
    if (reg.length) candidates = reg;
  }

  if (candidates.length) {
    // prefer servers with more open slots if available
    candidates.sort((a, b) => (Number(b.openPlayers ?? 0) - Number(a.openPlayers ?? 0)));
    return candidates[0];
  }

  // fallback to static config servers only when explicitly marked online/ready
  const cfgServers = (config.gameServers || []).filter(s => {
    const st = String(s.status || "online").toLowerCase();
    return st === "online" || st === "ready" || st === "available";
  });
  let cfg = cfgServers;
  if (playlist) {
    const p = String(playlist).toLowerCase();
    const exact = cfg.filter(s => String(s.playlist || "").toLowerCase() === p);
    if (exact.length) cfg = exact;
  }
  if (region) {
    const r = normalizeRegion(region);
    const reg = cfg.filter(s => normalizeRegion(s.region) === r);
    if (reg.length) cfg = reg;
  }
  if (!cfg.length && cfgServers.length) cfg = [cfgServers[0]];
  if (cfg.length) {
    const s = cfg[Math.floor(Math.random() * cfg.length)];
    return { ...s, status: s.status || "online", source: "config" };
  }

  return null;
}

let pruneTimer = null;
function startPruneLoop() {
  if (pruneTimer) return;
  pruneTimer = setInterval(heartbeatTick, HEARTBEAT_INTERVAL_MS);
  if (typeof pruneTimer.unref === "function") pruneTimer.unref();
  heartbeatTick();
}

function stopPruneLoop() {
  if (pruneTimer) clearInterval(pruneTimer);
  pruneTimer = null;
}

module.exports = {
  HEARTBEAT_INTERVAL_MS,
  HEARTBEAT_TIMEOUT_MS,
  upsertHeartbeat,
  removeStale,
  getReadyServers,
  listServers,
  findBestServer,
  startPruneLoop,
  stopPruneLoop,
};
