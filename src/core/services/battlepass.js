const fs = require("fs");
const path = require("path");

const bpDir = path.join(__dirname, "..", "..", "resources", "responses", "Athena", "BattlePass");
const cache = new Map();

function loadBattlePass(season) {
  const key = String(season);
  if (cache.has(key)) return cache.get(key);
  const file = path.join(bpDir, `Season${key}.json`);
  try {
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    cache.set(key, data);
    return data;
  } catch {
    cache.set(key, null);
    return null;
  }
}

function ensureItem(profileDoc, templateId, quantity = 1, attributes = {}) {
  profileDoc.data.items = profileDoc.data.items || {};
  const tid = String(templateId);
  // avoid duplicates for cosmetics/tokens/schedules/banners in athena-like inventories
  for (const [k, v] of Object.entries(profileDoc.data.items)) {
    if (v && v.templateId && String(v.templateId).toLowerCase() === tid.toLowerCase()) {
      return { itemId: k, existed: true };
    }
  }
  const itemId = `${tid}`;
  // keep unique key if somehow collides
  let finalId = itemId;
  if (profileDoc.data.items[finalId]) finalId = `${tid}:${Date.now()}_${Math.floor(Math.random()*1000)}`;
  profileDoc.data.items[finalId] = {
    templateId: tid,
    attributes: Object.assign({ favorite: false, item_seen: false, level: 1, max_level_bonus: 0, rnd_sel_cnt: 0, variants: [], xp: 0 }, attributes),
    quantity,
  };
  return { itemId: finalId, existed: false };
}

function addMtx(coreDoc, amount) {
  coreDoc.data.items = coreDoc.data.items || {};
  const key = "Currency:MtxGiveaway";
  if (!coreDoc.data.items[key]) coreDoc.data.items[key] = { templateId: key, attributes: { platform: "EpicPC" }, quantity: 0 };
  coreDoc.data.items[key].quantity = (coreDoc.data.items[key].quantity || 0) + amount;
  return key;
}

function grantRewardEntry({ templateId, quantity, athenaDoc, coreDoc, lootResult }) {
  const tid = String(templateId);
  const qty = Number(quantity) || 1;
  const lower = tid.toLowerCase();

  if (lower === "token:athenaseasonxpboost") {
    athenaDoc.data.stats = athenaDoc.data.stats || { attributes: {} };
    athenaDoc.data.stats.attributes = athenaDoc.data.stats.attributes || {};
    athenaDoc.data.stats.attributes.season_match_boost = (athenaDoc.data.stats.attributes.season_match_boost || 0) + qty;
    lootResult.push({ itemType: tid, itemGuid: tid, itemProfile: "athena", quantity: qty });
    return;
  }
  if (lower === "token:athenaseasonfriendxpboost") {
    athenaDoc.data.stats = athenaDoc.data.stats || { attributes: {} };
    athenaDoc.data.stats.attributes = athenaDoc.data.stats.attributes || {};
    athenaDoc.data.stats.attributes.season_friend_match_boost = (athenaDoc.data.stats.attributes.season_friend_match_boost || 0) + qty;
    lootResult.push({ itemType: tid, itemGuid: tid, itemProfile: "athena", quantity: qty });
    return;
  }
  if (lower === "currency:mtxgiveaway" || lower === "currency:mtxpurchased" || lower.startsWith("currency:mtx")) {
    if (coreDoc) {
      coreDoc.data.items = coreDoc.data.items || {};
      const key = tid.includes(":") ? tid : tid;
      // normalize common key forms
      const norm = lower === "currency:mtxgiveaway" ? "Currency:MtxGiveaway" : (lower === "currency:mtxpurchased" ? "Currency:MtxPurchased" : tid);
      if (!coreDoc.data.items[norm]) coreDoc.data.items[norm] = { templateId: norm, attributes: { platform: "EpicPC" }, quantity: 0 };
      coreDoc.data.items[norm].quantity = (coreDoc.data.items[norm].quantity || 0) + qty;
      lootResult.push({ itemType: norm, itemGuid: norm, itemProfile: "common_core", quantity: qty });
    }
    return;
  }

  // Most other rewards go to athena (cosmetics, banners, variant tokens, challenge bundle schedules, etc.)
  const gr = ensureItem(athenaDoc, tid, qty);
  if (!gr.existed) {
    lootResult.push({ itemType: tid, itemGuid: gr.itemId, itemProfile: "athena", quantity: qty });
  }
}

function grantTierRewards({ season, fromTier, toTier, includeFree = true, includePaid = false, athenaDoc, coreDoc }) {
  const bp = loadBattlePass(season);
  const lootResult = [];
  if (!bp || !athenaDoc) return lootResult;
  const start = Math.max(1, Number(fromTier) || 1);
  const end = Math.min(100, Number(toTier) || 0);
  if (end < start) return lootResult;

  for (let tier = start; tier <= end; tier++) {
    const idx = tier - 1;
    const freeTier = (bp.freeRewards && bp.freeRewards[idx]) || {};
    const paidTier = (bp.paidRewards && bp.paidRewards[idx]) || {};

    if (includeFree) {
      for (const [templateId, quantity] of Object.entries(freeTier)) {
        grantRewardEntry({ templateId, quantity, athenaDoc, coreDoc, lootResult });
      }
    }
    if (includePaid) {
      for (const [templateId, quantity] of Object.entries(paidTier)) {
        grantRewardEntry({ templateId, quantity, athenaDoc, coreDoc, lootResult });
      }
    }
  }
  return lootResult;
}

module.exports = {
  loadBattlePass,
  grantTierRewards,
};
