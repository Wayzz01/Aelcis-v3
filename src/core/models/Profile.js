const mongoose = require("mongoose");
const { wrapModel } = require("../database/memory");

const ProfileSchema = new mongoose.Schema(
  {
    accountId: { type: String, required: true, index: true },
    profileId: { type: String, required: true },
    // Full profile object as Fortnite expects (stats, items, commandRevision, etc.)
    data: { type: mongoose.Schema.Types.Mixed, default: {} },
    rvn: { type: Number, default: 0 },
    commandRevision: { type: Number, default: 0 },
    updated: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

ProfileSchema.index({ accountId: 1, profileId: 1 }, { unique: true });

const MModel = mongoose.models.Profile || mongoose.model("Profile", ProfileSchema);
module.exports = wrapModel(MModel, "profiles");
