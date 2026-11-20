const express = require("express");
const config = require("../../shared/utils/config");
const User = require("../../core/models/User");
const Ban = require("../../core/models/Ban");
const { getOrCreateProfile, saveProfile } = require("../../core/services/profiles");
const { bumpRvn, addMtx, ensureAttr } = require("../../core/services/mcp");

const router = express.Router();

function checkApiKey(req, res, next) {
  const key = req.headers["x-api-key"] || req.headers["authorization"]?.replace(/^bearer\s+/i, "") || req.query.apiKey || req.body.apiKey;
  if (!config.gameApiKey || key === config.gameApiKey) return next();
  return res.status(401).json({ ok: false, error: "Invalid API key" });
}

// V-Bucks grant on kill/win (called by gameserver with API key)
router.post("/api/game/kill", checkApiKey, async (req, res) => {
  try {
    const { killerAccountId, victimAccountId, accountId, amount } = req.body || {};
    const killerId = killerAccountId || accountId;
    if (!killerId) return res.status(400).json({ ok: false, error: "killerAccountId required" });

    const vbucks = typeof amount === "number" ? amount : (config.rewards.killVbucks || 5);
    const xp = config.rewards.killXp || 50;

    const core = await getOrCreateProfile(killerId, "common_core");
    const athena = await getOrCreateProfile(killerId, "athena");
    addMtx(core, vbucks);

    const attrs = ensureAttr(athena, "xp", 0);
    attrs.xp = (attrs.xp || 0) + xp;
    attrs.book_xp = (attrs.book_xp || 0) + xp;
    const xpPerLevel = config.rewards.xpPerLevel || 80000;
    attrs.level = Math.floor((attrs.book_xp || 0) / xpPerLevel) + 1;
    attrs.book_level = attrs.level;
    attrs.accountLevel = Math.max(attrs.accountLevel || 1, attrs.level);

    // arena hype on kill (simple)
    try {
      const user = await User.findOne({ accountId: killerId });
      if (user && config.arena && config.arena.enabled) {
        user.hype = (user.hype || 0) + (config.tournaments.hypePerKill || 1);
        await user.save();
      }
    } catch {}

    bumpRvn(core); await saveProfile(core);
    bumpRvn(athena); await saveProfile(athena);

    res.json({ ok: true, rewards: { vbucks, xp, accountId: killerId } });
  } catch (e) {
    console.error("kill reward error", e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.post("/api/game/win", checkApiKey, async (req, res) => {
  try {
    const { accountId, winnerAccountId, placement, amount } = req.body || {};
    const winnerId = accountId || winnerAccountId;
    if (!winnerId) return res.status(400).json({ ok: false, error: "accountId required" });

    const vbucks = typeof amount === "number" ? amount : (config.rewards.winVbucks || 25);
    const xp = config.rewards.winXp || 300;

    const core = await getOrCreateProfile(winnerId, "common_core");
    const athena = await getOrCreateProfile(winnerId, "athena");
    addMtx(core, vbucks);

    const attrs = ensureAttr(athena, "xp", 0);
    attrs.xp = (attrs.xp || 0) + xp;
    attrs.book_xp = (attrs.book_xp || 0) + xp;
    attrs.lifetime_wins = (attrs.lifetime_wins || 0) + 1;
    const season = attrs.season || { numWins: 0, numHighBracket: 0, numLowBracket: 0 };
    season.numWins = (season.numWins || 0) + 1;
    attrs.season = season;
    const xpPerLevel = config.rewards.xpPerLevel || 80000;
    attrs.level = Math.floor((attrs.book_xp || 0) / xpPerLevel) + 1;
    attrs.book_level = attrs.level;
    attrs.accountLevel = Math.max(attrs.accountLevel || 1, attrs.level);

    // arena hype on win
    try {
      const user = await User.findOne({ accountId: winnerId });
      if (user && config.arena && config.arena.enabled) {
        user.hype = (user.hype || 0) + (config.tournaments.hypePerWin || 10);
        await user.save();
      }
    } catch {}

    bumpRvn(core); await saveProfile(core);
    bumpRvn(athena); await saveProfile(athena);

    res.json({ ok: true, rewards: { vbucks, xp, accountId: winnerId, lifetimeWins: attrs.lifetime_wins } });
  } catch (e) {
    console.error("win reward error", e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Generic XP grant
router.post("/api/game/xp", checkApiKey, async (req, res) => {
  try {
    const { accountId, xp } = req.body || {};
    if (!accountId || !xp) return res.status(400).json({ ok: false, error: "accountId and xp required" });
    const athena = await getOrCreateProfile(accountId, "athena");
    const attrs = ensureAttr(athena, "xp", 0);
    attrs.xp = (attrs.xp || 0) + Number(xp);
    attrs.book_xp = (attrs.book_xp || 0) + Number(xp);
    const xpPerLevel = config.rewards.xpPerLevel || 80000;
    attrs.level = Math.floor((attrs.book_xp || 0) / xpPerLevel) + 1;
    attrs.book_level = attrs.level;
    attrs.accountLevel = Math.max(attrs.accountLevel || 1, attrs.level);
    bumpRvn(athena); await saveProfile(athena);
    res.json({ ok: true, xp: attrs.book_xp, level: attrs.level });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Simple anticheat/report endpoint stub (logs)
router.post("/api/game/report", checkApiKey, async (req, res) => {
  // could store anticheat logs; accept payload
  res.json({ ok: true });
});
router.post("/api/game/movement", checkApiKey, async (req, res) => {
  res.json({ ok: true });
});

module.exports = router;
