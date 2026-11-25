// Events aboard (2026-11-25): a passenger holds an event in a room of the
// ship, at a time of the ship's day (today or tomorrow), with a title and a
// few words on what it is. The game's Events card
// (public/game/modules/events.js) lists what is on and coming; server.js
// keeps them (models/ShipEvent.js) and says so in every chat as one starts.
//
// The ship's clock: 12:00 on the voyage's first day at the moment the voyage
// began (server.js voyageStartTime), running on with the real clock (as the
// game's own, game.js getBSTTime). Its days run midnight to midnight on it.

const MAX_TITLE = 60;
const MAX_DETAILS = 400;
const HOSTED_AT_ONCE = 3; // events one passenger has coming at once
const PACE = { gapMs: 20 * 1000, perHour: 6 };
const LASTS_MS = 60 * 60 * 1000; // an event is "on now" for an hour from its start
const ANNOUNCE_LATE_MS = 5 * 60 * 1000; // a start missed by longer is not announced
const LIST_LIMIT = 60;

const DAY_MIN = 24 * 60;
const NOON_MIN = 12 * 60;

// The ship's day (0 = the voyage's first) and minute of that day at a moment
function shipClock(voyageStart, at) {
  const minutes = NOON_MIN + Math.floor((at - voyageStart) / 60000);
  const day = Math.floor(minutes / DAY_MIN);
  return { day, minute: minutes - day * DAY_MIN };
}

// The moment of a minute of a ship's day
function momentOf(voyageStart, day, minute) {
  return new Date(voyageStart + (day * DAY_MIN + minute - NOON_MIN) * 60000);
}

const twoDigits = (n) => String(n).padStart(2, "0");
// "21:05", the ship's time of a minute of its day
const clockText = (minute) => `${twoDigits(Math.floor(minute / 60))}:${twoDigits(minute % 60)}`;

// a title: one line, its spaces single
function cleanTitle(value) {
  if (typeof value !== "string") return "";
  return value
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_TITLE);
}

// the description: lines kept, as a message's (lib/inbox.js)
function cleanDetails(value) {
  if (typeof value !== "string") return "";
  return value
    .replace(/\r\n?/g, "\n")
    .replace(/\t/g, " ")
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, "")
    .replace(/ +\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, MAX_DETAILS);
}

// What the page asked to hold, checked: { room, at, title, details } or
// { error }. day: 0 today, 1 tomorrow (the ship's days); time: "HH:MM" on
// the ship's clock; isRoom: whether a room can hold events.
function cleanEvent(body, { voyageStart, now = Date.now(), isRoom }) {
  const b = body && typeof body === "object" ? body : {};
  const title = cleanTitle(b.title);
  if (!title) return { error: "title" };
  if (typeof b.room !== "string" || !isRoom(b.room)) return { error: "room" };
  const day = Number(b.day);
  const time = /^(\d{1,2}):(\d{2})$/.exec(typeof b.time === "string" ? b.time.trim() : "");
  if ((day !== 0 && day !== 1) || !time) return { error: "time" };
  const hour = Number(time[1]);
  const minute = Number(time[2]);
  if (hour > 23 || minute > 59) return { error: "time" };
  const today = shipClock(voyageStart, now).day;
  const at = momentOf(voyageStart, today + day, hour * 60 + minute);
  if (at.getTime() <= now) return { error: "past" };
  return { room: b.room, at, title, details: cleanDetails(b.details) };
}

module.exports = {
  MAX_TITLE,
  MAX_DETAILS,
  HOSTED_AT_ONCE,
  PACE,
  LASTS_MS,
  ANNOUNCE_LATE_MS,
  LIST_LIMIT,
  shipClock,
  momentOf,
  clockText,
  cleanTitle,
  cleanDetails,
  cleanEvent,
};
