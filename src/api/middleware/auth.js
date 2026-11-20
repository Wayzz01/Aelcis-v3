const { v4: uuidv4 } = require("uuid");
const tokens = require("../../core/services/tokens");
const User = require("../../core/models/User");
const { sendEpicError } = require("../../shared/utils/errors");

async function ensureUser(accountId) {
  let user = await User.findOne({ accountId }).lean();
  if (user) return user;
  const short = String(accountId || uuidv4().replace(/-/g, "")).slice(0, 8);
  const created = await User.create({
    accountId: String(accountId || uuidv4().replace(/-/g, "")),
    email: `${short.toLowerCase()}@alecis.local`,
    username: `Player_${short}`,
    password: "no-mongo-any-credentials",
    vbucks: 1000,
  });
  return created && typeof created.toObject === "function" ? created.toObject() : created;
}

async function verifyToken(req, res, next) {
  const auth = req.headers["authorization"] || "";
  const token = auth.replace(/^bearer\s+/i, "");
  if (!token) {
    return sendEpicError(res, 401, "errors.com.epicgames.common.authentication.authentication_failed", `Authentication failed for ${req.originalUrl}`, 1032);
  }
  const data = tokens.getAccess(token);
  if (!data || !data.accountId) {
    return sendEpicError(res, 401, "errors.com.epicgames.common.authentication.authentication_failed", `Authentication failed for ${req.originalUrl}`, 1032);
  }
  try {
    const user = await ensureUser(data.accountId);
    req.user = user;
    req.accountId = data.accountId;
    req.token = token;
    req.tokenData = data;
    next();
  } catch (e) {
    return sendEpicError(res, 500, "errors.com.epicgames.common.server_error", "Server error", 1000);
  }
}

async function verifyClient(req, res, next) {
  // Many endpoints accept client credentials; be permissive but parse if present
  const auth = req.headers["authorization"] || "";
  if (!auth) return next();
  return next();
}

module.exports = { verifyToken, verifyClient };
