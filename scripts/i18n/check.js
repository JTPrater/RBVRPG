// Is everything on the game page in each language's dictionary? (2026-11-24)
// The rooms (public/game/data/deckRooms.js and the room labels in game.js) and
// the menus' dishes and their descriptions (public/game/menuData.js) must each
// have a Russian and a Spanish entry in public/js/i18n/<lang>-game.js (or in
// <lang>.js). A dish added or reworded in menuData.js without one shows in
// English to those players: this lists every such text, and exits 1.
// usage: npm run i18n:check
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..", "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const norm = (s) => String(s || "").replace(/\s+/g, " ").trim();

const dictCtx = { window: {} };
vm.createContext(dictCtx);
for (const f of ["ru.js", "ru-game.js", "es.js", "es-game.js"]) {
  vm.runInContext(read(`public/js/i18n/${f}`), dictCtx);
}
const dicts = dictCtx.window.RBV_I18N_DICT;

const menuCtx = {};
vm.createContext(menuCtx);
vm.runInContext(`${read("public/game/menuData.js")};this.M = MENU_DATA;`, menuCtx);

const roomCtx = { window: { RBV: {} } };
roomCtx.RBV = roomCtx.window.RBV;
vm.createContext(roomCtx);
vm.runInContext(read("public/game/data/deckRooms.js"), roomCtx);
const deckRooms = roomCtx.window.deckRooms;

// the room labels game.js shows (roomDisplayNames) and the plans' own buttons
const gameJs = read("public/game/game.js");
const labelBlock = /const roomDisplayNames = \{([\s\S]*?)\};/.exec(gameJs);
const labels = labelBlock ? [...labelBlock[1].matchAll(/:\s*"([^"]+)"/g)].map((m) => m[1]) : [];

const texts = new Map(); // English -> where it comes from
const add = (text, where) => {
  const t = norm(text);
  if (t && !texts.has(t)) texts.set(t, where);
};
for (const list of Object.values(deckRooms)) {
  if (Array.isArray(list)) list.forEach((r) => add(r.name, "deckRooms.js"));
}
labels.forEach((l) => add(l, "game.js room label"));
menuCtx.M.forEach((m) => {
  add(m.name, "menuData.js name");
  add(m.description, `menuData.js description of ${m.name}`);
});

// "Cabin A1", "Cabin B-81" are worded by a pattern (i18n.js, t.cabinNamed)
const byPattern = (t, lang) => /^Cabin [A-Z]-?\d+$/.test(t) && dicts[lang].t.cabinNamed;
// a cabin's label is its number ("A-10")
const noWords = (t) => !/[A-Za-z]{2,}/.test(t);

let missing = 0;
for (const lang of ["ru", "es"]) {
  const exact = dicts[lang].exact;
  const gaps = [...texts].filter(([t]) => !noWords(t) && !byPattern(t, lang) && !Object.prototype.hasOwnProperty.call(exact, t));
  missing += gaps.length;
  console.log(`${lang}: ${texts.size - gaps.length} of ${texts.size} texts translated`);
  for (const [t, where] of gaps) console.log(`  missing (${where}): ${JSON.stringify(t)}`);
}
process.exit(missing ? 1 : 0);
