const assert = require("assert");
const {
  TIMELINE_MS,
  TIMELINE_SECONDS,
  computeVoyageState,
  getCurrentVoyageState,
  SHIP_ACCELERATION,
  CHERBOURG_DECEL_RATE,
} = require("../lib/voyageState");

const voyageStart = Date.UTC(2026, 0, 1, 12, 0, 0);

function elapsedState(offsetSeconds) {
  return computeVoyageState(offsetSeconds);
}

// Before departure
{
  const s = elapsedState(0);
  assert.strictEqual(s.location, "Southampton");
  assert.strictEqual(s.speedValue, 0);
}

// Southampton Water acceleration
{
  const dep = TIMELINE_SECONDS.DEPARTURE_DELAY + 100;
  const s = elapsedState(dep);
  assert.strictEqual(s.location, "Southampton Water");
  assert.ok(s.speedValue > 0 && s.speedValue <= 6);
}

// Solent cruising at 12 knots
{
  const t =
    TIMELINE_SECONDS.DEPARTURE_DELAY +
    TIMELINE_SECONDS.SOUTHAMPTON_WATER_END +
    600;
  const s = elapsedState(t);
  assert.strictEqual(s.location, "The Solent");
  assert.strictEqual(s.speedValue, 12);
}

// Channel at 19 knots
{
  const t =
    TIMELINE_SECONDS.DEPARTURE_DELAY +
    TIMELINE_SECONDS.NEEDLES_COMPLETE +
    3600;
  const s = elapsedState(t);
  assert.strictEqual(s.location, "English Channel");
  assert.strictEqual(s.speedValue, 19);
}

// Server wrapper uses wall clock (berthed after departure delay + berthing phase)
{
  const now =
    voyageStart +
    TIMELINE_MS.DEPARTURE_DELAY +
    TIMELINE_MS.BERTHING_COMPLETE +
    5000;
  const s = getCurrentVoyageState(voyageStart, now);
  assert.strictEqual(s.location, "Cherbourg");
  assert.strictEqual(s.speedValue, 0);
}

// Timeline seconds match milliseconds
assert.strictEqual(
  TIMELINE_SECONDS.DEPARTURE_DELAY,
  TIMELINE_MS.DEPARTURE_DELAY / 1000,
);
assert.ok(SHIP_ACCELERATION > 0);
assert.ok(CHERBOURG_DECEL_RATE > 0);

console.log("voyageState.test.js: all assertions passed");
