require("dotenv").config();
const { MongoClient } = require("mongodb");

async function main() {
  const client = new MongoClient(process.env.MONGO_URL);
  await client.connect();
  const db = client.db();
  const doc = await db
    .collection("serverstates")
    .findOne({ key: "voyageStartTime" });
  console.log(JSON.stringify(doc, null, 2));
  await client.close();
}
main().catch((err) => {
  console.error(err);
  process.exit(1);
});
