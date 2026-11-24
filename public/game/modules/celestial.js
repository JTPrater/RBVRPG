/**
 * Celestial layer: sun, moon, stars, light glitter on the water, horizon haze.
 *
 * Positions come from real ephemeris (lib/astro.js) for 28 June 1920 plus
 * elapsed voyage time, evaluated at the ship's actual lat/lon from the
 * weather engine's route. The camera faces SOUTH (we see the starboard side
 * of a westbound ship), so azimuth maps east → screen-left, due south →
 * centre, west → screen-right. The frame covers a wide southern panorama
 * (azimuth 55°–305°); at 50°N the summer sun genuinely spends its day in
 * that window, transiting due south — dead centre — at solar noon (~13:09
 * game time), and the moon's real phase waxes to the actual full moon of
 * 1 July 1920 three days into the voyage.
 *
 * Two canvases inside .scene-layer:
 *   - sky canvas (z0): sun/moon disc and star field — above the sky
 *     gradients, below the cloud canvas (z1), so clouds occlude them.
 *   - water canvas (z2): the glitter path — above the water texture (z1),
 *     below the ship (z3), so the hull occludes it.
 *
 * Weather ties in: cloud cover from the engine dims sun, moon, and stars;
 * fog blots out the sky. Star visibility follows real twilight (sun
 * altitude), and the field drifts west at sidereal rate through the night.
 */
