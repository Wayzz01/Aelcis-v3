const { v4: uuidv4 } = require("uuid");
const { getOrCreateProfile, saveProfile } = require("./profiles");
const User = require("../models/User");
const Purchase = require("../models/Purchase");
const config = require("../../shared/utils/config");
const logger = require("../../shared/utils/logger");

function nowIso() { return new Date().toISOString(); }

function bumpRvn(profileDoc) {
  profileDoc.data.rvn = (profileDoc.data.rvn || 0) + 1;
  profileDoc.rvn = profileDoc.data.rvn;
  profileDoc.data.commandRevision = (profileDoc.data.commandRevision || 0) + 1;
  profileDoc.commandRevision = profileDoc.data.commandRevision;
  profileDoc.data.updated = nowIso();
}

function ensureAttr(profileDoc, key, defVal) {
  profileDoc.data.stats = profileDoc.data.stats || {};
  profileDoc.data.stats.attributes = profileDoc.data.stats.attributes || {};
  if (profileDoc.data.stats.attributes[key] === undefined) profileDoc.data.stats.attributes[key] = defVal;
  return profileDoc.data.stats.attributes;
}

function findLoadoutItem(profileDoc) {
  const items = profileDoc.data.items || {};
  const attrs = (profileDoc.data.stats && profileDoc.data.stats.attributes) || {};
  const loadouts = attrs.loadouts || ["sandbox_loadout"];
  const id = loadouts[0] || "sandbox_loadout";
  if (items[id]) return { id, item: items[id] };
  // fallback: find CosmeticLocker
  for (const [k, v] of Object.entries(items)) {
    if (v && typeof v.templateId === "string" && v.templateId.startsWith("CosmeticLocker:")) return { id: k, item: v };
  }
  return null;
}

function ensureMtxItem(coreDoc) {
  coreDoc.data.items = coreDoc.data.items || {};
  if (!coreDoc.data.items["Currency:MtxPurchased"]) {
    coreDoc.data.items["Currency:MtxPurchased"] = { templateId: "Currency:MtxPurchased", attributes: { platform: "EpicPC" }, quantity: 0 };
  }
  return coreDoc.data.items["Currency:MtxPurchased"];
}

function getTotalMtx(coreDoc) {
  coreDoc.data.items = coreDoc.data.items || {};
  let total = 0;
  for (const [k, v] of Object.entries(coreDoc.data.items)) {
    if (k.toLower().startsWith("currency:mtx")) total += (v.quantity || 0);
  }
  return total;
}

function deductMtx(coreDoc, amount) {
  let remaining = amount;
  const order = ["Currency:MtxPurchased", "Currency:MtxGiveaway", "Currency:MtxPurchaseBonus"];
  coreDoc.data.items = coreDoc.data.items || {};
  for (const key of order) {
    const it = coreDoc.data.items[key];
    if (!it || remaining <= 0) continue;
    const take = Math.min(it.quantity || 0, remaining);
    it.quantity = (it.quantity || 0) - take;
    remaining -= take;
  }
  // if still remaining, try any mtx
  if (remaining > 0) {
    for (const [k, v] of Object.entries(coreDoc.data.items)) {
      if (!k.toLowerCase().startsWith("currency:mtx") || remaining <= 0) continue;
      const take = Math.min(v.quantity || 0, remaining);
      v.quantity = (v.quantity || 0) - take;
      remaining -= take;
    }
  }
  return remaining <= 0;
}

function addMtx(coreDoc, amount) {
  const it = ensureMtxItem(coreDoc);
  it.quantity = (it.quantity || 0) + amount;
}

function grantItem(profileDoc, templateId, quantity = 1, attributes = {}) {
  profileDoc.data.items = profileDoc.data.items || {};
  // check if cosmetic already exists (athena cosmetics are usually unique by templateId)
  if (profileDoc.data.profileId === "athena") {
    for (const [k, v] of Object.entries(profileDoc.data.items)) {
      if (v && v.templateId && v.templateId.toLowerCase() === String(templateId).toLowerCase()) {
        // already owned, maybe increase quantity if stackable; cosmetics usually not
        return { itemId: k, existed: true };
      }
    }
  }
  const itemId = `${templateId}:${uuidv4().replace(/-/g, "")}`;
  profileDoc.data.items[itemId] = {
    templateId,
    attributes: Object.assign({ favorite: false, item_seen: false, level: 1, max_level_bonus: 0, rnd_sel_cnt: 0, variants: [], xp: 0 }, attributes),
    quantity,
  };
  return { itemId, existed: false };
}

