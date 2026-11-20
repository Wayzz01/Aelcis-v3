const express = require("express");
const fs = require("fs");
const path = require("path");
const { v4: uuidv4 } = require("uuid");
const config = require("../../shared/utils/config");
const { verifyToken } = require("../middleware/auth");
const { getOrCreateProfile, saveProfile } = require("../../core/services/profiles");
const { deductMtx, addMtx, getTotalMtx, bumpRvn } = require("../../core/services/mcp");
const User = require("../../core/models/User");
const Purchase = require("../../core/models/Purchase");
const SacCode = require("../../core/models/SacCode");

const router = express.Router();
const catalogPath = path.join(__dirname, "..", "..", "resources", "config", "catalog.json");
const keychainPath = path.join(__dirname, "..", "..", "resources", "responses", "keychain.json");

let cachedKeychain = null;
function getKeychain() {
  if (cachedKeychain !== null) return cachedKeychain;
  try {
    cachedKeychain = JSON.parse(fs.readFileSync(keychainPath, "utf8"));
  } catch {
    cachedKeychain = [];
  }
  return cachedKeychain;
}

let currentCatalog = null;
let lastCatalogGen = 0;

function ensureCatalogFile() {
  if (!fs.existsSync(catalogPath)) {
    const sample = {
      refreshIntervalHrs: 24,
      storefronts: {
        BRDailyStorefront: [],
        BRWeeklyStorefront: [],
      },
      // easier format: daily/featured arrays of offers
      daily: [
        { itemGrants: ["AthenaDance:EID_DanceMoves"], price: 200, categories: ["Panel 1"] },
        { itemGrants: ["AthenaPickaxe:Pickaxe_ID_011_Medieval"], price: 500, categories: ["Panel 2"] },
        { itemGrants: ["AthenaGlider:Glider_ID_003_District"], price: 500, categories: ["Panel 3"] },
        { itemGrants: ["AthenaBackpack:BID_004_BlackKnight"], price: 200, categories: ["Panel 4"] },
        { itemGrants: ["AthenaDance:EID_Wave"], price: 200, categories: ["Panel 5"] },
        { itemGrants: ["AthenaDance:EID_Fresh"], price: 500, categories: ["Panel 6"] }
      ],
      featured: [
        { itemGrants: ["AthenaCharacter:CID_028_Athena_Commando_F"], price: 1200, categories: ["Panel 1"] },
        { itemGrants: ["AthenaCharacter:CID_017_Athena_Commando_M"], price: 800, categories: ["Panel 2"] }
      ]
    };
    fs.writeFileSync(catalogPath, JSON.stringify(sample, null, 2));
  }
}

function loadCatalogConfig() {
  ensureCatalogFile();
  try { return JSON.parse(fs.readFileSync(catalogPath, "utf8")); } catch { return { daily: [], featured: [] }; }
}

function makeOffer(entry, devNamePrefix = "daily") {
  const itemGrants = (entry.itemGrants || []).map(t => ({ templateId: t, quantity: 1 }));
  const price = entry.price || 0;
  return {
    offerId: `v2:/${uuidv4().replace(/-/g, "")}`,
    devName: `${devNamePrefix}:${(itemGrants[0] && itemGrants[0].templateId) || "item"}`,
    offerType: "StaticPrice",
    prices: [{ currencyType: "MtxCurrency", currencySubType: "", regularPrice: price, finalPrice: price, saleExpiration: "9999-12-31T23:59:59.999Z", basePrice: price }],
    categories: entry.categories || [],
    giftInfo: { bIsEnabled: true, forcedGiftBoxTemplateId: "", purchaseRequirements: [], giftRecordIds: [] },
    dailyLimit: -1,
    weeklyLimit: -1,
    monthlyLimit: -1,
    refundable: true,
    appStoreId: ["", "", "", "", "", "", "", "", "", "", "", ""],
    requirements: [],
    metaInfo: entry.metaInfo || [],
    catalogGroup: entry.catalogGroup || "",
    catalogGroupPriority: entry.catalogGroupPriority || 0,
    sortPriority: entry.sortPriority || 0,
    title: entry.title || "",
    shortDescription: entry.shortDescription || "",
    description: entry.description || "",
    displayAssetPath: entry.displayAssetPath || "",
    itemGrants,
  };
}

