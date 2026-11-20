const logger = require("../../shared/utils/logger");
const queue = require("./queue");

function start(config) {
  // MMS WebSocket queue is handled by XMPP WS server dispatch (non-xmpp protocol connections).
  // HTTP matchmaking endpoints and gameserver heartbeat are served by the main Express app.
  if (config.matchmaker && config.matchmaker.enabled) {
    logger.match("Matchmaker queue active (WS via XMPP port dispatch) and HTTP matchmaking endpoints enabled.");
  }
  return { ok: true, queue };
}

module.exports = { start, handleConnection: queue.handleConnection };
