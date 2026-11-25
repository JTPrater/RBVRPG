// How often one passenger may do a thing (2026-11-25): a gap between two,
// and so many an hour, so a page cannot flood anyone. Used for messages
// (lib/inbox.js) and events (lib/shipEvents.js); money keeps its own
// (lib/money.js paceSend).
//
// times: the passenger's recent times (kept by the caller), changed in place.
// Answers { ok } or { error: "too-fast" | "too-many" }.
function pace(times, { gapMs, perHour }, now = Date.now()) {
  while (times.length && now - times[0] > 60 * 60 * 1000) times.shift();
  if (times.length && now - times[times.length - 1] < gapMs) return { error: "too-fast" };
  if (times.length >= perHour) return { error: "too-many" };
  times.push(now);
  return { ok: true };
}

module.exports = { pace };
