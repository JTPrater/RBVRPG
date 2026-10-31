const fs = require("fs");
const path = "public/game/game.js";
let src = fs.readFileSync(path, "utf8");

const header = `const socket = window.RBV.socket;

const {
  TIMELINE_SECONDS,
  TIMELINE_MS,
  computeVoyageState,
  SHIP_ACCELERATION,
  CHERBOURG_DECEL_RATE,
} = window.VoyageState;

RBV.gameState = {
  currentRoom: { name: null, id: null },
  chatHistory: { rooms: {} },
  isGlobalChat: false,
};
const currentRoom = RBV.gameState.currentRoom;
const chatHistory = RBV.gameState.chatHistory;
let isGlobalChat = RBV.gameState.isGlobalChat;
Object.defineProperty(RBV.gameState, "isGlobalChat", {
  get() {
    return isGlobalChat;
  },
  set(value) {
    isGlobalChat = value;
  },
});

const v = RBV.voyage;
const narrativeSystem = window.narrativeSystem;
const musicPlayer = window.musicPlayer;
const deckRooms = window.deckRooms;
const roomImages = window.roomImages;

console.debug("✅ Initialized game shell (socket, voyage, room data).");

`;

// Drop old header through setScale block
src = src.replace(
  /^const socket = window\.RBV\.socket;[\s\S]*?setScale\(\); \/\/ Initial call to set the scale\n\n/,
  "",
);

// Remove stray leftover comment from partial extraction
src = src.replace(/\n\/\/ Define room images for rooms with multiple variants\n\n/g, "\n");

// Remove duplicate musicPlayer line if present before DOMContentLoaded
src = src.replace(/\nconst musicPlayer = window\.musicPlayer;\n(?=\/\/ Single DOMContentLoaded)/, "\n");

const replacements = [
  [/\bvoyageStartTime\b/g, "v.voyageStartTime"],
  [/\bpendingVoyageState\b/g, "v.pendingVoyageState"],
  [/\bpendingVoyageStartTime\b/g, "v.pendingVoyageStartTime"],
  [/\binitialSyncDone\b/g, "v.initialSyncDone"],
  [/\blastServerElapsedAt\b/g, "v.lastServerElapsedAt"],
  [/\blastServerElapsed\b/g, "v.lastServerElapsed"],
  [/\blatestVoyageState\b/g, "v.latestVoyageState"],
  [/\bCHERBOURG_SHOW_KNOTS\b/g, "v.CHERBOURG_SHOW_KNOTS"],
  [/\bCHERBOURG_SLOW_MOVE_FACTOR\b/g, "v.CHERBOURG_SLOW_MOVE_FACTOR"],
  [/\bDEV_NORTH_ATLANTIC\b/g, "v.DEV_NORTH_ATLANTIC"],
  [/\bDEV_HOUR\b/g, "v.DEV_HOUR"],
];

for (const [pattern, replacement] of replacements) {
  src = src.replace(pattern, replacement);
}

fs.writeFileSync(path, header + src);
console.log("Patched", path, "->", header.split("\n").length + src.split("\n").length, "lines");
