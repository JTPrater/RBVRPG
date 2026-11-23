/**
 * Low-precision ephemeris for the voyage's sky: sun and moon positions and
 * the moon's phase, good to well under a degree for the sun and ~1-2° for
 * the moon — plenty for rendering.
 *
 * The voyage is anchored to 28 June 1920, 12:00 BST (11:00 UT); elapsed
 * voyage seconds advance both clock and calendar, so over a multi-day
 * crossing the solar declination shifts and the moon visibly fattens toward
 * the real full moon of 1 July 1920.
 *
 * Sun: NOAA-style linear elements. Moon: Schlyter orbital elements with the
 * three largest perturbation terms (evection, variation, annual equation).
 *
 * Used by the game client (via /lib/astro.js) and testable under Node.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.VoyageAstro = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  // 1920 June 28, 11:00 UT (game clock reads 12:00 BST at voyage start)
  const VOYAGE_EPOCH_JD =
    Date.UTC(1920, 5, 28, 11, 0, 0) / 86400000 + 2440587.5;

  const rad = (d) => (d * Math.PI) / 180;
  const deg = (r) => (r * 180) / Math.PI;
  const norm360 = (d) => ((d % 360) + 360) % 360;
  const sinD = (d) => Math.sin(rad(d));
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  function julianFromElapsed(elapsedSeconds) {
    return VOYAGE_EPOCH_JD + elapsedSeconds / 86400;
  }

  // Local sidereal time in hours (lon: degrees, east positive)
  function lstHours(jd, lonDeg) {
    const d = jd - 2451545.0;
    const gmst = 18.697374558 + 24.06570982441908 * d;
    return ((gmst + lonDeg / 15) % 24 + 24) % 24;
  }

  // Equatorial RA/Dec → horizontal alt/az (azimuth from North, clockwise)
  function altAz(raDeg, decDeg, lst, latDeg) {
    const H = rad(lst * 15 - raDeg);
    const la = rad(latDeg);
    const de = rad(decDeg);
    const sinAlt =
      Math.sin(de) * Math.sin(la) + Math.cos(de) * Math.cos(la) * Math.cos(H);
    const alt = Math.asin(clamp(sinAlt, -1, 1));
    // Measured from South, westward positive, then shifted to from-North
    const az = Math.atan2(
      Math.sin(H),
      Math.cos(H) * Math.sin(la) - Math.tan(de) * Math.cos(la),
    );
    return { altDeg: deg(alt), azDeg: norm360(deg(az) + 180) };
  }

  function sunEquatorial(jd) {
    const d = jd - 2451545.0;
    const g = rad(norm360(357.529 + 0.98560028 * d)); // mean anomaly
    const q = norm360(280.459 + 0.98564736 * d); // mean longitude
    const eclLon = norm360(q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g));
    const e = rad(23.439 - 0.00000036 * d);
    const L = rad(eclLon);
    const ra = deg(Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L)));
    const dec = deg(Math.asin(Math.sin(e) * Math.sin(L)));
    return { raDeg: norm360(ra), decDeg: dec, eclLon };
  }

  function moonEquatorial(jd, sunEclLon) {
    const d = jd - 2451543.5; // Schlyter epoch
    const N = norm360(125.1228 - 0.0529538083 * d); // ascending node
    const i = rad(5.1454);
    const w = norm360(318.0634 + 0.1643573223 * d); // arg. of perigee
    const a = 60.2666;
    const ecc = 0.0549;
    const M = norm360(115.3654 + 13.0649929509 * d); // mean anomaly

    // Kepler
    let E = rad(M) + ecc * Math.sin(rad(M)) * (1 + ecc * Math.cos(rad(M)));
    for (let k = 0; k < 4; k++) {
      E = E - (E - ecc * Math.sin(E) - rad(M)) / (1 - ecc * Math.cos(E));
    }
    const xv = a * (Math.cos(E) - ecc);
    const yv = a * Math.sqrt(1 - ecc * ecc) * Math.sin(E);
    const v = deg(Math.atan2(yv, xv));
    const r = Math.hypot(xv, yv);

    // Position in ecliptic coordinates
    const Nr = rad(N);
    const vw = rad(v + w);
    const xh =
      r * (Math.cos(Nr) * Math.cos(vw) - Math.sin(Nr) * Math.sin(vw) * Math.cos(i));
    const yh =
      r * (Math.sin(Nr) * Math.cos(vw) + Math.cos(Nr) * Math.sin(vw) * Math.cos(i));
    const zh = r * Math.sin(vw) * Math.sin(i);
    let lonEcl = norm360(deg(Math.atan2(yh, xh)));
    let latEcl = deg(Math.atan2(zh, Math.hypot(xh, yh)));

    // Largest perturbations (degrees)
    const Ms = norm360(356.047 + 0.9856002585 * d); // sun mean anomaly
    const Ls = norm360(Ms + 282.9404 + 0.0000470935 * d); // sun mean longitude
    const Lm = norm360(N + w + M); // moon mean longitude
    const D = norm360(Lm - Ls); // mean elongation
    const F = norm360(Lm - N); // arg. of latitude
    lonEcl = norm360(
      lonEcl -
        1.274 * sinD(M - 2 * D) + // evection
        0.658 * sinD(2 * D) - // variation
        0.186 * sinD(Ms), // annual equation
    );
    latEcl -= 0.173 * sinD(F - 2 * D);

    // Ecliptic → equatorial
    const e = rad(23.439);
    const lo = rad(lonEcl);
    const la = rad(latEcl);
    const xe = Math.cos(la) * Math.cos(lo);
    const ye = Math.cos(la) * Math.sin(lo);
    const ze = Math.sin(la);
    const raDeg = norm360(
      deg(Math.atan2(ye * Math.cos(e) - ze * Math.sin(e), xe)),
    );
    const decDeg = deg(Math.asin(ye * Math.sin(e) + ze * Math.cos(e)));

    // Phase from elongation against the sun
    const elong = norm360(lonEcl - sunEclLon);
    const illum = (1 - Math.cos(rad(elong))) / 2;
    return { raDeg, decDeg, illum, waxing: elong < 180 };
  }

  // ── Naked-eye planets ─────────────────────────────────────────────────
  // Schlyter orbital elements (same low-precision family as the moon above;
  // good to a fraction of a degree in 1920). Geocentric positions come from
  // heliocentric planet + geocentric sun vectors; magnitudes use the
  // standard phase-angle formulae.
  const PLANET_ELEMENTS = {
    mercury: { N: [48.3313, 3.24587e-5], i: [7.0047, 5.0e-8], w: [29.1241, 1.01444e-5], a: 0.387098, e: [0.205635, 5.59e-10], M: [168.6562, 4.0923344368] },
    venus: { N: [76.6799, 2.4659e-5], i: [3.3946, 2.75e-8], w: [54.891, 1.38374e-5], a: 0.72333, e: [0.006773, -1.302e-9], M: [48.0052, 1.6021302244] },
    mars: { N: [49.5574, 2.11081e-5], i: [1.8497, -1.78e-8], w: [286.5016, 2.92961e-5], a: 1.523688, e: [0.093405, 2.516e-9], M: [18.6021, 0.5240207766] },
    jupiter: { N: [100.4542, 2.76854e-5], i: [1.303, -1.557e-7], w: [273.8777, 1.64505e-5], a: 5.20256, e: [0.048498, 4.469e-9], M: [19.895, 0.0830853001] },
    saturn: { N: [113.6634, 2.398e-5], i: [2.4886, -1.081e-7], w: [339.3939, 2.97661e-5], a: 9.55475, e: [0.055546, -9.499e-9], M: [316.967, 0.0334442282] },
  };
  const PLANET_MAG = {
    mercury: (r, R, FV) => -0.36 + 5 * Math.log10(r * R) + 0.027 * FV + 2.2e-13 * Math.pow(FV, 6),
    venus: (r, R, FV) => -4.34 + 5 * Math.log10(r * R) + 0.013 * FV + 4.2e-7 * Math.pow(FV, 3),
    mars: (r, R, FV) => -1.51 + 5 * Math.log10(r * R) + 0.016 * FV,
    jupiter: (r, R, FV) => -9.25 + 5 * Math.log10(r * R) + 0.014 * FV,
    saturn: (r, R, FV) => -9.0 + 5 * Math.log10(r * R) + 0.044 * FV + 0.5, // mean ring term
  };

  function keplerE(Mrad, ecc) {
    let E = Mrad + ecc * Math.sin(Mrad) * (1 + ecc * Math.cos(Mrad));
    for (let k = 0; k < 5; k++) {
      E = E - (E - ecc * Math.sin(E) - Mrad) / (1 - ecc * Math.cos(E));
    }
    return E;
  }

  /**
   * Geocentric RA/Dec + visual magnitude for the five naked-eye planets.
   * @returns [{name, raDeg, decDeg, mag}]
   */
  function planetsAt(jd) {
    const d = jd - 2451543.5; // Schlyter epoch
    const ecl = rad(23.4393 - 3.563e-7 * d);
    // Sun (geocentric) for the Earth's position
    const ws = 282.9404 + 4.70935e-5 * d;
    const es = 0.016709 - 1.151e-9 * d;
    const Ms = norm360(356.047 + 0.9856002585 * d);
    const Es = keplerE(rad(Ms), es);
    const xvs = Math.cos(Es) - es;
    const yvs = Math.sqrt(1 - es * es) * Math.sin(Es);
    const rs = Math.hypot(xvs, yvs);
    const lonsun = rad(norm360(deg(Math.atan2(yvs, xvs)) + ws));
    const xs = rs * Math.cos(lonsun);
    const ys = rs * Math.sin(lonsun);

    const out = [];
    for (const name of Object.keys(PLANET_ELEMENTS)) {
      const el = PLANET_ELEMENTS[name];
      const N = rad(norm360(el.N[0] + el.N[1] * d));
      const inc = rad(el.i[0] + el.i[1] * d);
      const w = norm360(el.w[0] + el.w[1] * d);
      const ecc = el.e[0] + el.e[1] * d;
      const M = norm360(el.M[0] + el.M[1] * d);
      const E = keplerE(rad(M), ecc);
      const xv = el.a * (Math.cos(E) - ecc);
      const yv = el.a * Math.sqrt(1 - ecc * ecc) * Math.sin(E);
      const v = deg(Math.atan2(yv, xv));
      const r = Math.hypot(xv, yv);
      const vw = rad(v + w);
      // heliocentric ecliptic
      const xh = r * (Math.cos(N) * Math.cos(vw) - Math.sin(N) * Math.sin(vw) * Math.cos(inc));
      const yh = r * (Math.sin(N) * Math.cos(vw) + Math.cos(N) * Math.sin(vw) * Math.cos(inc));
      const zh = r * Math.sin(vw) * Math.sin(inc);
      // geocentric ecliptic
      const xg = xh + xs;
      const yg = yh + ys;
      const zg = zh;
      const R = Math.hypot(xg, yg, zg);
      // → equatorial
      const ye = yg * Math.cos(ecl) - zg * Math.sin(ecl);
      const ze = yg * Math.sin(ecl) + zg * Math.cos(ecl);
      const raDeg = norm360(deg(Math.atan2(ye, xg)));
      const decDeg = deg(Math.asin(ze / R));
      // phase angle → magnitude
      const cosFV = Math.max(-1, Math.min(1, (r * r + R * R - rs * rs) / (2 * r * R)));
      const FV = deg(Math.acos(cosFV));
      const mag = PLANET_MAG[name](r, R, FV);
      out.push({ name, raDeg, decDeg, mag: Math.round(mag * 100) / 100 });
    }
    return out;
  }

  /**
   * Full sky state for a moment of the voyage at the ship's position.
   * The terminator/face orientation is derived by the renderer directly from
   * the sun & moon alt/az (bearings on the local sky), so it stays consistent
   * with the panorama projection — see celestial.js drawMoon.
   * @returns {{sun:{altDeg,azDeg}, moon:{altDeg,azDeg,illum,waxing}, lst}}
   */
  function skyAt(elapsedSeconds, latDeg, lonDeg) {
    const jd = julianFromElapsed(elapsedSeconds);
    const lst = lstHours(jd, lonDeg);
    const s = sunEquatorial(jd);
    const m = moonEquatorial(jd, s.eclLon);
    return {
      sun: altAz(s.raDeg, s.decDeg, lst, latDeg),
      moon: Object.assign(altAz(m.raDeg, m.decDeg, lst, latDeg), {
        illum: m.illum,
        waxing: m.waxing,
      }),
      lst,
    };
  }

  /**
   * Synthetic moon pinned to a chosen phase (admin scenario): placed on the
   * ecliptic at the elongation that phase implies, so its rise/set times
   * track the phase the way the real orbit does — a new moon rides with the
   * sun, first quarter transits around sunset, full opposes the sun.
   */
  function moonForPhase(elapsedSeconds, latDeg, lonDeg, illum, waxing) {
    const jd = julianFromElapsed(elapsedSeconds);
    const lst = lstHours(jd, lonDeg);
    const s = sunEquatorial(jd);
    let cyc = Math.acos(clamp(1 - 2 * illum, -1, 1)) / (2 * Math.PI);
    if (!waxing) cyc = 1 - cyc;
    const elong = cyc * 360;
    const lo = rad(norm360(s.eclLon + elong));
    // Tilt the synthetic orbit like the real one (5.1° inclination), node
    // placed so syzygies miss the sun — without this every dev new moon
    // sits dead on the sun and fakes a total eclipse
    const la = rad(5.13 * Math.cos(rad(elong)));
    const e = rad(23.4393);
    const xe = Math.cos(la) * Math.cos(lo);
    const ye = Math.cos(la) * Math.sin(lo);
    const ze = Math.sin(la);
    const raDeg = norm360(
      deg(Math.atan2(ye * Math.cos(e) - ze * Math.sin(e), xe)),
    );
    const decDeg = deg(Math.asin(ye * Math.sin(e) + ze * Math.cos(e)));
    return Object.assign(altAz(raDeg, decDeg, lst, latDeg), {
      illum,
      waxing: elong < 180,
    });
  }

  return {
    VOYAGE_EPOCH_JD,
    julianFromElapsed,
    lstHours,
    altAz,
    sunEquatorial,
    moonEquatorial,
    moonForPhase,
    planetsAt,
    skyAt,
  };
});
