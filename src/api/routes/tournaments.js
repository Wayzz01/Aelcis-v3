const express = require("express");
const { v4: uuidv4 } = require("uuid");
const Tournament = require("../../core/models/Tournament");
const User = require("../../core/models/User");
const config = require("../../shared/utils/config");
const { verifyToken } = require("../middleware/auth");

const router = express.Router();

function checkApiKey(req) {
  const key = req.headers["x-api-key"] || req.query.apiKey || req.body.apiKey;
  return !config.gameApiKey || key === config.gameApiKey;
}

// --- Admin/API management ---

router.post("/api/tournaments/create", async (req, res) => {
  if (!checkApiKey(req)) return res.status(401).json({ ok: false, error: "Invalid API key" });
  try {
    const { eventId, name, description, playlistId, regions, season, active } = req.body || {};
    const id = eventId || `alecis_event_${uuidv4().slice(0, 8)}`;
    const doc = await Tournament.findOneAndUpdate(
      { eventId: id },
      { $set: { eventId: id, name: name || "Alecis Tournament", description: description || "", playlistId: playlistId || "Playlist_DefaultSolo", regions: regions || ["EU", "NAE"], season: season || config.season || 12, active: active !== false } },
      { upsert: true, new: true }
    );
    res.json({ ok: true, tournament: doc });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

router.get("/api/tournaments", async (req, res) => {
  const list = await Tournament.find({}).lean();
  res.json({ ok: true, tournaments: list });
});

router.post("/api/tournaments/:eventId/score", async (req, res) => {
  // Save points for a player in a tournament (and optionally arena hype)
  if (!checkApiKey(req)) return res.status(401).json({ ok: false, error: "Invalid API key" });
  try {
    const { eventId } = req.params;
    const { accountId, points, matches, kills, placement, region } = req.body || {};
    if (!accountId) return res.status(400).json({ ok: false, error: "accountId required" });
    const user = await User.findOne({ accountId }).lean();
    const username = (user && user.username) || accountId;
    const t = await Tournament.findOne({ eventId });
    if (!t) return res.status(404).json({ ok: false, error: "Tournament not found" });
    const pts = Number(points || 0);
    let entry = (t.leaderboard || []).find(e => e.accountId === accountId);
    if (!entry) {
      entry = { accountId, username, points: 0, matches: 0, kills: 0, region: region || "EU" };
      t.leaderboard.push(entry);
    }
    entry.points = (entry.points || 0) + pts;
    entry.matches = (entry.matches || 0) + (matches ? Number(matches) : 1);
    entry.kills = (entry.kills || 0) + (kills ? Number(kills) : 0);
    entry.username = username;
    if (region) entry.region = region;
    // keep sorted desc
    t.leaderboard.sort((a, b) => (b.points || 0) - (a.points || 0));
    await t.save();

    // also persist to user tournament history
    await User.updateOne({ accountId }, { $push: { tournamentHistory: { eventId, points: pts, placement, at: new Date() } } });

    res.json({ ok: true, eventId, accountId, totalPoints: entry.points, rank: t.leaderboard.findIndex(e => e.accountId === accountId) + 1 });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

router.get("/api/tournaments/:eventId/leaderboard", async (req, res) => {
  const t = await Tournament.findOne({ eventId: req.params.eventId }).lean();
  if (!t) return res.status(404).json({ ok: false, error: "Tournament not found" });
  const limit = Math.min(parseInt(req.query.limit || "100", 10), 1000);
  const lb = (t.leaderboard || []).slice(0, limit).map((e, i) => ({ rank: i + 1, ...e }));
  res.json({ ok: true, eventId: t.eventId, name: t.name, leaderboard: lb });
});

// Arena hype endpoints
router.post("/api/arena/hype", async (req, res) => {
  if (!checkApiKey(req)) return res.status(401).json({ ok: false, error: "Invalid API key" });
  try {
    const { accountId, hype, delta } = req.body || {};
    if (!accountId) return res.status(400).json({ ok: false, error: "accountId required" });
    const user = await User.findOne({ accountId });
    if (!user) return res.status(404).json({ ok: false, error: "User not found" });
    if (typeof hype === "number") user.hype = hype;
    else if (typeof delta === "number") user.hype = (user.hype || 0) + delta;
    // determine division
    const divs = (config.arena && config.arena.divisions) || [];
    let divIndex = 0;
    for (let i = 0; i < divs.length; i++) { if ((user.hype || 0) >= (divs[i].minHype || 0)) divIndex = i; }
    user.arenaDivision = divIndex;
    await user.save();
    res.json({ ok: true, accountId, hype: user.hype, division: divIndex, divisionName: divs[divIndex] ? divs[divIndex].name : "Open" });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

router.get("/api/arena/:accountId", async (req, res) => {
  const user = await User.findOne({ accountId: req.params.accountId }).lean();
  if (!user) return res.status(404).json({ ok: false, error: "User not found" });
  const divs = (config.arena && config.arena.divisions) || [];
  const divIndex = user.arenaDivision || 0;
  res.json({ ok: true, accountId: user.accountId, hype: user.hype || 0, division: divIndex, divisionName: divs[divIndex] ? divs[divIndex].name : "Open" });
});

// --- In-game events endpoints (enhanced) ---

function buildEventsDownload(accountId) {
  // Basic event/template structure; real structure is complex and build-specific.
  // Provide configured tournaments as events so they appear and points can be tracked via our APIs.
  return Tournament.find({ active: true }).lean().then(tournaments => {
    const events = tournaments.map(t => ({
      eventId: t.eventId,
      displayDataId: t.eventId,
      announcementTime: new Date(Date.now() - 86400000).toISOString(),
      beginTime: new Date(Date.now() - 3600000).toISOString(),
      endTime: new Date(Date.now() + 30 * 86400000).toISOString(),
      regions: t.regions || ["EU", "NAE", "NAW", "BR", "ASIA", "OCE", "ME"],
      platforms: ["Windows", "PS4", "XboxOne", "Switch", "Android", "IOS"],
      playlistId: t.playlistId || "Playlist_DefaultSolo",
      metadata: { name: t.name, description: t.description },
      eventWindows: [{
        eventWindowId: `${t.eventId}_window`,
        beginTime: new Date(Date.now() - 3600000).toISOString(),
        endTime: new Date(Date.now() + 30 * 86400000).toISOString(),
        countdownBeginTime: new Date().toISOString(),
        canLiveSpectate: false,
        payoutDelay: 0,
        requireAllTokens: [],
        requireNoneTokensCaller: [],
        scoreLocations: [],
        visibility: "public",
      }],
      link: { type: "br:tournament", code: t.eventId },
    }));
    return {
      player: { gameId: "Fortnite", accountId, tokens: [`ARENA_S${config.season || 12}_Division1`], teams: {}, pendingPayouts: [], pendingPenalties: {}, persistentScores: { Hype: 0 }, groupIdentity: {} },
      events,
      templates: events.map(e => ({ eventTemplateId: e.eventId, playlistId: e.playlistId, eventWindows: e.eventWindows })),
      scores: [],
      leaderboards: [],
      leaderboardDefs: [],
      resolvedWindowLocations: {},
      payoutTables: [],
      scoringRuleSets: [],
    };
  }).catch(() => ({ player: { gameId: "Fortnite", accountId, tokens: [], teams: {}, pendingPayouts: [], pendingPenalties: {}, persistentScores: {}, groupIdentity: {} }, events: [], templates: [], scores: [], leaderboards: [], leaderboardDefs: [], resolvedWindowLocations: {}, payoutTables: [], scoringRuleSets: [] }));
}

router.get("/api/v1/events/Fortnite/download/:accountId", async (req, res) => {
  res.json(await buildEventsDownload(req.params.accountId));
});
router.post("/api/v1/events/Fortnite/download/:accountId", async (req, res) => {
  res.json(await buildEventsDownload(req.params.accountId));
});

// override misc stubs if mounted later? we mount tournaments route too - express will use first match; so add specific ones
router.get("/fortnite/api/game/v2/events/tournamentandhistory/:accountId/:region/:platform", async (req, res) => {
  const { accountId } = req.params;
  const user = await User.findOne({ accountId }).lean();
  const hype = (user && user.hype) || 0;
  res.json({ tournament_history: { accountId, tournaments: (user && user.tournamentHistory) || [] }, event_window_histories: [], pity: {}, persistent_scores: { Hype: hype } });
});

module.exports = router;
