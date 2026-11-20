const { v4: uuidv4 } = require("uuid");

const pendingByAccount = new Map(); // accountId -> { accountId, playlist, region, bucketId, createdAt }
const pendingQueue = []; // FIFO of accountIds waiting for WS association
const sessionsById = new Map(); // sessionId -> session payload
const sessionByAccount = new Map(); // accountId -> sessionId

function normalizePlaylist(playlist) {
  if (!playlist) return "Playlist_DefaultSolo";
  let p = String(playlist).trim();
  if (!p) return "Playlist_DefaultSolo";

  const lower = p.toLowerCase();
  // Map common 12.41 arena aliases to canonical arena late-game IDs we expose
  if (/(showdown|arena)/i.test(p)) {
    if (/trio/i.test(p)) return "Playlist_ShowdownAlt_Trios";
    if (/duo/i.test(p)) return "Playlist_ShowdownAlt_Duos";
    if (/solo/i.test(p)) return "Playlist_ShowdownAlt_Solo";
  }
  if (lower === "playlist_playgroundv2" || lower === "playlist_creative_playonly" || lower === "playlist_playground") {
    return "Playlist_PlaygroundV2";
  }
  return p;
}

function normalizeRegion(region) {
  if (!region) return "EU";
  return String(region).trim().toUpperCase();
}

function setPending(accountId, info = {}) {
  if (!accountId) return null;
  const rec = {
    accountId,
    playlist: normalizePlaylist(info.playlist || "Playlist_DefaultSolo"),
    region: normalizeRegion(info.region || "EU"),
    bucketId: info.bucketId || "",
    buildUniqueId: info.buildUniqueId || "0",
    createdAt: Date.now(),
  };
  pendingByAccount.set(accountId, rec);
  // keep queue unique per account, most recent at end
  const idx = pendingQueue.indexOf(accountId);
  if (idx !== -1) pendingQueue.splice(idx, 1);
  pendingQueue.push(accountId);
  return rec;
}

function getPending(accountId) {
  return pendingByAccount.get(accountId) || null;
}

function consumePending(accountId) {
  if (!accountId) return null;
  const rec = pendingByAccount.get(accountId) || null;
  pendingByAccount.delete(accountId);
  const idx = pendingQueue.indexOf(accountId);
  if (idx !== -1) pendingQueue.splice(idx, 1);
  return rec;
}

function consumeNextPending() {
  while (pendingQueue.length) {
    const accountId = pendingQueue.shift();
    const rec = pendingByAccount.get(accountId);
    pendingByAccount.delete(accountId);
    if (rec) return rec;
  }
  return null;
}

function makeId() {
  return uuidv4().replace(/-/g, "");
}

function buildSession({ sessionId, matchId, playlist, region, server, buildUniqueId }) {
  const sid = sessionId || makeId();
  const now = new Date().toISOString();
  const gs = server || {};
  const port = Number(gs.port || 7777);
  return {
    id: sid,
    ownerId: makeId().toUpperCase(),
    ownerName: "[DS]alecis-v3",
    serverName: "[DS]alecis-v3",
    serverAddress: String(gs.ip || "127.0.0.1"),
    serverPort: port,
    matchId: matchId || makeId(),
    maxPublicPlayers: Number(gs.maxPlayers || 100),
    openPublicPlayers: Number(gs.openPlayers || 100),
    maxPrivatePlayers: 0,
    openPrivatePlayers: 0,
    attributes: {
      REGION_s: normalizeRegion(region || gs.region || "EU"),
      GAMEMODE_s: "FORTATHENA",
      ALLOWBROADCASTING_b: true,
      SUBREGION_s: "GB",
      DCID_s: `FORTNITE-LIVEEU-${sid.slice(0, 8).toUpperCase()}`,
      tenant_s: "Fortnite",
      MATCHMAKINGPOOL_s: "Any",
      STORMSHIELDDEFENSETYPE_i: 0,
      HOTFIXVERSION_i: 0,
      PLAYLISTNAME_s: normalizePlaylist(playlist || gs.playlist || "Playlist_DefaultSolo"),
      SESSIONKEY_s: makeId().toUpperCase(),
      TENANT_s: "Fortnite",
      BEACONPORT_i: Number(gs.beaconPort || (port + 1)),
    },
    publicPlayers: [],
    privatePlayers: [],
    totalPlayers: 0,
    allowJoinInProgress: false,
    shouldAdvertise: false,
    isDedicated: true,
    usesStats: false,
    allowInvites: false,
    usesPresence: false,
    allowJoinViaPresence: true,
    allowJoinViaPresenceFriendsOnly: false,
    buildUniqueId: String(buildUniqueId || "0"),
    lastUpdated: now,
    started: false,
  };
}

function setSessionForAccount(accountId, session) {
  if (!session || !session.id) return session;
  sessionsById.set(session.id, session);
  if (session.matchId) sessionsById.set(`match:${session.matchId}`, session);
  if (accountId) sessionByAccount.set(accountId, session.id);
  return session;
}

function getSessionById(sessionId) {
  return sessionsById.get(sessionId) || sessionsById.get(`match:${sessionId}`) || null;
}

function getSessionForAccount(accountId) {
  const sid = sessionByAccount.get(accountId);
  if (!sid) return null;
  return sessionsById.get(sid) || null;
}

module.exports = {
  setPending,
  getPending,
  consumePending,
  consumeNextPending,
  buildSession,
  setSessionForAccount,
  getSessionById,
  getSessionForAccount,
  makeId,
};