function generateCatalog() {
  const cfg = loadCatalogConfig();
  const dailyEntries = (cfg.daily || cfg.storefronts?.BRDailyStorefrontRaw || []).map(e => makeOffer(e, "daily"));
  const featuredEntries = (cfg.featured || cfg.storefronts?.BRWeeklyStorefrontRaw || []).map(e => makeOffer(e, "featured"));

  // If old format stored actual offers, allow passthrough
  const daily = dailyEntries.length ? dailyEntries : (cfg.storefronts && cfg.storefronts.BRDailyStorefront) || [];
  const featured = featuredEntries.length ? featuredEntries : (cfg.storefronts && cfg.storefronts.BRWeeklyStorefront) || [];

  const catalog = {
    refreshIntervalHrs: cfg.refreshIntervalHrs || 24,
    dailyPurchaseHrs: 24,
    expiration: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
    storefronts: [
      { name: "BRDailyStorefront", catalogEntries: daily },
      { name: "BRWeeklyStorefront", catalogEntries: featured },
      { name: "BRSeasonStorefront", catalogEntries: [] }, // battle pass offers handled specially in many builds, but can be added
      { name: "BRSeason13", catalogEntries: [] },
    ],
  };

  // Add standard battle pass offers for season context (use Season BP IDs when available for 12.41 compatibility)
  const season = config.features.battlePassSeason || config.season || 12;
  let bpIds = { battlePassOfferId: "battlepass", battleBundleOfferId: "battlepassbundle", tierOfferId: "battlestartier" };
  try {
    const bpFile = path.join(__dirname, "..", "..", "resources", "responses", "Athena", "BattlePass", `Season${season}.json`);
    if (fs.existsSync(bpFile)) {
      const bpData = JSON.parse(fs.readFileSync(bpFile, "utf8"));
      bpIds = {
        battlePassOfferId: bpData.battlePassOfferId || bpIds.battlePassOfferId,
        battleBundleOfferId: bpData.battleBundleOfferId || bpIds.battleBundleOfferId,
        tierOfferId: bpData.tierOfferId || bpIds.tierOfferId,
      };
    }
  } catch (e) { try { console.log("[storefront] bp id load failed", e && e.message); } catch {} }
  try { console.log("[storefront] bpIds", season, bpIds.battlePassOfferId, bpIds.battleBundleOfferId, bpIds.tierOfferId); } catch {}
  const bpStore = catalog.storefronts.find(s => s.name === "BRSeasonStorefront");
  if (bpStore) {
    bpStore.catalogEntries.push({
      offerId: bpIds.battlePassOfferId,
      devName: `BR.Season${season}.BattlePass.01`,
      offerType: "StaticPrice",
      prices: [{ currencyType: "MtxCurrency", currencySubType: "", regularPrice: 950, finalPrice: 950, saleExpiration: "9999-12-31T23:59:59.999Z", basePrice: 950 }],
      categories: [],
      giftInfo: { bIsEnabled: true, forcedGiftBoxTemplateId: "", purchaseRequirements: [], giftRecordIds: [] },
      dailyLimit: -1, weeklyLimit: -1, monthlyLimit: -1,
      refundable: false, appStoreId: ["","","","","","","","","","","",""],
      requirements: [], metaInfo: [{ key: "Preroll", value: "false" }],
      catalogGroup: "", catalogGroupPriority: 0, sortPriority: 1, title: "Battle Pass", shortDescription: "", description: "", displayAssetPath: "",
      itemGrants: []
    });
    bpStore.catalogEntries.push({
      offerId: bpIds.battleBundleOfferId,
      devName: `BR.Season${season}.BattleBundle.01`,
      offerType: "StaticPrice",
      prices: [{ currencyType: "MtxCurrency", currencySubType: "", regularPrice: 2800, finalPrice: 2800, saleExpiration: "9999-12-31T23:59:59.999Z", basePrice: 2800 }],
      categories: [],
      giftInfo: { bIsEnabled: true, forcedGiftBoxTemplateId: "", purchaseRequirements: [], giftRecordIds: [] },
      dailyLimit: -1, weeklyLimit: -1, monthlyLimit: -1,
      refundable: false, appStoreId: ["","","","","","","","","","","",""],
      requirements: [], metaInfo: [],
      catalogGroup: "", catalogGroupPriority: 0, sortPriority: 2, title: "Battle Bundle", shortDescription: "", description: "", displayAssetPath: "",
      itemGrants: []
    });
    bpStore.catalogEntries.push({
      offerId: bpIds.tierOfferId,
      devName: `BR.Season${season}.SingleTier.01`,
      offerType: "StaticPrice",
      prices: [{ currencyType: "MtxCurrency", currencySubType: "", regularPrice: 150, finalPrice: 150, saleExpiration: "9999-12-31T23:59:59.999Z", basePrice: 150 }],
      categories: [],
      giftInfo: { bIsEnabled: false, forcedGiftBoxTemplateId: "", purchaseRequirements: [], giftRecordIds: [] },
      dailyLimit: -1, weeklyLimit: -1, monthlyLimit: -1,
      refundable: false, appStoreId: ["","","","","","","","","","","",""],
      requirements: [], metaInfo: [],
      catalogGroup: "", catalogGroupPriority: 0, sortPriority: 3, title: "Battle Pass Tier", shortDescription: "", description: "", displayAssetPath: "",
      itemGrants: []
    });
  }

  currentCatalog = catalog;
  lastCatalogGen = Date.now();
  return catalog;
}

