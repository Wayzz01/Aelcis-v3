require("dotenv").config();
const express = require("express");
const path = require("path");
const fs = require("fs");
const http = require("http");
const https = require("https");
const cors = require("cors");
const cookieParser = require("cookie-parser");

const config = require("./shared/utils/config");
const logger = require("./shared/utils/logger");
const connectDatabase = require("./core/database/connect");

// Routes
const accountRoutes = require("./api/routes/account");
const mcpRoutes = require("./api/routes/mcp");
const lightswitchRoutes = require("./api/routes/lightswitch");
const waitingroomRoutes = require("./api/routes/waitingroom");
const cloudstorageRoutes = require("./api/routes/cloudstorage");
const timelineRoutes = require("./api/routes/timeline");
const contentRoutes = require("./api/routes/content");
const storefrontRoutes = require("./api/routes/storefront");
const friendsRoutes = require("./api/routes/friends");
const matchmakingRoutes = require("./api/routes/matchmaking");
const partyRoutes = require("./api/routes/party");
const gameRoutes = require("./api/routes/game");
const webRoutes = require("./api/routes/web");
const tournamentsRoutes = require("./api/routes/tournaments");
const miscRoutes = require("./api/routes/misc");

// Optional services
let xmppServer = null;
let discordBot = null;

