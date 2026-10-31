/**
 * Grant (or revoke) admin rights on an existing account.
 *
 *   node scripts/makeAdmin.js <email>            → grant admin
 *   node scripts/makeAdmin.js <email> --revoke   → revoke admin
 *
 * Admin unlocks /admin/room-editor and the other /api/admin/* actions.
 */
require("dotenv").config();
const mongoose = require("mongoose");
const User = require("../models/User");

async function main() {
  const email = process.argv[2];
  const revoke = process.argv.includes("--revoke");
  if (!email) {
    console.error("Usage: node scripts/makeAdmin.js <email> [--revoke]");
    process.exit(1);
  }
  if (!process.env.MONGO_URL) {
    console.error("MONGO_URL is not set in .env");
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGO_URL);
  const user = await User.findOne({ email });
  if (!user) {
    console.error(`No account found for ${email}`);
    await mongoose.disconnect();
    process.exit(1);
  }

  const was = !!user.isAdmin;
  user.isAdmin = !revoke;
  await user.save();
  console.log(
    `${email}: isAdmin ${was} -> ${user.isAdmin}` +
      (was === user.isAdmin ? " (no change)" : ""),
  );

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
