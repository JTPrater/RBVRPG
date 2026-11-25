// Moderation (2026-11-24): bans, mutes, and two rooms a player cannot leave,
// the padded room and, for the worst of the worst, hell. For the ship's admins
// and its owner. This file holds the rules; server.js applies them (each join,
// line of chat, deal and purchase is checked there, whatever a player's page
// does) and serves the moderation panel (/moderation).
//
// Who may do what:
//   an admin   mutes and unmutes, bans and unbans, sends a player to the
//              padded room or to hell, lets them out of the padded room
//   the owner  all of that, and lets players out of hell, makes and unmakes
//              admins, and gives a player a new password
// Nobody acts on the owner or on themselves, and only the owner acts on an
// admin. A player in hell is the owner's: only the owner moves them out of it
// (to the padded room, or free).

// The rooms a player can be locked in, and what each offers
const PLACES = {
  // cards, the cabin's shower, lavatory and bed, and plain fare
  padded_room: { menu: ["Helping rice", "Water"], poker: true },
  // nothing at all
  hell: { menu: [], poker: false },
};
const isPlace = (room) =>
  typeof room === "string" && Object.prototype.hasOwnProperty.call(PLACES, room);

const ACTIONS = [
  "mute",
  "unmute",
  "ban",
  "unban",
  "padded",
  "hell",
  "release",
  "make-admin",
  "remove-admin",
  "reset-password",
];
const OWNER_ONLY = new Set(["make-admin", "remove-admin", "reset-password"]);
// a reason is asked for each of these (the log says why)
const NEEDS_REASON = new Set(["ban", "padded", "hell"]);
// a mute or ban runs for minutes, or until lifted (none given)
const TIMED = new Set(["mute", "ban"]);
const MAX_MINUTES = 365 * 24 * 60;
const MAX_REASON = 300;

function roleOf(user) {
  if (!user) return null;
  if (user.isOwner) return "owner";
  if (user.isAdmin) return "admin";
  return null;
}

function nameOf(user) {
  const c = (user && user.character) || {};
  return `${c.forename || ""} ${c.surname || ""}`.trim() || "Passenger";
}

const iso = (d) => (d ? new Date(d).toISOString() : null);

// A mute or ban that holds at `now` (one whose time is up does not)
function inForce(measure, now = Date.now()) {
  if (!measure || !measure.active) return null;
  if (measure.until && new Date(measure.until).getTime() <= now) return null;
  return measure;
}

function plainMeasure(m) {
  return m
    ? { until: iso(m.until), reason: m.reason || "", by: m.by || "", at: iso(m.at) }
    : null;
}

function confinementOf(user) {
  const c = user && user.moderation && user.moderation.confinement;
  return c && isPlace(c.place) ? c : null;
}

// What holds for a player now: their role, and any mute, ban or confinement
function statusOf(user, now = Date.now()) {
  const mod = (user && user.moderation) || {};
  const conf = confinementOf(user);
  return {
    role: roleOf(user),
    mute: plainMeasure(inForce(mod.mute, now)),
    ban: plainMeasure(inForce(mod.ban, now)),
    confinement: conf
      ? { place: conf.place, reason: conf.reason || "", by: conf.by || "", at: iso(conf.at) }
      : null,
  };
}

// What the player's own game is told (not which moderator it was)
function forPlayer(status) {
  const s = status || {};
  return {
    role: s.role || null,
    mute: s.mute ? { until: s.mute.until, reason: s.mute.reason } : null,
    confinement: s.confinement
      ? { place: s.confinement.place, reason: s.confinement.reason }
      : null,
  };
}

// The mute of a status kept on a connection, if its time is not yet up
function muteNow(status, now = Date.now()) {
  const m = status && status.mute;
  if (!m) return null;
  if (m.until && Date.parse(m.until) <= now) return null;
  return m;
}

// The moderation panel's request, checked: { action, player, reason, minutes }
// or { error }
function cleanRequest(body) {
  const b = body && typeof body === "object" ? body : {};
  const action = typeof b.action === "string" ? b.action : "";
  if (!ACTIONS.includes(action)) return { error: "Unknown action." };
  const player =
    typeof b.player === "string" && /^[a-f0-9]{24}$/i.test(b.player) ? b.player : null;
  if (!player) return { error: "No such passenger." };
  const reason =
    typeof b.reason === "string" ? b.reason.replace(/\s+/g, " ").trim().slice(0, MAX_REASON) : "";
  if (NEEDS_REASON.has(action) && !reason) return { error: "Write a reason." };
  let minutes = null;
  if (TIMED.has(action) && b.minutes != null && b.minutes !== "") {
    const m = Number(b.minutes);
    if (!Number.isInteger(m) || m < 1 || m > MAX_MINUTES) return { error: "Choose how long." };
    minutes = m;
  }
  return { action, player, reason, minutes };
}

