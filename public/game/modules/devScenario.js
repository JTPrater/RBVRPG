/**
 * Admin test scenario: Britannic steaming mid-North Atlantic.
 *
 * Activates the DEV_NORTH_ATLANTIC flag (voyageSync) and extends it with:
 *   - an open-ocean stand-in position (46.5°N 35°W, no shelter, no land) fed
 *     to the weather engine and the celestial layer. Ship clocks are assumed
 *     retarded to local time en route, so consumers realign the sun to the
 *     clock via DEV_REF_LON.
 *   - a body class (dev-north-atlantic) that hides Southampton, Cherbourg,
 *     yachts, and coastal terrain so nothing interrupts the open-water scene.
 *   - an admin panel (top-left): ship-time slider (preview sunset/night/dawn)
 *     plus weather overrides — condition presets and cloud/wind sliders that
 *     take precedence over the weather engine via window.applyDevWeather.
 *
 * Persisted in localStorage: "rbv:devNA", "rbv:devNAHour", "rbv:devNADay",
 * "rbv:devNAWx".
 * Currently DEFAULT ON for scene art direction — the panel's Turn off
 * button (or localStorage.setItem("rbv:devNA","0") + reload) restores the
 * normal voyage. Flip DEFAULT_ON to false before a public deploy.
 */
