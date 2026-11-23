/**
 * Reset voyage clock in MongoDB to "now" (Southampton / pre-departure).
 * Restart the game server afterward if it is already running.
 */
require("dotenv").config();
const mongoose = require("mongoose");
const ServerState = require("../models/ServerState");

async function main() {
  if (!process.env.MONGO_URL) {
    console.error("MONGO_URL is not set in .env");
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGO_URL);

  const previous = await ServerState.findOne({ key: "voyageStartTime" });
  const voyageStartTime = Date.now();

  await ServerState.findOneAndUpdate(
    { key: "voyageStartTime" },
    { value: voyageStartTime },
    { upsert: true },
  );

  if (previous?.value) {
    const elapsedHours = ((voyageStartTime - previous.value) / 3_600_000).toFixed(
      2,
    );
    console.log(
      `Previous voyage started: ${new Date(previous.value).toISOString()} (${elapsedHours}h ago)`,
    );
  } else {
    console.log("No previous voyageStartTime record found; created a new one.");
  }

  console.log(
    `Voyage clock reset to: ${new Date(voyageStartTime).toISOString()} (Southampton)`,
  );

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
