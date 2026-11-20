const express = require("express");
const { v4: uuidv4 } = require("uuid");
const User = require("../../core/models/User");
const { getOrCreateProfile } = require("../../core/services/profiles");

const router = express.Router();

// ── Public shop endpoint ──────────────────────────────────────────────────────
// Returns daily + featured items in a simple format the website can consume.
// No auth required. Resolves cosmetic IDs to fortnite-api.com image URLs.

function cosmeticIdFromTemplate(templateId) {
  // "AthenaCharacter:CID_028_Athena_Commando_F" → "CID_028_Athena_Commando_F"
  if (!templateId) return null;
  const parts = String(templateId).split(":");
  return parts[parts.length - 1] || null;
}

function typeLabel(templateId) {
  const prefix = String(templateId || "").split(":")[0] || "";
  const map = {
    AthenaCharacter:  "Outfit",
    AthenaBackpack:   "Back Bling",
    AthenaPickaxe:    "Harvesting Tool",
    AthenaGlider:     "Glider",
    AthenaDance:      "Emote",
    AthenaItemWrap:   "Wrap",
    AthenaMusicPack:  "Music",
    AthenaLoadingScreen: "Loading Screen",
    AthenaSkyDiveContrail: "Contrail",
    AthenaPetCarrier: "Pet",
    AthenaSpray:      "Spray",
    AthenaToy:        "Toy",
  };
  return map[prefix] || prefix.replace("Athena", "") || "Item";
}

function rarityFromPrice(price) {
  if (price >= 1500) return "legendary";
  if (price >= 1200) return "epic";
  if (price >= 800)  return "rare";
  if (price >= 500)  return "uncommon";
  return "common";
}

router.get("/api/shop", (req, res) => {
  try {
    // Lazy-require to avoid circular dep issues at boot
    const { getCatalog } = require("./storefront");
    const catalog = getCatalog();

    const dailySF  = catalog.storefronts.find(s => s.name === "BRDailyStorefront");
    const featSF   = catalog.storefronts.find(s => s.name === "BRWeeklyStorefront");

    function mapEntries(entries) {
      return (entries || []).map(entry => {
        const grants = entry.itemGrants || [];
        const primary = grants[0];
        const id = cosmeticIdFromTemplate(primary?.templateId);
        const price = entry.prices?.[0]?.finalPrice ?? 0;
        return {
          offerId:   entry.offerId,
          name:      entry.title || id || "Unknown",
          type:      typeLabel(primary?.templateId),
          rarity:    rarityFromPrice(price),
          price,
          imageUrl:  id ? `https://fortnite-api.com/images/cosmetics/br/${id.toLowerCase()}/icon.png` : null,
          grants:    grants.map(g => g.templateId),
        };
      });
    }

    res.json({
      expiration: catalog.expiration,
      daily:    mapEntries(dailySF?.catalogEntries),
      featured: mapEntries(featSF?.catalogEntries),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
// ─────────────────────────────────────────────────────────────────────────────

async function ensureProfiles(accountId) {
  await Promise.all([
    getOrCreateProfile(accountId, "athena"),
    getOrCreateProfile(accountId, "common_core"),
    getOrCreateProfile(accountId, "common_public"),
    getOrCreateProfile(accountId, "creative"),
    getOrCreateProfile(accountId, "collections"),
  ]);
}

async function findOrCreateByIdentity(identityRaw) {
  const identity = String(identityRaw || "").trim();
  const lower = identity.toLowerCase();
  const esc = lower.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  let user = await User.findOne({ $or: [{ email: lower }, { username: lower }, { username: identity }] });
  if (!user && esc) {
    user = await User.findOne({ $or: [{ username: new RegExp(`^${esc}$`, "i") }, { email: new RegExp(`^${esc}$`, "i") }] });
  }
  if (user) return user;
  const accountId = uuidv4().replace(/-/g, "");
  const isEmail = lower.includes("@");
  const base = (isEmail ? lower.split("@")[0] : (identity || "player")).replace(/[^a-zA-Z0-9_\-]/g, "").slice(0, 20) || "player";
  let username = base;
  let email = isEmail ? lower : `${base.toLowerCase()}_${accountId.slice(0, 6)}@alecis.local`;
  const escName = username.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (escName && await User.findOne({ username: new RegExp(`^${escName}$`, "i") })) username = `${base}_${accountId.slice(0, 4)}`;
  if (await User.findOne({ email })) email = `${accountId.slice(0, 8)}@alecis.local`;
  user = await User.create({
    accountId,
    email,
    username,
    password: "no-mongo-any-credentials",
    vbucks: 1000,
  });
  await ensureProfiles(accountId);
  return user;
}

router.post("/api/auth/register", async (req, res) => {
  try {
    const { email, username } = req.body || {};
    const emailNorm = String(email || "").toLowerCase().trim();
    const userNorm = String(username || "").trim();
    if (!emailNorm && !userNorm) {
      return res.status(400).json({ ok: false, error: "email or username is required" });
    }
    let user = null;
    if (emailNorm) user = await User.findOne({ email: emailNorm });
    if (!user && userNorm) user = await User.findOne({ username: userNorm });
    if (!user) {
      const accountId = uuidv4().replace(/-/g, "");
      const finalUsername = userNorm || (emailNorm.split("@")[0] || "player").replace(/[^a-zA-Z0-9_\-]/g, "").slice(0, 20) || `player_${accountId.slice(0,4)}`;
      const finalEmail = emailNorm || `${finalUsername.toLowerCase()}_${accountId.slice(0, 6)}@alecis.local`;
      user = await User.create({
        accountId,
        email: finalEmail,
        username: finalUsername,
        password: "no-mongo-any-credentials",
        vbucks: 1000,
      });
    }
    await ensureProfiles(user.accountId);
    return res.json({ ok: true, accountId: user.accountId, username: user.username, email: user.email });
  } catch (err) {
    console.error("register error", err);
    return res.status(500).json({ ok: false, error: err.message || "Registration failed" });
  }
});

router.post("/api/auth/login", async (req, res) => {
  try {
    const { email, username } = req.body || {};
    const id = String(email || username || "").trim();
    if (!id) return res.status(400).json({ ok: false, error: "credentials required" });
    const user = await findOrCreateByIdentity(id);
    await ensureProfiles(user.accountId);
    return res.json({ ok: true, accountId: user.accountId, username: user.username, email: user.email });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

router.get("/api/status", (req, res) => {
  res.json({ ok: true, name: "alecis-v3", season: 12, build: "12.41", status: "online", mongoRequired: false, anyCredentials: true });
});

module.exports = router;