(function (RBV) {
  const W = 1920;
  const H = 1080;
  // Top edge of the .water layer: 1080 - var(--water-bottom,150) - 54.25% of 1080
  const HORIZON_Y = 344;

  // South-facing panorama: azimuth window mapped across the screen
  const AZ_LEFT = 55; // ENE at the left edge
  const AZ_RIGHT = 305; // WNW at the right edge

  const FRAME_MS = 66; // ~15 fps is plenty for twinkle and shimmer
  const STILL_FRAME_MS = 1000; // nothing twinkling or shimmering: once a second
  let lastFrameMoved = true;
  // While timelapsing, render every animation frame (no throttle). A fixed
  // ms throttle skips rAF ticks unevenly on high-refresh displays (e.g. on
  // 144Hz a 16ms gate lands frames 14ms/21ms apart → judder), so match the
  // display's own vsync cadence instead.
  const WEATHER_REFRESH_MS = 30000;

  let skyCanvas = null;
  let skyCtx = null;
  let waterCanvas = null;
  let waterCtx = null;
  let hazeDay = null;
  let hazeMs = null;
  let hazeNight = null;
  let lastFrame = 0;
  let cachedWeather = null;
  let lastWeatherAt = 0;
  let started = false;

  // ---- small helpers ----
  function hash(n) {
    let h = (n | 0) ^ 0x51ed;
    h = Math.imul(h ^ (h >>> 16), 2246822519);
    h = Math.imul(h ^ (h >>> 13), 3266489917);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }
  function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
  }
  function lerp(a, b, t) {
    return a + (b - a) * t;
  }
  function lerpRgb(c1, c2, t) {
    return [
      Math.round(lerp(c1[0], c2[0], t)),
      Math.round(lerp(c1[1], c2[1], t)),
      Math.round(lerp(c1[2], c2[2], t)),
    ];
  }
  function rgba(c, a) {
    return `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${a})`;
  }

  // ── Real sky ──────────────────────────────────────────────────────────
  // A true star field: the Hipparcos-based catalogue in data/skyData.js
  // (J2000), precessed to the voyage epoch, projected each frame to real
  // alt/az at the ship's lat/lon and sidereal time, then onto the
  // south-facing view. Atmospheric extinction dims and reddens stars toward
  // the horizon; a limiting magnitude driven by twilight, the Moon's phase
  // and altitude, and cloud decides what's faint enough to vanish.
  const DEG = Math.PI / 180;
  const EPOCH_YEAR = 1920; // matches lib/astro.js voyage epoch
  const K_EXT = 0.2; // extinction, mag per airmass (clear maritime air)

  // First-order precession of J2000 [ra,dec] to the epoch year. Rates are in
  // degrees/year (m and n reduced from 3.075 s and 20.04″); T is negative
  // going back from 2000.
  function precess(raDeg, decDeg) {
    const T = EPOCH_YEAR - 2000;
    const ra = raDeg * DEG;
    const dec = decDeg * DEG;
    const tanDec = clamp(Math.tan(dec), -60, 60);
    const dRa = (0.0128123 + 0.00556754 * Math.sin(ra) * tanDec) * T;
    const dDec = 0.00556753 * Math.cos(ra) * T;
    return [(raDeg + dRa + 360) % 360, decDeg + dDec];
  }

  // B−V colour index → star tint (blue-white through to red).
  const BV_ANCHORS = [
    [-0.33, [155, 176, 255]],
    [0.0, [222, 230, 255]],
    [0.3, [248, 247, 255]],
    [0.58, [255, 244, 214]],
    [0.81, [255, 223, 181]],
    [1.4, [255, 199, 158]],
    [1.9, [255, 176, 138]],
  ];
  function bvToRgb(bv) {
    if (bv <= BV_ANCHORS[0][0]) return BV_ANCHORS[0][1].slice();
    for (let i = 1; i < BV_ANCHORS.length; i++) {
      if (bv <= BV_ANCHORS[i][0]) {
        const t =
          (bv - BV_ANCHORS[i - 1][0]) /
          (BV_ANCHORS[i][0] - BV_ANCHORS[i - 1][0]);
        return lerpRgb(BV_ANCHORS[i - 1][1], BV_ANCHORS[i][1], t);
      }
    }
    return BV_ANCHORS[BV_ANCHORS.length - 1][1].slice();
  }

  // Catalogues, built once from window.RBV_SKY.
  let skyStars = null; // {ra,dec,mag,tint}
  let skyReady = false;

  function initSky() {
    if (skyReady || !window.RBV_SKY) return;
    const raw = window.RBV_SKY;
    skyStars = raw.stars.map((s) => {
      const [ra, dec] = precess(s[0], s[1]);
      return { ra, dec, mag: s[2], tint: bvToRgb(s[3]) };
    });
    // already sorted brightest-first in the data; keep it for early-out
    skyStars.sort((a, b) => a.mag - b.mag);
    skyReady = true;
  }

  // Per-dash params for the glitter path
  const dashes = [];
  for (let i = 0; i < 55; i++) {
    dashes.push({
      f: i / 55,
      swing: 0.25 + hash(i * 11 + 50) * 0.75,
      swingSpeed: 0.4 + hash(i * 11 + 51) * 0.9,
      swingPhase: hash(i * 11 + 52) * Math.PI * 2,
      flickSpeed: 1.2 + hash(i * 11 + 53) * 2.4,
      flickPhase: hash(i * 11 + 54) * Math.PI * 2,
    });
  }

function ensureLayers() {
    const scene = document.querySelector(".scene-layer");
    if (!scene) return false;
    if (!skyCanvas) {
      skyCanvas = document.createElement("canvas");
      skyCanvas.className = "celestial-sky-canvas";
      skyCanvas.width = W;
      skyCanvas.height = H;
      scene.appendChild(skyCanvas);
      skyCtx = skyCanvas.getContext("2d");
    }
    if (!waterCanvas) {
      waterCanvas = document.createElement("canvas");
      waterCanvas.className = "celestial-water-canvas";
      waterCanvas.width = W;
      waterCanvas.height = H;
      scene.appendChild(waterCanvas);
      waterCtx = waterCanvas.getContext("2d");
    }
    if (!hazeDay) {
      hazeDay = document.createElement("div");
      hazeDay.className = "horizon-haze hz-day";
      hazeMs = document.createElement("div");
      hazeMs.className = "horizon-haze hz-ms";
      hazeNight = document.createElement("div");
      hazeNight.className = "horizon-haze hz-night";
      scene.appendChild(hazeDay);
      scene.appendChild(hazeMs);
      scene.appendChild(hazeNight);
    }
    if (!document.querySelector(".water-bottom-fade")) {
      const fade = document.createElement("div");
      fade.className = "water-bottom-fade";
      scene.appendChild(fade);
    }
    return true;
  }

  function devMode() {
    const v = RBV.voyage || {};
    return v.DEV_NORTH_ATLANTIC && typeof window.getDevElapsedSeconds === "function"
      ? v
      : null;
  }

  function elapsedSeconds() {
    const dev = devMode();
    if (dev) return window.getDevElapsedSeconds();
    return typeof window.getElapsedSeconds === "function"
      ? window.getElapsedSeconds()
      : 0;
  }

  function gameHour() {
    const dev = devMode();
    if (dev) return ((dev.DEV_HOUR % 24) + 24) % 24;
    return (12 + elapsedSeconds() / 3600) % 24;
  }

  // The weather is drawn from the voyage's own seed (its start time), so there
  // is none until the server's voyage clock arrives. Computing it with a
  // stand-in seed of 0 made every reload overcast and rainy (and kept it for
  // half a minute in this cache): the sky came back grey with every reload.
  let cachedWeatherSeed = 0;
  function weatherNow() {
    const now = Date.now();
    const v = RBV.voyage || {};
    const seed = v.voyageStartTime || v.pendingVoyageStartTime || 0;
    if (!seed) return null;
    if (
      !cachedWeather ||
      seed !== cachedWeatherSeed ||
      now - lastWeatherAt > WEATHER_REFRESH_MS
    ) {
      if (window.VoyageWeather) {
        cachedWeather = window.VoyageWeather.computeWeatherAt(
          elapsedSeconds(),
          seed,
          devMode() ? v.DEV_POSITION : undefined,
        );
        if (window.applyDevWeather) {
          cachedWeather = window.applyDevWeather(cachedWeather);
        }
        cachedWeatherSeed = seed;
        lastWeatherAt = now;
      }
    }
    return cachedWeather;
  }

  // Project real alt/az onto the south-facing frame. Returns null when the
  // body is behind the camera (northerly azimuths) or fully set. Discs are
  // allowed to sink below the waterline — the water layer sits above this
  // canvas, so the sea occludes the submerged part naturally.
  // Camera pull-back factor (set by core/layout.js): sun/moon discs shrink
  // with the subject so a zoomed-out shot reads as one coherent camera
  function camZoom() {
    return (window.__vista && window.__vista.camZoom) || 1;
  }

  function toScreen(azDeg, altDeg) {
    if (altDeg <= -2) return null;
    const t = (azDeg - AZ_LEFT) / (AZ_RIGHT - AZ_LEFT);
    if (t < -0.04 || t > 1.04) return null;
    const altPx = Math.sin((altDeg * Math.PI) / 180) * 330;
    // Ease out over the frame edges instead of popping off
    const edgeFade = clamp(Math.min(t + 0.04, 1.04 - t) / 0.07, 0, 1);
    return {
      x: lerp(60, W - 60, t),
      y: HORIZON_Y - 6 - altPx,
      // Full strength while sinking through the horizon, gone once buried
      horizonFade: clamp((altDeg + 2) / 1.5, 0, 1) * edgeFade,
    };
  }

  function drawSun(sun, dim) {
    const p = toScreen(sun.azDeg, sun.altDeg);
    if (!p) return null;
    // A low sun swells, reddens, and flattens; high sun is small and pale
    const lowness = clamp(1 - sun.altDeg / 20, 0, 1);
    const core = lerpRgb([255, 252, 240], [255, 214, 130], lowness);
    const mid = lerpRgb([255, 244, 205], [255, 145, 62], lowness);
    const rim = lerpRgb([255, 234, 175], [255, 88, 32], lowness);
    const glow = lerpRgb([255, 240, 190], [255, 110, 45], lowness);
    const r = (26 + lowness * 16) * camZoom();
    const a = p.horizonFade * dim;
    if (a <= 0.01) return null;
    const squash = 1 - 0.16 * lowness; // atmospheric flattening near the sea

    // Broad evening/morning wash filling that side of the sky when low
    if (lowness > 0.3) {
      const wr = r * 16;
      const wg = skyCtx.createRadialGradient(p.x, p.y, 0, p.x, p.y, wr);
      wg.addColorStop(0, rgba(glow, 0.12 * a * lowness));
      wg.addColorStop(1, rgba(glow, 0));
      skyCtx.fillStyle = wg;
      skyCtx.fillRect(p.x - wr, p.y - wr, wr * 2, wr * 2);
    }

    // Horizon-hugging elliptical glow — sunset light spreads sideways
    if (lowness > 0.25) {
      skyCtx.save();
      skyCtx.translate(p.x, p.y);
      skyCtx.scale(3.2, 1);
      const hg = skyCtx.createRadialGradient(0, 0, 0, 0, 0, r * 5);
      hg.addColorStop(0, rgba(glow, 0.22 * a * lowness));
      hg.addColorStop(1, rgba(glow, 0));
      skyCtx.fillStyle = hg;
      skyCtx.fillRect(-r * 5, -r * 5, r * 10, r * 10);
      skyCtx.restore();
    }

    // Round bloom around the disc
    const g = skyCtx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r * 4);
    g.addColorStop(0, rgba(glow, 0.55 * a));
    g.addColorStop(0.3, rgba(glow, 0.2 * a));
    g.addColorStop(1, rgba(glow, 0));
    skyCtx.fillStyle = g;
    skyCtx.fillRect(p.x - r * 4, p.y - r * 4, r * 8, r * 8);

    // Sun pillar: column of light joining the disc to the waterline
    if (lowness > 0.45 && p.y < HORIZON_Y) {
      const pg = skyCtx.createLinearGradient(0, p.y, 0, HORIZON_Y + 4);
      pg.addColorStop(0, rgba(glow, 0.3 * a * (lowness - 0.45) * 1.8));
      pg.addColorStop(1, rgba(glow, 0.06 * a));
      skyCtx.fillStyle = pg;
      const pw = r * 0.9;
      skyCtx.fillRect(p.x - pw / 2, p.y, pw, HORIZON_Y + 4 - p.y);
    }

    // The disc: white-hot centre through orange to a soft red rim
    skyCtx.save();
    skyCtx.translate(p.x, p.y);
    skyCtx.scale(1, squash);
    const dg = skyCtx.createRadialGradient(0, 0, 0, 0, 0, r);
    dg.addColorStop(0, rgba(core, a));
    dg.addColorStop(0.55, rgba(mid, a));
    dg.addColorStop(0.88, rgba(rim, 0.96 * a));
    dg.addColorStop(1, rgba(rim, 0));
    skyCtx.fillStyle = dg;
    skyCtx.beginPath();
    skyCtx.arc(0, 0, r, 0, Math.PI * 2);
    skyCtx.fill();
    skyCtx.restore();

    return { x: p.x, altDeg: sun.altDeg, lowness, a, kind: "sun" };
  }

  // Real full-moon photograph; phases are carved out of it at draw time
  const moonImg = new Image();
  moonImg.src = "/images/moon phase/full.webp";

  // Offscreen mask holding the lit shape for the current phase; stamped over
  // the photo through a blur so the terminator is a soft band, not a razor
  const moonMask = document.createElement("canvas");
  moonMask.width = 128;
  moonMask.height = 128;
  const moonMaskCtx = moonMask.getContext("2d");

  // The whole moon (photo + phase carve + earthshine + tints) is composited
  // on this offscreen canvas, then stamped onto the sky in one source-over
  // draw. Doing the destination-in / source-atop steps here keeps them off
  // the real sky canvas, so they can't punch a hole in the sky gradient or
  // erase the stars behind the disc.
  const moonSprite = document.createElement("canvas");
  moonSprite.width = 256;
  moonSprite.height = 256;
  const moonSpriteCtx = moonSprite.getContext("2d");

  function buildMoonMask(f, litRight) {
    const S = 128;
    const c = S / 2;
    const R = c - 2;
    const m = moonMaskCtx;
    m.globalCompositeOperation = "source-over";
    m.clearRect(0, 0, S, S);
    m.fillStyle = "#fff";
    m.fillRect(litRight ? c : 0, 0, c, S);
    const termRx = Math.max(0.01, R * Math.abs(2 * f - 1));
    if (f >= 0.5) {
      // Gibbous: lit bulge crosses the centre line
      m.beginPath();
      m.ellipse(c, c, termRx, R, 0, 0, Math.PI * 2);
      m.fill();
    } else {
      // Crescent: terminator carves into the lit half
      m.globalCompositeOperation = "destination-out";
      m.beginPath();
      m.ellipse(c, c, termRx, R, 0, 0, Math.PI * 2);
      m.fill();
      m.globalCompositeOperation = "source-over";
    }
  }
  // Disc diameter as a fraction of the texture width (the photo carries a
  // baked-in glow halo around the disc itself)
  const MOON_IMG_DISC = 0.8;

  function drawMoon(moon, dim, nf, sun, latDeg) {
    const p = toScreen(moon.azDeg, moon.altDeg);
    if (!p) return null;
    // Bigger and warmer near the horizon (the classic moonrise look)
    const moonLow = clamp(1 - moon.altDeg / 15, 0, 1);
    const r = 22 * (1 + 0.3 * moonLow) * camZoom();
    // Visible faintly in daylight, fully by night — like the real thing
    let a = p.horizonFade * dim * (0.3 + 0.7 * nf);
    if (a <= 0.01) return null;
    const f = moon.illum;
    // Naked-eye daylight visibility: near the sun the moon drowns in sky
    // glare, and a thin crescent needs real angular distance to show at all
    // (why first-crescent sightings are hard). This is also what kills the
    // fake "eclipse" when the dev slider parks a new moon by the sun.
    if (sun && sun.altDeg > -2) {
      const dr = Math.PI / 180;
      const cs =
        Math.sin(moon.altDeg * dr) * Math.sin(sun.altDeg * dr) +
        Math.cos(moon.altDeg * dr) *
          Math.cos(sun.altDeg * dr) *
          Math.cos((moon.azDeg - sun.azDeg) * dr);
      const sep = Math.acos(clamp(cs, -1, 1)) / dr;
      const dayW = clamp((sun.altDeg + 2) / 8, 0, 1);
      const sepFade = clamp((sep - 14) / 22, 0, 1);
      const thinFade = clamp((sep - (30 - f * 25)) / 20, 0, 1);
      a *= 1 - dayW * (1 - sepFade * thinFade);
      if (a <= 0.012) return null;
    }
    // No painted halo — the photo's own baked glow follows the lit shape
    // through the carve, so the dark limb stays clean against the sky
    if (!moonImg.complete || !moonImg.naturalWidth) {
      return { x: p.x, altDeg: moon.altDeg, a, illum: f, kind: "moon" };
    }

    // Terminator & face orientation from real sky geometry. bearing() gives
    // the angle at the Moon, on the local sky, from the zenith-ward direction
    // (screen up) toward a target, measured clockwise toward increasing
    // azimuth (screen right). Since the panorama maps altitude→up and azimuth→
    // right, and the disc is drawn undistorted, these bearings ARE the true
    // on-screen tilts (position angles reckoned from the zenith).
    //   • toward the Sun   → the bright limb points there (the terminator)
    //   • toward the pole  → the Moon's north, i.e. how the face tilts
    const DR = Math.PI / 180;
    const bearing = (tAltDeg, tAzDeg) => {
      const dAz = (tAzDeg - moon.azDeg) * DR;
      const tA = tAltDeg * DR;
      const mA = moon.altDeg * DR;
      return Math.atan2(
        Math.sin(dAz) * Math.cos(tA),
        Math.cos(mA) * Math.sin(tA) - Math.sin(mA) * Math.cos(tA) * Math.cos(dAz),
      );
    };
    const lat = typeof latDeg === "number" ? latDeg : 50;
    // North celestial pole sits at altitude = latitude, due north (az 0)
    const faceRoll = bearing(lat, 0);
    // Bright limb points at the Sun; the mask is built lit-on-the-right (+x,
    // i.e. 90° CW of up), so rotate it by (limbBearing − 90°) to aim it.
    const limbBearing = bearing(sun.altDeg, sun.azDeg);
    const maskRot = limbBearing - Math.PI / 2;

    // Everything below is composited on the offscreen sprite around its own
    // centre (cx, cy), then stamped onto the sky in one draw — so the
    // destination-in carve and source-atop tints never touch the sky
    // gradient or the stars.
    const rLim = r * 1.45;
    const imgSize = (r * 2) / MOON_IMG_DISC;
    const cx = moonSprite.width / 2;
    const cy = moonSprite.height / 2;
    const mctx = moonSpriteCtx;
    mctx.setTransform(1, 0, 0, 1, 0, 0);
    mctx.globalCompositeOperation = "source-over";
    mctx.globalAlpha = 1;
    mctx.clearRect(0, 0, moonSprite.width, moonSprite.height);
    mctx.save();

    // The photo's baked glow belongs to the night, but let it in gradually
    // and only a little so the disc doesn't visibly "grow" at dusk (small
    // clip range: ~1.26r by day → ~1.42r deep night)
    mctx.beginPath();
    mctx.arc(cx, cy, r * (1.26 + 0.16 * nf), 0, Math.PI * 2);
    mctx.clip();

    // Tilt the face so the Moon's north points at the celestial pole (the
    // real "roll" as it arcs across the sky: level at southern transit,
    // leaning toward rise and set).
    mctx.translate(cx, cy);
    mctx.rotate(faceRoll);
    mctx.translate(-cx, -cy);

    mctx.drawImage(moonImg, cx - imgSize / 2, cy - imgSize / 2, imgSize, imgSize);

    // Keep the photo only where the phase mask is lit; the blur turns the
    // terminator into a soft band. The mask is oriented independently so the
    // bright limb points exactly at the Sun (maskRot), then we rotate back to
    // the face orientation for the earthshine pass.
    buildMoonMask(f, true);
    mctx.translate(cx, cy);
    mctx.rotate(maskRot - faceRoll);
    mctx.translate(-cx, -cy);
    mctx.globalCompositeOperation = "destination-in";
    mctx.filter = "blur(2px)";
    mctx.drawImage(moonMask, cx - rLim, cy - rLim, rLim * 2, rLim * 2);
    mctx.filter = "none";
    mctx.globalCompositeOperation = "source-over";
    mctx.translate(cx, cy);
    mctx.rotate(faceRoll - maskRot);
    mctx.translate(-cx, -cy);

    // Earthshine: the dark side faintly ghost-lit by Earth, most visible on
    // crescents, gone by full
    const earth = (0.12 * (1 - f) + 0.03) * (0.15 + 0.85 * nf);
    if (earth > 0.035) {
      mctx.globalAlpha = earth;
      mctx.drawImage(moonImg, cx - imgSize / 2, cy - imgSize / 2, imgSize, imgSize);
      mctx.globalAlpha = 1;
    }

    // Daylight wash: sky-blue scattered in front of the disc → pale ghost-moon
    if (nf < 0.95) {
      mctx.globalCompositeOperation = "source-atop";
      mctx.fillStyle = `rgba(205, 225, 248, ${(0.38 * (1 - nf)).toFixed(3)})`;
      mctx.fillRect(cx - rLim, cy - rLim, rLim * 2, rLim * 2);
      mctx.globalCompositeOperation = "source-over";
    }

    // Warm amber tint on whatever stayed lit, when riding low
    if (moonLow > 0.05) {
      mctx.globalCompositeOperation = "source-atop";
      mctx.fillStyle = `rgba(255, 178, 110, ${0.28 * moonLow})`;
      mctx.fillRect(cx - rLim, cy - rLim, rLim * 2, rLim * 2);
      mctx.globalCompositeOperation = "source-over";
    }
    mctx.restore();

    // Stamp the finished moon onto the sky, faded by daylight/horizon
    skyCtx.globalAlpha = a;
    skyCtx.drawImage(moonSprite, p.x - cx, p.y - cy);
    skyCtx.globalAlpha = 1;

    return { x: p.x, altDeg: moon.altDeg, a, illum: f, kind: "moon" };
  }

  // Per-frame projection state (set in drawSky before the passes below).
  let fSinLat = 0;
  let fCosLat = 1;
  let fLstRad = 0;

  // Project a catalogue RA/Dec to the south-facing screen for the current
  // frame's location and sidereal time. Returns {x,y,alt,horizonFade} or
  // null when below the horizon or off-frame.
  function projRaDec(raDeg, decDeg) {
    const raR = raDeg * DEG;
    const decR = decDeg * DEG;
    const sinDec = Math.sin(decR);
    const cosDec = Math.cos(decR);
    const H = fLstRad - raR;
    const sinAlt = sinDec * fSinLat + cosDec * fCosLat * Math.cos(H);
    const altDeg = Math.asin(clamp(sinAlt, -1, 1)) / DEG;
    if (altDeg <= -1.5) return null;
    const azR = Math.atan2(
      Math.sin(H),
      Math.cos(H) * fSinLat - (sinDec / cosDec) * fCosLat,
    );
    const azDeg = (azR / DEG + 180 + 360) % 360;
    const p = toScreen(azDeg, altDeg);
    if (!p) return null;
    p.alt = altDeg;
    return p;
  }

  // Kasten–Young airmass; grows sharply toward the horizon.
  function airmass(altDeg) {
    if (altDeg < -0.5) return 40;
    const a = Math.max(altDeg, 0);
    return 1 / (Math.sin(a * DEG) + 0.50572 * Math.pow(a + 6.07995, -1.6364));
  }

  // Moonlight scatter that washes out faint stars (0 = no moon glow).
  function moonSkyglow(moon) {
    if (!moon || moon.altDeg <= 0) return 0;
    return clamp(Math.sin(moon.altDeg * DEG), 0, 1) * clamp(moon.illum, 0, 1);
  }

  // Zenith limiting magnitude from twilight, the Moon, and cloud.
  function limitingMag(sunAlt, glow, cloud) {
    // dark base: nothing until civil/nautical dusk, full catalogue by ~-18°
    const base = clamp((-sunAlt - 4) / 14, 0, 1) * 6.9 - 1.5;
    return clamp(base - 2.9 * glow - 3 * cloud, -1.5, 5.1);
  }

  // ── Planets ─────────────────────────────────────────────────────────────
  // The naked-eye planets, positions and magnitudes computed for the actual
  // voyage dates by lib/astro.js. They shine steadily (barely any twinkle —
  // the classic way to tell a planet from a star), with their real colours.
  const PLANET_TINTS = {
    mercury: [255, 226, 196],
    venus: [255, 252, 240],
    mars: [255, 168, 122],
    jupiter: [252, 242, 216],
    saturn: [250, 230, 175],
  };

  function drawPlanets(planets, sunAlt, moon, cloud, cloudDim, now) {
    if (!planets) return;
    const glow = moonSkyglow(moon);
    // bright planets pierce twilight and moonlight longer than stars
    const limit = limitingMag(sunAlt, glow, cloud) + 1.2;
    const darkFade = clamp((-sunAlt - 2.5) / 6, 0, 1); // Venus shows early
    if (darkFade <= 0.01) return;
    const t = now / 1000;
    for (const pl of planets) {
      const p = projRaDec(pl.raDeg, pl.decDeg);
      if (!p || p.alt < -0.5) continue;
      const X = airmass(p.alt);
      const magEff = pl.mag + K_EXT * X;
      if (magEff > limit) continue;
      let a =
        clamp((limit - magEff) / 2 + 0.25, 0, 1) *
        darkFade *
        (1 - 0.3 * glow) *
        cloudDim *
        p.horizonFade;
      if (a < 0.02) continue;
      // planets shine steadily — only a whisper of low-altitude shimmer
      const scint = 0.05 * clamp((X - 1) / 8, 0, 1);
      a *= 1 - scint * (0.5 + 0.5 * Math.sin(t * 3.1 + pl.raDeg));
      // planets read as small steady discs, clearly fatter than the
      // point-like twinkling stars around them
      const r = clamp(2.9 - 0.42 * pl.mag, 1.5, 4.4);
      const redn = clamp((X - 1) * 0.05, 0, 0.8);
      const col = lerpRgb(
        PLANET_TINTS[pl.name] || [255, 245, 225],
        [255, 150, 110],
        redn,
      );
      skyCtx.beginPath();
      skyCtx.arc(p.x, p.y, r, 0, Math.PI * 2);
      skyCtx.fillStyle = rgba(col, clamp(a, 0, 1));
      skyCtx.fill();
      if (pl.mag < 1.1 && a > 0.22) {
        const gr = r * 3.0;
        const g = skyCtx.createRadialGradient(p.x, p.y, 0, p.x, p.y, gr);
        g.addColorStop(0, rgba(col, a * (pl.mag < -0.5 ? 0.4 : 0.24)));
        g.addColorStop(1, rgba(col, 0));
        skyCtx.fillStyle = g;
        skyCtx.fillRect(p.x - gr, p.y - gr, gr * 2, gr * 2);
      }
    }
  }

  // ── Sporadic meteors ────────────────────────────────────────────────────
  // A few per hour on dark clear nights (no major shower is active in late
  // June/early July — this is the realistic background rate). Timing and
  // paths hash from the voyage seed per one-minute slot, so every player
  // sees the same streak at the same instant.
  function drawMeteors(darkness, cloudDim, now) {
    if (darkness < 0.5 || cloudDim < 0.3) return;
    const v = RBV.voyage || {};
    const seed = ((v.voyageStartTime || 0) / 1000) >>> 0;
    let esm;
    if (v.DEV_NORTH_ATLANTIC) {
      esm = now / 1000; // dev clock is frozen — free-run so streaks animate
    } else if (v.lastServerElapsedAt > 0) {
      esm = v.lastServerElapsed + (Date.now() - v.lastServerElapsedAt) / 1000;
    } else if (v.voyageStartTime) {
      esm = (Date.now() - v.voyageStartTime) / 1000;
    } else {
      return;
    }
    const slotNow = Math.floor(esm / 60);
    for (let k = 0; k <= 1; k++) {
      const slot = slotNow - k;
      if (hash(seed ^ (slot * 2654435761)) > 0.12) continue; // ≈7/hour
      const t0 = slot * 60 + hash(seed ^ (slot * 97 + 1)) * 58;
      const dur = 0.75;
      const dt = esm - t0;
      if (dt < 0 || dt > dur) continue;
      const f = dt / dur;
      const x0 = 80 + hash(seed ^ (slot * 97 + 2)) * (W - 160);
      const y0 = 20 + hash(seed ^ (slot * 97 + 3)) * (HORIZON_Y * 0.5);
      const ang = Math.PI * (0.25 + 0.5 * hash(seed ^ (slot * 97 + 4)));
      const len = 130 + hash(seed ^ (slot * 97 + 5)) * 120;
      const hx = x0 + Math.cos(ang) * len * f;
      const hy = y0 + Math.sin(ang) * len * f;
      const tail = Math.min(70, len * f);
      const tx = hx - Math.cos(ang) * tail;
      const ty = hy - Math.sin(ang) * tail;
      const a = Math.sin(Math.PI * f) * 0.85 * darkness * cloudDim;
      const g = skyCtx.createLinearGradient(tx, ty, hx, hy);
      g.addColorStop(0, "rgba(200, 215, 235, 0)");
      g.addColorStop(1, `rgba(235, 242, 252, ${a})`);
      skyCtx.strokeStyle = g;
      skyCtx.lineWidth = 1.6;
      skyCtx.lineCap = "round";
      skyCtx.beginPath();
      skyCtx.moveTo(tx, ty);
      skyCtx.lineTo(hx, hy);
      skyCtx.stroke();
    }
  }

  // The stars themselves, with extinction, twinkle, and colour.
  function drawStars(sunAlt, moon, cloud, cloudDim, now) {
    if (!skyStars) return;
    const glow = moonSkyglow(moon);
    const limit = limitingMag(sunAlt, glow, cloud);
    if (limit <= -1.4) return; // daylight / too bright
    // stars fade in through twilight; the Moon also lowers overall contrast
    const darkFade = clamp((-sunAlt - 4) / 8, 0, 1);
    const contrast = 1 - 0.45 * glow;
    const t = now / 1000;

    for (let i = 0; i < skyStars.length; i++) {
      const s = skyStars[i];
      // catalogue is sorted brightest-first; once intrinsic mag passes the
      // best-case (zenith) limit, no fainter star can show — stop.
      if (s.mag > limit) break;
      const p = projRaDec(s.ra, s.dec);
      if (!p || p.alt < -0.5) continue;

      const X = airmass(p.alt);
      const magEff = s.mag + K_EXT * X;
      if (magEff > limit) continue;

      // brightness above the limit → alpha; intrinsic mag → size
      let a =
        clamp((limit - magEff) / 1.6 + 0.18, 0, 1) *
        darkFade *
        contrast *
        cloudDim *
        p.horizonFade;
      if (a < 0.015) continue;
      // scintillation, stronger low down — the twinkle that marks a star
      const scint = 0.12 + 0.34 * clamp((X - 1) / 6, 0, 1);
      a *= 1 - scint * (0.5 + 0.5 * Math.sin(t * (2 + (i % 7)) + i));
      // near-point sources: brightness lives in alpha, barely in size
      const r = clamp(1.7 - 0.24 * s.mag, 0.5, 2.1);

      // redden toward the horizon (blue light is scattered away first)
      const redn = clamp((X - 1) * 0.05, 0, 0.85);
      const col = lerpRgb(s.tint, [255, 150, 110], redn);

      skyCtx.beginPath();
      skyCtx.arc(p.x, p.y, r, 0, Math.PI * 2);
      skyCtx.fillStyle = rgba(col, clamp(a, 0, 1));
      skyCtx.fill();
      // a tight glow on only the very brightest (Vega, Arcturus, Capella…)
      if (s.mag < 0.2 && a > 0.3) {
        const gr = r * 2.5;
        const g = skyCtx.createRadialGradient(p.x, p.y, 0, p.x, p.y, gr);
        g.addColorStop(0, rgba(col, a * 0.22));
        g.addColorStop(1, rgba(col, 0));
        skyCtx.fillStyle = g;
        skyCtx.fillRect(p.x - gr, p.y - gr, gr * 2, gr * 2);
      }
    }
  }

  // Orchestrates the night-sky passes for the frame. True when it drew
  // something that twinkles (and so must be drawn again soon).
  function drawSky(sky, pos, cloud, cloudDim, now, planets) {
    if (!skyReady) initSky(); // data script may have loaded after us
    if (!skyReady) return false;
    fSinLat = Math.sin(pos.lat * DEG);
    fCosLat = Math.cos(pos.lat * DEG);
    fLstRad = sky.lst * 15 * DEG;
    const sunAlt = sky.sun.altDeg;
    const darkness = clamp((-sunAlt - 4) / 12, 0, 1);
    const planetDark = clamp((-sunAlt - 2.5) / 6, 0, 1);
    if (darkness < 0.02 && planetDark < 0.02) return false;
    drawStars(sunAlt, sky.moon, cloud, cloudDim, now);
    drawPlanets(planets, sunAlt, sky.moon, cloud, cloudDim, now);
    drawMeteors(darkness, cloudDim, now);
    return true;
  }

