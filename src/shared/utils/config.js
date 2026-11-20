const fs = require("fs");
const path = require("path");

function loadConfig() {
  const configPath = path.join(__dirname, "..", "..", "resources", "config", "config.json");
  let fileConfig = {};
  try {
    if (fs.existsSync(configPath)) {
      fileConfig = JSON.parse(fs.readFileSync(configPath, "utf8"));
    }
  } catch (err) {
    console.error("[config] Failed to read Config/config.json:", err.message);
  }

  const env = process.env;
  const config = {
    name: fileConfig.name || "alecis-v3",
    version: fileConfig.version || "3.0.0",
    season: parseInt(env.DEFAULT_SEASON || fileConfig.season || 12, 10),
    build: fileConfig.build || "12.41",
    ports: {
      http: parseInt(env.PORT || (fileConfig.ports && fileConfig.ports.http) || 3551, 10),
      https: parseInt(env.SSL_PORT || (fileConfig.ports && fileConfig.ports.https) || 443, 10),
      xmpp: parseInt(env.XMPP_PORT || (fileConfig.ports && fileConfig.ports.xmpp) || 80, 10),
      xmppWss: parseInt(env.XMPP_WSS_PORT || (fileConfig.ports && fileConfig.ports.xmppWss) || 4433, 10),
      matchmaker: parseInt(env.MATCHMAKER_PORT || (fileConfig.ports && fileConfig.ports.matchmaker) || 8081, 10),
      website: parseInt(env.WEBSITE_PORT || (fileConfig.ports && fileConfig.ports.website) || 3000, 10),
      caldera: parseInt(env.CALDERA_PORT || (fileConfig.ports && fileConfig.ports.caldera) || 5000, 10),
    },
    mongodb: env.MONGODB_URI || fileConfig.mongodb || "mongodb://127.0.0.1:27017/alecis_v3",
    jwtSecret: env.JWT_SECRET || fileConfig.jwtSecret || "change-this-secret",
    publicUrl: env.PUBLIC_URL || fileConfig.publicUrl || "http://127.0.0.1:3551",
    discord: {
      enabled: (env.DISCORD_BOT_ENABLED || "").toLowerCase() === "true" || (fileConfig.discord && fileConfig.discord.enabled) || false,
      token: env.DISCORD_BOT_TOKEN || (fileConfig.discord && fileConfig.discord.token) || "",
      clientId: env.DISCORD_CLIENT_ID || (fileConfig.discord && fileConfig.discord.clientId) || "",
      guildId: env.DISCORD_GUILD_ID || (fileConfig.discord && fileConfig.discord.guildId) || "",
      moderatorRoleId: env.DISCORD_MOD_ROLE_ID || (fileConfig.discord && fileConfig.discord.moderatorRoleId) || "",
    },
    features: Object.assign({}, fileConfig.features || {}, {
      autoShop: env.ENABLE_AUTO_SHOP ? env.ENABLE_AUTO_SHOP === "true" : (fileConfig.features && fileConfig.features.autoShop) !== false,
      ssl: env.ENABLE_SSL ? env.ENABLE_SSL === "true" : !!(fileConfig.features && fileConfig.features.ssl),
      https: env.ENABLE_HTTPS ? env.ENABLE_HTTPS === "true" : !!(fileConfig.features && fileConfig.features.https),
      battlePass: (fileConfig.features && fileConfig.features.battlePass) !== false,
      battlePassSeason: parseInt(env.BATTLEPASS_SEASON || (fileConfig.features && fileConfig.features.battlePassSeason) || 12, 10),
    }),
    shop: fileConfig.shop || { refreshIntervalHours: 24, dailySlots: 6, featuredSlots: 2 },
    rewards: fileConfig.rewards || { killVbucks: 5, winVbucks: 25, killXp: 50, winXp: 300, xpPerLevel: 80000 },
    gameApiKey: env.GAME_API_KEY || fileConfig.gameApiKey || "change-this-api-key",
    gameServers: fileConfig.gameServers || [],
    matchmaker: fileConfig.matchmaker || { enabled: true },
    sac: fileConfig.sac || { enabled: true, creatorVbucksReward: 5 },
    tournaments: fileConfig.tournaments || { enabled: true },
    arena: fileConfig.arena || { enabled: true, divisions: [] },
  };

  // ensure base event structure
  if (!config.features.events) config.features.events = {};
  if (!config.features.events.c2s2) config.features.events.c2s2 = { enabled: config.season === 12 };
  if (!config.features.events.winterfest) config.features.events.winterfest = { enabled: false, version: "11.31" };

  return config;
}

const config = loadConfig();
module.exports = config;
