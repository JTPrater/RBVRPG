const mongoose = require("mongoose");

// An event a passenger holds aboard (lib/shipEvents.js, server.js
// "events-create"): where, when, what, who holds it and who means to go.
// "announced" once every chat has been told it is starting; "cancelled" by
// its host or a moderator (and then never shown).
const shipEventSchema = new mongoose.Schema({
  createdAt: { type: Date, default: Date.now },
  at: { type: Date, index: true },
  room: String,
  title: String,
  details: String,
  host: {
    id: { type: mongoose.Schema.Types.ObjectId, index: true },
    name: String,
  },
  going: [mongoose.Schema.Types.ObjectId],
  announced: { type: Boolean, default: false },
  cancelled: { type: Boolean, default: false },
  cancelledBy: {
    id: mongoose.Schema.Types.ObjectId,
    name: String,
    moderator: Boolean,
  },
});

module.exports = mongoose.model("ShipEvent", shipEventSchema);
