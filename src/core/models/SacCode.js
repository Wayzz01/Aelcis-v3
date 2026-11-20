const mongoose = require("mongoose");
const { wrapModel } = require("../database/memory");

const SacCodeSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true, lowercase: true, trim: true },
    ownerAccountId: { type: String, required: true, index: true },
    ownerUsername: { type: String, default: "" },
    active: { type: Boolean, default: true },
    totalUses: { type: Number, default: 0 },
    totalEarnings: { type: Number, default: 0 },
    createdAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

const MModel = mongoose.models.SacCode || mongoose.model("SacCode", SacCodeSchema);
module.exports = wrapModel(MModel, "saccodes");
