const express = require("express");
const fs = require("fs");
const path = require("path");

const router = express.Router();

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

// Data router / telemetry
router.post("/datarouter/api/v1/public/data", (req, res) => res.status(204).end());
router.post("/datarouter/api/v1/public/data/*", (req, res) => res.status(204).end());

// Presence / social ban stubs
router.get("/presence/api/v1/_/:accountId/settings/subscriptions", (req, res) => res.json([]));
router.get("/socialban/api/public/v1/:accountId", (req, res) => res.json({ bans: [], warnings: [] }));

// Fortnite data asset directory, catalog misc
router.get("/fortnite/api/storefront/v2/keychain", (req, res) => {
  try { console.log(`[keychain] misc handler hit url=${req.originalUrl} ua=${req.headers["user-agent"] || ""}`); } catch {}
  return res.json(getKeychain());
});
router.get("/fortnite/api/game/v2/privacy/account/:accountId", (req, res) => res.json({ accountId: req.params.accountId, optOutOfPublicLeaderboards: false }));
router.post("/fortnite/api/game/v2/privacy/account/:accountId", (req, res) => res.json({}));

// Stats stubs
router.get("/fortnite/api/stats/accountId/:accountId/bulk/window/:window", (req, res) => res.json([]));
router.get("/fortnite/api/statsv2/account/:accountId", (req, res) => res.json({ startTime: 0, endTime: 0, stats: {}, accountId: req.params.accountId }));
router.get("/statsproxy/api/statsv2/account/:accountId", (req, res) => res.json({ startTime: 0, endTime: 0, stats: {}, accountId: req.params.accountId }));

// Feedback / region
router.get("/region", (req, res) => res.json({ continent: { code: "EU", geoname_id: 6255148, names: { en: "Europe" } }, country: { geoname_id: 2635167, is_in_european_union: false, iso_code: "GB", names: { en: "United Kingdom" } }, subdivisions: [] }));
router.get("/fortnite/api/game/v2/world/info", (req, res) => res.json({}));

// Tournaments / events stubs (basic responses so lobby doesn't break)
router.get("/fortnite/api/game/v2/events/tournamentandhistory/:accountId/:region/:platform", (req, res) => {
  res.json({ tournament_history: { accountId: req.params.accountId, tournaments: [] }, event_window_histories: [], pity: {} });
});
router.get("/fortnite/api/game/v2/events/tournamentandhistory/:accountId/:region/:platform/:window", (req, res) => {
  res.json({ tournament_history: { accountId: req.params.accountId, tournaments: [] }, event_window_histories: [], pity: {} });
});
router.get("/fortnite/api/events/v1/events/:accountId/data", (req, res) => {
  res.json({ player: { gameId: "Fortnite", accountId: req.params.accountId, tokens: [], teams: {}, pendingPayouts: [], pendingPenalties: {}, persistentScores: {}, groupIdentity: {} }, events: [], templates: [], scores: [], leaderboards: [], resolvedWindowLocations: {}, leaderboardDefs: [], payoutTables: [], scoringRuleSets: [] });
});

router.post("/api/v1/events/Fortnite/download/:accountId", (req, res) => {
  res.json({ player: { gameId: "Fortnite", accountId: req.params.accountId, tokens: [], teams: {}, pendingPayouts: [], pendingPenalties: {}, persistentScores: { Hype: 0 }, groupIdentity: {} }, events: [], templates: [], scores: [], leaderboards: [], resolvedWindowLocations: {}, leaderboardDefs: [], payoutTables: [], scoringRuleSets: [] });
});

router.get("/fortnite/api/game/v2/leaderboards/cohort/:accountId", (req, res) => res.json([]));

// Launcher/epic stubs
router.get("/launcher/api/public/distributionpoints/", (req, res) => res.json({ distributions: ["https://download.epicgames.com/", "https://epicgames-download1.akamaized.net/"] }));
router.get("/launcher/api/public/assets/*", (req, res) => res.json({ appName: "FortniteContentBuilds", labelName: "alecis-v3", buildVersion: "12.41", catalogItemId: "", expires: "9999-12-31T23:59:59.999Z", items: {}, assetId: "Fortnite" }));

// Friends presence stub
router.get("/friends/api/v1/:accountId/settings", (req, res) => res.json({ acceptInvites: "public", mutualPrivacy: "ALL" }));

module.exports = router;
