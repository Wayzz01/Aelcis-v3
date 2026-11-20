const logger = require("../../shared/utils/logger");
const gsRegistry = require("../../core/services/gameserverRegistry");
const mmState = require("../../core/services/matchmakingState");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function send(ws, name, payload) {
  try {
    if (ws.readyState === 1) ws.send(JSON.stringify({ payload, name }));
  } catch (e) {
    // ignore
  }
}

function status(ws, state, extra = {}) {
  if (state === "Queued") {
    return send(ws, "StatusUpdate", {
      ticketId: extra.ticketId,
      queuedPlayers: extra.queuedPlayers || 0,
      estimatedWaitSec: extra.estimatedWaitSec != null ? extra.estimatedWaitSec : 0,
      status: extra.status || {},
      state,
    });
  }
  if (state === "SessionAssignment") {
    return send(ws, "StatusUpdate", { matchId: extra.matchId, state });
  }
  return send(ws, "StatusUpdate", { state });
}

const queues = new Map(); // key -> { key, players: [], countdown: number, timer: NodeJS.Timeout|null }
const wsToPlayer = new Map();

function queueKey(playlist, region) {
  return `${String(playlist || "Playlist_DefaultSolo").toLowerCase()}|${String(region || "EU").toUpperCase()}`;
}

function getOrCreateQueue(key) {
  let q = queues.get(key);
  if (!q) {
    q = { key, players: [], countdown: 30, timer: null };
    queues.set(key, q);
  }
  return q;
}

function updateQueued(q) {
  const queued = q.players.filter((p) => p.state === "Queued" && p.ws.readyState === 1);
  for (const p of queued) {
    status(p.ws, "Queued", {
      ticketId: p.ticketId,
      queuedPlayers: queued.length,
      estimatedWaitSec: Math.max(0, q.countdown),
      status: {},
    });
  }
}

function removePlayer(ws) {
  const player = wsToPlayer.get(ws);
  if (!player) return;
  wsToPlayer.delete(ws);
  const q = queues.get(player.queueKey);
  if (!q) return;
  q.players = q.players.filter((p) => p.ws !== ws);
  updateQueued(q);
  if (q.players.length === 0) {
    stopTimer(q);
    queues.delete(player.queueKey);
  }
}

function stopTimer(q) {
  if (q && q.timer) {
    clearInterval(q.timer);
    q.timer = null;
  }
}

function tryStartMatch(q) {
  const players = q.players.filter((p) => p.state === "Queued" && p.ws.readyState === 1);
  if (!players.length) return false;

  // Prefer server matching playlist/region
  const sample = players[0];
  const server = gsRegistry.findBestServer(sample.playlist, sample.region);
  if (!server) {
    // no server ready yet; keep waiting
    q.countdown = Math.max(q.countdown, 10);
    updateQueued(q);
    logger.match(`[mm] waiting for ready gameserver for ${sample.playlist} ${sample.region} (${players.length} queued)`);
    return false;
  }

  stopTimer(q);
  q.countdown = 0;
  q.players = q.players.filter((p) => !players.includes(p));
  if (q.players.length === 0) queues.delete(q.key);

  logger.match(`[mm] starting match for ${sample.playlist} ${sample.region} with ${players.length} player(s) on ${server.ip}:${server.port}`);

  (async () => {
    for (const p of players) {
      try {
        p.state = "SessionAssignment";
        const session = mmState.buildSession({
          sessionId: p.sessionId,
          matchId: p.matchId,
          playlist: p.playlist,
          region: p.region,
          server,
          buildUniqueId: p.buildUniqueId || "0",
        });
        mmState.setSessionForAccount(p.accountId, session);
        status(p.ws, "SessionAssignment", { matchId: p.matchId });
      } catch (e) {
        logger.warn(`[mm] failed assigning session: ${e.message}`);
      }
    }
    await sleep(2000);
    for (const p of players) {
      try {
        send(p.ws, "Play", { matchId: p.matchId, sessionId: p.sessionId, joinDelaySec: 1 });
        p.state = "Playing";
      } catch {}
    }
  })().catch((e) => logger.warn(`[mm] startMatch error: ${e.message}`));

  return true;
}

function startTimer(q) {
  if (q.timer) return;
  q.timer = setInterval(() => {
    const active = q.players.filter((p) => p.state === "Queued" && p.ws.readyState === 1);
    if (!active.length) {
      stopTimer(q);
      queues.delete(q.key);
      return;
    }
    q.countdown -= 2;
    if (q.countdown <= 0 || active.length >= 2) {
      q.countdown = 0;
      if (!tryStartMatch(q)) {
        // server not ready; timer keeps running to retry
      } else {
        return;
      }
    }
    updateQueued(q);
  }, 2000);
  if (typeof q.timer.unref === "function") q.timer.unref();
}

async function handleConnection(ws, req) {
  // Try to associate with a pending ticket request (authenticated earlier via HTTP)
  let pending = null;
  try {
    const url = new URL(req.url || "/", "http://localhost");
    const accountId = url.searchParams.get("accountId");
    const ticketId = url.searchParams.get("ticketId") || url.searchParams.get("ticket");
    if (accountId) pending = mmState.consumePending(accountId);
    if (!pending && ticketId) {
      // best-effort: not indexed by ticketId currently, fall through
    }
  } catch {}
  if (!pending) pending = mmState.consumeNextPending();

  const playlist = pending?.playlist || "Playlist_DefaultSolo";
  const region = pending?.region || "EU";
  const accountId = pending?.accountId || null;
  const buildUniqueId = pending?.buildUniqueId || "0";

  const ticketId = mmState.makeId();
  const matchId = mmState.makeId();
  const sessionId = mmState.makeId();
  const key = queueKey(playlist, region);
  const q = getOrCreateQueue(key);

  const player = {
    ws,
    accountId,
    ticketId,
    matchId,
    sessionId,
    playlist,
    region,
    buildUniqueId,
    state: "Connecting",
    queueKey: key,
    connectedAt: Date.now(),
  };

  wsToPlayer.set(ws, player);
  q.players.push(player);

  if (q.players.length === 1) q.countdown = 30;
  else q.countdown = Math.max(5, q.countdown - 5);

  logger.match(`[mm] player joined queue playlist=${playlist} region=${region} queued=${q.players.length}${accountId ? ` account=${accountId}` : ""}`);

  ws.on("close", () => removePlayer(ws));
  ws.on("error", () => removePlayer(ws));

  try {
    status(ws, "Connecting");
    await sleep(800);
    if (ws.readyState !== 1) return;
    status(ws, "Waiting");
    await sleep(1000);
    if (ws.readyState !== 1) return;
    player.state = "Queued";
    updateQueued(q);
    startTimer(q);
  } catch (e) {
    logger.warn(`[mm] connection setup error: ${e.message}`);
  }
}

module.exports = { handleConnection };
