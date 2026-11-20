const mongoose = require("mongoose");
const { wrapModel } = require("../database/memory");

const QuestSchema = new mongoose.Schema(
  {
    accountId: { type: String, required: true, index: true },
    // key like daily:date or weekly:season:week or quest template id
    questKey: { type: String, required: true },
    templateId: { type: String, required: true },
    type: { type: String, enum: ["daily", "weekly", "event", "battlepass"], default: "daily" },
    season: { type: Number, default: 12 },
    objectives: { type: mongoose.Schema.Types.Mixed, default: {} },
    progress: { type: mongoose.Schema.Types.Mixed, default: {} },
    completed: { type: Boolean, default: false },
    claimed: { type: Boolean, default: false },
    xpReward: { type: Number, default: 0 },
    expiresAt: { type: Date, default: null },
    rerolled: { type: Boolean, default: false },
  },
  { timestamps: true }
);

QuestSchema.index({ accountId: 1, questKey: 1 }, { unique: true });

const MModel = mongoose.models.Quest || mongoose.model("Quest", QuestSchema);
module.exports = wrapModel(MModel, "quests");
