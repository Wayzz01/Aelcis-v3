const mongoose = require("mongoose");
const { wrapModel } = require("../database/memory");

const FriendSchema = new mongoose.Schema(
  {
    accountId: { type: String, required: true, index: true },
    friendId: { type: String, required: true, index: true },
    status: {
      type: String,
      enum: ["PENDING_OUTGOING", "PENDING_INCOMING", "ACCEPTED", "BLOCKED"],
      required: true,
    },
    alias: { type: String, default: "" },
    note: { type: String, default: "" },
    favorite: { type: Boolean, default: false },
    created: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

FriendSchema.index({ accountId: 1, friendId: 1 }, { unique: true });

const MModel = mongoose.models.Friend || mongoose.model("Friend", FriendSchema);
module.exports = wrapModel(MModel, "friends");
