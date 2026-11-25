const mongoose = require("mongoose");

// Every moderator's action, for the moderation panel's log: who did what to
// whom, when and why (lib/moderation.js, server.js /api/mod/action)
const moderationLogSchema = new mongoose.Schema({
  at: { type: Date, default: Date.now, index: true },
  action: String,
  actor: {
    id: mongoose.Schema.Types.ObjectId,
    name: String,
    role: String,
  },
  target: {
    id: { type: mongoose.Schema.Types.ObjectId, index: true },
    name: String,
  },
  reason: String,
  until: Date,
  place: String,
});

module.exports = mongoose.model("ModerationLog", moderationLogSchema);
