require("dotenv").config();
const mongoose = require("mongoose");
const User = require("./models/User");

async function setupAdmin() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGO_URL);
    console.log("✅ Connected to MongoDB");

    const adminEmail = process.env.ADMIN_EMAIL;
    if (!adminEmail) {
      console.error("❌ ADMIN_EMAIL not set in environment variables");
      process.exit(1);
    }

    // Find and update the admin user
    const result = await User.findOneAndUpdate(
      { email: adminEmail },
      { isAdmin: true },
      { new: true }
    );

    if (result) {
      console.log(`✅ Admin privileges granted to: ${adminEmail}`);
      console.log("Admin user details:", {
        email: result.email,
        isAdmin: result.isAdmin,
        character: result.character
          ? `${result.character.forename} ${result.character.surname}`
          : "No character",
      });
    } else {
      console.log(
        `⚠️ User with email ${adminEmail} not found. Make sure to register first.`
      );
      console.log("To set up admin:");
      console.log("1. Register an account with email:", adminEmail);
      console.log("2. Run this script again");
    }
  } catch (error) {
    console.error("❌ Error setting up admin:", error);
  } finally {
    await mongoose.disconnect();
    console.log("✅ Disconnected from MongoDB");
  }
}

setupAdmin();
