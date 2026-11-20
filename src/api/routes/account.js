const express = require("express");
const bcrypt = require("bcrypt");
const { v4: uuidv4 } = require("uuid");
const User = require("../../core/models/User");
const tokens = require("../../core/services/tokens");
const { getOrCreateProfile } = require("../../core/services/profiles");
const { sendEpicError } = require("../../shared/utils/errors");
const { verifyToken } = require("../middleware/auth");

const router = express.Router();

function basicClientId(req) {
  try {
    const auth = req.headers.authorization || "";
    if (auth.toLowerCase().startsWith("basic ")) {
      const decoded = Buffer.from(auth.split(" ")[1] || "", "base64").toString("utf8");
      return decoded.split(":")[0] || "alecis";
    }
  } catch (_) {}
  return "alecis";
}

function normalizeIdentity(raw) {
  const s = String(raw || "").trim();
  return s;
}

function safeName(raw, fallback = "Player") {
  const base = String(raw || "").trim();
  const cleaned = base.replace(/[^a-zA-Z0-9_\-\. ]/g, "").trim();
  return (cleaned || fallback).slice(0, 24);
}

async function ensureUserByAccountId(accountId, hint) {
  let user = await User.findOne({ accountId });
  if (user) return user;
  const id = String(accountId || uuidv4().replace(/-/g, ""));
  const base = safeName(hint || id.slice(0, 8), `Player_${id.slice(0, 6)}`);
  const email = `${base.toLowerCase().replace(/[^a-z0-9]/g, "") || id.slice(0, 8)}_${id.slice(0, 6)}@alecis.local`;
  const username = `${base}_${id.slice(0, 4)}`;
  user = await User.create({
    accountId: id,
    email,
    username,
    password: "no-mongo-any-credentials",
    vbucks: 1000,
    banned: false,
  });
  return user;
}

async function ensureUserFromLogin(identityRaw) {
  const identity = normalizeIdentity(identityRaw);
  const lower = identity.toLowerCase();
  if (lower) {
    let user = await User.findOne({ $or: [{ email: lower }, { username: lower }, { username: identity }] });
    if (!user) {
      const esc = lower.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      user = await User.findOne({ $or: [{ username: new RegExp(`^${esc}$`, "i") }, { email: new RegExp(`^${esc}$`, "i") }] });
    }
    if (user) return user;
  }
  const accountId = uuidv4().replace(/-/g, "");
  const base = safeName(identity || lower || "player", "Player");
  const isEmail = lower.includes("@");
  const email = isEmail ? lower : `${base.toLowerCase().replace(/[^a-z0-9]/g, "") || "player"}_${accountId.slice(0, 6)}@alecis.local`;
  let username = isEmail ? (lower.split("@")[0] || base) : (identity || base);
  username = safeName(username, base);
  // ensure username not colliding in memory
  const escName = username.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const existingName = await User.findOne({ username: new RegExp(`^${escName}$`, "i") });
  if (existingName) username = `${username}_${accountId.slice(0, 4)}`;
  const existingEmail = await User.findOne({ email: lower && isEmail ? lower : email });
  const finalEmail = existingEmail && existingEmail.accountId ? `${accountId.slice(0, 8)}@alecis.local` : email;
  const user = await User.create({
    accountId,
    email: finalEmail,
    username,
    password: "no-mongo-any-credentials",
    vbucks: 1000,
    banned: false,
  });
  return user;
}

async function ensureDefaultProfiles(accountId) {
  await Promise.all([
    getOrCreateProfile(accountId, "athena"),
    getOrCreateProfile(accountId, "common_core"),
    getOrCreateProfile(accountId, "common_public"),
    getOrCreateProfile(accountId, "creative"),
    getOrCreateProfile(accountId, "collections"),
  ]);
}

// OAuth token
router.post("/account/api/oauth/token", async (req, res) => {
  try {
    const grant_type = req.body.grant_type || req.query.grant_type;
    const clientId = basicClientId(req);
    let accountId, user;

    if (grant_type === "client_credentials") {
      const access = tokens.createClientToken(clientId);
      return res.json({
        access_token: access,
        expires_in: 28800,
        expires_at: new Date(Date.now() + 28800 * 1000).toISOString(),
        token_type: "bearer",
        client_id: clientId,
        internal_client: true,
        client_service: "fortnite",
      });
    }

    if (grant_type === "password") {
      const identity = req.body.username || req.body.email || "player";
      user = await ensureUserFromLogin(identity);
      accountId = user.accountId;
    } else if (grant_type === "exchange_code") {
      const code = req.body.exchange_code;
      const data = tokens.consumeExchangeCode(code);
      if (data && data.accountId) {
        accountId = data.accountId;
        user = await User.findOne({ accountId });
        if (!user) user = await ensureUserByAccountId(accountId);
      } else {
        // permissive: accept any exchange code
        user = await ensureUserFromLogin(req.body.username || "player");
        accountId = user.accountId;
      }
    } else if (grant_type === "refresh_token") {
      const rt = req.body.refresh_token;
      const data = tokens.getRefresh(rt);
      if (data && data.accountId) {
        tokens.killRefresh(rt);
        accountId = data.accountId;
        user = await User.findOne({ accountId });
        if (!user) user = await ensureUserByAccountId(accountId);
      } else {
        user = await ensureUserFromLogin(req.body.username || "player");
        accountId = user.accountId;
      }
    } else if (grant_type === "device_auth") {
      accountId = req.body.account_id || req.body.device_id || uuidv4().replace(/-/g, "");
      user = await User.findOne({ accountId });
      if (!user) user = await ensureUserByAccountId(accountId, req.body.username || req.body.email || "player");
      accountId = user.accountId;
    } else {
      // be permissive for dev launchers
      const identity = req.body.username || req.body.email || "player";
      user = await ensureUserFromLogin(identity);
      accountId = user.accountId;
    }

    if (!user) user = await ensureUserByAccountId(accountId, req.body.username || req.body.email || "player");
    accountId = user.accountId || accountId;

    await ensureDefaultProfiles(accountId);

    const deviceId = req.body.device_id || uuidv4().replace(/-/g, "");
    const access = tokens.createAccessToken(accountId, clientId, deviceId);
    const refresh = tokens.createRefreshToken(accountId, clientId, deviceId);
    const body = tokens.buildOauthResponse({ accessToken: access, refreshToken: refresh, accountId, clientId, deviceId, displayName: user.username, app: "fortnite" });
    return res.json(body);
  } catch (err) {
    console.error("oauth/token error", err);
    return sendEpicError(res, 500, "errors.com.epicgames.common.server_error", err.message, 1000);
  }
});