// Why the actor may not do this to the target (null: they may)
function refusal(actor, target, action, now = Date.now()) {
  const role = roleOf(actor);
  if (!role) return "Only moderators can do that.";
  if (!ACTIONS.includes(action)) return "Unknown action.";
  if (!target) return "No such passenger.";
  if (String(actor._id) === String(target._id)) return "You cannot do that to yourself.";
  if (target.isOwner) return "Nobody can do that to the owner.";
  if (OWNER_ONLY.has(action) && role !== "owner") return "Only the owner can do that.";
  if (target.isAdmin && role !== "owner") return "Only the owner can do that to an admin.";
  const conf = confinementOf(target);
  if (
    conf &&
    conf.place === "hell" &&
    (action === "release" || action === "padded") &&
    role !== "owner"
  ) {
    return "Only the owner can let a player out of hell.";
  }
  const mod = target.moderation || {};
  if (action === "release" && !conf) return "This passenger is not locked in.";
  if (action === "padded" && conf && conf.place === "padded_room") return "Already in the padded room.";
  if (action === "hell" && conf && conf.place === "hell") return "Already in hell.";
  if (action === "unmute" && !inForce(mod.mute, now)) return "This passenger is not muted.";
  if (action === "unban" && !inForce(mod.ban, now)) return "This passenger is not banned.";
  if (action === "make-admin" && target.isAdmin) return "Already an admin.";
  if (action === "remove-admin" && !target.isAdmin) return "Not an admin.";
  return null;
}

// The database's own check, in the update itself: what refusal() read could
// have changed in between (another moderator acting on the same passenger)
function guardFilter(actor, action, targetId) {
  const filter = { _id: targetId, isOwner: { $ne: true } };
  if (roleOf(actor) !== "owner") {
    filter.isAdmin = { $ne: true };
    if (action === "release" || action === "padded") {
      filter["moderation.confinement.place"] = { $ne: "hell" };
    }
  }
  return filter;
}

// The change to the passenger's record
function updateFor(action, { actor, reason, minutes, now = Date.now() }) {
  const by = { by: nameOf(actor), byId: actor._id, at: new Date(now) };
  const until = minutes ? new Date(now + minutes * 60 * 1000) : null;
  switch (action) {
    case "mute":
      return { $set: { "moderation.mute": { active: true, until, reason, ...by } } };
    case "unmute":
      return { $unset: { "moderation.mute": "" } };
    case "ban":
      return { $set: { "moderation.ban": { active: true, until, reason, ...by } } };
    case "unban":
      return { $unset: { "moderation.ban": "" } };
    case "padded":
      return { $set: { "moderation.confinement": { place: "padded_room", reason, ...by } } };
    case "hell":
      return { $set: { "moderation.confinement": { place: "hell", reason, ...by } } };
    case "release":
      return { $unset: { "moderation.confinement": "" } };
    case "make-admin":
      return { $set: { isAdmin: true } };
    case "remove-admin":
      return { $set: { isAdmin: false } };
    default:
      return null;
  }
}

// What a player's page is told when their standing was found changed (not
// by an action this server took: a moderator acted while they connected)
function eventBetween(before, after) {
  const placeBefore = before && before.confinement && before.confinement.place;
  const placeAfter = after && after.confinement && after.confinement.place;
  if (placeAfter && placeAfter !== placeBefore) return "confined";
  if (placeBefore && !placeAfter) return "released";
  const muteBefore = before && before.mute;
  const muteAfter = after && after.mute;
  if (muteAfter && (!muteBefore || muteBefore.until !== muteAfter.until)) return "muted";
  if (muteBefore && !muteAfter) return "unmuted";
  if (((before && before.role) || null) !== ((after && after.role) || null)) return "role";
  return null;
}

// What the player's game is told of the change ("moderation-status" event)
const EVENT_OF = {
  mute: "muted",
  unmute: "unmuted",
  padded: "confined",
  hell: "confined",
  release: "released",
  "make-admin": "role",
  "remove-admin": "role",
};

// ── Second accounts ──────────────────────────────────────────────────────────
// Each account keeps the marks it was seen with (server.js recordSeen): its
// browser's own random id (js/device.js) and its network. Two accounts seen
// with the same mark are linked. The same browser is a strong sign of one
// person; the same network a weak one (a family, a school, a café share one).

const DEVICE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
// a browser's mark, as it sent it (null: none, or not one of ours)
function deviceMark(id) {
  return typeof id === "string" && DEVICE_ID.test(id) ? id : null;
}