function getCatalog() {
  const interval = (config.shop.refreshIntervalHours || 24) * 3600 * 1000;
  if (!currentCatalog || (config.features.autoShop && Date.now() - lastCatalogGen > interval)) {
    return generateCatalog();
  }
  return currentCatalog;
}

// find offer across storefronts
function findOffer(offerId) {
  const cat = getCatalog();
  for (const sf of cat.storefronts || []) {
    for (const e of sf.catalogEntries || []) {
      if (e.offerId === offerId || e.devName === offerId) return e;
    }
  }
  return null;
}

router.get("/fortnite/api/storefront/v2/catalog", (req, res) => {
  res.json(getCatalog());
});

router.get("/fortnite/api/storefront/v2/gift/check_eligibility/recipient/:friendId/offer/:offerId", (req, res) => {
  res.json({ price: findOffer(req.params.offerId)?.prices?.[0] || { currencyType: "MtxCurrency", finalPrice: 0 }, items: [], eligible: true });
});

router.get("/fortnite/api/storefront/v2/keychain", (req, res) => {
  try { console.log(`[keychain] storefront handler hit url=${req.originalUrl} ua=${req.headers["user-agent"] || ""} ip=${req.ip}`); } catch {}
  return res.json(getKeychain());
});

router.get("/catalog/api/shared/bulk/offers", (req, res) => {
  res.json({});
});

// Manual refresh endpoint (can be used by bot/admin)
router.post("/api/shop/refresh", (req, res) => {
  // simple protection: require gameApiKey header optionally
  const key = req.headers["x-api-key"] || req.query.apiKey;
  if (config.gameApiKey && key && key !== config.gameApiKey) return res.status(403).json({ error: "invalid api key" });
  const cat = generateCatalog();
  res.json({ ok: true, expiration: cat.expiration });
});

module.exports = router;
module.exports.getCatalog = getCatalog;
module.exports.findOffer = findOffer;
module.exports.generateCatalog = generateCatalog;
