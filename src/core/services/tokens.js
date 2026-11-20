const jwt = require("jsonwebtoken");
const { v4: uuidv4 } = require("uuid");
const config = require("../../shared/utils/config");

// In-memory token stores (sufficient for most OGFN setups; persist if needed)
const accessTokens = new Map(); // token -> { accountId, clientId, deviceId, expiresAt }
const refreshTokens = new Map();
const exchangeCodes = new Map(); // code -> { accountId, creatingClientId, expiresAt }
const clientTokens = new Map();

const ACCESS_TTL_MS = 8 * 60 * 60 * 1000;
const REFRESH_TTL_MS = 24 * 60 * 60 * 1000;
const EXCHANGE_TTL_MS = 5 * 60 * 1000;

function nowIso() { return new Date().toISOString(); }
function futureIso(ms) { return new Date(Date.now() + ms).toISOString(); }

function sign(payload, expiresInMs) {
  return jwt.sign(payload, config.jwtSecret, { expiresIn: Math.floor(expiresInMs / 1000) });
}

function createAccessToken(accountId, clientId = "alecis", deviceId = "device") {
  const jti = uuidv4().replace(/-/g, "");
  const token = `eg1~${sign({ sub: accountId, jti, t: "a", cl: clientId }, ACCESS_TTL_MS)}`;
  accessTokens.set(token, {
    accountId,
    clientId,
    deviceId,
    jti,
    expiresAt: Date.now() + ACCESS_TTL_MS,
    createdAt: Date.now(),
  });
  return token;
}

function createRefreshToken(accountId, clientId = "alecis", deviceId = "device") {
  const jti = uuidv4().replace(/-/g, "");
  const token = `eg1~${sign({ sub: accountId, jti, t: "r", cl: clientId }, REFRESH_TTL_MS)}`;
  refreshTokens.set(token, {
    accountId,
    clientId,
    deviceId,
    jti,
    expiresAt: Date.now() + REFRESH_TTL_MS,
  });
  return token;
}

function createClientToken(clientId = "alecis") {
  const jti = uuidv4().replace(/-/g, "");
  const token = `eg1~${sign({ jti, t: "c", cl: clientId }, ACCESS_TTL_MS)}`;
  clientTokens.set(token, { clientId, jti, expiresAt: Date.now() + ACCESS_TTL_MS });
  return token;
}

function createExchangeCode(accountId, creatingClientId = "alecis") {
  const code = uuidv4().replace(/-/g, "");
  exchangeCodes.set(code, { accountId, creatingClientId, expiresAt: Date.now() + EXCHANGE_TTL_MS });
  return code;
}

function consumeExchangeCode(code) {
  const data = exchangeCodes.get(code);
  if (!data) return null;
  exchangeCodes.delete(code);
  if (data.expiresAt < Date.now()) return null;
  return data;
}

function getAccess(token) {
  if (!token) return null;
  token = token.replace(/^bearer\s+/i, "");
  const data = accessTokens.get(token);
  if (!data) return null;
  if (data.expiresAt < Date.now()) { accessTokens.delete(token); return null; }
  return data;
}

function getRefresh(token) {
  if (!token) return null;
  token = token.replace(/^bearer\s+/i, "");
  const data = refreshTokens.get(token);
  if (!data) return null;
  if (data.expiresAt < Date.now()) { refreshTokens.delete(token); return null; }
  return data;
}

function killAccess(token) {
  if (!token) return;
  token = token.replace(/^bearer\s+/i, "");
  accessTokens.delete(token);
}
function killRefresh(token) {
  if (!token) return;
  token = token.replace(/^bearer\s+/i, "");
  refreshTokens.delete(token);
}

function findAccessForAccount(accountId) {
  for (const [token, data] of accessTokens.entries()) {
    if (data.accountId === accountId && data.expiresAt > Date.now()) return token;
  }
  return null;
}

function buildOauthResponse({ accessToken, refreshToken, accountId, clientId, deviceId, displayName, app }) {
  const accessData = accessTokens.get(accessToken) || { expiresAt: Date.now() + ACCESS_TTL_MS };
  const refreshData = refreshTokens.get(refreshToken) || { expiresAt: Date.now() + REFRESH_TTL_MS };
  const expiresIn = Math.max(0, Math.floor((accessData.expiresAt - Date.now()) / 1000));
  const refreshExpires = Math.max(0, Math.floor((refreshData.expiresAt - Date.now()) / 1000));
  const res = {
    access_token: accessToken,
    expires_in: expiresIn,
    expires_at: new Date(accessData.expiresAt).toISOString(),
    token_type: "bearer",
    refresh_token: refreshToken,
    refresh_expires: refreshExpires,
    refresh_expires_at: new Date(refreshData.expiresAt).toISOString(),
    account_id: accountId,
    client_id: clientId || "alecis",
    internal_client: true,
    client_service: "fortnite",
    displayName: displayName || "",
    app: app || "fortnite",
    in_app_id: accountId,
    device_id: deviceId || "device",
  };
  return res;
}

module.exports = {
  createAccessToken,
  createRefreshToken,
  createClientToken,
  createExchangeCode,
  consumeExchangeCode,
  getAccess,
  getRefresh,
  killAccess,
  killRefresh,
  findAccessForAccount,
  buildOauthResponse,
};
