const mongoose = require("mongoose");

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
    lastUpdated: { type: Date, default: Date.now },
  },
  chatColor: {
    type: String,
    default: "#c0932b", // Default chat color
  },
});

module.exports = mongoose.model("User", userSchema);
