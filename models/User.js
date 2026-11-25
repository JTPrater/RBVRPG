const mongoose = require("mongoose");

// A moderator's measure on a player (lib/moderation.js): who took it, when,
// why, and until when (no "until": until a moderator lifts it)
const measureSchema = new mongoose.Schema(
  {
    active: Boolean,
    until: Date,
    reason: String,
    by: String, // the moderator's name, as it was then
    byId: mongoose.Schema.Types.ObjectId,
    at: Date,
  },
  { _id: false },
);

// Where a moderator has locked the player in ("padded_room" or "hell"), until
// a moderator lets them out
const confinementSchema = new mongoose.Schema(
  {
    place: String,
    reason: String,
    by: String,
    byId: mongoose.Schema.Types.ObjectId,
    at: Date,
  },
  { _id: false },
);

const userSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    unique: true,
  },
  password: {
    type: String,
    required: true,
  },
  isAdmin: {
    type: Boolean,
    default: false,
  },
  // The ship's owner: an admin who also lets players out of hell, makes and
  // unmakes admins, and keeps the room editor and the voyage's clock
  // (scripts/makeAdmin.js <email> --owner)
  isOwner: {
    type: Boolean,
    default: false,
  },
  moderation: {
    mute: measureSchema,
    ban: measureSchema,
    confinement: confinementSchema,
  },
  // The marks the account was last seen with (server.js recordSeen): its
  // browser's ("browser", js/device.js) and its network's ("network"), each
  // only as a keyed hash, never the address or the id itself. The moderation
  // panel links accounts seen with the same mark (lib/moderation.js
  // linkAccounts). The most recent 12 are kept.
  seenOn: [
    new mongoose.Schema(
      {
        kind: String,
        hash: { type: String, index: true },
        first: Date,
        last: Date,
      },
      { _id: false },
    ),
  ],
  character: {
    forename: String,
    surname: String,
    birthdate: Date,
    cabin: String,
    cabin_number: String,
    bio: String,
    avatar: String,
  },
  stats: {
    hunger: { type: Number, default: 100 },
    thirst: { type: Number, default: 100 },
    energy: { type: Number, default: 100 },
    hygiene: { type: Number, default: 100 },
    bladder: { type: Number, default: 100 },
    intoxication: { type: Number, default: 0 },
    // (indexed: the Money card's list of the richest aboard)
    money: { type: Number, default: 0, index: true },
    moneyVersion: { type: Number, default: 0 },
    lastUpdated: { type: Date, default: Date.now },
  },
  chatColor: {
    type: String,
    default: "#c0932b", // Default chat color
  },
});

module.exports = mongoose.model("User", userSchema);
