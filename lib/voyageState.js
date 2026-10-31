/**
 * Single source of truth for voyage timeline and ship kinematics.
 * Used by server.js, public/game/game.js (via /lib/voyageState.js), and tests.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.VoyageState = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const TIMELINE_MS = {
    DEPARTURE_DELAY: 12 * 60 * 1000,
    SOUTHAMPTON_WATER_END: 20 * 60 * 1000,
    NEEDLES_PASS: 4_650_000,
    NEEDLES_COMPLETE: 5_130_000,
    CHANNEL_COMPLETE: 5 * 60 * 60 * 1000,
    APPROACH_COMPLETE: 18_900_000,
    BERTHING_COMPLETE: 19_500_000,
  };

  const SHIP_ACCELERATION = 0.012;

  const CHERBOURG_DECEL_RATE =
    19 /
    ((TIMELINE_MS.BERTHING_COMPLETE - TIMELINE_MS.CHANNEL_COMPLETE) / 1000);

  const TIMELINE_SECONDS = {
    DEPARTURE_DELAY: TIMELINE_MS.DEPARTURE_DELAY / 1000,
    SOUTHAMPTON_WATER_END: TIMELINE_MS.SOUTHAMPTON_WATER_END / 1000,
    NEEDLES_PASS: TIMELINE_MS.NEEDLES_PASS / 1000,
    NEEDLES_COMPLETE: TIMELINE_MS.NEEDLES_COMPLETE / 1000,
    CHANNEL_COMPLETE: TIMELINE_MS.CHANNEL_COMPLETE / 1000,
    APPROACH_COMPLETE: TIMELINE_MS.APPROACH_COMPLETE / 1000,
    BERTHING_COMPLETE: TIMELINE_MS.BERTHING_COMPLETE / 1000,
  };

  /**
   * @param {number} elapsedSeconds Total seconds since voyageStartTime
   */
  function computeVoyageState(elapsedSeconds) {
    let location = "Southampton";
    let speed = "0 knots";
    let speedValue = 0;
    let targetSpeed = 0;

    const {
      DEPARTURE_DELAY,
      SOUTHAMPTON_WATER_END,
      NEEDLES_COMPLETE,
      CHANNEL_COMPLETE,
      BERTHING_COMPLETE,
    } = TIMELINE_MS;

    const elapsedSinceDeparture = Math.max(
      0,
      elapsedSeconds - DEPARTURE_DELAY / 1000,
    );

    if (elapsedSeconds < DEPARTURE_DELAY / 1000) {
      location = "Southampton";
      speedValue = 0;
      targetSpeed = 0;
    } else if (elapsedSinceDeparture * 1000 < SOUTHAMPTON_WATER_END) {
      location = "Southampton Water";
      targetSpeed = 6;
      const timeToReach6Knots = 6 / SHIP_ACCELERATION;
      if (elapsedSinceDeparture < timeToReach6Knots) {
        speedValue = Math.min(6, elapsedSinceDeparture * SHIP_ACCELERATION);
      } else {
        speedValue = 6;
      }
      speed = `${speedValue.toFixed(1)} knots`;
    } else if (elapsedSinceDeparture * 1000 < NEEDLES_COMPLETE) {
      location = "The Solent";
      targetSpeed = 12;
      const elapsedInSolent =
        elapsedSinceDeparture - SOUTHAMPTON_WATER_END / 1000;
      const timeToReach12Knots = (12 - 6) / SHIP_ACCELERATION;
      if (elapsedInSolent < timeToReach12Knots) {
        speedValue = Math.min(12, 6 + elapsedInSolent * SHIP_ACCELERATION);
      } else {
        speedValue = 12;
      }
      speed = `${speedValue.toFixed(1)} knots`;
    } else if (elapsedSinceDeparture * 1000 < CHANNEL_COMPLETE) {
      location = "English Channel";
      targetSpeed = 19;
      const elapsedInChannel =
        elapsedSinceDeparture - NEEDLES_COMPLETE / 1000;
      const timeToReach19Knots = (19 - 12) / SHIP_ACCELERATION;
      if (elapsedInChannel < timeToReach19Knots) {
        speedValue = Math.min(19, 12 + elapsedInChannel * SHIP_ACCELERATION);
      } else {
        speedValue = 19;
      }
      speed = `${speedValue.toFixed(1)} knots`;
    } else if (elapsedSinceDeparture * 1000 < BERTHING_COMPLETE) {
      const elapsedSinceChannelEntry = Math.max(
        0,
        elapsedSinceDeparture - CHANNEL_COMPLETE / 1000,
      );
      const drop = elapsedSinceChannelEntry * CHERBOURG_DECEL_RATE;
      speedValue = Math.max(0, 19 - drop);
      targetSpeed = Math.max(0, speedValue - CHERBOURG_DECEL_RATE);

      if (speedValue > 6) {
        location = "Approaching Cherbourg";
      } else if (speedValue > 0) {
        location = "Cherbourg Harbour";
      } else {
        location = "Cherbourg";
      }

      speed = `${speedValue.toFixed(1)} knots`;
    } else {
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

  function getCurrentVoyageState(voyageStartTime, nowMs = Date.now()) {
    const elapsedSeconds = Math.floor((nowMs - voyageStartTime) / 1000);
    return computeVoyageState(elapsedSeconds);
  }

  return {
    TIMELINE_MS,
    TIMELINE_SECONDS,
    SHIP_ACCELERATION,
    CHERBOURG_DECEL_RATE,
    computeVoyageState,
    getCurrentVoyageState,
  };
});
