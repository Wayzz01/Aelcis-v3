const levels = {
  info: "INFO",
  warn: "WARN",
  error: "ERROR",
  debug: "DEBUG",
  xmpp: "XMPP",
  http: "HTTP",
  bot: "BOT",
  match: "MATCH",
};

function ts() {
  return new Date().toISOString();
}

function log(level, ...args) {
  const tag = levels[level] || String(level).toUpperCase();
  const line = `[${ts()}] [${tag}]`;
  if (level === "error") console.error(line, ...args);
  else if (level === "warn") console.warn(line, ...args);
  else console.log(line, ...args);
}

module.exports = {
  info: (...a) => log("info", ...a),
  warn: (...a) => log("warn", ...a),
  error: (...a) => log("error", ...a),
  debug: (...a) => log("debug", ...a),
  xmpp: (...a) => log("xmpp", ...a),
  http: (...a) => log("http", ...a),
  bot: (...a) => log("bot", ...a),
  match: (...a) => log("match", ...a),
};
