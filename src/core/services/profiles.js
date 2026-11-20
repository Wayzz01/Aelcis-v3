const { v4: uuidv4 } = require("uuid");
const Profile = require("../models/Profile");
const config = require("../../shared/utils/config");

function nowIso() { return new Date().toISOString(); }

function baseProfile(profileId, accountId) {
  return {
    profileId,
    profileChanges: [],
    profileRevision: 0,
    profileCommandRevision: 0,
    serverTime: nowIso(),
    responseVersion: 1,
    _accountId: accountId,
  };
}

function defaultAthena(accountId) {
  const season = config.season || 12;
  const loadoutId = "sandbox_loadout";
  const items = {};

  // Default loadout
  items[loadoutId] = {
    templateId: "CosmeticLocker:cosmeticlocker_athena",
    attributes: {
      locker_slots_data: {
        slots: {
          Pickaxe: { items: ["AthenaPickaxe:DefaultPickaxe"], activeVariants: [null] },
          Dance: { items: [null, null, null, null, null, null], activeVariants: [null, null, null, null, null, null] },
          Glider: { items: ["AthenaGlider:DefaultGlider"], activeVariants: [null] },
          Character: { items: ["AthenaCharacter:CID_001_Athena_Commando_F_Default"], activeVariants: [null] },
          Backpack: { items: [null], activeVariants: [null] },
          ItemWrap: { items: [null, null, null, null, null, null, null], activeVariants: [null, null, null, null, null, null, null] },
          LoadingScreen: { items: [null], activeVariants: [null] },
          MusicPack: { items: [null], activeVariants: [null] },
          SkyDiveContrail: { items: [null], activeVariants: [null] },
        }
      },
      use_count: 0,
      banner_icon_template: "StandardBanner",
      banner_color_template: "DefaultColor1",
      locker_name: "alecis-v3",
      item_seen: true,
      favorite: false,
    },
    quantity: 1,
  };

  // Ensure default cosmetics exist as items too (some clients expect them)
  items["AthenaPickaxe:DefaultPickaxe"] = { templateId: "AthenaPickaxe:DefaultPickaxe", attributes: { favorite: false, item_seen: true, level: 1, max_level_bonus: 0, rnd_sel_cnt: 0, variants: [], xp: 0 }, quantity: 1 };
  items["AthenaGlider:DefaultGlider"] = { templateId: "AthenaGlider:DefaultGlider", attributes: { favorite: false, item_seen: true, level: 1, max_level_bonus: 0, rnd_sel_cnt: 0, variants: [], xp: 0 }, quantity: 1 };
  items["AthenaCharacter:CID_001_Athena_Commando_F_Default"] = { templateId: "AthenaCharacter:CID_001_Athena_Commando_F_Default", attributes: { favorite: false, item_seen: true, level: 1, max_level_bonus: 0, rnd_sel_cnt: 0, variants: [], xp: 0 }, quantity: 1 };

  return {
    created: nowIso(),
    updated: nowIso(),
    rvn: 0,
    wipeNumber: 1,
    accountId,
    profileId: "athena",
    version: "alecis_v3_c2s2",
    items,
    stats: {
      attributes: {
        season_match_boost: 0,
        loadouts: [loadoutId],
        active_loadout_index: 0,
        last_applied_loadout: loadoutId,
        rested_xp_overflow: 0,
        mtx_purchase_history: { refundsUsed: 0, refundCredits: 3, purchases: [] },
        last_match_end_datetime: "",
        last_stw_match_end_datetime: "",
        rested_xp_exchange: 1,
        rested_xp_mult: 1,
        rested_xp_cumulative: 0,
        current_mtx_platform: "EpicPC",
        last_xp_interaction: nowIso(),
        favorite_backpack: "",
        favorite_pickaxe: "AthenaPickaxe:DefaultPickaxe",
        favorite_glider: "AthenaGlider:DefaultGlider",
        favorite_skydivecontrail: "",
        favorite_loadingscreen: "",
        favorite_dance: [null, null, null, null, null, null],
        favorite_itemwraps: [null, null, null, null, null, null, null],
        favorite_character: "AthenaCharacter:CID_001_Athena_Commando_F_Default",
        favorite_musicpack: "",
        banner_icon: "StandardBanner",
        banner_color: "DefaultColor1",
        accountLevel: 1,
        level: 1,
        xp: 0,
        xp_overflow: 0,
        book_purchased: false,
        book_level: 1,
        book_xp: 0,
        season_num: season,
        season_update: 0,
        season_friend_match_boost: 0,
        lifetime_wins: 0,
        party_assist_quest: "",
        purchased_battle_pass_tier_offers: [],
        quest_manager: { dailyLoginInterval: nowIso(), dailyQuestRerolls: 1 },
        permissions: [],
        past_seasons: [],
        season: { numWins: 0, numHighBracket: 0, numLowBracket: 0 },
        battlestars: 0,
        battlestars_season_total: 0,
        alien_style_points: 0,
      }
    },
    commandRevision: 0,
  };
}

