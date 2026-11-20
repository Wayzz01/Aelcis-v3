const express = require("express");
const config = require("../../shared/utils/config");
const router = express.Router();

function nowIso() { return new Date().toISOString(); }

router.get(["/content/api/pages/fortnite-game", "/content/api/pages/fortnite-game/*"], (req, res) => {
  const season = config.season || 12;
  const lang = (req.query.lang || req.headers["accept-language"] || "en").split(",")[0].split("-")[0];

  // Dynamic backgrounds for C2S2 (season 12)
  let backgrounds = [
    { stage: `season${season}`, _type: "DynamicBackground", key: "lobby" }
  ];
  if (season === 12) {
    backgrounds = [
      { stage: "season12", _type: "DynamicBackground", key: "lobby" },
      { stage: "seasonx", _type: "DynamicBackground", key: "vault" }
    ];
  }

  const newsMessages = [{
    image: "https://cdn2.unrealengine.com/Fortnite/fortnite-game/battleroyalenews/v42/BR06_MOTD_Shield-1024x512-75eacc1dbc23b41eea812f1b33f12e141b0291c5.jpg",
    hidden: false,
    messagetype: "normal",
    _type: "CommonUI Simple Message Base",
    title: "Alecis-v3",
    body: `Welcome to Alecis-v3! Chapter 2 Season ${season === 12 ? "2" : season} backend is online.`,
    spotlight: false,
  }];

  const emergencynotice = [{ hidden: false, _type: "CommonUI Emergency Notice Base", title: "Alecis-v3", body: "Backend online." }];
  const emergencynoticev2 = [{ hidden: true, _type: "CommonUI Emergency Notice Base", gamemodes: [], title: "Alecis-v3", body: "" }];

  const arenaSoloImage = "https://static.wikia.nocookie.net/fortnite/images/e/e4/Arena_-_Solo_Playlist_-_Fortnite.png/revision/latest?cb=20210409031906";
  const arenaDuosImage = "https://static.wikia.nocookie.net/fortnite/images/8/8f/Arena_%28Chapter_3_Duos%29_-_Mode_-_Fortnite.jpg/revision/latest?cb=20220430000519";
  const arenaTriosImage = "https://static.wikia.nocookie.net/fortnite/images/9/9b/Arena_-_Trios_Playlist_-_Fortnite.png/revision/latest/scale-to-width-down/350?cb=20210409031938";
  // Creative image URL was not provided in conversation context; replace with exact image if needed.
  const creativeImage = "https://cdn2.unrealengine.com/Fortnite/fortnite-game/playlistinformation/CM_LobbyTileArt_Creative-1024x512-1f3f1e0d2a2b8a3f8f6e0a9e7c2c1d4b8a9f0e1d.jpg";

  // Only requested modes visible: Creative + Arena Solo/Duo/Trio (Late Game labels)
  // Use 12.41 arena playlist IDs as canonical targets; matchmaking normalizes aliases.
  const playlists = [
    {
      image: creativeImage,
      playlist_name: "Playlist_PlaygroundV2",
      hidden: false,
      special_border: "None",
      _type: "FortPlaylistInfo",
      description: "Create, play, and battle with friends for free in Creative.",
      display_subname: "Island Games",
      display_name: "Creative",
    },
    {
      image: arenaSoloImage,
      playlist_name: "Playlist_ShowdownAlt_Solo",
      hidden: false,
      special_border: "None",
      _type: "FortPlaylistInfo",
      description: "Arena Solo Late Game",
      display_subname: "Late Game",
      display_name: "Arena Solo",
    },
    {
      image: arenaDuosImage,
      playlist_name: "Playlist_ShowdownAlt_Duos",
      hidden: false,
      special_border: "None",
      _type: "FortPlaylistInfo",
      description: "Arena Duo Late Game",
      display_subname: "Late Game",
      display_name: "Arena Duos",
    },
    {
      image: arenaTriosImage,
      playlist_name: "Playlist_ShowdownAlt_Trios",
      hidden: false,
      special_border: "None",
      _type: "FortPlaylistInfo",
      description: "Arena Trio Late Game",
      display_subname: "Late Game",
      display_name: "Arena Trios",
    },
  ];

  const tournamentInfo = {
    tournament_display_id: "",
    _type: "Tournament Display Info",
    playlist_tile_image: "",
    loading_screen_image: "",
    title_line_2: "ALECIS CUP",
    title_line_1: "TOURNAMENT",
    poster_back_image: "",
    style_info: {},
    _activeDate: "2020-01-01T00:00:00.000Z",
    lastModified: nowIso(),
    locale: lang,
    tournament_info: {
      tournaments: [],
      _type: "Tournaments Info"
    }
  };

  const playlistImages = playlists.map(p => ({ image: p.image, playlist_name: p.playlist_name, _type: "FortPlaylistImageEntry", type: "image" }));

  const subgameselectdata = {
    _title: "subgameselectdata",
    _activeDate: "2017-10-11T18:37:23.145Z",
    lastModified: nowIso(),
    _locale: lang,
    battleRoyale: {
      _type: "CommonUI Simple Message",
      message: {
        image: "",
        hidden: false,
        messagetype: "normal",
        _type: "CommonUI Simple Message Base",
        title: "Battle Royale",
        body: "Arena Late Game modes.",
        spotlight: false
      }
    },
    creative: {
      _type: "CommonUI Simple Message",
      message: {
        image: "",
        hidden: false,
        messagetype: "normal",
        _type: "CommonUI Simple Message Base",
        title: "Creative",
        body: "Create and play.",
        spotlight: false
      }
    }
  };

  res.json({
    _title: "Fortnite Game",
    _activeDate: "2017-07-24T22:24:02.300Z",
    lastModified: nowIso(),
    _locale: lang,
    battleroyalenews: { news: { platform_messages: [], motds: newsMessages, messages: newsMessages }, _title: "battleroyalenews", _activeDate: nowIso(), lastModified: nowIso(), _locale: lang },
    emergencynotice: { news: { platform_messages: [], _type: "Battle Royale News", messages: emergencynotice } , _title: "emergencynotice", _activeDate: nowIso(), lastModified: nowIso(), _locale: lang },
    emergencynoticev2: { "jcr:isCheckedOut": true, _title: "emergencynoticev2", _noIndex: false, emergencynotices: { _type: "Emergency Notices", emergencynotices: emergencynoticev2 }, _activeDate: nowIso(), lastModified: nowIso(), _locale: lang },
    dynamicbackgrounds: { backgrounds: { backgrounds, _type: "DynamicBackgroundList" }, _title: "dynamicbackgrounds", _activeDate: nowIso(), lastModified: nowIso(), _locale: lang },
    playlistinformation: { frontend_matchmaking_header_style: "None", _title: "playlistinformation", frontend_matchmaking_header_text: "", playlist_info: { _type: "Playlist Information", playlists }, _noIndex: false, _activeDate: nowIso(), lastModified: nowIso(), _locale: lang },
    playlistimages: { images: playlistImages, _title: "playlistimages", _activeDate: nowIso(), lastModified: nowIso(), _locale: lang },
    shopSections: { sectionList: { sections: [{ bSortOffersByOwnership: false, bShowIneligibleOffersIfGiftable: false, bEnableToastNotification: true, background: { stage: "summer", _type: "DynamicBackground" }, _type: "ShopSection", landingPriority: 0, bHidden: false, sectionId: "Featured", bShowTimer: true, sectionDisplayName: "Featured", bShowIneligibleOffers: true }, { bSortOffersByOwnership: false, bShowIneligibleOffersIfGiftable: false, bEnableToastNotification: true, background: { stage: "summer", _type: "DynamicBackground" }, _type: "ShopSection", landingPriority: 1, bHidden: false, sectionId: "Daily", bShowTimer: false, sectionDisplayName: "Daily", bShowIneligibleOffers: true }] }, _title: "shop-sections", _activeDate: nowIso(), lastModified: nowIso(), _locale: lang },
    tournamentinformation: tournamentInfo,
    // Sub-game info / BattlePass info stubs useful for lobby
    battleroyalenewsv2: { news: { motds: newsMessages }, _title: "battleroyalenewsv2", _activeDate: nowIso(), lastModified: nowIso(), _locale: lang },
    subscription: { _title: "subscription", _activeDate: nowIso(), lastModified: nowIso(), _locale: lang },
    tournament_info: { _title: "tournament_info", _activeDate: nowIso(), lastModified: nowIso(), _locale: lang, tournaments: [] },
    subgameselectdata,
  });
});

router.post("/fortnite/api/game/v2/grant_access/:accountId", (req, res) => res.json({}));
router.post("/fortnite/api/game/v2/tryPlayOnPlatform/account/:accountId", (req, res) => res.setHeader("Content-Type", "text/plain").send("true"));
router.get("/fortnite/api/game/v2/enabled_features", (req, res) => res.json([]));
router.get("/fortnite/api/receipts/v1/account/:accountId/receipts", (req, res) => res.json([]));
router.get("/fortnite/api/game/v2/br-inventory/account/:accountId", (req, res) => res.json({ stash: { globalcash: 0 } }));
router.get("/fortnite/api/game/v2/twitch/:accountId", (req, res) => res.status(204).end());
router.get("/fortnite/api/v2/versioncheck/:platform", (req, res) => res.json({ type: "NO_UPDATE" }));
router.get("/fortnite/api/versioncheck*", (req, res) => res.json({ type: "NO_UPDATE" }));

module.exports = router;
