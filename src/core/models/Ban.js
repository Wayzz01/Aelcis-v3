const mongoose = require("mongoose");
const { wrapModel } = require("../database/memory");

const BanSchema = new mongoose.Schema(
  {
    accountId: { type: String, required: true, index: true },
    type: { type: String, enum: ["matchmaking", "competitive", "permanent", "temporary"], default: "matchmaking" },
    reason: { type: String, default: "" },
    bannedBy: { type: String, default: "system" },
    expiresAt: { type: Date, default: null }, // null = permanent
    active: { type: Boolean, default: true },
    createdAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

const MModel = mongoose.models.Ban || mongoose.model("Ban", BanSchema);
module.exports = wrapModel(MModel, "bans");
