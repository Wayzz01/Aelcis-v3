const mongoose = require("mongoose");
const config = require("../../shared/utils/config");
const logger = require("../../shared/utils/logger");

async function connectDatabase() {
  mongoose.set("strictQuery", true);
  mongoose.set("bufferCommands", false);
  try {
    await mongoose.connect(config.mongodb, {
      serverSelectionTimeoutMS: 3000,
    });
    logger.info(`MongoDB connected: ${config.mongodb}`);
  } catch (err) {
    logger.warn(`MongoDB unavailable (${err.message}). Running with in-memory storage (no MongoDB required).`);
    // Ensure mongoose does not stay in a connecting/buffering state
    try { await mongoose.disconnect(); } catch (_) {}
  }

  mongoose.connection.on("error", (err) => {
    logger.error("MongoDB error:", err.message);
  });
  mongoose.connection.on("disconnected", () => {
    if (mongoose.connection.readyState === 0) return;
    logger.warn("MongoDB disconnected");
  });
}

module.exports = connectDatabase;
