/**
 * Scene weather effects driven by the shared VoyageWeather engine.
 *
 * Reads the current observation every 30 s and makes the outdoor scene match
 * the report in the narrative panel:
 *   - overcast veil: the scene dims as cloud cover climbs past half
 *   - fog layer: rolls in/out on mist and fog conditions (long CSS fades)
 *   - rain canvas: drizzle / showers / steady rain, streaks slanted by wind;
 *     showers pulse in intensity the way passing cells do
 *
 * Purely visual and client-local: on/off state and intensity come from the
 * deterministic engine, so every player still sees the same weather; only
 * individual raindrop positions differ per client.
 */
(function (RBV) {
  const SCENE_W = 1920;
  const SCENE_H = 1080;
  const REFRESH_MS = 30000;

  const RAIN_PRESETS = {
    drizzle: { count: 90, len: 7, speed: 320, alpha: 0.2, pulse: false },
    showers: { count: 170, len: 12, speed: 560, alpha: 0.28, pulse: true },
    rain: { count: 250, len: 15, speed: 660, alpha: 0.32, pulse: false },
  };

  let veilLayer = null;
  let fogLayer = null;
  let rainCanvas = null;
  let rainCtx = null;
  let drops = [];
  let rainCfg = null;
  let rainSlant = 0; // horizontal px/sec
  let rainAnim = null;
  let rainStopTimer = null;
  let lastTick = 0;
  let lightningLayer = null;
  let lightningTimer = null;
  let lastBoltSlot = -1;
  let flashResetTimer = null;

  // Same integer-hash family as the weather engine, for seeded bolt slots
  function boltHash(n) {
    let h = (n | 0) ^ 0x9e37;
    h = Math.imul(h ^ (h >>> 16), 2246822519);
    h = Math.imul(h ^ (h >>> 13), 3266489917);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }

  function ensureLayers() {
    const scene = document.querySelector(".scene-layer");
    if (!scene) return false;

    if (!veilLayer) {
      veilLayer = document.createElement("div");
      veilLayer.className = "weather-cloud-veil";
      scene.appendChild(veilLayer);
    }
    if (!fogLayer) {
      fogLayer = document.createElement("div");
      fogLayer.className = "weather-fog-layer";
      scene.appendChild(fogLayer);
    }
    if (!rainCanvas) {
      rainCanvas = document.createElement("canvas");
      rainCanvas.className = "weather-rain-canvas";
      rainCanvas.width = SCENE_W;
      rainCanvas.height = SCENE_H;
      scene.appendChild(rainCanvas);
      rainCtx = rainCanvas.getContext("2d");
    }
    if (!lightningLayer) {
      lightningLayer = document.createElement("div");
      lightningLayer.className = "weather-lightning";
      scene.appendChild(lightningLayer);
    }
    return true;
  }

  // ── Squall lightning ──
  // Elapsed time is cut into 10 s slots; a seeded hash decides which slots
  // flash, so every client sees the same bolt at the same moment.
  function checkLightning() {
    const v = RBV.voyage || {};
    const seed = v.voyageStartTime || v.pendingVoyageStartTime || 0;
    const elapsed =
      typeof window.getElapsedSeconds === "function"
        ? window.getElapsedSeconds()
        : 0;
    const slot = Math.floor(elapsed / 10);
    if (slot === lastBoltSlot) return;
    lastBoltSlot = slot;
    if (boltHash((seed / 1000) ^ (slot * 7919)) < 0.22) {
      lightningLayer.classList.remove("flash");
      // Force a reflow so re-adding the class restarts the animation
      void lightningLayer.offsetWidth;
      lightningLayer.classList.add("flash");
      if (flashResetTimer) clearTimeout(flashResetTimer);
      flashResetTimer = setTimeout(() => {
        flashResetTimer = null;
        lightningLayer.classList.remove("flash");
      }, 800);
    }
  }

  function setLightning(active) {
    if (active && !lightningTimer) {
      lastBoltSlot = -1;
      lightningTimer = setInterval(checkLightning, 1000);
    } else if (!active && lightningTimer) {
      clearInterval(lightningTimer);
      lightningTimer = null;
    }
  }

  function currentWeather() {
    if (!window.VoyageWeather) return null;
    const v = RBV.voyage || {};
    const seed = v.voyageStartTime || v.pendingVoyageStartTime || 0;
    const dev =
      v.DEV_NORTH_ATLANTIC &&
      typeof window.getDevElapsedSeconds === "function";
    const elapsed = dev
      ? window.getDevElapsedSeconds()
      : typeof window.getElapsedSeconds === "function"
        ? window.getElapsedSeconds()
        : 0;
    let state = window.VoyageWeather.computeWeatherAt(
      elapsed,
      seed,
      dev ? v.DEV_POSITION : undefined,
    );
    if (window.applyDevWeather) state = window.applyDevWeather(state);
    return state;
  }

  function buildDrops(count) {
    drops = [];
    for (let i = 0; i < count; i++) {
      drops.push({
        x: Math.random() * SCENE_W,
        y: Math.random() * SCENE_H,
        jitter: 0.75 + Math.random() * 0.5,
      });
    }
  }

  function rainTick(now) {
    if (!rainCfg || !rainCtx) {
      rainAnim = null;
      return;
    }
    const dt = lastTick ? Math.min(0.05, (now - lastTick) / 1000) : 0.016;
    lastTick = now;

    rainCtx.clearRect(0, 0, SCENE_W, SCENE_H);
    let alpha = rainCfg.alpha;
    if (rainCfg.pulse) {
      // Passing cells: intensity swells and eases over ~20 s
      alpha *= 0.55 + 0.45 * Math.sin(now / 9000);
    }
    rainCtx.strokeStyle = `rgba(202, 214, 224, ${Math.max(0.05, alpha)})`;
    rainCtx.lineWidth = 1.2;
    rainCtx.beginPath();
    const slantLen = (rainSlant / rainCfg.speed) * rainCfg.len;
    for (const d of drops) {
      d.y += rainCfg.speed * d.jitter * dt;
      d.x += rainSlant * d.jitter * dt;
      if (d.y > SCENE_H) {
        d.y -= SCENE_H + rainCfg.len;
        d.x = Math.random() * SCENE_W;
      }
      if (d.x > SCENE_W) d.x -= SCENE_W;
      if (d.x < 0) d.x += SCENE_W;
      rainCtx.moveTo(d.x, d.y);
      rainCtx.lineTo(d.x - slantLen, d.y - rainCfg.len);
    }
    rainCtx.stroke();
    rainAnim = requestAnimationFrame(rainTick);
  }

  function setRain(cfg, windKn, windDirDeg) {
    if (cfg) {
      if (rainStopTimer) {
        clearTimeout(rainStopTimer);
        rainStopTimer = null;
      }
      // Winds out of the east lean the rain the other way
      const dirSign = windDirDeg > 0 && windDirDeg < 180 ? -1 : 1;
      rainSlant = dirSign * Math.min(windKn, 30) * 8;
      if (!rainCfg || rainCfg.count !== cfg.count) buildDrops(cfg.count);
      rainCfg = cfg;
      rainCanvas.style.opacity = "1";
      if (!rainAnim) {
        lastTick = 0;
        rainAnim = requestAnimationFrame(rainTick);
      }
    } else if (rainCfg) {
      // Fade the canvas out, then stop the loop
      rainCanvas.style.opacity = "0";
      if (!rainStopTimer) {
        rainStopTimer = setTimeout(() => {
          rainStopTimer = null;
          rainCfg = null;
          if (rainAnim) {
            cancelAnimationFrame(rainAnim);
            rainAnim = null;
          }
          if (rainCtx) rainCtx.clearRect(0, 0, SCENE_W, SCENE_H);
        }, 4000);
      }
    }
  }

  function apply() {
    if (!ensureLayers()) return;
    const w = currentWeather();
    if (!w) return;

    // The sky gradient itself grays out with cloud (updateSkyGradient);
    // this veil is only a whisper of gloom over the ship and sea in rain
    const raining =
      w.condition === "rain" ||
      w.condition === "drizzle" ||
      w.condition === "showers";
    let veil = Math.max(0, w.cloudCover - 0.5) * 0.25;
    if (raining) veil += 0.06;
    veilLayer.style.opacity = Math.min(0.18, veil).toFixed(3);

    // Fog / mist
    const fogOpacity =
      w.condition === "fog" ? 0.75 : w.condition === "mist" ? 0.4 : 0;
    fogLayer.style.opacity = String(fogOpacity);

    // Rain
    setRain(RAIN_PRESETS[w.condition] || null, w.windKn, w.windDirDeg);

    // Squall lightning: showers driven by a strong-breeze-or-worse wind
    setLightning(w.condition === "showers" && w.beaufort >= 6);

    // Publish the wind for other scene systems (funnel smoke reads this)
    window.sceneWind = { kn: w.windKn, dirDeg: w.windDirDeg };
  }

  document.addEventListener("DOMContentLoaded", () => {
    apply();
    setInterval(apply, REFRESH_MS);
  });

  RBV.weatherFx = { apply };
  window.weatherEffects = RBV.weatherFx;
})(window.RBV);