function grantToProfile(profileDoc, templateId, quantity = 1, attributes = {}) {
  if (String(templateId).toLowerCase().startsWith("currency:mtx")) {
    if (profileDoc.data.profileId === "common_core") {
      profileDoc.data.items = profileDoc.data.items || {};
      const key = templateId; // e.g. Currency:MtxPurchased
      if (!profileDoc.data.items[key]) profileDoc.data.items[key] = { templateId: key, attributes: { platform: "EpicPC" }, quantity: 0 };
      profileDoc.data.items[key].quantity += quantity;
      return { itemId: key, existed: true };
    }
  }
  return grantItem(profileDoc, templateId, quantity, attributes);
}

async function applyCommand(accountId, profileId, command, body = {}, query = {}) {
  const doc = await getOrCreateProfile(accountId, profileId);
  const rvn = parseInt(query.rvn || body.rvn || -1, 10);
  // basic rvn check tolerance
  const profileChanges = [];
  let notifications = [];
  let multiUpdate = null;

  switch (command) {
    case "QueryProfile": {
      profileChanges.push({ changeType: "fullProfileUpdate", profile: doc.data });
      break;
    }
    case "ClientQuestLogin": {
      if (profileId === "athena") {
        try {
          const { applyQuestsToAthena } = require("./quests");
          await applyQuestsToAthena(doc);
        } catch (e) { logger.debug("Quest init error", e.message); }
      }
      bumpRvn(doc);
      await saveProfile(doc);
      profileChanges.push({ changeType: "fullProfileUpdate", profile: doc.data });
      break;
    }
    case "SetMtxPlatform": {
      ensureAttr(doc, "current_mtx_platform", body.platform || "EpicPC");
      bumpRvn(doc);
      await saveProfile(doc);
      profileChanges.push({ changeType: "fullProfileUpdate", profile: doc.data });
      break;
    }
    case "MarkItemSeen": {
      const ids = body.itemIds || [];
      doc.data.items = doc.data.items || {};
      for (const id of ids) {
        if (doc.data.items[id]) {
          doc.data.items[id].attributes = doc.data.items[id].attributes || {};
          doc.data.items[id].attributes.item_seen = true;
        }
      }
      bumpRvn(doc);
      await saveProfile(doc);
      profileChanges.push({ changeType: "fullProfileUpdate", profile: doc.data });
      break;
    }
    case "SetItemFavoriteStatus": {
      const { targetItemId, bFavorite } = body;
      if (doc.data.items && doc.data.items[targetItemId]) {
        doc.data.items[targetItemId].attributes = doc.data.items[targetItemId].attributes || {};
        doc.data.items[targetItemId].attributes.favorite = !!bFavorite;
      }
      bumpRvn(doc);
      await saveProfile(doc);
      profileChanges.push({ changeType: "fullProfileUpdate", profile: doc.data });
      break;
    }
    case "SetItemFavoriteStatusBatch": {
      const ids = body.itemIds || [];
      const fav = !!body.itemFavStatus;
      doc.data.items = doc.data.items || {};
      for (const id of ids) {
        if (doc.data.items[id]) {
          doc.data.items[id].attributes = doc.data.items[id].attributes || {};
          doc.data.items[id].attributes.favorite = fav;
        }
      }
      bumpRvn(doc);
      await saveProfile(doc);
      profileChanges.push({ changeType: "fullProfileUpdate", profile: doc.data });
      break;
    }
    case "SetCosmeticLockerBanner": {
      const loadout = findLoadoutItem(doc);
      if (loadout) {
        loadout.item.attributes = loadout.item.attributes || {};
        if (body.bannerIconTemplateName) {
          loadout.item.attributes.banner_icon_template = body.bannerIconTemplateName;
          ensureAttr(doc, "banner_icon", body.bannerIconTemplateName);
        }
        if (body.bannerColorTemplateName) {
          loadout.item.attributes.banner_color_template = body.bannerColorTemplateName;
          ensureAttr(doc, "banner_color", body.bannerColorTemplateName);
        }
      }
      bumpRvn(doc);
      await saveProfile(doc);
      profileChanges.push({ changeType: "fullProfileUpdate", profile: doc.data });
      break;
    }
    case "SetBattleRoyaleBanner": {
      // also used in some contexts
      const attrs = ensureAttr(doc, "banner_icon", "StandardBanner");
      if (body.homebaseBannerIconId) attrs.banner_icon = body.homebaseBannerIconId;
      if (body.homebaseBannerColorId) attrs.banner_color = body.homebaseBannerColorId;
      bumpRvn(doc);
      await saveProfile(doc);
      profileChanges.push({ changeType: "fullProfileUpdate", profile: doc.data });
      break;
    }
    case "EquipBattleRoyaleCustomization": {
      const slotName = body.slotName; // Character, Backpack, Pickaxe, Glider, etc.
      const itemToSlot = body.itemToSlot || ""; // templateId or itemId
      const indexWithinSlot = body.indexWithinSlot || 0;
      const variantUpdates = body.variantUpdates || [];
      const loadout = findLoadoutItem(doc);
      const attrs = ensureAttr(doc, "favorite_character", "");

      if (loadout) {
        loadout.item.attributes = loadout.item.attributes || {};
        loadout.item.attributes.locker_slots_data = loadout.item.attributes.locker_slots_data || { slots: {} };
        const slots = loadout.item.attributes.locker_slots_data.slots;
        if (!slots[slotName]) {
          slots[slotName] = { items: [null], activeVariants: [null] };
        }
        const slot = slots[slotName];
        // normalize array length for multi-slot categories
        if (Array.isArray(slot.items)) {
          while (slot.items.length <= indexWithinSlot) slot.items.push(null);
          if (!Array.isArray(slot.activeVariants)) slot.activeVariants = slot.items.map(() => null);
          while (slot.activeVariants.length <= indexWithinSlot) slot.activeVariants.push(null);
          slot.items[indexWithinSlot] = itemToSlot || null;
          if (variantUpdates.length) slot.activeVariants[indexWithinSlot] = variantUpdates;
        } else {
          slot.items = [itemToSlot || null];
          slot.activeVariants = [variantUpdates.length ? variantUpdates : null];
        }

        // also update favorite_* stats for convenience
        const favKeyMap = {
          Character: "favorite_character",
          Backpack: "favorite_backpack",
          Pickaxe: "favorite_pickaxe",
          Glider: "favorite_glider",
          SkyDiveContrail: "favorite_skydivecontrail",
          MusicPack: "favorite_musicpack",
          LoadingScreen: "favorite_loadingscreen",
        };
        if (favKeyMap[slotName] && indexWithinSlot === 0) {
          attrs[favKeyMap[slotName]] = itemToSlot || "";
        }
        if (slotName === "Dance") {
          const dances = slots.Dance.items.slice(0, 6);
          while (dances.length < 6) dances.push(null);
          attrs.favorite_dance = dances;
        }
        if (slotName === "ItemWrap") {
          const wraps = slots.ItemWrap.items.slice(0, 7);
          while (wraps.length < 7) wraps.push(null);
          attrs.favorite_itemwraps = wraps;
        }

        // apply style variants to the owned item if present
        if (itemToSlot && variantUpdates.length) {
          const target = doc.data.items[itemToSlot] || Object.values(doc.data.items || {}).find(i => i.templateId === itemToSlot);
          if (target) {
            target.attributes = target.attributes || {};
            target.attributes.variants = variantUpdates;
          }
        }
      }
      bumpRvn(doc);
      await saveProfile(doc);
      profileChanges.push({ changeType: "fullProfileUpdate", profile: doc.data });
      break;
    }
    case "SetCosmeticLockerSlot": {
      // Newer naming, similar to EquipBattleRoyaleCustomization
      const category = body.category;
      const itemToSlot = body.itemToSlot || "";
      const slotIndex = body.slotIndex || 0;
      const variantUpdates = body.variantUpdates || [];
      const loadout = findLoadoutItem(doc);
      const attrs = ensureAttr(doc, "favorite_character", "");

      if (loadout && category) {
        loadout.item.attributes = loadout.item.attributes || {};
        loadout.item.attributes.locker_slots_data = loadout.item.attributes.locker_slots_data || { slots: {} };
        const slots = loadout.item.attributes.locker_slots_data.slots;
        if (!slots[category]) slots[category] = { items: [null], activeVariants: [null] };
        const slot = slots[category];
        if (!Array.isArray(slot.items)) slot.items = [slot.items];
        if (!Array.isArray(slot.activeVariants)) slot.activeVariants = slot.items.map(() => null);
        while (slot.items.length <= slotIndex) slot.items.push(null);
        while (slot.activeVariants.length <= slotIndex) slot.activeVariants.push(null);
        slot.items[slotIndex] = itemToSlot || null;
        if (variantUpdates.length) slot.activeVariants[slotIndex] = variantUpdates;

        const favKeyMap = {
          Character: "favorite_character",
          Backpack: "favorite_backpack",
          Pickaxe: "favorite_pickaxe",
          Glider: "favorite_glider",
          SkyDiveContrail: "favorite_skydivecontrail",
          MusicPack: "favorite_musicpack",
          LoadingScreen: "favorite_loadingscreen",
        };
        if (favKeyMap[category] && slotIndex === 0) {
          attrs[favKeyMap[category]] = itemToSlot || "";
        }
        if (category === "Dance") {
          const dances = (slots.Dance.items || []).slice(0, 6);
          while (dances.length < 6) dances.push(null);
          attrs.favorite_dance = dances;
        }
        if (category === "ItemWrap") {
          const wraps = (slots.ItemWrap.items || []).slice(0, 7);
          while (wraps.length < 7) wraps.push(null);
          attrs.favorite_itemwraps = wraps;
        }

        if (itemToSlot && variantUpdates.length) {
          const target = doc.data.items[itemToSlot] || Object.values(doc.data.items || {}).find(i => i.templateId === itemToSlot);
          if (target) {
            target.attributes = target.attributes || {};
            target.attributes.variants = variantUpdates;
          }
        }
      }
      bumpRvn(doc);
      await saveProfile(doc);
      profileChanges.push({ changeType: "fullProfileUpdate", profile: doc.data });
      break;
    }
    case "SetCosmeticLockerName": {
      const loadout = findLoadoutItem(doc);
      if (loadout && body.lockerName) {
        loadout.item.attributes = loadout.item.attributes || {};
        loadout.item.attributes.locker_name = body.lockerName;
      }
      bumpRvn(doc);
      await saveProfile(doc);
      profileChanges.push({ changeType: "fullProfileUpdate", profile: doc.data });
      break;
    }
    case "CopyCosmeticLoadout": {
      // simple stub - accept request
      profileChanges.push({ changeType: "fullProfileUpdate", profile: doc.data });
      break;
    }
    case "ClaimMfaEnabled": {
      ensureAttr(doc, "mfa_reward_claimed", true);
      bumpRvn(doc);
      await saveProfile(doc);
      profileChanges.push({ changeType: "fullProfileUpdate", profile: doc.data });
      break;
    }
    case "SetAffiliateName": {
      // SAC / Support-A-Creator
      if (profileId === "common_core") {
        const code = (body.affiliateName || "").toLowerCase().trim();
        const attrs = ensureAttr(doc, "mtx_affiliate", "");
        attrs.mtx_affiliate = code;
        attrs.mtx_affiliate_id = code;
        attrs.mtx_affiliate_set_time = nowIso();
        // also store on user if exists
        try {
          await User.findOneAndUpdate({ accountId }, { supportedCreator: code || null });
        } catch {}
      }
      bumpRvn(doc);
      await saveProfile(doc);
      profileChanges.push({ changeType: "fullProfileUpdate", profile: doc.data });
      break;
    }
    case "PurchaseCatalogEntry": {
      // Commonly called on common_core
      const offerId = body.offerId;
      const purchaseQuantity = body.purchaseQuantity || 1;
      const expectedTotalPrice = body.expectedTotalPrice || 0;
      const currency = body.currency || "MtxCurrency";
      const currencySubType = body.currencySubType || "";
      const receiverAccountIds = body.receiverAccountIds || [];
      const isGift = Array.isArray(receiverAccountIds) && receiverAccountIds.length > 0;

      // lazy require to avoid circular deps
      let findOffer;
      try { ({ findOffer } = require("../../api/routes/storefront")); } catch { findOffer = () => null; }
      let offer = findOffer ? findOffer(offerId) : null;
      if (!offer) {
        // fallback synthetic offer for direct template grants? not expected
        offer = { offerId, itemGrants: [], prices: [{ finalPrice: expectedTotalPrice || 0, currencyType: currency }] };
      }
      const price = (offer.prices && offer.prices[0] && offer.prices[0].finalPrice) || 0;
      const totalPrice = price * purchaseQuantity;

      const coreDoc = profileId === "common_core" ? doc : await getOrCreateProfile(accountId, "common_core");
      const athenaDoc = await getOrCreateProfile(isGift ? receiverAccountIds[0] : accountId, "athena");

      // Deduct V-Bucks from purchaser
      if (currency === "MtxCurrency") {
        const ok = deductMtx(coreDoc, totalPrice);
        if (!ok) {
          return {
            profileRevision: coreDoc.data.rvn || 0,
            profileId: coreDoc.data.profileId,
            profileChangesBaseRevision: coreDoc.data.rvn || 0,
            profileChanges: [{ changeType: "fullProfileUpdate", profile: coreDoc.data }],
            profileCommandRevision: coreDoc.data.commandRevision || 0,
            serverTime: nowIso(),
            multiUpdate: null,
            notifications: [],
            responseVersion: 1,
          };
        }
      }

      // Record purchase history
      const coreAttrs = ensureAttr(coreDoc, "mtx_purchase_history", { refundsUsed: 0, refundCredits: 3, purchases: [] });
      if (!coreAttrs.mtx_purchase_history) coreAttrs.mtx_purchase_history = { refundsUsed: 0, refundCredits: 3, purchases: [] };
      const purchaseId = uuidv4().replace(/-/g, "");
      const lootResult = [];

      // Special offers: battle pass, bundle, tier
      let bpIds = {};
      let isBattlePassPurchase = false;
      try {
        const bpSeason0 = config.features.battlePassSeason || config.season || 12;
        const bp = require("./battlepass").loadBattlePass(bpSeason0) || {};
        bpIds = { pass: String(bp.battlePassOfferId || "").toLowerCase(), bundle: String(bp.battleBundleOfferId || "").toLowerCase(), tier: String(bp.tierOfferId || "").toLowerCase() };
      } catch {}
      const offerIdLower = String(offerId || "").toLowerCase();
      const devNameLower = String(offer.devName || "").toLowerCase();
      if (offerId === "battlepass" || offerIdLower === bpIds.pass || devNameLower.includes("battlepass.01")) {
        isBattlePassPurchase = true;
        const aAttrs = ensureAttr(athenaDoc, "book_purchased", false);
        const bpSeason = config.features.battlePassSeason || config.season || 12;
        const oldLevel = aAttrs.book_level || 1;
        aAttrs.book_purchased = true;
        aAttrs.book_level = oldLevel;
        aAttrs.season_num = bpSeason;
        try {
          // Reload-like: add NoBattleBundleOption token to common_core
          coreDoc.data.items = coreDoc.data.items || {};
          const tokenKey = `Token:Athena_S${bpSeason}_NoBattleBundleOption_Token`;
          if (!coreDoc.data.items[tokenKey]) {
            coreDoc.data.items[tokenKey] = {
              templateId: `Token:athena_s${bpSeason}_nobattlebundleoption_token`,
              attributes: { max_level_bonus: 0, level: 1, item_seen: true, xp: 0, favorite: false },
              quantity: 1,
            };
          }
        } catch {}
        try {
          const { grantTierRewards } = require("./battlepass");
          // Grant all free+paid rewards up to current level on purchase (includes boosts/tokens defined in BP data)
          const bpLoot = grantTierRewards({ season: bpSeason, fromTier: 1, toTier: aAttrs.book_level, includeFree: true, includePaid: true, athenaDoc, coreDoc });
          lootResult.push(...bpLoot);
        } catch (e) { logger.debug("Battle pass grant error", e && e.message ? e.message : e); }
        try {
          // Reload-like gift box in common_core for purchase presentation
          const giftBoxId = uuidv4().replace(/-/g, "");
          coreDoc.data.items = coreDoc.data.items || {};
          coreDoc.data.items[giftBoxId] = {
            templateId: "GiftBox:gb_battlepasspurchased",
            attributes: {
              max_level_bonus: 0,
              fromAccountId: "",
              lootList: lootResult.map(l => ({ itemType: l.itemType, itemGuid: l.itemGuid || l.itemType, quantity: l.quantity || 1 })),
            },
            quantity: 1,
          };
        } catch {}
      } else if (offerId === "battlepassbundle" || offerIdLower === bpIds.bundle || devNameLower.includes("battlebundle")) {
        isBattlePassPurchase = true;
        const aAttrs = ensureAttr(athenaDoc, "book_purchased", false);
        const bpSeason = config.features.battlePassSeason || config.season || 12;
        const oldLevel = aAttrs.book_level || 1;
        aAttrs.book_purchased = true;
        aAttrs.book_level = Math.max(oldLevel, 26); // 1 + 25 tiers
        aAttrs.season_num = bpSeason;
        try {
          coreDoc.data.items = coreDoc.data.items || {};
          const tokenKey = `Token:Athena_S${bpSeason}_NoBattleBundleOption_Token`;
          if (!coreDoc.data.items[tokenKey]) {
            coreDoc.data.items[tokenKey] = {
              templateId: `Token:athena_s${bpSeason}_nobattlebundleoption_token`,
              attributes: { max_level_bonus: 0, level: 1, item_seen: true, xp: 0, favorite: false },
              quantity: 1,
            };
          }
        } catch {}
        try {
          const { grantTierRewards } = require("./battlepass");
          const bpLoot = grantTierRewards({ season: bpSeason, fromTier: 1, toTier: aAttrs.book_level, includeFree: true, includePaid: true, athenaDoc, coreDoc });
          lootResult.push(...bpLoot);
        } catch (e) { logger.debug("Battle bundle grant error", e && e.message ? e.message : e); }
        try {
          const giftBoxId = uuidv4().replace(/-/g, "");
          coreDoc.data.items = coreDoc.data.items || {};
          coreDoc.data.items[giftBoxId] = {
            templateId: "GiftBox:gb_battlepasspurchased",
            attributes: {
              max_level_bonus: 0,
              fromAccountId: "",
              lootList: lootResult.map(l => ({ itemType: l.itemType, itemGuid: l.itemGuid || l.itemType, quantity: l.quantity || 1 })),
            },
            quantity: 1,
          };
        } catch {}
      } else if (offerId === "battlestartier" || offerIdLower === bpIds.tier || devNameLower.includes("singletier")) {
        isBattlePassPurchase = true;
        const aAttrs = ensureAttr(athenaDoc, "book_level", 1);
        const bpSeason = config.features.battlePassSeason || config.season || 12;
        const oldLevel = aAttrs.book_level || 1;
        const newLevel = Math.min(oldLevel + (purchaseQuantity || 1), 100);
        aAttrs.book_level = newLevel;
        aAttrs.season_num = bpSeason;
        try {
          const { grantTierRewards } = require("./battlepass");
          // Grant rewards for newly unlocked tiers; include paid rewards only if battle pass owned
          const includePaid = !!aAttrs.book_purchased;
          if (newLevel >= oldLevel + 1) {
            const bpLoot = grantTierRewards({ season: bpSeason, fromTier: oldLevel + 1, toTier: newLevel, includeFree: true, includePaid, athenaDoc, coreDoc });
            lootResult.push(...bpLoot);
          }
        } catch (e) { logger.debug("Battle tier grant error", e && e.message ? e.message : e); }
        try {
          const giftBoxId = uuidv4().replace(/-/g, "");
          coreDoc.data.items = coreDoc.data.items || {};
          coreDoc.data.items[giftBoxId] = {
            templateId: "GiftBox:gb_battlepass",
            attributes: {
              max_level_bonus: 0,
              fromAccountId: "",
              lootList: lootResult.map(l => ({ itemType: l.itemType, itemGuid: l.itemGuid || l.itemType, quantity: l.quantity || 1 })),
            },
            quantity: 1,
          };
        } catch {}
      } else {
        // Regular item grants -> athena or common_core depending on template
        const targetAthena = isGift ? athenaDoc : (profileId === "athena" ? doc : athenaDoc);
        for (const grant of (offer.itemGrants || [])) {
          const templateId = grant.templateId;
          const qty = grant.quantity || 1;
          if (String(templateId).toLowerCase().startsWith("currency:mtx")) {
            grantToProfile(coreDoc, templateId, qty);
            lootResult.push({ itemType: templateId, itemGuid: templateId, itemProfile: "common_core", quantity: qty });
          } else if (templateId.startsWith("Athena") || templateId.startsWith("Cosmetic") || templateId.startsWith("Token:athena")) {
            const gr = grantToProfile(targetAthena, templateId, qty);
            lootResult.push({ itemType: templateId, itemGuid: gr.itemId || templateId, itemProfile: "athena", quantity: qty });
          } else {
            const gr = grantToProfile(coreDoc, templateId, qty);
            lootResult.push({ itemType: templateId, itemGuid: gr.itemId || templateId, itemProfile: "common_core", quantity: qty });
          }
        }
      }

      // SAC reward to creator on purchase (simple implementation)
      try {
        const purchaser = await User.findOne({ accountId });
        if (purchaser && purchaser.supportedCreator && config.sac && config.sac.enabled) {
          const sac = await require("../models/SacCode").findOne({ code: purchaser.supportedCreator, active: true });
          if (sac && sac.ownerAccountId && sac.ownerAccountId !== accountId) {
            const reward = (config.sac.creatorVbucksReward || 5);
            sac.totalUses = (sac.totalUses || 0) + 1;
            sac.totalEarnings = (sac.totalEarnings || 0) + reward;
            await sac.save();
            // credit creator: if online in DB profile
            const creatorCore = await getOrCreateProfile(sac.ownerAccountId, "common_core");
            addMtx(creatorCore, reward);
            bumpRvn(creatorCore);
            await saveProfile(creatorCore);
            await User.findOneAndUpdate({ accountId: sac.ownerAccountId }, { $inc: { sacEarnings: reward } });
          }
        }
      } catch (e) { /* non-fatal */ }

      const purchaseRecord = {
        purchaseId,
        offerId: offer.offerId || offerId,
        purchaseDate: nowIso(),
        freeRefundEligible: offer.refundable !== false,
        fulfillments: [],
        lootResult,
        totalMtxPaid: totalPrice,
        metadata: {},
        gameContext: "",
      };
      coreAttrs.mtx_purchase_history.purchases.push(purchaseRecord);

      // Gift history
      if (isGift) {
        coreAttrs.gift_history = coreAttrs.gift_history || { sentTo: [], receivedFrom: [], gifts: [] };
        coreAttrs.gift_history.sentTo.push(receiverAccountIds[0]);
        coreAttrs.gift_history.gifts.push({ giftId: purchaseId, offerId, toAccountId: receiverAccountIds[0], date: nowIso() });
      }

      // Save purchases
      try {
        await Purchase.create({
          accountId,
          offerId: offer.offerId || offerId,
          itemGrants: (offer.itemGrants || []).map(g => g.templateId),
          price: totalPrice,
          currency,
          refunded: false,
          purchaseDate: new Date(),
          metadata: { purchaseId, receiverAccountIds, lootResult },
        });
      } catch {}

      bumpRvn(coreDoc);
      await saveProfile(coreDoc);
      if (athenaDoc !== doc && athenaDoc !== coreDoc) { bumpRvn(athenaDoc); await saveProfile(athenaDoc); }

      // Build notifications / response per Fortnite expectations
      const changes = [{ changeType: "fullProfileUpdate", profile: coreDoc.data }];
      const multi = [];
      if (athenaDoc._id && String(athenaDoc.accountId) === String(isGift ? receiverAccountIds[0] : accountId)) {
        multi.push({ profileRevision: athenaDoc.data.rvn || 0, profileId: "athena", profileChangesBaseRevision: (athenaDoc.data.rvn || 1) - 1, profileChanges: [{ changeType: "fullProfileUpdate", profile: athenaDoc.data }], profileCommandRevision: athenaDoc.data.commandRevision || 0 });
      }

      if (!isBattlePassPurchase) {
        notifications.push({
          type: "CatalogPurchase",
          primary: true,
          lootResult: { items: lootResult.map(l => ({ itemType: l.itemType, itemGuid: l.itemGuid, itemProfile: l.itemProfile, quantity: l.quantity })) },
        });
      }

      return {
        profileRevision: coreDoc.data.rvn || 0,
        profileId: coreDoc.data.profileId,
        profileChangesBaseRevision: (coreDoc.data.rvn || 1) - 1,
        profileChanges: changes,
        profileCommandRevision: coreDoc.data.commandRevision || 0,
        serverTime: nowIso(),
        multiUpdate: multi.length ? multi : null,
        notifications,
        responseVersion: 1,
      };
    }
    case "RefundMtxPurchase": {
      // Refund last eligible purchase or by purchaseId
      const purchaseId = body.purchaseId;
      const coreDoc = profileId === "common_core" ? doc : await getOrCreateProfile(accountId, "common_core");
      const attrs = ensureAttr(coreDoc, "mtx_purchase_history", { refundsUsed: 0, refundCredits: 3, purchases: [] });
      const hist = attrs.mtx_purchase_history || { refundsUsed: 0, refundCredits: 3, purchases: [] };
      attrs.mtx_purchase_history = hist;
      if ((hist.refundCredits || 0) <= 0) {
        profileChanges.push({ changeType: "fullProfileUpdate", profile: coreDoc.data });
        break;
      }
      let purchase = null;
      if (purchaseId) purchase = hist.purchases.find(p => p.purchaseId === purchaseId && p.freeRefundEligible);
      if (!purchase) purchase = [...hist.purchases].reverse().find(p => p.freeRefundEligible && !p.refunded);
      if (purchase) {
        purchase.freeRefundEligible = false;
        purchase.refunded = true;
        hist.refundsUsed = (hist.refundsUsed || 0) + 1;
        hist.refundCredits = Math.max(0, (hist.refundCredits || 0) - 1);
        addMtx(coreDoc, purchase.totalMtxPaid || 0);
        // remove granted items from athena if possible
        try {
          const athenaDoc = await getOrCreateProfile(accountId, "athena");
          let changed = false;
          for (const lr of (purchase.lootResult || [])) {
            if (lr.itemProfile === "athena" && lr.itemGuid && athenaDoc.data.items[lr.itemGuid]) {
              delete athenaDoc.data.items[lr.itemGuid];
              changed = true;
            }
          }
          if (changed) { bumpRvn(athenaDoc); await saveProfile(athenaDoc); }
          await Purchase.updateOne({ "metadata.purchaseId": purchase.purchaseId }, { $set: { refunded: true, refundDate: new Date() } });
        } catch {}
      }
      bumpRvn(coreDoc);
      await saveProfile(coreDoc);
      profileChanges.push({ changeType: "fullProfileUpdate", profile: coreDoc.data });
      break;
    }
    case "FortRerollDailyQuest": {
      if (profileId === "athena") {
        try {
          const { rerollDaily, applyQuestsToAthena } = require("./quests");
          await rerollDaily(accountId, body.questId || body.questToReroll || "");
          await applyQuestsToAthena(doc);
        } catch (e) { logger.debug("Reroll error", e.message); }
      }
      bumpRvn(doc);
      await saveProfile(doc);
      profileChanges.push({ changeType: "fullProfileUpdate", profile: doc.data });
      break;
    }
    case "AbandonDailyQuest": {
      if (profileId === "athena") {
        const questId = body.questId || body.dailyQuestId;
        if (questId && doc.data.items && doc.data.items[questId]) {
          delete doc.data.items[questId];
        }
      }
      bumpRvn(doc);
      await saveProfile(doc);
      profileChanges.push({ changeType: "fullProfileUpdate", profile: doc.data });
      break;
    }
    case "SetPartyAssistQuest": {
      const attrs = ensureAttr(doc, "party_assist_quest", "");
      attrs.party_assist_quest = body.questToPinAsPartyAssist || body.questId || "";
      bumpRvn(doc);
      await saveProfile(doc);
      profileChanges.push({ changeType: "fullProfileUpdate", profile: doc.data });
      break;
    }
    case "RefreshExpeditions":
    case "MarkNewQuestNotificationSent":
    default: {
      logger.debug(`MCP command ${command} for profile ${profileId} (default handling)`);
      profileChanges.push({ changeType: "fullProfileUpdate", profile: doc.data });
      break;
    }
  }

  return {
    profileRevision: doc.data.rvn || 0,
    profileId,
    profileChangesBaseRevision: (doc.data.rvn || 1) - 1,
    profileChanges,
    profileCommandRevision: doc.data.commandRevision || 0,
    serverTime: nowIso(),
    multiUpdate,
    notifications,
    responseVersion: 1,
  };
}

module.exports = {
  applyCommand,
  bumpRvn,
  ensureAttr,
  findLoadoutItem,
  getTotalMtx,
  deductMtx,
  addMtx,
  grantToProfile,
  grantItem,
};