(function (RBV) {
  const v = RBV.voyage;
  const KEY = "rbv:devNA";
  const HOUR_KEY = "rbv:devNAHour";
  const WX_KEY = "rbv:devNAWx";
  const DEFAULT_ON = false; // (2026-11-23: off for the public test, as the note above asks)

  const stored = localStorage.getItem(KEY);
  v.DEV_NORTH_ATLANTIC = stored === null ? DEFAULT_ON : stored === "1";
  const storedHour = parseFloat(localStorage.getItem(HOUR_KEY));
  v.DEV_HOUR = Number.isFinite(storedHour) ? storedHour : 17.5;
  const DAY_KEY = "rbv:devNADay";
  const storedDay = parseInt(localStorage.getItem(DAY_KEY), 10);
  v.DEV_DAY = Number.isFinite(storedDay) ? storedDay : 0;
  v.DEV_POSITION = { lat: 46.5, lon: -35, shelter: 0, land: 0 };
  v.DEV_REF_LON = -1.5; // clock stays sun-aligned as if still near this lon

  let storedWx = null;
  try {
    storedWx = JSON.parse(localStorage.getItem(WX_KEY) || "null");
  } catch (e) {
    storedWx = null;
  }
  v.DEV_WEATHER = storedWx; // null = let the engine drive

  const MOON_KEY = "rbv:devNAMoon";
  const MOON_PRESETS = {
    new: { illum: 0.02, waxing: true },
    waxc: { illum: 0.25, waxing: true },
    fq: { illum: 0.5, waxing: true },
    waxg: { illum: 0.78, waxing: true },
    full: { illum: 0.999, waxing: true },
    wang: { illum: 0.78, waxing: false },
    lq: { illum: 0.5, waxing: false },
    wanc: { illum: 0.25, waxing: false },
  };
  let storedMoon = null;
  try {
    storedMoon = JSON.parse(localStorage.getItem(MOON_KEY) || "null");
  } catch (e) {
    storedMoon = null;
  }
  v.DEV_MOON = storedMoon; // null = real 1920 ephemeris

  // Scrubbed hour mapped onto the current dev day (timelapse advances the
  // day at each noon-crossing), for deterministic weather/astro. Days give
  // the timelapse a real calendar: the moon phase creeps, moonrise slides
  // ~50 min later each night, weather systems roll through.
  window.getDevElapsedSeconds = function () {
    return v.DEV_DAY * 86400 + ((v.DEV_HOUR - 12 + 24) % 24) * 3600;
  };

  // ── Weather override ──
  // Presets seed condition + typical cloud/wind; the sliders then fine-tune.
  const WX_PRESETS = {
    clear: { condition: "dry", description: "Clear skies", cloudCover: 0.05, windKn: 8 },
    fair: { condition: "dry", description: "Fair, scattered cloud", cloudCover: 0.28, windKn: 10 },
    partly: { condition: "dry", description: "Partly cloudy", cloudCover: 0.5, windKn: 12 },
    overcast: { condition: "dry", description: "Overcast", cloudCover: 0.95, windKn: 14 },
    drizzle: { condition: "drizzle", description: "Grey skies, light drizzle", cloudCover: 0.92, windKn: 7 },
    rain: { condition: "rain", description: "Overcast, steady rain", cloudCover: 0.97, windKn: 14 },
    showers: { condition: "showers", description: "Passing showers", cloudCover: 0.8, windKn: 19 },
    squall: { condition: "showers", description: "Squally showers", cloudCover: 0.9, windKn: 30 },
    mist: { condition: "mist", description: "Mist patches", cloudCover: 0.55, windKn: 4 },
    fog: { condition: "fog", description: "Dense fog banks", cloudCover: 0.6, windKn: 3 },
  };

  const BFT_MAX = [1, 3, 6, 10, 16, 21, 27, 33];
  const BFT_TEXT = [
    "calm", "light air", "light breeze", "gentle breeze", "moderate breeze",
    "fresh breeze", "strong breeze", "near gale", "gale",
  ];
  const SEA_TEXT = [
    "sea like glass", "sea like glass", "calm sea", "slight sea",
    "moderate sea", "rather rough sea", "rough sea", "very rough sea",
    "very rough sea",
  ];

  // Consumers (narrative, weatherEffects, celestial) run engine output
  // through this; a copy comes back with the admin overrides applied.
  window.applyDevWeather = function (state) {
    if (!v.DEV_NORTH_ATLANTIC || !v.DEV_WEATHER || !state) return state;
    const o = v.DEV_WEATHER;
    const s = Object.assign({}, state);
    if (typeof o.cloudCover === "number") s.cloudCover = o.cloudCover;
    if (typeof o.windKn === "number") {
      s.windKn = Math.round(o.windKn);
      let b = 0;
      while (b < BFT_MAX.length && s.windKn > BFT_MAX[b]) b++;
      s.beaufort = b;
      s.beaufortText = BFT_TEXT[b];
      s.seaState = SEA_TEXT[b];
    }
    if (o.condition) s.condition = o.condition;
    if (o.description) s.description = o.description;
    return s;
  };

  function persistWx() {
    if (v.DEV_WEATHER) {
      localStorage.setItem(WX_KEY, JSON.stringify(v.DEV_WEATHER));
    } else {
      localStorage.removeItem(WX_KEY);
    }
  }

  function fmtHour(h) {
    const hh = Math.floor(h);
    const mm = Math.round((h - hh) * 60);
    return String(hh).padStart(2, "0") + ":" + String(mm).padStart(2, "0");
  }

  const NA_TEXT =
    "We are now deep in the North Atlantic, making steady progress. The open ocean stretches to every horizon.";

  function pushRefresh() {
    if (typeof window.updateSkyImage === "function") window.updateSkyImage();
    if (typeof window.updateInfoBar === "function") window.updateInfoBar();
    if (window.narrativeSystem) window.narrativeSystem.updateWeather();
    if (RBV.celestial && RBV.celestial.refreshWeather) {
      RBV.celestial.refreshWeather();
    }
    if (RBV.weatherFx) RBV.weatherFx.apply();
    // Keep the scenario's story text pinned even if a voyage handler ran
    // before the guards were in place
    const story = document.getElementById("story-text");
    if (story && story.textContent.indexOf("North Atlantic") === -1) {
      story.textContent = NA_TEXT;
      story.style.opacity = "1";
    }
  }

  function buildPanel() {
    if (!v.DEV_NORTH_ATLANTIC) {
      // The chip that switches the test on is for the developer only (every
      // player saw it at the top left). Show it with
      // localStorage.setItem("rbv:dev", "1") and a reload.
      if (localStorage.getItem("rbv:dev") !== "1") return;
      const onTab = document.createElement("button");
      onTab.id = "dev-na-show";
      onTab.type = "button";
      onTab.textContent = "⚙";
      onTab.title = "Enable N. Atlantic test";
      onTab.addEventListener("click", () => {
        localStorage.setItem(KEY, "1");
        location.reload();
      });
      document.body.appendChild(onTab);
      return;
    }
    document.body.classList.add("dev-north-atlantic");

    const panel = document.createElement("div");
    panel.id = "dev-na-panel";
    panel.innerHTML = `
      <div class="dev-na-row">
        <span class="dev-na-title">N. Atlantic Test</span>
        <span>
          <button id="dev-na-hide" type="button">Hide</button>
          <button id="dev-na-off" type="button">Turn off</button>
        </span>
      </div>
      <input id="dev-na-hour" type="range" min="0" max="23.75" step="0.25" />
      <div id="dev-na-readout" class="dev-na-readout"></div>
      <div class="dev-na-sec">Weather</div>
      <select id="dev-na-wx">
        <option value="auto">Engine (auto)</option>
        <option value="clear">Clear</option>
        <option value="fair">Fair</option>
        <option value="partly">Partly cloudy</option>
        <option value="overcast">Overcast</option>
        <option value="drizzle">Drizzle</option>
        <option value="rain">Steady rain</option>
        <option value="showers">Passing showers</option>
        <option value="squall">Squall</option>
        <option value="mist">Mist</option>
        <option value="fog">Fog</option>
      </select>
      <div class="dev-na-srow">
        <span>Cloud</span>
        <input id="dev-na-cloud" type="range" min="0" max="100" step="5" />
        <span id="dev-na-cloud-out" class="dev-na-val"></span>
      </div>
      <div class="dev-na-srow">
        <span>Wind</span>
        <input id="dev-na-wind" type="range" min="0" max="38" step="1" />
        <span id="dev-na-wind-out" class="dev-na-val"></span>
      </div>
      <div class="dev-na-sec">Moon</div>
      <select id="dev-na-moon">
        <option value="auto">Real (1920)</option>
        <option value="custom">Custom (slider)</option>
        <option value="new">New</option>
        <option value="waxc">Waxing crescent</option>
        <option value="fq">First quarter</option>
        <option value="waxg">Waxing gibbous</option>
        <option value="full">Full</option>
        <option value="wang">Waning gibbous</option>
        <option value="lq">Last quarter</option>
        <option value="wanc">Waning crescent</option>
      </select>
      <div class="dev-na-srow">
        <span>Phase</span>
        <input id="dev-na-phase" type="range" min="0" max="100" step="0.5" value="50" />
        <span id="dev-na-phase-out" class="dev-na-val"></span>
      </div>
      <div class="dev-na-sec">Timelapse</div>
      <div class="dev-na-srow">
        <button id="dev-na-lapse" type="button">Play</button>
        <input id="dev-na-lspeed" type="range" min="0.05" max="2" step="0.05" value="0.4" />
        <span id="dev-na-lspeed-out" class="dev-na-val">0.4h/s</span>
      </div>
    `;
    document.body.appendChild(panel);

    const slider = panel.querySelector("#dev-na-hour");
    const readout = panel.querySelector("#dev-na-readout");
    const wxSelect = panel.querySelector("#dev-na-wx");
    const cloudIn = panel.querySelector("#dev-na-cloud");
    const cloudOut = panel.querySelector("#dev-na-cloud-out");
    const windIn = panel.querySelector("#dev-na-wind");
    const windOut = panel.querySelector("#dev-na-wind-out");
    slider.value = String(v.DEV_HOUR);

    const updateReadout = () => {
      let sunTxt = "";
      if (window.VoyageAstro) {
        const devElapsed =
          window.getDevElapsedSeconds() +
          ((v.DEV_REF_LON - v.DEV_POSITION.lon) / 15) * 3600;
        const alt = window.VoyageAstro.skyAt(
          devElapsed,
          v.DEV_POSITION.lat,
          v.DEV_POSITION.lon,
        ).sun.altDeg;
        sunTxt = " · sun " + alt.toFixed(0) + "°";
      }
      readout.textContent =
        "Day " + (v.DEV_DAY + 1) + " · " + fmtHour(v.DEV_HOUR) + sunTxt;
    };

    const syncWxUI = () => {
      const o = v.DEV_WEATHER;
      wxSelect.value = o && o.preset ? o.preset : "auto";
      cloudIn.disabled = !o;
      windIn.disabled = !o;
      if (o) {
        cloudIn.value = String(Math.round(o.cloudCover * 100));
        windIn.value = String(o.windKn);
        cloudOut.textContent = Math.round(o.cloudCover * 100) + "%";
        windOut.textContent = o.windKn + " kn";
      } else {
        cloudOut.textContent = "auto";
        windOut.textContent = "auto";
      }
    };

    slider.addEventListener("input", () => {
      v.DEV_HOUR = parseFloat(slider.value);
      localStorage.setItem(HOUR_KEY, String(v.DEV_HOUR));
      updateReadout();
      pushRefresh();
    });

    const reseed = () => {
      if (typeof window.reseedClouds !== "function") return;
      let density = 0.5;
      if (v.DEV_WEATHER) {
        density = v.DEV_WEATHER.cloudCover;
      } else if (RBV.celestial && RBV.celestial.weather) {
        density = RBV.celestial.weather.cloudCover;
      }
      window.reseedClouds(density);
    };

    wxSelect.addEventListener("change", () => {
      const key = wxSelect.value;
      if (key === "auto") {
        v.DEV_WEATHER = null;
      } else {
        v.DEV_WEATHER = Object.assign({ preset: key }, WX_PRESETS[key]);
      }
      persistWx();
      syncWxUI();
      pushRefresh();
      reseed();
    });

    cloudIn.addEventListener("input", () => {
      if (!v.DEV_WEATHER) return;
      v.DEV_WEATHER.cloudCover = Number(cloudIn.value) / 100;
      persistWx();
      syncWxUI();
      pushRefresh();
      reseed();
    });

    windIn.addEventListener("input", () => {
      if (!v.DEV_WEATHER) return;
      v.DEV_WEATHER.windKn = Number(windIn.value);
      persistWx();
      syncWxUI();
      pushRefresh();
    });

    const moonSelect = panel.querySelector("#dev-na-moon");
    const phaseIn = panel.querySelector("#dev-na-phase");
    const phaseOut = panel.querySelector("#dev-na-phase-out");

    // Slider = position in the lunar cycle: 0 new → 25 first quarter →
    // 50 full → 75 last quarter → 100 new again
    const cycleToMoon = (s) => ({
      illum: (1 - Math.cos(2 * Math.PI * s)) / 2,
      waxing: s < 0.5,
    });
    const moonToCycle = (m) => {
      const s = Math.acos(1 - 2 * m.illum) / (2 * Math.PI);
      return m.waxing ? s : 1 - s;
    };

    const persistMoon = () => {
      if (v.DEV_MOON) {
        localStorage.setItem(MOON_KEY, JSON.stringify(v.DEV_MOON));
      } else {
        localStorage.removeItem(MOON_KEY);
      }
    };

    const syncMoonUI = () => {
      const m = v.DEV_MOON;
      moonSelect.value = m && m.preset ? m.preset : "auto";
      if (m) {
        phaseIn.value = String(Math.round(moonToCycle(m) * 200) / 2);
        phaseOut.textContent =
          Math.round(m.illum * 100) + "%" + (m.waxing ? "↑" : "↓");
      } else {
        phaseOut.textContent = "real";
      }
    };

    moonSelect.addEventListener("change", () => {
      const key = moonSelect.value;
      if (key === "auto") {
        v.DEV_MOON = null;
      } else if (key === "custom") {
        v.DEV_MOON = Object.assign(
          { preset: "custom" },
          cycleToMoon(Number(phaseIn.value) / 100),
        );
      } else {
        v.DEV_MOON = Object.assign({ preset: key }, MOON_PRESETS[key]);
      }
      persistMoon();
      syncMoonUI();
    });

    phaseIn.addEventListener("input", () => {
      v.DEV_MOON = Object.assign(
        { preset: "custom" },
        cycleToMoon(Number(phaseIn.value) / 100),
      );
      persistMoon();
      syncMoonUI();
    });

    syncMoonUI();

    // ── Timelapse: auto-advance the ship clock for demo recordings ──
    const lapseBtn = panel.querySelector("#dev-na-lapse");
    const lspeedIn = panel.querySelector("#dev-na-lspeed");
    const lspeedOut = panel.querySelector("#dev-na-lspeed-out");
    let lapseRAF = null;
    let lapseLast = 0;
    let lapseAccum = 0; // heavy-refresh accumulator (seconds)
    let lapseTextAcc = 0; // text-readout throttle (seconds)
    let lapseSpeed = 0.4; // game-hours per real second

    function lapsing() {
      return lapseRAF !== null;
    }

    function stopLapse() {
      if (lapseRAF === null) return;
      cancelAnimationFrame(lapseRAF);
      lapseRAF = null;
      document.body.classList.remove("dev-timelapse");
      lapseBtn.textContent = "Play";
      localStorage.setItem(HOUR_KEY, String(v.DEV_HOUR));
      slider.value = String(v.DEV_HOUR);
      updateReadout();
    }

    // Drive the timelapse on requestAnimationFrame so the sky gradient,
    // cloud/smoke/water relight and ship lighting all advance every frame,
    // in lockstep with the celestial canvas (which runs at 60fps while the
    // body.dev-timelapse class is set). The old 100ms setInterval + long CSS
    // transitions were the source of the "catch up" smear.
    function startLapse() {
      if (lapseRAF !== null) return;
      document.body.classList.add("dev-timelapse");
      lapseBtn.textContent = "Stop";
      lapseLast = performance.now();
      lapseAccum = 0;
      lapseTextAcc = 0;
      const step = (nowT) => {
        // Clamp big gaps (e.g. a backgrounded tab pausing rAF) so the clock
        // can never leap and skip a day-increment.
        const dt = Math.min(0.05, (nowT - lapseLast) / 1000);
        lapseLast = nowT;
        // The hour→elapsed mapping wraps at noon (voyage clock starts 12:00);
        // when it wraps, a day has passed — advance the calendar.
        const prevMapped = (v.DEV_HOUR - 12 + 24) % 24;
        v.DEV_HOUR = (v.DEV_HOUR + dt * lapseSpeed) % 24;
        if ((v.DEV_HOUR - 12 + 24) % 24 < prevMapped) {
          v.DEV_DAY += 1;
          localStorage.setItem(DAY_KEY, String(v.DEV_DAY));
        }
        // Visuals every frame
        if (typeof window.updateSkyImage === "function") window.updateSkyImage();
        // Text readouts don't need 60fps — throttle to ~10/s
        lapseTextAcc += dt;
        if (lapseTextAcc > 0.1) {
          lapseTextAcc = 0;
          slider.value = String(v.DEV_HOUR);
          updateReadout();
          if (typeof window.updateInfoBar === "function") window.updateInfoBar();
        }
        // Heavy refreshes (weather text, fog/rain layers) every few seconds
        lapseAccum += dt;
        if (lapseAccum > 3) {
          lapseAccum = 0;
          if (window.narrativeSystem) window.narrativeSystem.updateWeather();
          if (RBV.celestial && RBV.celestial.refreshWeather) {
            RBV.celestial.refreshWeather();
          }
          if (RBV.weatherFx) RBV.weatherFx.apply();
        }
        lapseRAF = requestAnimationFrame(step);
      };
      lapseRAF = requestAnimationFrame(step);
    }

    lapseBtn.addEventListener("click", () => {
      if (lapsing()) stopLapse();
      else startLapse();
    });

    lspeedIn.addEventListener("input", () => {
      lapseSpeed = Number(lspeedIn.value);
      lspeedOut.textContent = lapseSpeed.toFixed(2).replace(/0$/, "") + "h/s";
    });

    panel.querySelector("#dev-na-off").addEventListener("click", () => {
      stopLapse();
      localStorage.setItem(KEY, "0");
      location.reload();
    });

    // Hide the panel for clean recordings; a small gear chip brings it back
    const showTab = document.createElement("button");
    showTab.id = "dev-na-show";
    showTab.type = "button";
    showTab.textContent = "⚙";
    showTab.title = "Show N. Atlantic test panel";
    document.body.appendChild(showTab);
    const setHidden = (hid) => {
      panel.style.display = hid ? "none" : "block";
      showTab.style.display = hid ? "block" : "none";
      localStorage.setItem("rbv:devNAHide", hid ? "1" : "0");
    };
    panel
      .querySelector("#dev-na-hide")
      .addEventListener("click", () => setHidden(true));
    showTab.addEventListener("click", () => setHidden(false));
    setHidden(localStorage.getItem("rbv:devNAHide") === "1");

    updateReadout();
    syncWxUI();
    // First paint once the other modules have booted
    setTimeout(() => {
      pushRefresh();
      reseed();
    }, 400);
  }

  document.addEventListener("DOMContentLoaded", buildPanel);
})(window.RBV);
