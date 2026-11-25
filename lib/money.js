// Money between passengers (2026-11-25): the rules of sending it, and of the
// list of the richest aboard. server.js applies them ("money-send",
// "money-overview", "money-people"); the game's Money card
// (public/game/modules/money.js) shows them.
//
// A passenger sends any amount they have, in pounds and pence, to any other
// passenger who is not banned, with a short note if they like. It is taken
// from them and given to the other in two single updates, each kept to whole
// pence, the first only if the money is there (so no two sends at once can
// spend it twice). Not while locked in by a moderator; and a muted passenger
// sends no note (a note is a line of text the other reads). One send every
// few seconds, and so many an hour, so a page cannot flood anyone.

const MAX_NOTE = 80;
const MAX_POUNDS = 10000000; // more than anyone aboard has
const SEND_GAP_MS = 3000;
const SENDS_PER_HOUR = 30;

// "12.5", 12.5, "12.50" -> 12.5; anything else (less than a penny, part of a
// penny, not a number) -> null
function parseAmount(value) {
  const n = typeof value === "string" ? Number(value.trim()) : value;
  if (typeof n !== "number" || !Number.isFinite(n)) return null;
  const pence = Math.round(n * 100);
  if (Math.abs(n * 100 - pence) > 1e-6) return null;
  if (pence < 1 || pence > MAX_POUNDS * 100) return null;
  return pence / 100;
}

function cleanNote(value) {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, MAX_NOTE);
}

// What the page asked to send, checked: { to, amount, note } or { error }
function cleanSend(body) {
  const b = body && typeof body === "object" ? body : {};
  const to = typeof b.to === "string" && /^[a-f0-9]{24}$/i.test(b.to) ? b.to : null;
  if (!to) return { error: "no-one" };
  const amount = parseAmount(b.amount);
  if (amount === null) return { error: "amount" };
  return { to, amount, note: cleanNote(b.note) };
}

// The pace of one passenger's sends: { ok } or { error: "too-fast" | "too-many" }.
// times: that passenger's recent send times (kept by the caller), changed in place.
function paceSend(times, now = Date.now()) {
  while (times.length && now - times[0] > 60 * 60 * 1000) times.shift();
  if (times.length && now - times[times.length - 1] < SEND_GAP_MS) return { error: "too-fast" };
  if (times.length >= SENDS_PER_HOUR) return { error: "too-many" };
  times.push(now);
  return { ok: true };
}

// The database's test for "banned now" (lib/moderation.js inForce), so the
// richest list and the counts leave banned accounts out
function bannedNow(now = Date.now()) {
  return {
    "moderation.ban.active": true,
    $or: [{ "moderation.ban.until": null }, { "moderation.ban.until": { $gt: new Date(now) } }],
  };
}
// passengers with a character, not banned
function aboardFilter(now = Date.now()) {
  return { "character.forename": { $exists: true, $ne: "" }, $nor: [bannedNow(now)] };
}

const pounds = (n) => Math.round((Number(n) || 0) * 100) / 100;

module.exports = {
  MAX_NOTE,
  SEND_GAP_MS,
  SENDS_PER_HOUR,
  parseAmount,
  cleanNote,
  cleanSend,
  paceSend,
  bannedNow,
  aboardFilter,
  pounds,
};
