const mongoose = require("mongoose");

// Money sent from one passenger to another (lib/money.js, server.js
// "money-send"): who, to whom, how much, when, and the note if any. The
// passengers' own "Recent" lists and the moderators read it.
const moneyTransferSchema = new mongoose.Schema({
  at: { type: Date, default: Date.now, index: true },
  from: {
    id: { type: mongoose.Schema.Types.ObjectId, index: true },
    name: String,
  },
  to: {
    id: { type: mongoose.Schema.Types.ObjectId, index: true },
    name: String,
  },
  amount: Number,
  note: String,
});

module.exports = mongoose.model("MoneyTransfer", moneyTransferSchema);