function defaultCommonCore(accountId) {
  const items = {
    "Currency:MtxPurchased": { templateId: "Currency:MtxPurchased", attributes: { platform: "EpicPC" }, quantity: 1000 },
    "Currency:MtxGiveaway": { templateId: "Currency:MtxGiveaway", attributes: { platform: "EpicPC" }, quantity: 0 },
  };
  return {
    created: nowIso(),
    updated: nowIso(),
    rvn: 0,
    wipeNumber: 1,
    accountId,
    profileId: "common_core",
    version: "alecis_v3",
    items,
    stats: {
      attributes: {
        survey_data: {},
        personal_offers: {},
        intro_game_played: true,
        import_friends_claimed: {},
        mtx_purchase_history: { refundsUsed: 0, refundCredits: 3, purchases: [] },
        undo_cooldowns: [],
        mtx_affiliate_set_time: nowIso(),
        current_mtx_platform: "EpicPC",
        mtx_affiliate: "",
        mtx_affiliate_id: "",
        weekly_purchases: {},
        daily_purchases: {},
        ban_history: {},
        in_app_purchases: {},
        permissions: [],
        undo_timeout: "min",
        monthly_purchases: {},
        allowed_to_send_gifts: true,
        mfa_enabled: false,
        allowed_to_receive_gifts: true,
        gift_history: { sentTo: [], receivedFrom: [], gifts: [] },
      }
    },
    commandRevision: 0,
  };
}

function defaultCommonPublic(accountId) {
  return {
    created: nowIso(),
    updated: nowIso(),
    rvn: 0,
    wipeNumber: 1,
    accountId,
    profileId: "common_public",
    version: "alecis_v3",
    items: {},
    stats: { attributes: { banner_color: "DefaultColor1", banner_icon: "StandardBanner", homebase_name: accountId.slice(0, 8) } },
    commandRevision: 0,
  };
}

function defaultCollections(accountId) {
  return {
    created: nowIso(), updated: nowIso(), rvn: 0, wipeNumber: 1, accountId,
    profileId: "collections", version: "alecis_v3",
    items: {}, stats: { attributes: {} }, commandRevision: 0,
  };
}

function defaultCreative(accountId) {
  return {
    created: nowIso(), updated: nowIso(), rvn: 0, wipeNumber: 1, accountId,
    profileId: "creative", version: "alecis_v3",
    items: {}, stats: { attributes: { last_used_battlelab_file: "", max_island_plots: 50, publish_allowed: true, support_code: "", last_used_plot: "", permissions: [], support_code_id: "", links: {} } },
    commandRevision: 0,
  };
}

function defaultProfile0(accountId) {
  // campaign-like stub
  return {
    created: nowIso(), updated: nowIso(), rvn: 0, wipeNumber: 1, accountId,
    profileId: "profile0", version: "alecis_v3",
    items: {}, stats: { attributes: { mission_alert_redemption_record: {}, rewards_claimed_post_max_level: 0, book_level: 1, book_xp: 0 } },
    commandRevision: 0,
  };
}

const generators = {
  athena: defaultAthena,
  common_core: defaultCommonCore,
  common_public: defaultCommonPublic,
  collections: defaultCollections,
  creative: defaultCreative,
  profile0: defaultProfile0,
};

async function getOrCreateProfile(accountId, profileId) {
  profileId = String(profileId || "athena").toLowerCase();
  let doc = await Profile.findOne({ accountId, profileId });
  if (doc) return doc;

  const gen = generators[profileId];
  if (!gen) {
    // generic empty profile
    const empty = { created: nowIso(), updated: nowIso(), rvn: 0, wipeNumber: 1, accountId, profileId, version: "alecis_v3", items: {}, stats: { attributes: {} }, commandRevision: 0 };
    doc = await Profile.create({ accountId, profileId, data: empty, rvn: 0, commandRevision: 0, updated: new Date() });
    return doc;
  }
  const data = gen(accountId);
  doc = await Profile.create({ accountId, profileId, data, rvn: data.rvn || 0, commandRevision: data.commandRevision || 0, updated: new Date() });
  return doc;
}

async function saveProfile(doc) {
  if (!doc) return;
  doc.updated = new Date();
  if (doc.data) {
    doc.data.updated = nowIso();
    doc.rvn = doc.data.rvn || doc.rvn || 0;
    doc.commandRevision = doc.data.commandRevision || doc.commandRevision || 0;
  }
  await doc.save();
}

function makeProfileChange(profileId, data) {
  return {
    changeType: "fullProfileUpdate",
    profile: data,
  };
}

module.exports = {
  getOrCreateProfile,
  saveProfile,
  makeProfileChange,
  baseProfile,
  generators,
};
