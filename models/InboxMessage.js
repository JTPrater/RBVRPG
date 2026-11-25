const mongoose = require("mongoose");

// A message from one passenger to another (lib/inbox.js, server.js
// "inbox-send"): who, to whom, when, the words, and when it was read (null
// until the passenger it went to opens the thread). The game's Inbox card
// reads it; the number on the Inbox button counts the unread.
const inboxMessageSchema = new mongoose.Schema({
  at: { type: Date, default: Date.now },
  from: {
    id: mongoose.Schema.Types.ObjectId,
    name: String,
  },
  to: {
    id: mongoose.Schema.Types.ObjectId,
    name: String,
  },
  text: String,
  readAt: { type: Date, default: null },
});
inboxMessageSchema.index({ "to.id": 1, at: -1 });
inboxMessageSchema.index({ "from.id": 1, at: -1 });
inboxMessageSchema.index({ "to.id": 1, readAt: 1 });

module.exports = mongoose.model("InboxMessage", inboxMessageSchema);
