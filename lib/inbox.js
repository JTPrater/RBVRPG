// Messages between passengers (2026-11-25): the rules of the game's Inbox
// card (public/game/modules/inbox.js). server.js applies them ("inbox-list",
// "inbox-thread", "inbox-send"; the number on the Inbox button, "badges").
//
// A passenger writes to any other passenger who is not banned, and reads
// what they were sent, and the replies, in one thread for each passenger
// written with. Not while muted (a message is words, like a chat line) or
// locked in by a moderator. One message every second and a half, and so many
// an hour, so a page cannot flood anyone.

const MAX_TEXT = 1000;
const PACE = { gapMs: 1500, perHour: 120 };
const THREAD_LIMIT = 100; // the latest messages of a thread shown
const LIST_LIMIT = 50; // the passengers written with shown

const isId = (value) => typeof value === "string" && /^[a-f0-9]{24}$/i.test(value);

// A message's words as written, with its lines: no control characters,
// spaces at the ends of lines and more than one empty line in a row taken out
function cleanText(value) {
  if (typeof value !== "string") return "";
  return value
    .replace(/\r\n?/g, "\n")
    .replace(/\t/g, " ")
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, "")
    .replace(/ +\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// What the page asked to send, checked: { to, text } or { error }
function cleanMessage(body) {
  const b = body && typeof body === "object" ? body : {};
  if (!isId(b.to)) return { error: "no-one" };
  const text = cleanText(b.text);
  if (!text) return { error: "empty" };
  if (text.length > MAX_TEXT) return { error: "too-long" };
  return { to: b.to.toLowerCase(), text };
}

module.exports = { MAX_TEXT, PACE, THREAD_LIMIT, LIST_LIMIT, isId, cleanText, cleanMessage };
