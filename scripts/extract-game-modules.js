const fs = require("fs");

const gamePath = "public/game/game.js";
const lines = fs.readFileSync(gamePath, "utf8").split(/\r?\n/);

function findSlice(startIncludes, endIncludes) {
  const start = lines.findIndex((l) => l.includes(startIncludes));
  const end = lines.findIndex((l, i) => i > start && l.includes(endIncludes));
  if (start < 0 || end < 0) {
    throw new Error(`markers not found: ${startIncludes} -> ${endIncludes}`);
  }
  return {
    start,
    endExclusive: end + 1,
    content: lines.slice(start, end),
  };
}

function wrapData(varName, content, filename) {
  return [
    "(function (RBV) {",
    ...content,
    "  RBV.data = RBV.data || {};",
    `  RBV.data.${varName} = ${varName};`,
    `  window.${varName} = ${varName};`,
    `  console.debug("✅ Defined ${varName}:", ${varName});`,
    "})(window.RBV);",
    "",
  ].join("\n");
}

const deck = findSlice("const deckRooms = {", 'Defined deckRooms:');
const rooms = findSlice("const roomImages = {", 'Defined roomImages:');

fs.mkdirSync("public/game/data", { recursive: true });
fs.writeFileSync("public/game/data/deckRooms.js", wrapData("deckRooms", deck.content));
fs.writeFileSync("public/game/data/roomImages.js", wrapData("roomImages", rooms.content));

let gameLines = [...lines];
for (const block of [rooms, deck]) {
  gameLines.splice(block.start, block.endExclusive - block.start);
}

fs.writeFileSync(gamePath, gameLines.join("\n"));
console.log(`Extracted deckRooms (${deck.content.length} lines)`);
console.log(`Extracted roomImages (${rooms.content.length} lines)`);
console.log(`game.js now ${gameLines.length} lines`);
