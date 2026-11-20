const mongoose = require("mongoose");
const { wrapModel } = require("../database/memory");

const TournamentSchema = new mongoose.Schema(
  {
    eventId: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    description: { type: String, default: "" },
    playlistId: { type: String, default: "Playlist_DefaultSolo" },
    season: { type: Number, default: 12 },
    active: { type: Boolean, default: true },
    regions: { type: [String], default: ["EU", "NAE", "NAW", "BR", "ASIA", "OCE", "ME"] },
    windows: { type: Array, default: [] }, // schedule windows
    scoring: { type: mongoose.Schema.Types.Mixed, default: {} },
    leaderboard: { type: Array, default: [] }, // {accountId, username, points, matches}
    createdAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

const MModel = mongoose.models.Tournament || mongoose.model("Tournament", TournamentSchema);
module.exports = wrapModel(MModel, "tournaments");
