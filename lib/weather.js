/**
 * Deterministic voyage weather engine.
 *
 * Produces a full surface observation (sky, wind, temperature, barometer,
 * sea state, visibility) for any moment of the voyage, derived from:
 *   - the ship's position along the Southampton→Cherbourg course
 *     (interpolated from the VoyageState timeline),
 *   - the in-game local hour (game clock starts at 12:00 at voyage start),
 *   - late-June/early-July English Channel climatology, with a mildly
 *     unsettled maritime bias: barometer centred a shade low, temperatures
 *     ~1°C under modern normals, changeable WSW'ly weather dominating —
 *     typical of an early-20th-century Channel summer.
 *
 * Everything is a pure function of (elapsedSeconds, seed). The seed is the
 * voyage start time, which the server broadcasts to every client — so all
 * players compute byte-identical weather with no extra network traffic, and
 * each voyage reset rolls a fresh weather history.
 *
 * Used by server.js (require) and the game client (via /lib/weather.js).
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./voyageState"));
  } else {
    root.VoyageWeather = factory(root.VoyageState);
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (VoyageState) {
  const T = VoyageState.TIMELINE_SECONDS;

  // Course waypoints: absolute voyage seconds → position.
  // shelter: how much surrounding land knocks the wind/sea down (0 open sea, 1 dock)
  // land: land influence on air temperature (bigger day/night swing near shore)
  const ROUTE = [
    { t: 0, lat: 50.899, lon: -1.407, shelter: 1.0, land: 1.0 },
    { t: T.DEPARTURE_DELAY, lat: 50.899, lon: -1.407, shelter: 1.0, land: 1.0 },
    {
      t: T.DEPARTURE_DELAY + T.SOUTHAMPTON_WATER_END,
      lat: 50.82,
      lon: -1.34,
      shelter: 0.8,
      land: 0.8,
    },
    {
      t: T.DEPARTURE_DELAY + T.NEEDLES_COMPLETE,
      lat: 50.66,
      lon: -1.6,
      shelter: 0.35,
      land: 0.4,
    },
    {
      t: T.DEPARTURE_DELAY + (T.NEEDLES_COMPLETE + T.CHANNEL_COMPLETE) / 2,
      lat: 50.15,
      lon: -1.7,
      shelter: 0.0,
      land: 0.05,
    },
    {
      t: T.DEPARTURE_DELAY + T.CHANNEL_COMPLETE,
      lat: 49.75,
      lon: -1.63,
      shelter: 0.3,
      land: 0.35,
    },
    {
      t: T.DEPARTURE_DELAY + T.BERTHING_COMPLETE,
      lat: 49.645,
      lon: -1.622,
      shelter: 0.9,
      land: 0.9,
    },
  ];

  const COMPASS = [
    "N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
    "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW",
  ];

  const BEAUFORT = [
    { max: 1, text: "calm" },
    { max: 3, text: "light air" },
    { max: 6, text: "light breeze" },
    { max: 10, text: "gentle breeze" },
    { max: 16, text: "moderate breeze" },
    { max: 21, text: "fresh breeze" },
    { max: 27, text: "strong breeze" },
    { max: 33, text: "near gale" },
    { max: Infinity, text: "gale" },
  ];

  function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
  }

  // ---- Deterministic noise -------------------------------------------------

  function normalizeSeed(seedInput) {
    // Fold a ms timestamp (or anything numeric) into a well-mixed 32-bit int
    let h = Math.floor(Number(seedInput) || 0) >>> 0;
    h = Math.imul(h ^ (h >>> 16), 2246822519);
    h = Math.imul(h ^ (h >>> 13), 3266489917);
    return (h ^ (h >>> 16)) >>> 0;
  }

  function latticeHash(seed, n) {
    let h = (seed ^ Math.imul(n | 0, 2654435761)) >>> 0;
    h = Math.imul(h ^ (h >>> 16), 2246822519);
    h = Math.imul(h ^ (h >>> 13), 3266489917);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296; // 0..1
  }

  // 1-D value noise with smoothstep interpolation, 0..1
  function vnoise(seed, x) {
    const i = Math.floor(x);
    const f = x - i;
    const a = latticeHash(seed, i);
    const b = latticeHash(seed, i + 1);
    const u = f * f * (3 - 2 * f);
    return a + (b - a) * u;
  }

  // Fractal (octave) noise, 0..1
  function fbm(seed, x, octaves) {
    let sum = 0;
    let amp = 0.5;
    let freq = 1;
    let norm = 0;
    for (let o = 0; o < octaves; o++) {
      sum += amp * vnoise(seed + o * 101, x * freq);
      norm += amp;
      amp *= 0.5;
      freq *= 2;
    }
    return sum / norm;
  }

  // Signed variant, -1..1
  function sfbm(seed, x, octaves) {
    return fbm(seed, x, octaves) * 2 - 1;
  }

  // ---- Position ------------------------------------------------------------

  function getPosition(elapsedSeconds) {
    const t = clamp(elapsedSeconds, ROUTE[0].t, ROUTE[ROUTE.length - 1].t);
    let i = 1;
    while (i < ROUTE.length - 1 && t > ROUTE[i].t) i++;
    const a = ROUTE[i - 1];
    const b = ROUTE[i];
    const span = b.t - a.t || 1;
    const f = clamp((t - a.t) / span, 0, 1);
    return {
      lat: a.lat + (b.lat - a.lat) * f,
      lon: a.lon + (b.lon - a.lon) * f,
      shelter: a.shelter + (b.shelter - a.shelter) * f,
      land: a.land + (b.land - a.land) * f,
    };
  }

  // ---- Core observation ----------------------------------------------------

  function pressureAt(seed, hours) {
    // Long synoptic systems (~36 h) with short ripples (~8 h) riding on them.
    return (
      1012 +
      14 * sfbm(seed ^ 0xa1a1, hours / 36, 3) +
      4 * sfbm(seed ^ 0xb2b2, hours / 8, 2)
    );
  }

  /**
   * @param {number} elapsedSeconds seconds since voyage start
   * @param {number} seedInput voyage start time in ms (or any stable number)
   * @param {{lat,lon,shelter,land}} [posOverride] use this position instead
   *   of the route (admin/test scenarios)
   */
  function computeWeatherAt(elapsedSeconds, seedInput, posOverride) {
    const seed = normalizeSeed(seedInput);
    const hours = elapsedSeconds / 3600;
    const localHour = (12 + hours) % 24; // game clock starts at noon
    const pos = posOverride || getPosition(elapsedSeconds);

    // Barometer + three-hour tendency (ship's-log convention)
    const pressureMb = pressureAt(seed, hours);
    const tendency = pressureMb - pressureAt(seed, hours - 3);
    const pressureTrend =
      tendency > 0.5 ? "rising" : tendency < -0.5 ? "falling" : "steady";

    // Wind: prevailing SW'ly, stronger under low/falling glass, eased in shelter
    let windKn =
      7 + (1013 - pressureMb) * 0.9 + 5 * sfbm(seed ^ 0xc3c3, hours / 3, 2);
    windKn *= 1 - 0.55 * pos.shelter;
    windKn = clamp(windKn, 1, 38);
    const windDirDeg =
      ((225 + 75 * sfbm(seed ^ 0xd4d4, hours / 18, 2) + tendency * 4) % 360 +
        360) %
      360;
    const windDirText = COMPASS[Math.round(windDirDeg / 22.5) % 16];
    let beaufortIdx = 0;
    while (windKn > BEAUFORT[beaufortIdx].max) beaufortIdx++;
    const beaufortText = BEAUFORT[beaufortIdx].text;

    // Cloud cover follows the pressure field
    const cloudCover = clamp(
      0.5 + (1012 - pressureMb) / 24 + 0.35 * sfbm(seed ^ 0xe5e5, hours / 6, 2),
      0,
      1,
    );

    // Humidity proxy, higher overnight
    const nightBoost = localHour < 8 || localHour > 21 ? 0.06 : 0;
    const humidity = clamp(
      0.72 + 0.18 * sfbm(seed ^ 0xf6f6, hours / 9, 2) + nightBoost,
      0.4,
      1,
    );

    // Precipitation
    const instability = fbm(seed ^ 0x1717, hours / 4, 2);
    let precip = "none";
    if (cloudCover > 0.85 && pressureMb < 1004) {
      precip = "rain";
    } else if (cloudCover > 0.8 && pressureMb < 1009 && instability > 0.55) {
      precip = "showers";
    } else if (cloudCover > 0.88 && humidity > 0.85 && windKn < 12) {
      precip = "drizzle";
    }

    // Channel advection fog favours quiet, damp early mornings
    let fog = "none";
    if (
      precip === "none" &&
      windKn < 8 &&
      humidity > 0.87 &&
      localHour >= 2 &&
      localHour <= 9.5
    ) {
      fog = humidity > 0.93 && windKn < 5 ? "fog" : "mist";
    }

    // Visibility (nautical miles)
    const visibilityNm =
      fog === "fog"
        ? 0.5
        : fog === "mist"
          ? 2.5
          : precip === "rain"
            ? 4
            : Math.round(8 + 6 * (1 - cloudCover));

    // Temperature: sea-moderated with a land-amplified diurnal swing.
    // Sea cools slightly toward mid-Channel; mild cool-summer bias baked in.
    const seaTempC = 16.3 - 0.7 * ((50.9 - pos.lat) / 1.26);
    const diurnalAmp = (1.1 + 3.2 * pos.land) * (1 - 0.55 * cloudCover);
    const diurnal = Math.cos(((localHour - 14.5) / 24) * Math.PI * 2);
    let tempC =
      seaTempC +
      1.2 -
      0.7 +
      diurnalAmp * diurnal +
      1.5 * sfbm(seed ^ 0x2828, hours / 12, 2);
    if (precip !== "none") tempC -= 0.8;

    // Sea state
    let seaState;
    if (pos.shelter > 0.7) {
      seaState = "sheltered water";
    } else if (beaufortIdx <= 1) {
      seaState = "sea like glass";
    } else if (beaufortIdx === 2) {
      seaState = "calm sea";
    } else if (beaufortIdx === 3) {
      seaState = "slight sea";
    } else if (beaufortIdx === 4) {
      seaState = "moderate sea";
    } else if (beaufortIdx === 5) {
      seaState = "rather rough sea";
    } else if (beaufortIdx === 6) {
      seaState = "rough sea";
    } else {
      seaState = "very rough sea";
    }

    // Sky description with fog/precip overrides
    let description;
    if (fog === "fog") {
      description = "Dense fog banks";
    } else if (fog === "mist") {
      description = "Mist patches";
    } else if (precip === "rain") {
      description = "Overcast, steady rain";
    } else if (precip === "showers") {
      description = beaufortIdx >= 6 ? "Squally showers" : "Passing showers";
    } else if (precip === "drizzle") {
      description = "Grey skies, light drizzle";
    } else if (cloudCover < 0.15) {
      description = "Clear skies";
    } else if (cloudCover < 0.35) {
      description = "Fair, scattered cloud";
    } else if (cloudCover < 0.6) {
      description = "Partly cloudy";
    } else if (cloudCover < 0.85) {
      description = "Mostly cloudy";
    } else {
      description = "Overcast";
    }

    return {
      description,
      condition:
        fog !== "none" ? fog : precip !== "none" ? precip : "dry",
      tempC: Math.round(tempC * 10) / 10,
      seaTempC: Math.round(seaTempC * 10) / 10,
      windKn: Math.round(windKn),
      windDirDeg: Math.round(windDirDeg),
      windDirText,
      beaufort: beaufortIdx,
      beaufortText,
      pressureMb: Math.round(pressureMb),
      pressureTrend,
      cloudCover: Math.round(cloudCover * 100) / 100,
      humidity: Math.round(humidity * 100) / 100,
      visibilityNm,
      seaState,
      position: pos,
      localHour,
      elapsedSeconds,
    };
  }

  function getCurrentWeather(voyageStartTime, nowMs) {
    const now = typeof nowMs === "number" ? nowMs : Date.now();
    const elapsedSeconds = Math.max(0, (now - voyageStartTime) / 1000);
    return computeWeatherAt(elapsedSeconds, voyageStartTime);
  }

  // Ship's-log style one-liner for the narrative panel
  function formatWeatherReport(w) {
    const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
    return (
      `${w.description} · Wind ${w.windDirText} ${w.windKn} kn (${w.beaufortText})` +
      ` · Air ${Math.round(w.tempC)}°C · ${cap(w.seaState)}` +
      ` · ${w.pressureMb} mb, ${w.pressureTrend}`
    );
  }

  return {
    ROUTE,
    computeWeatherAt,
    getCurrentWeather,
    formatWeatherReport,
  };
});
