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
});

module.exports = mongoose.model("User", userSchema);
