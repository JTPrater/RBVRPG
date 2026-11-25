/**
 * Grant (or revoke) admin rights, or the owner's, on an existing account.
 *
 *   node scripts/makeAdmin.js <email>                  → grant admin
 *   node scripts/makeAdmin.js <email> --revoke         → revoke admin
 *   node scripts/makeAdmin.js <email> --owner          → make the owner (an admin too)
 *   node scripts/makeAdmin.js <email> --revoke-owner   → no longer the owner (stays an admin)
 *
 * An admin moderates (the moderation panel, /moderation: mutes, bans, the
 * padded room and hell). The owner also lets players out of hell, makes and
 * unmakes admins from the panel, gives passengers new passwords, and keeps
 * the room editor (/admin/room-editor) and the voyage's clock
 * (/api/admin/reset-voyage). See lib/moderation.js.
 */
require("dotenv").config();
const mongoose = require("mongoose");
const User = require("../models/User");

async function main() {
  const email = process.argv[2];
  const flags = new Set(process.argv.slice(3));
  if (!email || email.startsWith("--")) {
    console.error(
      "Usage: node scripts/makeAdmin.js <email> [--revoke | --owner | --revoke-owner]",
    );
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

  const was = { admin: !!user.isAdmin, owner: !!user.isOwner };
  if (flags.has("--owner")) {
    user.isOwner = true;
    user.isAdmin = true;
  } else if (flags.has("--revoke-owner")) {
    user.isOwner = false;
  } else if (flags.has("--revoke")) {
    user.isAdmin = false;
    user.isOwner = false;
  } else {
    user.isAdmin = true;
  }
  await user.save();
  console.log(
    `${email}: admin ${was.admin} -> ${user.isAdmin}, owner ${was.owner} -> ${user.isOwner}`,
  );

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
