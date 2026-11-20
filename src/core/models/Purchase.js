const mongoose = require("mongoose");
const { wrapModel } = require("../database/memory");

const PurchaseSchema = new mongoose.Schema(
  {
    accountId: { type: String, required: true, index: true },
    offerId: { type: String, required: true },
    itemGrants: { type: Array, default: [] },
    price: { type: Number, default: 0 },
    currency: { type: String, default: "MtxCurrency" },
    refunded: { type: Boolean, default: false },
    refundDate: { type: Date, default: null },
    purchaseDate: { type: Date, default: Date.now },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

const MModel = mongoose.models.Purchase || mongoose.model("Purchase", PurchaseSchema);
module.exports = wrapModel(MModel, "purchases");
