const mongoose = require("mongoose");
const { wrapModel } = require("../database/memory");

const UserSchema = new mongoose.Schema(
  {
    accountId: { type: String, required: true, unique: true, index: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    username: { type: String, required: true, unique: true, trim: true },
    password: { type: String, required: true },
    created: { type: Date, default: Date.now },
    banned: { type: Boolean, default: false },
    banReason: { type: String, default: "" },
    banExpires: { type: Date, default: null },
    vbucks: { type: Number, default: 1000 },
    mtxPlatform: { type: String, default: "EpicPC" },
    discordId: { type: String, default: null },
    country: { type: String, default: "US" },
    preferredLanguage: { type: String, default: "en" },
    canUpdateDisplayName: { type: Boolean, default: true },
    tfaEnabled: { type: Boolean, default: false },
    emailVerified: { type: Boolean, default: true },
    minorVerified: { type: Boolean, default: true },
    minorExpected: { type: Boolean, default: false },
    minorStatus: { type: String, default: "NOT_MINOR" },
    // SAC
    creatorCode: { type: String, default: null },
    supportedCreator: { type: String, default: null },
    sacEarnings: { type: Number, default: 0 },
    // Arena/Tournaments
    hype: { type: Number, default: 0 },
    arenaDivision: { type: Number, default: 0 },
    tournamentHistory: { type: Array, default: [] },
  },
  { timestamps: true }
);

const MModel = mongoose.models.User || mongoose.model("User", UserSchema);
module.exports = wrapModel(MModel, "users");
