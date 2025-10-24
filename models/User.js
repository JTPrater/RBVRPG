const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    email: {
        type: String,
        required: true,
        unique: true
    },
    password: {
        type: String,
        required: true
    },
    character: {
        forename: String,
        surname: String,
        birthdate: Date,
        cabin: String,
        bio: String,
        avatar: String
    }
});

module.exports = mongoose.model('User', userSchema);