// ── Water colour grade ───────────────────────────────────────────────────
  // The sea borrows the sky: blue by day shading to burnt orange near the
  // horizon at sunset, grayed under overcast, inked down at night.
  function drawWaterGrade(sky, nf, cloud) {
    const sunAlt = sky.sun.altDeg;
    const dayF = clamp(sunAlt / 10, 0, 1);
    const lowness = clamp(1 - sunAlt / 18, 0, 1);
    if (dayF > 0) {
      const c = lerpRgb([96, 165, 215], [255, 150, 70], lowness);
      const g = waterCtx.createLinearGradient(0, HORIZON_Y, 0, HORIZON_Y + 340);
      g.addColorStop(0, rgba(c, 0.26 * dayF * (1 - cloud * 0.5)));
      g.addColorStop(1, rgba(c, 0));
      waterCtx.fillStyle = g;
      waterCtx.fillRect(0, HORIZON_Y, W, 340);
    }
    if (cloud > 0.4) {
      waterCtx.fillStyle = `rgba(105, 115, 125, ${(cloud - 0.4) * 0.22})`;
      waterCtx.fillRect(0, HORIZON_Y, W, H - HORIZON_Y - 150);
    }
    if (nf > 0.05) {
      waterCtx.fillStyle = `rgba(3, 6, 14, ${nf * 0.45})`;
      waterCtx.fillRect(0, HORIZON_Y, W, H - HORIZON_Y - 150);
    }
    // Mirror the ink onto the vista wing water (CSS var consumed by the
    // #water-wing::before overlay) so scene and wings darken as one
    const inkV = (nf > 0.05 ? nf * 0.45 : 0).toFixed(3);
    if (inkV !== lastInkV) {
      lastInkV = inkV;
      document.documentElement.style.setProperty("--night-ink", inkV);
    }
  }
  let lastInkV = "";

  // ── Ship light reflections ───────────────────────────────────────────────
  // A true mirrored reflection of the ship's lights, done as scanline
  // displacement: the night sprite's emissive pixels (windows, masthead and
  // sidelights, each in its own colour) are extracted once, then mirrored
  // into the water in thin slices. Each slice is displaced sideways and
  // jittered vertically by beating sine pairs whose amplitude grows with
  // depth, so the mirror breaks into shimmering ripples. A quarter-scale
  // pre-blurred copy is layered underneath as bloom.
  let lightsSprite = null;
  let lightsBloom = null;
  let lightsBottomRow = 0; // last opaque hull row = the waterline in the sprite
  function buildLightsSprites() {
    if (lightsSprite) return true;
    const img = document.querySelector(".britannic-night");
    if (!img || !img.complete || !img.naturalWidth) return false;
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    const sprite = document.createElement("canvas");
    sprite.width = w;
    sprite.height = h;
    const c1 = sprite.getContext("2d", { willReadFrequently: true });
    c1.drawImage(img, 0, 0);
    // keep only emissive pixels — the dark hull must not reflect
    try {
      const id = c1.getImageData(0, 0, w, h);
      const px = id.data;
      let bottomTmp = 0;
      for (let i = 0; i < px.length; i += 4) {
        if (px[i + 3] > 20) {
          const y = ((i >> 2) / w) | 0;
          if (y > bottomTmp) bottomTmp = y;
        }
        const lum = 0.45 * px[i] + 0.45 * px[i + 1] + 0.1 * px[i + 2];
        px[i + 3] =
          lum <= 95 ? 0 : Math.round(px[i + 3] * Math.min(1, (lum - 95) / 60));
      }
      lightsBottomRow = bottomTmp + 1;
      c1.putImageData(id, 0, 0);
    } catch (e) {
      return false;
    }
    lightsSprite = sprite;
    // quarter-scale, heavily blurred copy = cheap bloom
    const bw = Math.max(1, Math.round(w / 4));
    const bh = Math.max(1, Math.round(h / 4));
    lightsBloom = document.createElement("canvas");
    lightsBloom.width = bw;
    lightsBloom.height = bh;
    const c2 = lightsBloom.getContext("2d");
    c2.filter = "blur(5px) saturate(1.25)";
    c2.drawImage(sprite, 0, 0, bw, bh);
    return true;
  }

  // True when it drew the (shimmering) reflection
  function drawShipLights(now, sunAltDeg) {
    const lw = Math.min(1, Math.max(0, (sunAltDeg + 6) / 10));
    const lightsAmt = 1 - lw * lw * (3 - 2 * lw); // matches window-light ramp
    if (lightsAmt <= 0.04) return false;
    if (!buildLightsSprites()) return false;
    const ship =
      window.__britCanvas || document.querySelector(".britannic-night");
    if (!ship || !waterCanvas) return false;
    // Map the ship into the water canvas's own scene coordinates via client
    // rects — the ship's offset parent is a nested container, so offsetTop
    // would land the mirror far below the real waterline.
    const wRect = waterCanvas.getBoundingClientRect();
    const sRect = ship.getBoundingClientRect();
    if (!wRect.width || !sRect.width) return false;
    const kx = W / wRect.width;
    const ky = H / wRect.height;
    const left = (sRect.left - wRect.left) * kx;
    const width = sRect.width * kx;
    const shipH = sRect.height * ky;
    // The mirror plane is the water surface itself, a canvas-internal
    // constant (the water texture's top edge sits at HORIZON_Y), so layout
    // shifts can never drag the reflection down. Only the sprite row that
    // corresponds to that waterline is derived from the ship's rect.
    const waterY = HORIZON_Y + 10;
    const shipTop = (sRect.top - wRect.top) * ky;
    const waterRow = Math.min(
      lightsBottomRow,
      ((waterY - shipTop) / shipH) * lightsSprite.height,
    );
    const maxDepth = Math.min(H - 150 - waterY, shipH * 0.8);
    if (maxDepth <= 8 || waterRow <= 0) return false;
    const t = now / 1000;
    const STRETCH = 0.78; // choppy water squashes the mirror image vertically
    waterCtx.save();
    waterCtx.globalCompositeOperation = "lighter";

    // bloom pass: coarse mirrored slices of the blurred copy — a soft glow
    // pooling under the hull that survives any display scale
    const BLOOM_SLICES = 8;
    const bs = maxDepth / BLOOM_SLICES;
    const bloomRows = (bs * (lightsBloom.width / width)) / STRETCH;
    for (let j = 0; j < BLOOM_SLICES; j++) {
      const d = j / BLOOM_SLICES;
      const srcY = waterRow / 4 - (j + 1) * bloomRows;
      if (srcY + bloomRows <= 0) break;
      waterCtx.globalAlpha = lightsAmt * 0.16 * (1 - d);
      waterCtx.drawImage(
        lightsBloom,
        0,
        Math.max(0, srcY),
        lightsBloom.width,
        bloomRows,
        left + Math.sin(t * 0.6 + j * 0.8) * (2 + d * 8),
        waterY + j * bs,
        width,
        bs + 1,
      );
    }

    // sharp pass: thin mirrored slices, displaced by beating sine pairs.
    // Near the waterline the mirror is almost intact; with depth the slices
    // wander further and smear vertically, breaking it into ripples.
    const SLICE = 3;
    const nSlices = Math.floor(maxDepth / SLICE);
    const srcRows = (SLICE * (lightsSprite.width / width)) / STRETCH;
    for (let j = 0; j < nSlices; j++) {
      const d = j / nSlices;
      let srcY = waterRow - (j + 1) * srcRows;
      // vertical jitter smears window rows into streaks as depth grows
      srcY +=
        Math.sin(t * 1.3 + j * 0.9) * (1.5 + d * 4) +
        Math.sin(t * 0.7 + j * 0.37) * (2.5 + d * 5);
      if (srcY + srcRows <= 0 || srcY >= lightsSprite.height) continue;
      const wob =
        Math.sin(t * 1.7 + j * 0.55) * (1 + d * 7) +
        Math.sin(t * 0.9 + j * 0.23 + 2.1) * (1 + d * 5);
      const a = lightsAmt * 0.55 * Math.pow(1 - d, 2.1);
      if (a < 0.012) continue;
      waterCtx.globalAlpha = a;
      waterCtx.drawImage(
        lightsSprite,
        0,
        srcY,
        lightsSprite.width,
        srcRows,
        left + wob,
        waterY + j * SLICE,
        width,
        SLICE,
      );
    }
    waterCtx.restore();
    return true;
  }

  // True when it drew the (flickering) path of light on the water
  function drawGlitter(body, now, cloudDim) {
    if (!body) return false;
    let strength;
    let color;
    if (body.kind === "sun") {
      // Only a low sun lays a path on the water
      if (body.altDeg > 22) return false;
      strength = ((22 - body.altDeg) / 22) * body.a;
      color = lerpRgb([255, 235, 170], [255, 110, 50], body.lowness);
    } else {
      strength = 0.4 * body.a * body.illum;
      color = [205, 218, 235];
    }
    strength *= cloudDim;
    if (strength <= 0.03) return false;

    // Moonlight lays a tighter, quieter path than the sun
    const spread = body.kind === "moon" ? 0.55 : 1;
    const t = now / 1000;
    for (const d of dashes) {
      const y = HORIZON_Y + 6 + Math.pow(d.f, 1.5) * 400;
      const halfW = (10 + d.f * 130) * spread;
      const x =
        body.x + Math.sin(t * d.swingSpeed + d.swingPhase) * halfW * d.swing;
      const flick =
        0.3 + 0.7 * Math.abs(Math.sin(t * d.flickSpeed + d.flickPhase));
      const a = strength * (1 - d.f * 0.78) * flick;
      if (a <= 0.02) continue;
      const len = 5 + d.f * 26;
      waterCtx.fillStyle = rgba(color, a);
      waterCtx.fillRect(x - len / 2, y, len, 2 + d.f * 1.5);
    }
    return true;
  }

  function updateHaze(sunAlt) {
    // Continuous weights from the sun's altitude — the three haze bands
    // blend through each other with no stepped switches
    const dayW = clamp((sunAlt - 6) / 5, 0, 1);
    const nightW = clamp((-sunAlt - 7) / 5, 0, 1);
    const msW = Math.max(0, 1 - dayW - nightW);
    hazeDay.style.opacity = dayW.toFixed(3);
    hazeNight.style.opacity = nightW.toFixed(3);
    hazeMs.style.opacity = msW.toFixed(3);
  }

  // Paint the sky as an opaque gradient on the (GPU-composited) sky canvas,
  // replacing the per-frame CSS background repaint that hitched the
  // compositor. Stops are published by game.js updateSkyGradient (palette
  // bands + overcast blending). The opaque fill covers the static CSS .sky
  // layers behind it; if no stops are published yet, we leave the canvas
  // transparent and the CSS sky shows through as a fallback.
  function drawSkyGradient() {
    const g = window.RBV && window.RBV.skyGradient;
    if (!g || !g.stops || !g.stops.length) return;
    const top = Number.isFinite(g.top) ? g.top : 0;
    const bottom = Number.isFinite(g.bottom) ? g.bottom : HORIZON_Y;
    const grad = skyCtx.createLinearGradient(0, top, 0, bottom);
    const n = g.stops.length;
    for (let i = 0; i < n; i++) {
      const p =
        g.positions && g.positions[i] != null ? g.positions[i] : i / (n - 1);
      grad.addColorStop(clamp(p, 0, 1), g.stops[i]);
    }
    skyCtx.fillStyle = grad;
    // Fill only the sky band (down to the .sky element's bottom); the sea
    // layers (z-index 1–2) cover everything below the horizon.
    skyCtx.fillRect(0, 0, W, Math.ceil(bottom));
  }

  function frame(now) {
    requestAnimationFrame(frame);
    // No throttle during timelapse — render on every vsync tick for even
    // pacing; otherwise cap at ~15fps to save power for idle twinkle/shimmer.
    // And when the last picture had nothing that moves by itself (no stars,
    // glitter or ship lights: a high sun), the sky changes only as the sun
    // and the light move, which once a second shows as well: two full-screen
    // canvases redrawn 15 times a second for a still picture were a large
    // part of the game's CPU.
    // Drawn on the scene's shared frames (RBV.sceneFrame, core/rbv.js), so the
    // sky changes in the same frames as everything else.
    if (!document.body.classList.contains("dev-timelapse")) {
      if (!RBV.sceneFrame(now)) return;
      // (a few ms short of 66: shared frames come every ~33 ms)
      if (now - lastFrame < (lastFrameMoved ? FRAME_MS - 6 : STILL_FRAME_MS)) return;
    }
    lastFrame = now;
    if (!window.VoyageAstro) return;

    const w = weatherNow();
    const dev = devMode();
    let pos = (w && w.position) || { lat: 50.5, lon: -1.5 };
    let astroElapsed = elapsedSeconds();
    if (dev && dev.DEV_POSITION) {
      pos = dev.DEV_POSITION;
      // Clocks retarded en route: keep the sun aligned to ship time as if
      // still near the reference longitude
      const refLon = typeof dev.DEV_REF_LON === "number" ? dev.DEV_REF_LON : -1.5;
      astroElapsed += ((refLon - pos.lon) / 15) * 3600;
    }
    const sky = window.VoyageAstro.skyAt(astroElapsed, pos.lat, pos.lon);
    // Admin moon-phase override (dev panel) — the moon is moved to the
    // orbital position that phase implies (elongation along the ecliptic),
    // so its rise/set times stay honest: a dev new moon rides with the sun,
    // first quarter transits near sunset, full opposes the sun.
    if (dev && dev.DEV_MOON) {
      sky.moon = window.VoyageAstro.moonForPhase(
        astroElapsed,
        pos.lat,
        pos.lon,
        dev.DEV_MOON.illum,
        dev.DEV_MOON.waxing,
      );
    }
    // Publish for the sky-gradient and ship-lighting systems
    if (RBV.celestial) RBV.celestial.sunAltDeg = sky.sun.altDeg;

    const cloud = w ? w.cloudCover : 0.4;
    const foggy = w && (w.condition === "fog" || w.condition === "mist");
    // Heavy cloud hides the sky; fog hides nearly everything
    let dim = 1 - cloud * 0.85;
    if (foggy) dim *= 0.15;
    // Real twilight: stars arrive as the sun sinks past -3° and the sky is
    // fully dark by -12°
    const nf = clamp((-sky.sun.altDeg - 3) / 9, 0, 1);

    // Defensive: reset both contexts so no transform, clip-free composite
    // mode, or alpha from a failed previous frame can leak into this one
    skyCtx.setTransform(1, 0, 0, 1, 0, 0);
    skyCtx.globalCompositeOperation = "source-over";
    skyCtx.globalAlpha = 1;
    waterCtx.setTransform(1, 0, 0, 1, 0, 0);
    waterCtx.globalCompositeOperation = "source-over";
    waterCtx.globalAlpha = 1;
    skyCtx.clearRect(0, 0, W, H);
    waterCtx.clearRect(0, 0, W, H);
    // Recompute the gradient stops from THIS frame's sun altitude, then draw
    // them — keeps the sky perfectly in step with the bodies (no cross-loop
    // jitter between the timelapse loop and this one).
    if (window.updateSkyGradient) {
      try {
        window.updateSkyGradient();
      } catch (e) {
        /* non-fatal */
      }
    }
    drawSkyGradient();

    try {
      const starDim = Math.max(0, 1 - cloud * 0.9) * (foggy ? 0.08 : 1);
      const planets = window.VoyageAstro.planetsAt
        ? window.VoyageAstro.planetsAt(
            window.VoyageAstro.julianFromElapsed(astroElapsed),
          )
        : null;
      const starsShown = drawSky(sky, pos, cloud, starDim, now, planets);
      const sun = drawSun(sky.sun, dim);
      const moon = drawMoon(sky.moon, dim, nf, sky.sun, pos.lat);
      drawWaterGrade(sky, nf, cloud);
      const glitterShown = drawGlitter(
        sun && sun.altDeg <= 22 ? sun : moon,
        now,
        Math.max(0.05, dim),
      );
      const lightsShown = drawShipLights(now, sky.sun.altDeg);
      lastFrameMoved = starsShown || glitterShown || lightsShown;
      updateHaze(sky.sun.altDeg);
    } catch (err) {
      if (!window.__celestialErrLogged) {
        window.__celestialErrLogged = true;
        console.error("Celestial frame error:", err);
      }
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    if (started) return;
    if (!ensureLayers()) return;
    initSky();
    started = true;
    requestAnimationFrame(frame);
  });

  RBV.celestial = {
    get weather() {
      return cachedWeather;
    },
    refreshWeather() {
      lastWeatherAt = 0;
    },
  };
})(window.RBV);
