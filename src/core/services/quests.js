const { v4: uuidv4 } = require("uuid");
const Quest = require("../models/Quest");
const config = require("../../shared/utils/config");

function dayKey() {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,"0")}-${String(d.getUTCDate()).padStart(2,"0")}`;
}

const DAILY_POOL = [
  { templateId: "Quest:Quest_BR_Damage_Player", desc: "Deal damage to players", objective: "damage_players", target: 500, xp: 14000 },
  { templateId: "Quest:Quest_BR_Eliminate", desc: "Eliminate opponents", objective: "eliminations", target: 3, xp: 14000 },
  { templateId: "Quest:Quest_BR_Interact_Chests", desc: "Search chests", objective: "search_chests", target: 7, xp: 14000 },
  { templateId: "Quest:Quest_BR_Interact_AmmoBox", desc: "Search ammo boxes", objective: "search_ammo", target: 7, xp: 14000 },
  { templateId: "Quest:Quest_BR_Visit_NamedLocations", desc: "Visit named locations", objective: "visit_locations", target: 5, xp: 14000 },
  { templateId: "Quest:Quest_BR_Play_Matches", desc: "Play matches", objective: "play_matches", target: 3, xp: 14000 },
  { templateId: "Quest:Quest_BR_Collect_Materials", desc: "Collect materials", objective: "collect_materials", target: 500, xp: 14000 },
];

const WEEKLY_POOL = [
  { templateId: "Quest:Quest_BR_S12_W1_Elims", desc: "Season 12 Week 1: Eliminations", objective: "w1_elims", target: 10, xp: 40000 },
  { templateId: "Quest:Quest_BR_S12_W1_Chests", desc: "Season 12 Week 1: Search chests", objective: "w1_chests", target: 10, xp: 40000 },
  { templateId: "Quest:Quest_BR_S12_W1_Damage", desc: "Season 12 Week 1: Deal damage", objective: "w1_damage", target: 1000, xp: 40000 },
  { templateId: "Quest:Quest_BR_S12_W2_Elims", desc: "Season 12 Week 2: Eliminations", objective: "w2_elims", target: 10, xp: 40000 },
  { templateId: "Quest:Quest_BR_S12_W2_Visit", desc: "Season 12 Week 2: Visit locations", objective: "w2_visit", target: 5, xp: 40000 },
  { templateId: "Quest:Quest_BR_S12_W3_Ammo", desc: "Season 12 Week 3: Search ammo boxes", objective: "w3_ammo", target: 10, xp: 40000 },
];

function pickRandom(arr, n) {
  const copy = [...arr];
  const out = [];
  while (out.length < n && copy.length) {
    const i = Math.floor(Math.random() * copy.length);
    out.push(copy.splice(i, 1)[0]);
  }
  return out;
}

async function ensureDailyQuests(accountId) {
  const keyBase = `daily:${dayKey()}`;
  const existing = await Quest.find({ accountId, questKey: new RegExp(`^${keyBase}`), type: "daily" }).lean();
  if (existing.length >= 3) return existing;

  // clear old dailies for today key variants? keep simple: create missing
  const picked = pickRandom(DAILY_POOL, 3);
  const created = [];
  for (let i = 0; i < picked.length; i++) {
    const p = picked[i];
    const questKey = `${keyBase}:${i}`;
    const doc = await Quest.findOneAndUpdate(
      { accountId, questKey },
      {
        $setOnInsert: {
          accountId,
          questKey,
          templateId: `${p.templateId}_${dayKey().replace(/-/g, "")}_${i}`,
          type: "daily",
          season: config.season || 12,
          objectives: { [p.objective]: p.target },
          progress: { [p.objective]: 0 },
          completed: false,
          claimed: false,
          xpReward: p.xp,
          expiresAt: new Date(Date.now() + 24 * 3600 * 1000),
          rerolled: false,
        }
      },
      { upsert: true, new: true }
    ).lean();
    created.push(doc);
  }
  return created;
}

async function ensureWeeklyQuests(accountId) {
  const season = config.season || 12;
  const existing = await Quest.find({ accountId, type: "weekly", season }).lean();
  if (existing.length > 0) return existing;
  const created = [];
  for (let i = 0; i < WEEKLY_POOL.length; i++) {
    const p = WEEKLY_POOL[i];
    const questKey = `weekly:${season}:${i}`;
    const doc = await Quest.findOneAndUpdate(
      { accountId, questKey },
      {
        $setOnInsert: {
          accountId, questKey,
          templateId: p.templateId,
          type: "weekly",
          season,
          objectives: { [p.objective]: p.target },
          progress: { [p.objective]: 0 },
          completed: false, claimed: false, xpReward: p.xp, rerolled: false,
        }
      },
      { upsert: true, new: true }
    ).lean();
    created.push(doc);
  }
  return created;
}

function questItemFromDoc(q) {
  return {
    templateId: q.templateId,
    attributes: {
      quest_state: q.completed ? "Claimed" : "Active",
      creation_time: new Date().toISOString(),
      level: -1,
      item_seen: false,
      playlists: [],
      sent_new_notification: true,
      challenge_bundle_id: "",
      xp_reward_scalar: 1,
      challenge_linked_quest_given: "",
      quest_pool: "",
      bucket: "",
      last_state_change_time: new Date().toISOString(),
      challenge_linked_quest_parent: "",
      max_level_bonus: 0,
      xp: 0,
      quest_rarity: "uncommon",
      favorite: false,
      ...Object.keys(q.objectives || {}).reduce((acc, k) => {
        acc[`completion_${k}`] = (q.progress || {})[k] || 0;
        return acc;
      }, {}),
    },
    quantity: 1,
  };
}

async function applyQuestsToAthena(athenaDoc) {
  const accountId = athenaDoc.data.accountId || athenaDoc.accountId;
  const dailies = await ensureDailyQuests(accountId);
  const weeklies = await ensureWeeklyQuests(accountId);
  athenaDoc.data.items = athenaDoc.data.items || {};
  const all = [...dailies, ...weeklies];
  for (const q of all) {
    const itemId = `Quest:${q.questKey}`;
    athenaDoc.data.items[itemId] = questItemFromDoc(q);
  }
  return all;
}

async function rerollDaily(accountId, questKeyOrItemId) {
  // find a daily quest for today and replace with a different one
  const keyBase = `daily:${dayKey()}`;
  const dailies = await Quest.find({ accountId, type: "daily", questKey: new RegExp(`^${keyBase}`) }).lean();
  let target = dailies.find(q => q.questKey === questKeyOrItemId || `Quest:${q.questKey}` === questKeyOrItemId || q.templateId === questKeyOrItemId);
  if (!target) target = dailies[0];
  if (!target) return null;
  const used = new Set(dailies.map(d => d.templateId.split("_")[0] + ":" + d.templateId.split(":")[1]));
  const pool = DAILY_POOL.filter(p => !target.templateId.includes(p.objective));
  const pick = pool[Math.floor(Math.random() * pool.length)] || DAILY_POOL[0];
  const idx = target.questKey.split(":").pop();
  const newTemplate = `${pick.templateId}_${dayKey().replace(/-/g, "")}_${idx}_r`;
  await Quest.updateOne({ _id: target._id }, {
    $set: {
      templateId: newTemplate,
      objectives: { [pick.objective]: pick.target },
      progress: { [pick.objective]: 0 },
      completed: false, claimed: false, xpReward: pick.xp, rerolled: true,
    }
  });
  return true;
}

module.exports = { ensureDailyQuests, ensureWeeklyQuests, applyQuestsToAthena, rerollDaily };
