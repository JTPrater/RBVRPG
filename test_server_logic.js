const TIMELINE_MS = {
  DEPARTURE_DELAY: 7 * 60 * 1000, // 7 minutes between prep and actual departure
  SOUTHAMPTON_WATER_END: 20 * 60 * 1000, // 20 minutes - 6 knots
  NEEDLES_PASS: 4_650_000, // 1h 17.5m - Isle of Wight passage start
  NEEDLES_COMPLETE: 5_130_000, // ~8 minutes after Needles start
  CHANNEL_COMPLETE: 5 * 60 * 60 * 1000, // 5 hours - English Channel complete
  APPROACH_COMPLETE: 18_900_000, // 15 minutes of Cherbourg approach (12 knots)
  BERTHING_COMPLETE: 19_500_000, // 10 minutes harbor entry to stop
};

const CHERBOURG_DECEL_RATE =
  19 / ((TIMELINE_MS.BERTHING_COMPLETE - TIMELINE_MS.CHANNEL_COMPLETE) / 1000);

// Global voyage start time (set when server starts)
// Begin from Southampton (real-time progression)
// Start 1 minute before sunset (BST 16:59)
const voyageStartTime = Date.now() - 299 * 60 * 1000; // 299 mins = 4h59m

function getCurrentVoyageState() {
  const elapsedSeconds = Math.floor((Date.now() - voyageStartTime) / 1000);

  let location = "Southampton";
  let speed = "0 knots";
  let speedValue = 0; // Actual current speed
  let targetSpeed = 0; // Target speed for smooth acceleration

  const {
    DEPARTURE_DELAY,
    SOUTHAMPTON_WATER_END,
    NEEDLES_COMPLETE,
    CHANNEL_COMPLETE,
    APPROACH_COMPLETE,
    BERTHING_COMPLETE,
  } = TIMELINE_MS;

  // Acceleration rate: 0.012 knots per second squared (matches client)
  const ACCELERATION = 0.012;

  // Departure happens DEPARTURE_DELAY milliseconds into the voyage
  const elapsedSinceDeparture = Math.max(
    0,
    elapsedSeconds - DEPARTURE_DELAY / 1000
  );

  if (elapsedSeconds < DEPARTURE_DELAY / 1000) {
    // Before departure
    location = "Southampton";
    speed = "0 knots";
    speedValue = 0;
    targetSpeed = 0;
  } else if (elapsedSinceDeparture * 1000 < SOUTHAMPTON_WATER_END) {
    // Southampton Water - accelerating to 6 knots
    location = "Southampton Water";
    targetSpeed = 6;

    // Calculate current speed based on acceleration from 0 to 6 knots
    // Time to reach 6 knots: 6 / 0.012 = 500 seconds
    const timeToReach6Knots = 6 / ACCELERATION;
    if (elapsedSinceDeparture < timeToReach6Knots) {
      speedValue = Math.min(6, elapsedSinceDeparture * ACCELERATION);
    } else {
      speedValue = 6;
    }
    speed = `${speedValue.toFixed(1)} knots`;
  } else if (elapsedSinceDeparture * 1000 < NEEDLES_COMPLETE) {
    // The Solent - accelerating from 6 to 12 knots
    location = "The Solent";
    targetSpeed = 12;

    // Calculate time elapsed since entering The Solent
    const elapsedInSolent =
      elapsedSinceDeparture - SOUTHAMPTON_WATER_END / 1000;

    // Time to accelerate from 6 to 12 knots: (12 - 6) / 0.012 = 500 seconds
    const timeToReach12Knots = (12 - 6) / ACCELERATION;

    if (elapsedInSolent < timeToReach12Knots) {
      // Still accelerating from 6 to 12
      speedValue = Math.min(12, 6 + elapsedInSolent * ACCELERATION);
    } else {
      // Reached 12 knots
      speedValue = 12;
    }
    speed = `${speedValue.toFixed(1)} knots`;
  } else if (elapsedSinceDeparture * 1000 < CHANNEL_COMPLETE) {
    // English Channel - accelerating from 12 to 19 knots, then cruising
    location = "English Channel";
    targetSpeed = 19;

    // Calculate time elapsed since entering English Channel
    const elapsedInChannel = elapsedSinceDeparture - NEEDLES_COMPLETE / 1000;

    // Time to accelerate from 12 to 19 knots: (19 - 12) / 0.012 = 583.33 seconds
    const timeToReach19Knots = (19 - 12) / ACCELERATION;

    if (elapsedInChannel < timeToReach19Knots) {
      // Still accelerating from 12 to 19
      speedValue = Math.min(19, 12 + elapsedInChannel * ACCELERATION);
    } else {
      // Reached 19 knots, cruising
      speedValue = 19;
    }
    speed = `${speedValue.toFixed(1)} knots`;
  } else if (elapsedSinceDeparture * 1000 < BERTHING_COMPLETE) {
    // Continuous Cherbourg deceleration from 19 knots down to 0 by berthing
    const elapsedSinceChannelEntry = Math.max(
      0,
      elapsedSinceDeparture - CHANNEL_COMPLETE / 1000
    );
    const drop = elapsedSinceChannelEntry * CHERBOURG_DECEL_RATE;
    speedValue = Math.max(0, 19 - drop);
    targetSpeed = Math.max(0, speedValue - CHERBOURG_DECEL_RATE);

    if (speedValue > 6) {
      location = "Approaching Cherbourg";
    } else if (speedValue > 0) {
      location = "Cherbourg Harbor";
    } else {
      location = "Cherbourg";
    }

    speed = `${speedValue.toFixed(1)} knots`;
  } else {
    // Berthed - full stop
    location = "Cherbourg";
    speed = "0 knots";
    speedValue = 0;
    targetSpeed = 0;
  }

  return {
    location,
    speed,
    speedValue,
    targetSpeed,
    elapsedSeconds,
    elapsedSinceDeparture,
  };
}

// Test helper: removed automatic invocation to avoid console noise
// console.log(getCurrentVoyageState());