async function main() {
  logger.info(`${config.name} v${config.version} starting (Chapter 2 Season ${config.season}, build ${config.build})`);

  await connectDatabase();

  const app = express();
  app.disable("x-powered-by");
  app.use(cors());
  app.use(cookieParser());
  // Body parsers: skip for cloudstorage user file uploads (route reads raw stream)
  const jsonParser = express.json({ limit: "10mb" });
  const urlParser = express.urlencoded({ extended: true, limit: "10mb" });
  const textParser = express.text({ type: "text/*", limit: "10mb" });
  app.use((req, res, next) => {
    if (req.path.startsWith("/fortnite/api/cloudstorage/user/") && (req.method === "PUT" || req.method === "POST")) {
      return next();
    }
    const ct = req.headers["content-type"] || "";
    if (ct.includes("application/x-www-form-urlencoded")) return urlParser(req, res, next);
    if (ct.includes("application/json") || ct.includes("+json")) return jsonParser(req, res, next);
    if (ct.startsWith("text/")) return textParser(req, res, next);
    // default: try json for empty/unknown (some clients omit content-type), without breaking raw streams
    return jsonParser(req, res, (err) => {
      if (err) return urlParser(req, res, next);
      return next();
    });
  });

  // Basic request log (lightweight)
  app.use((req, res, next) => {
    if (!req.path.startsWith("/datarouter")) {
      const extra = (req.method === "POST" && /profile|purchase|battle|catalog/i.test(req.originalUrl)) ? ` bodyKeys=${Object.keys(req.body || {}).join(",")}` : "";
      logger.http(`${req.method} ${req.originalUrl}${extra}`);
    }
    next();
  });

  // Static website — serve from resources/public AND website/ folder
  const publicDir = path.join(__dirname, "resources", "public");
  const websiteDir = path.join(__dirname, "..", "..", "website");
  if (fs.existsSync(publicDir)) app.use(express.static(publicDir));
  if (fs.existsSync(websiteDir)) app.use(express.static(websiteDir));
  app.get("/", (req, res) => {
    const websiteIndex = path.join(websiteDir, "index.html");
    if (fs.existsSync(websiteIndex)) return res.sendFile(websiteIndex);
    const index = path.join(publicDir, "index.html");
    if (fs.existsSync(index)) return res.sendFile(index);
    return res.json({ name: config.name, status: "online", season: config.season });
  });

  // Mount routes
  app.use(webRoutes);
  app.use(gameRoutes);
  app.use(accountRoutes);
  app.use(mcpRoutes);
  app.use(lightswitchRoutes);
  app.use(waitingroomRoutes);
  app.use(cloudstorageRoutes);
  app.use(timelineRoutes);
  app.use(contentRoutes);
  app.use(storefrontRoutes);
  app.use(friendsRoutes);
  app.use(matchmakingRoutes);
  app.use(partyRoutes);
  app.use(tournamentsRoutes);
  app.use(miscRoutes);

  // Affiliate/SAC endpoint (simple API)
  app.get("/affiliate/api/public/affiliates/slug/:slug", async (req, res) => {
    const slug = String(req.params.slug || "").toLowerCase();
    try {
      const SacCode = require("./core/models/SacCode");
      const sac = await SacCode.findOne({ code: slug, active: true }).lean();
      if (!sac) return res.status(404).json({ errorCode: "errors.com.epicgames.ecommerce.affiliate.not_found", errorMessage: "Affiliate not found" });
      return res.json({ id: sac.ownerAccountId, slug: sac.code, displayName: sac.ownerUsername || sac.code, status: "ACTIVE", verified: true });
    } catch {
      return res.status(404).json({});
    }
  });

  // 404 fallback (many clients expect 404 with epic-style body for unknown endpoints)
  app.use((req, res) => {
    res.status(404).json({
      errorCode: "errors.com.epicgames.common.not_found",
      errorMessage: "Sorry the resource you were trying to find could not be found",
      numericErrorCode: 1004,
      originatingService: "fortnite",
      intent: "prod-live",
    });
  });

  // Error handler
  app.use((err, req, res, next) => {
    logger.error("Unhandled error:", err && err.stack ? err.stack : err);
    const status = err.status || 500;
    res.status(status).json(err.body || { errorCode: "errors.com.epicgames.common.server_error", errorMessage: err.message || "Server error", numericErrorCode: 1000, originatingService: "fortnite", intent: "prod-live" });
  });

  // Start HTTP
  const httpServer = http.createServer(app);
  httpServer.listen(config.ports.http, "0.0.0.0", () => {
    logger.info(`HTTP backend listening on port ${config.ports.http}`);
  });

  // Optional HTTPS
  if (config.features.https || config.features.ssl) {
    try {
      const sslDir = path.join(__dirname, "runtime", "ssl");
      const keyPath = path.join(sslDir, "key.pem");
      const certPath = path.join(sslDir, "cert.pem");
      let credentials = null;
      if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
        credentials = { key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) };
      } else {
        // generate self-signed for local dev
        const selfsigned = require("selfsigned");
        const attrs = [{ name: "commonName", value: "alecis-v3.local" }];
        const pems = await selfsigned.generate(attrs, { days: 365, keySize: 2048 });
        if (!fs.existsSync(sslDir)) fs.mkdirSync(sslDir, { recursive: true });
        fs.writeFileSync(keyPath, pems.private);
        fs.writeFileSync(certPath, pems.cert);
        credentials = { key: pems.private, cert: pems.cert };
        logger.info("Generated self-signed SSL certificate in ssl/");
      }
      const httpsServer = https.createServer(credentials, app);
      httpsServer.listen(config.ports.https, "0.0.0.0", () => {
        logger.info(`HTTPS backend listening on port ${config.ports.https}`);
      });
    } catch (e) {
      logger.warn("Failed to start HTTPS server:", e.message);
    }
  }

  // XMPP (basic WebSocket XMPP)
  try {
    const startXmpp = require("./integrations/xmpp/server");
    xmppServer = startXmpp({ appConfig: config });
    logger.info(`XMPP service initialized (ws)`);
  } catch (e) {
    logger.warn("XMPP service not started:", e.message);
  }

  // Matchmaker service placeholder (HTTP matchmaker endpoints already served; could run separate port)
  try {
    if (config.matchmaker && config.matchmaker.enabled) {
      const mm = require("./integrations/matchmaker/server");
      mm.start(config);
    }
  } catch (e) {
    logger.warn("Matchmaker service note:", e.message);
  }

  // Discord bot
  try {
    if (config.discord && config.discord.enabled && config.discord.token) {
      const startBot = require("./integrations/bot/bot");
      discordBot = await startBot(config);
    } else {
      logger.info("Discord bot disabled (set DISCORD_BOT_ENABLED=true and token to enable)");
    }
  } catch (e) {
    logger.warn("Discord bot not started:", e.message);
  }

  logger.info("Alecis-v3 is ready.");
  logger.info(`Website: http://127.0.0.1:${config.ports.http}/`);
  logger.info("Redirect Fortnite traffic to this backend (HTTP port) to play.");
}

main().catch((err) => {
  console.error("Fatal startup error:", err);
  process.exit(1);
});