// A network's mark: an IPv4 address whole; an IPv6 one by its first four
// groups (a household's /64: the last four change by the hour)
function networkMark(ip) {
  if (typeof ip !== "string") return null;
  let a = ip.trim().replace(/%.*$/, "");
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(a);
  if (mapped) a = mapped[1];
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(a)) return a;
  if (!/^[0-9a-f:]+$/i.test(a) || !a.includes(":")) return null;
  const halves = a.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const groups =
    halves.length === 2
      ? [...head, ...Array(Math.max(0, 8 - head.length - tail.length)).fill("0"), ...tail]
      : head;
  if (groups.length !== 8) return null;
  return `${groups.slice(0, 4).map((g) => g.toLowerCase().replace(/^0+(?=.)/, "")).join(":")}::/64`;
}

// The marks an account keeps: of each kind (browser, network) its first two
// for good, and the four seen most recently. Keeping only the most recent
// would let a player cut the link to a banned account: be seen with enough
// new browsers and the shared one falls out. At most 12 in all.
const MARKS_FIRST = 2;
const MARKS_RECENT = 4;
function keepMarks(list) {
  const kept = [];
  for (const kind of ["browser", "network"]) {
    const ofKind = list.filter((m) => m && m.kind === kind);
    const time = (d) => new Date(d || 0).getTime();
    const first = [...ofKind].sort((a, b) => time(a.first) - time(b.first)).slice(0, MARKS_FIRST);
    const recent = ofKind
      .filter((m) => !first.includes(m))
      .sort((a, b) => time(b.last) - time(a.last))
      .slice(0, MARKS_RECENT);
    kept.push(...first, ...recent);
  }
  return kept;
}

// Which accounts are linked, and how: id -> { browser: Set, network: Set }
// (an account linked by both is listed under "browser" only)
function linkAccounts(users) {
  const byMark = new Map();
  for (const u of users) {
    const id = String(u._id);
    for (const s of u.seenOn || []) {
      if (!s || !s.hash || (s.kind !== "browser" && s.kind !== "network")) continue;
      const key = `${s.kind}|${s.hash}`;
      const ids = byMark.get(key) || new Set();
      ids.add(id);
      byMark.set(key, ids);
    }
  }
  const links = new Map();
  for (const [key, ids] of byMark) {
    if (ids.size < 2) continue;
    const kind = key.slice(0, key.indexOf("|"));
    for (const id of ids) {
      const entry = links.get(id) || { browser: new Set(), network: new Set() };
      for (const other of ids) if (other !== id) entry[kind].add(other);
      links.set(id, entry);
    }
  }
  for (const entry of links.values()) {
    for (const id of entry.browser) entry.network.delete(id);
  }
  return links;
}

// Is this account possibly a second one of a passenger who is banned, locked
// in or muted? { kind: "browser" | "network", of: [ids] }, or null.
// standing: id -> statusOf()
function flagOf(id, links, standing) {
  const entry = links.get(id);
  if (!entry) return null;
  const caught = (ids) =>
    [...ids].filter((other) => {
      const s = standing.get(other);
      return !!(s && (s.ban || s.confinement || s.mute));
    });
  const byBrowser = caught(entry.browser);
  if (byBrowser.length) return { kind: "browser", of: byBrowser };
  const byNetwork = caught(entry.network);
  if (byNetwork.length) return { kind: "network", of: byNetwork };
  return null;
}

// A passenger as the moderation panel lists them. `online`: where they are
// ({ room }), if they are aboard; the email only for the owner's eyes;
// `links`, `standing` (linkAccounts, and every account's statusOf): the
// accounts linked to this one, and whether that flags it. Never the marks.
function summary(
  user,
  { online = null, viewerRole = null, now = Date.now(), links = null, standing = null } = {},
) {
  const c = user.character || {};
  const s = statusOf(user, now);
  const out = {
    id: String(user._id),
    name: nameOf(user),
    cabin: c.cabin_number || "",
    cabinType: c.cabin || "",
    avatar: typeof c.avatar === "string" ? c.avatar : "",
    role: s.role,
    online: !!online,
    room: (online && online.room) || null,
    mute: s.mute,
    ban: s.ban,
    confinement: s.confinement,
    links: { browser: [], network: [] },
    flag: null,
    // the purse (the Money card), when the record was read with it
    money: user.stats ? Math.round((Number(user.stats.money) || 0) * 100) / 100 : null,
  };
  if (links) {
    const id = String(user._id);
    const entry = links.get(id);
    if (entry) out.links = { browser: [...entry.browser], network: [...entry.network] };
    if (standing) out.flag = flagOf(id, links, standing);
  }
  if (viewerRole === "owner") out.email = user.email || "";
  return out;
}

module.exports = {
  PLACES,
  isPlace,
  ACTIONS,
  OWNER_ONLY,
  MAX_MINUTES,
  MAX_REASON,
  roleOf,
  nameOf,
  inForce,
  statusOf,
  forPlayer,
  muteNow,
  cleanRequest,
  refusal,
  guardFilter,
  updateFor,
  eventBetween,
  EVENT_OF,
  deviceMark,
  networkMark,
  keepMarks,
  linkAccounts,
  flagOf,
  summary,
};