router.get("/account/api/oauth/verify", verifyToken, async (req, res) => {
  const auth = req.headers["authorization"] || "";
  const token = auth.replace(/^bearer\s+/i, "");
  const data = tokens.getAccess(token);
  return res.json({
    token: token,
    session_id: data && data.jti,
    token_type: "bearer",
    client_id: (data && data.clientId) || "alecis",
    internal_client: true,
    client_service: "fortnite",
    account_id: req.accountId,
    expires_in: data ? Math.max(0, Math.floor((data.expiresAt - Date.now()) / 1000)) : 28800,
    expires_at: data ? new Date(data.expiresAt).toISOString() : new Date(Date.now() + 28800000).toISOString(),
    auth_method: "exchange_code",
    display_name: req.user.username,
    app: "fortnite",
    in_app_id: req.accountId,
    device_id: (data && data.deviceId) || "device",
  });
});

router.delete("/account/api/oauth/sessions/kill", (req, res) => res.status(204).end());
router.delete("/account/api/oauth/sessions/kill/:token", (req, res) => res.status(204).end());
router.delete("/account/api/oauth/sessions", (req, res) => res.status(204).end());

router.get("/account/api/oauth/exchange", verifyToken, (req, res) => {
  const code = tokens.createExchangeCode(req.accountId, (req.tokenData && req.tokenData.clientId) || "alecis");
  res.json({ expiresInSeconds: 300, code, creatingClientId: "alecis" });
});

// Device auth stubs (basic)
router.get("/account/api/public/account/:accountId/deviceAuth", verifyToken, (req, res) => {
  res.json([]);
});
router.post("/account/api/public/account/:accountId/deviceAuth", verifyToken, (req, res) => {
  res.json({ accountId: req.accountId, deviceId: uuidv4().replace(/-/g, ""), secret: uuidv4().replace(/-/g, "") });
});
router.delete("/account/api/public/account/:accountId/deviceAuth", verifyToken, (req, res) => res.status(204).end());

// Account lookup
router.get("/account/api/public/account/:accountId", async (req, res) => {
  const user = await User.findOne({ accountId: req.params.accountId }).lean();
  if (!user) return sendEpicError(res, 404, "errors.com.epicgames.account.account_not_found", "Account not found", 18007);
  res.json({
    id: user.accountId,
    displayName: user.username,
    name: user.username,
    email: user.email,
    failedLoginAttempts: 0,
    lastLogin: new Date().toISOString(),
    numberOfDisplayNameChanges: 0,
    ageGroup: "UNKNOWN",
    headless: false,
    country: user.country || "US",
    lastName: "User",
    preferredLanguage: "en",
    canUpdateDisplayName: true,
    tfaEnabled: false,
    emailVerified: true,
    minorVerified: true,
    minorExpected: false,
    minorStatus: "NOT_MINOR",
    cabinedMode: false,
    hasHashedEmail: false,
  });
});

router.get("/account/api/public/account", async (req, res) => {
  const accountId = req.query.accountId;
  if (accountId) {
    const ids = Array.isArray(accountId) ? accountId : [accountId];
    const users = await User.find({ accountId: { $in: ids } }).lean();
    return res.json(users.map(u => ({ id: u.accountId, displayName: u.username, externalAuths: {} })));
  }
  return res.json([]);
});

router.get("/account/api/public/account/displayName/:displayName", async (req, res) => {
  const user = await User.findOne({ username: new RegExp(`^${req.params.displayName}$`, "i") }).lean();
  if (!user) return sendEpicError(res, 404, "errors.com.epicgames.account.account_not_found", "Account not found", 18007);
  res.json({ id: user.accountId, displayName: user.username, externalAuths: {} });
});

router.get("/account/api/public/account/email/:email", async (req, res) => {
  const user = await User.findOne({ email: String(req.params.email).toLowerCase() }).lean();
  if (!user) return sendEpicError(res, 404, "errors.com.epicgames.account.account_not_found", "Account not found", 18007);
  res.json({ id: user.accountId, displayName: user.username, externalAuths: {} });
});

// External auths stub
router.get("/account/api/public/account/:accountId/externalAuths", (req, res) => res.json({}));

// Metadata
router.get("/account/api/accounts/:accountId/metadata", (req, res) => res.json({}));

// SSOT / version checks common
router.get("/account/api/versioncheck*", (req, res) => res.status(204).end());

module.exports = router;
