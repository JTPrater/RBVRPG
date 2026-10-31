const socket = window.RBV.socket;

const {
  TIMELINE_SECONDS,
  TIMELINE_MS,
  computeVoyageState,
  SHIP_ACCELERATION,
  CHERBOURG_DECEL_RATE,
} = window.VoyageState;

RBV.gameState = {
  currentRoom: { name: null, id: null },
  chatHistory: { rooms: {} },
  isGlobalChat: false,
};
const currentRoom = RBV.gameState.currentRoom;
const chatHistory = RBV.gameState.chatHistory;
let isGlobalChat = RBV.gameState.isGlobalChat;
Object.defineProperty(RBV.gameState, "isGlobalChat", {
  get() {
    return isGlobalChat;
  },
  set(value) {
    isGlobalChat = value;
  },
});

const v = RBV.voyage;
const narrativeSystem = window.narrativeSystem;
const musicPlayer = window.musicPlayer;
const deckRooms = window.deckRooms;
const roomImages = window.roomImages;

console.debug("✅ Initialized game shell (socket, voyage, room data).");


// Single DOMContentLoaded event listener
document.addEventListener("DOMContentLoaded", function () {
  console.debug("📄 DOMContentLoaded event triggered.");

  // Initialize music player
  musicPlayer.init();

  // Initialize narrative system
  narrativeSystem.init();

  // Initialize chat elements
  const chatInput = document.getElementById("chat-input");
  const sendButton = document.getElementById("send-message");
  const chatContainer = document.getElementById("chat-container");
  const deckplansPopup = document.getElementById("deckplans-popup");

  console.debug("✅ Initialized chat elements.");

  // Get character data from sessionStorage
  const characterData = JSON.parse(sessionStorage.getItem("character"));
  if (characterData) {
    console.debug(
      `🔑 Retrieved character data: ${characterData.forename} ${characterData.surname}`,
    );
    const avatarElement = document.getElementById("character-avatar");
    const nameElement = document.getElementById("character-name");
    const classElement = document.getElementById("character-class");
    const cabinElement = document.getElementById("character-cabin");

    if (characterData.avatar) {
      avatarElement.src = characterData.avatar;
      avatarElement.onerror = () =>
        console.error("❌ Failed to load avatar:", characterData.avatar);
    }
    nameElement.textContent = `${characterData.forename} ${characterData.surname}`;

    const cabinType = characterData.cabin;
    const cabinNumber = characterData.cabin_number;
    let className;
    if (cabinType.startsWith("1st_")) {
      className = "First Class";
    } else if (cabinType.startsWith("2nd_")) {
      className = "Second Class";
    } else if (cabinType.startsWith("3rd_")) {
      className = "Third Class";
    } else {
      className = "Crew";
    }

    classElement.textContent = `${className} Passenger`;
    cabinElement.textContent = `${cabinNumber}`; // e.g. "A3"

    // Make cabin clickable
    cabinElement.addEventListener("click", (e) => {
      e.preventDefault();
      // Create cabin id (e.g., "cabin_a3", "cabin_b49") and search across all decks
      const cabinId = `cabin_${cabinNumber.toLowerCase()}`; // e.g., "cabin_a3"
      const cabinRoom = Object.values(deckRooms)
        .flat()
        .find((r) => r.id === cabinId);
      if (cabinRoom) {
        enterRoom(cabinRoom);
        console.debug(`🚪 Navigated to ${cabinRoom.name}`);
      } else {
        console.warn(`❌ Cabin ${cabinNumber} not found in deckRooms.`);
      }
    });

    function findPlayerCabin() {
      if (!characterData || !characterData.cabin_number) return null;
      const cabinId = `cabin_${characterData.cabin_number.toLowerCase()}`;
      return (
        Object.values(deckRooms)
          .flat()
          .find((r) => r.id === cabinId) || null
      );
    }
  } else {
    console.warn("⚠️ No character data found.");
  }

  // Add event listeners for chat functionality
  sendButton.addEventListener("click", sendMessage);
  chatInput.addEventListener("keypress", function (e) {
    if (e.key === "Enter") {
      console.debug("↩️ Enter key pressed in chat input.");
      sendMessage();
    }
  });

  // Add event listener for global chat toggle
  const globalChatToggle = document.getElementById("global-chat-toggle");
  globalChatToggle.addEventListener("click", toggleGlobalChat);

  console.debug("✅ Added event listeners for chat functionality.");

  const skyImages = document.querySelectorAll(".sky");
  const imageIntervals = [
    { start: 0, end: 0, className: "night" },
    { start: 1, end: 1, className: "ms-5" },
    { start: 2, end: 2, className: "ms-4" },
    { start: 3, end: 3, className: "ms-3" },
    { start: 4, end: 4, className: "ms-2" },
    { start: 5, end: 5, className: "ms-1" },
    { start: 6, end: 6, className: "ms-0" },
    { start: 7, end: 16, className: "day" },
    { start: 17, end: 17, className: "ms-0" },
    { start: 18, end: 18, className: "ms-1" },
    { start: 19, end: 19, className: "ms-2" },
    { start: 20, end: 20, className: "ms-3" },
    { start: 21, end: 21, className: "ms-4" },
    { start: 22, end: 22, className: "ms-5" },
    { start: 23, end: 23, className: "night" },
  ];

  let desiredCloudTexture = "day";
  let lastRequestedCloudTexture = null;

  const calculateVoyageState = computeVoyageState;

  // Returns elapsed voyage seconds using server-provided time to avoid clock skew.
  // Interpolates locally between 3-second server broadcasts.
  function getElapsedSeconds() {
    if (v.lastServerElapsedAt > 0) {
      return (
        v.lastServerElapsed +
        Math.floor((Date.now() - v.lastServerElapsedAt) / 1000)
      );
    }
    // Fallback before first server broadcast
    if (v.voyageStartTime) {
      return Math.floor((Date.now() - v.voyageStartTime) / 1000);
    }
    return 0;
  }
  window.getElapsedSeconds = getElapsedSeconds;

  function getBSTTime() {
    // DEV override: return the frozen hour when North Atlantic mode is active
    if (v.DEV_NORTH_ATLANTIC) {
      const h = Math.floor(v.DEV_HOUR);
      const m = Math.round((v.DEV_HOUR - h) * 60);
      const t = new Date();
      t.setHours(h, m, 0, 0);
      return t;
    }

    // Use server-synced elapsed time for synchronization
    const elapsedSeconds = getElapsedSeconds();
    if (elapsedSeconds === 0 && !v.voyageStartTime) {
      // Fallback if server time not yet received
      const now = new Date();
      const fixed = new Date(now);
      fixed.setHours(12, 0, 0); // Set to 12:00:00 PM
      return fixed;
    }

    // Calculate game time starting from 12:00
    const elapsedMinutes = Math.floor(elapsedSeconds / 60);
    const totalGameMinutes = elapsedMinutes;
    const gameHours = (12 + Math.floor(totalGameMinutes / 60)) % 24;
    const gameMinutes = totalGameMinutes % 60;
    const gameSeconds = elapsedSeconds % 60;

    const voyageTime = new Date();
    voyageTime.setHours(gameHours, gameMinutes, gameSeconds, 0);

    return voyageTime;
  }

  function mapIntervalToCloudTexture(className = "") {
    if (className === "day") return "day";
    if (className === "night") return "night";
    return "ms";
  }

  function syncCloudTextureWithSky(interval) {
    if (!interval) return;
    const targetTexture = mapIntervalToCloudTexture(interval.className);
    if (targetTexture === lastRequestedCloudTexture) {
      return;
    }

    lastRequestedCloudTexture = targetTexture;
    desiredCloudTexture = targetTexture;

    if (typeof window.setCloudTexture === "function") {
      window.setCloudTexture(targetTexture);
    } else {
      console.debug(
        `⏳ Queued cloud texture ${targetTexture}.png until clouds initialize.`,
      );
    }

    // Sync smoke particles with the same day/ms/night texture
    if (typeof window.setSmokeTexture === "function") {
      window.setSmokeTexture(targetTexture);
    }
  }

  function updateSkyImage() {
    const bstTime = getBSTTime();
    const hours = bstTime.getHours();
    const minutes = bstTime.getMinutes();
    const seconds = bstTime.getSeconds();
    // console.debug(`🌤️ Updating sky image based on BST hour: ${hours}`);

    // All sky layers stay fully opaque and share one inline gradient
    // (updateSkyGradient). Crossfading elements — even with identical
    // backgrounds — dips the combined alpha and reads as an hourly pulse.
    skyImages.forEach((img) => (img.style.opacity = 1));

    // 1. Determine active interval (still drives cloud/smoke textures)
    const interval = imageIntervals.find(
      (interval) => hours >= interval.start && hours <= interval.end,
    );

    if (interval) {
      const altForTex =
        window.RBV && window.RBV.celestial
          ? window.RBV.celestial.sunAltDeg
          : undefined;
      if (typeof altForTex === "number") {
        // Single day texture for clouds and funnel smoke, lit continuously
        // by a canvas-level filter driven by the sun — no texture swaps to
        // snap mid-timelapse. Warm sepia kicks in near the horizon.
        syncCloudTextureWithSky({ className: "day" });
        const cl01 = (x) => Math.min(1, Math.max(0, x));
        const lit = cl01((altForTex + 10) / 22);
        // Re-applying a CSS filter to these large cloud/smoke/water elements
        // repaints them on the compositor. The value only sweeps during
        // twilight — which is exactly when the scene stuttered — so quantise
        // to ~1% steps (imperceptible) and only re-apply when it changes.
        const b = (0.35 + 0.65 * lit).toFixed(2);
        const warm = (cl01(1 - Math.abs(altForTex) / 12) * 0.35).toFixed(2);
        const filt = `brightness(${b}) sepia(${warm})`;
        if (filt !== window.__cloudSmokeFilt) {
          window.__cloudSmokeFilt = filt;
          const cloudCanvas = document.querySelector(".cloud-container canvas");
          const smokeCanvas = document.querySelector(".smoke-container canvas");
          if (cloudCanvas) cloudCanvas.style.filter = filt;
          if (smokeCanvas) smokeCanvas.style.filter = filt;
        }
        // The wake foam (.waves z4, .swater z5) rides above the celestial
        // water ink, so it stays day-bright at night unless relit here.
        // .water (z1) gets both this and the ink — the darkest layer.
        const wFilt = `brightness(${(0.24 + 0.76 * lit).toFixed(2)})`;
        if (wFilt !== window.__waterFilt) {
          window.__waterFilt = wFilt;
          for (const sel of [".water", ".waves", ".swater", "#water-wing"]) {
            const el = document.querySelector(sel);
            if (el) el.style.filter = wFilt;
          }
        }
      } else {
        syncCloudTextureWithSky(interval);
      }
    }

    // 2. Apply gradient (Now that the element is visible)
    // Smooth gradient update for a progressive sky
    try {
      updateSkyGradient(bstTime);
    } catch (err) {
      console.warn("⚠️ updateSkyGradient failed:", err);
    }

    // Also update Britannic image (day / md / night): a continuous
    // crossfade driven by the real sun altitude. Sprites are stacked
    // day (bottom) → dusk → night (top); only the incoming upper layer's
    // opacity ramps, over a fully opaque base, so the ship never goes
    // translucent mid-blend and timelapse stays perfectly smooth.
    try {
      const britDay = document.querySelector(".britannic-day");
      const britMd = document.querySelector(".britannic-md");
      const britNight = document.querySelector(".britannic-night");
      const sunAltShip =
        window.RBV && window.RBV.celestial
          ? window.RBV.celestial.sunAltDeg
          : undefined;
      const cl = (x) => Math.min(1, Math.max(0, x));
      const ease = (x) => x * x * (3 - 2 * x);

      const spritesReady =
        britDay &&
        britDay.complete &&
        britDay.naturalWidth &&
        britNight &&
        britNight.complete &&
        britNight.naturalWidth;

      if (typeof sunAltShip === "number" && spritesReady) {
        // Single-sprite relighting, no image dissolve: the day sprite is
        // continuously dimmed/warmed with the sun on a compositing canvas,
        // and the night sprite is screen-blended on top so only its lit
        // windows glow on as the lights come up through twilight.
        if (!window.__britCanvas) {
          const c = document.createElement("canvas");
          c.width = britDay.naturalWidth;
          c.height = britDay.naturalHeight;
          c.className = "britannic britannic-canvas";
          britNight.parentElement.insertBefore(c, britNight.nextSibling);
          window.__britCanvas = c;
        }
        const c = window.__britCanvas;
        const b = 0.17 + 0.83 * ease(cl((sunAltShip + 2) / 20));
        const warm = cl(1 - Math.abs(sunAltShip) / 10) * 0.25;
        const lights = 1 - ease(cl((sunAltShip + 6) / 10));
        // Quantise to ~1% steps: this redraw (two full-ship drawImages + a
        // canvas filter) is costly, and at toFixed(3) it re-ran almost every
        // frame through twilight. 1% brightness steps are invisible.
        const key =
          b.toFixed(2) + "|" + warm.toFixed(2) + "|" + lights.toFixed(2);
        if (window.__britKey !== key) {
          window.__britKey = key;
          const cx = c.getContext("2d");
          cx.clearRect(0, 0, c.width, c.height);
          cx.filter = `brightness(${b.toFixed(3)}) sepia(${warm.toFixed(3)})`;
          cx.drawImage(britDay, 0, 0, c.width, c.height);
          cx.filter = "none";
          if (lights > 0.01) {
            cx.globalCompositeOperation = "screen";
            cx.globalAlpha = lights;
            cx.drawImage(britNight, 0, 0, c.width, c.height);
            cx.globalAlpha = 1;
            cx.globalCompositeOperation = "source-over";
          }
        }
        // The img variants stop rendering but keep opacity values that the
        // waterline reflections read (day hull always, windows by night)
        [britDay, britMd, britNight].forEach((el) => {
          if (el) {
            el.style.transition = "none";
            el.style.visibility = "hidden";
            el.style.zIndex = 3;
          }
        });
        britDay.style.opacity = "1";
        if (britMd) britMd.style.opacity = "0";
        britNight.style.opacity = String(lights);
      } else {
        // Fallback before the celestial layer or sprites are ready:
        // plain hourly variant pick
        const cls = interval ? interval.className : "day";
        const pick =
          cls === "day" ? britDay : cls === "night" ? britNight : britMd;
        [britDay, britMd, britNight].forEach((el) => {
          if (el) {
            el.style.transition = "none";
            el.style.visibility = "";
            el.style.zIndex = 3;
            el.style.opacity = el === pick ? "1" : "0";
          }
        });
      }
    } catch (err) {
      console.warn("⚠️ Failed to update Britannic image:", err);
    }

    // Swap any room-based location images that have time-of-day variants
    try {
      // console.debug("🔁 Calling swapLocationImagesForSky from updateSkyImage", {
      //   intervalClass: interval?.className,
      //   currentRoom: currentRoom?.name,
      // });
      swapLocationImagesForSky(interval);
    } catch (err) {
      console.warn("⚠️ swapLocationImagesForSky failed:", err);
    }
  }

  function swapLocationImagesForSky(interval) {
    // Determine variant: day / ms (sunset) / night
    let variant = "day";
    if (!interval) variant = "day";
    else if (interval.className === "night") variant = "night";
    else if (interval.className.startsWith("ms")) variant = "ms";

    if (!currentRoom || !currentRoom.name) {
      console.debug(
        "🔍 swapLocationImagesForSky: no currentRoom or name present",
      );
      return;
    }
    console.debug("🔍 swapLocationImagesForSky:", {
      intervalClass: interval?.className,
      currentRoom: currentRoom.name,
    });
    const roomName = currentRoom.name;
    const roomData = roomImages[roomName];
    if (!roomData) {
      console.warn(
        `🔍 swapLocationImagesForSky: roomData not found for ${roomName}`,
      );
      return;
    }
    console.debug(
      `🔍 swapLocationImagesForSky: roomData variants:`,
      roomData.variants,
    );

    // Helper to draw the room's default image
    const drawDefault = () => {
      const imgName = roomData.images[roomData.currentIndex];
      if (!imgName) return;
      const isSouthampton =
        deckRooms.southampton &&
        deckRooms.southampton.some((r) => r.location.chatRoom === roomName);
      const basePath = isSouthampton
        ? "/images/animations/locations/southampton/"
        : "/images/animations/locations/britannic/";
      drawLocationImage(basePath + imgName, false);
      console.debug(`🖼️ Reverted ${roomName} to default image: ${imgName}`);
    };

    if (variant === "ms") {
      // Sunset/morning variant - check if variant exists
      const msVariants = roomData.variants && roomData.variants.ms;
      if (msVariants && msVariants.length > 0) {
        // Use the current index if it's within range, otherwise default to 0
        const idx =
          roomData.currentIndex < msVariants.length ? roomData.currentIndex : 0;
        const msImage = msVariants[idx];

        // Attempt both unencoded and encoded folder paths so we handle server URL behavior
        const candidateFolders = [
          "britannic (sunset)",
          encodeURIComponent("britannic (sunset)"),
          "britannic",
        ];
        const tryPaths = candidateFolders.map(
          (f) => `/images/animations/locations/${f}/${msImage}`,
        );
        let tried = 0;
        const tryNext = () => {
          if (tried >= tryPaths.length) {
            console.warn(
              `⚠️ All sunset variant paths failed for ${roomName}, reverting to default`,
              tryPaths,
            );
            drawDefault();
            return;
          }
          const p = tryPaths[tried++];
          console.debug(`🔁 Trying sunset path for ${roomName}: ${p}`);
          drawLocationImage(p, false, {
            onLoad: () =>
              console.debug(`🌇 Applied sunset variant for ${roomName}: ${p}`),
            onError: () => {
              console.warn(`⚠️ Failed to load ${p}, trying next...`);
              tryNext();
            },
          });
        };
        tryNext();
        return;
      } else {
        // No variant - just do nothing
        return;
      }
    }

    if (variant === "night") {
      // Night variant (not yet available). For now revert to default until night images are added.
      drawDefault();
      return;
    }

    // Day variant - revert to default
    drawDefault();
  }

  // Developer helper to force a variant for testing
  window.forceSetRoomVariant = (variant = "ms") => {
    const fakeInterval = { className: variant === "ms" ? "ms-0" : variant };
    try {
      swapLocationImagesForSky(fakeInterval);
      console.debug(`🔧 forceSetRoomVariant applied: ${variant}`);
    } catch (e) {
      console.warn("🔧 forceSetRoomVariant failed:", e);
    }
  };

  const infoBarElements = {
    location: document.getElementById("location"),
    speed: document.getElementById("speed"),
    date: document.getElementById("date"),
  };

  function renderInfoBarText(location, speed, date) {
    const nextLocation = `Location: ${location}`;
    const nextSpeed = `Speed: ${speed}`;
    const nextDate = `Date: ${date}`;

    if (
      infoBarElements.location &&
      infoBarElements.location.textContent !== nextLocation
    ) {
      infoBarElements.location.textContent = nextLocation;
    }
    if (
      infoBarElements.speed &&
      infoBarElements.speed.textContent !== nextSpeed
    ) {
      infoBarElements.speed.textContent = nextSpeed;
    }
    if (infoBarElements.date && infoBarElements.date.textContent !== nextDate) {
      infoBarElements.date.textContent = nextDate;
    }
  }

  function updateInfoBar() {
    const bstTime = getBSTTime();

    // Calculate voyage progress
    let location = "Southampton";
    let speed = "0 knots";

    if (v.DEV_NORTH_ATLANTIC) {
      location = "North Atlantic";
      speed = "22.0 knots";
      window.currentSpeed = 22;
      window.targetSpeed = 22;
    } else if (v.voyageStartTime) {
      const elapsedSeconds = getElapsedSeconds();
      const state = calculateVoyageState(elapsedSeconds);
      location = state.location;
      speed = state.speed;
      window.currentSpeed = state.speedValue;
      window.targetSpeed = state.targetSpeed;
    } else if (v.latestVoyageState) {
      // Fallback while waiting on v.voyageStartTime handshake
      location = v.latestVoyageState.location;
      speed = v.latestVoyageState.speed;
      window.currentSpeed = v.latestVoyageState.speedValue;
      window.targetSpeed = v.latestVoyageState.targetSpeed;
    }

    const date = `${bstTime.getDate()} ${bstTime.toLocaleString("en-GB", {
      month: "long",
    })}, ${bstTime.getHours().toString().padStart(2, "0")}:${bstTime
      .getMinutes()
      .toString()
      .padStart(2, "0")}:${bstTime.getSeconds().toString().padStart(2, "0")}`;

    renderInfoBarText(location, speed, date);

    console.debug("🗓️ Updated info bar:", { location, speed, date });
  }

  // ---- Sky gradient interpolation helpers ----
  // Naturalistic maritime palettes (zenith → horizon). Real skies are far
  // less saturated than screen blues: a milky bright horizon by day, salmon
  // and slate (not neon orange) at sunset, near-black desaturated navy at
  // night with a faintly lighter horizon.
  const SKY_PALETTES = {
    night: ["#04070e", "#080d18", "#0d1422", "#141c2c", "#1e2836"],
    "ms-5": ["#091020", "#101830", "#1a233e", "#252d48", "#383650"], // astronomical twilight
    "ms-4": ["#141f3d", "#232f55", "#3a3f66", "#6a4a63", "#9c5a50"], // nautical twilight, dying ember
    "ms-3": ["#22325a", "#3a4671", "#705878", "#c76d52", "#ef7f42"], // civil twilight, burnt horizon
    "ms-2": ["#35507a", "#5a6f92", "#987f8b", "#e0906a", "#f5a05f"], // sunset proper, salmon band
    "ms-1": ["#4a6d96", "#6d8cab", "#9dadb8", "#dbb58e", "#f2b878"], // low sun, peach horizon
    "ms-0": ["#5b7fa6", "#7d9cb9", "#a7bcc9", "#d9c9ab", "#eecf9d"], // golden hour edge
    day: ["#4285c2", "#68a2d4", "#93bfe2", "#bdd8ec", "#e2eef5"], // clear summer day, milky horizon
  };

  function hexToRgb(hex) {
    const m = hex.replace("#", "");
    const r = parseInt(m.slice(0, 2), 16);
    const g = parseInt(m.slice(2, 4), 16);
    const b = parseInt(m.slice(4, 6), 16);
    return { r, g, b };
  }

  function rgbToHex({ r, g, b }) {
    const toHex = (v) => v.toString(16).padStart(2, "0");
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function blendHex(c1, c2, t) {
    const a = hexToRgb(c1);
    const b = hexToRgb(c2);
    return rgbToHex({
      r: Math.round(lerp(a.r, b.r, t)),
      g: Math.round(lerp(a.g, b.g, t)),
      b: Math.round(lerp(a.b, b.b, t)),
    });
  }

  function updateSkyGradient(bstTime) {
    // Callable with no arg (the celestial loop calls it each frame right
    // before it draws the gradient, so stops stay in lockstep with the sun).
    bstTime = bstTime || getBSTTime();
    const hours = bstTime.getHours();
    const minutes = bstTime.getMinutes();
    const seconds = bstTime.getSeconds();
    const totalSeconds = hours * 3600 + minutes * 60 + seconds;

    // Continuous interpolation: every interval blends into the next across
    // its full duration, forming a seamless 24 h palette loop (the old
    // 30-second sunrise/sunset "snap" specials are gone)
    let currPaletteName = null;
    let nextPaletteName = null;
    let t = 0;

    const intervalIndex = imageIntervals.findIndex(
      (iv) => hours >= iv.start && hours <= iv.end,
    );

    if (intervalIndex >= 0) {
      const current = imageIntervals[intervalIndex];
      const next = imageIntervals[(intervalIndex + 1) % imageIntervals.length];

      currPaletteName = current.className;
      nextPaletteName = next.className;

      const startSec = current.start * 3600;
      const endSec = (current.end + 1) * 3600;
      const duration = Math.max(1, endSec - startSec);
      t = Math.min(1, Math.max(0, totalSeconds - startSec) / duration);

      // Day holds steady through the afternoon, then eases into the golden
      // ms-0 palette across 16:00–17:00 so sunset onset is gradual
      if (current.className === "day") {
        if (hours >= 16) {
          nextPaletteName = "ms-0";
          t = Math.min(1, Math.max(0, (totalSeconds - 16 * 3600) / 3600));
        } else {
          nextPaletteName = "day";
          t = 0;
        }
      }
    } else {
      // Fallback
      currPaletteName = "day";
      nextPaletteName = "day";
      t = 0;
    }

    // When the celestial layer knows the real sun altitude, let it pick the
    // palette instead of the wall clock — dawn colours then arrive with the
    // actual sunrise (~05:20 here), not at a hardcoded hour, and evening
    // mirrors the real sunset wherever the ship is
    const sunAltNow =
      window.RBV && window.RBV.celestial
        ? window.RBV.celestial.sunAltDeg
        : undefined;
    if (typeof sunAltNow === "number") {
      const bands = [
        [-90, "night"],
        [-13, "night"],
        [-8.5, "ms-5"],
        [-4.5, "ms-4"],
        [-1, "ms-3"],
        [2.5, "ms-2"],
        [6, "ms-1"],
        [11, "ms-0"],
        [17, "day"],
        [91, "day"],
      ];
      let bi = 0;
      while (bi < bands.length - 2 && sunAltNow > bands[bi + 1][0]) bi++;
      currPaletteName = bands[bi][1];
      nextPaletteName = bands[bi + 1][1];
      const span = bands[bi + 1][0] - bands[bi][0];
      t = Math.min(1, Math.max(0, (sunAltNow - bands[bi][0]) / span));
    }

    // Apply override if set
    if (window.skyPaletteOverride) {
      currPaletteName = window.skyPaletteOverride;
      nextPaletteName = window.skyPaletteOverride;
      t = 0;
    }

    const currPalette = SKY_PALETTES[currPaletteName] || SKY_PALETTES.day;
    const nextPalette = SKY_PALETTES[nextPaletteName] || SKY_PALETTES.day;

    // Blend each stop between the two palettes
    const stops = [];
    for (let i = 0; i < Math.max(currPalette.length, nextPalette.length); i++) {
      const c1 = currPalette[i] || currPalette[currPalette.length - 1];
      const c2 = nextPalette[i] || nextPalette[nextPalette.length - 1];
      stops.push(blendHex(c1, c2, t));
    }

    // Overcast: drag the sky itself toward flat gray as cloud cover climbs,
    // so heavy weather changes the sky rather than tinting the scene
    const wx =
      window.RBV && window.RBV.celestial && window.RBV.celestial.weather;
    if (wx) {
      const overcast = Math.min(
        1,
        Math.max(0, (wx.cloudCover - 0.3) / 0.65),
      );
      if (overcast > 0.02) {
        const isDark =
          currPaletteName === "night" ||
          currPaletteName === "ms-5" ||
          currPaletteName === "ms-4";
        const target = isDark
          ? ["#161b22", "#1c222a", "#232a32", "#2a323a", "#323a42"]
          : ["#8f99a2", "#9aa3ab", "#a8b0b7", "#b6bcc2", "#c2c7cc"];
        for (let i = 0; i < stops.length; i++) {
          stops[i] = blendHex(
            stops[i],
            target[i] || target[target.length - 1],
            overcast * 0.85,
          );
        }
      }
    }

    // The sky is drawn on the celestial sky CANVAS (GPU-composited, in the
    // same loop as the sun/moon) rather than as a CSS background — repainting
    // the stacked .sky layers every frame hitched the compositor. Here we
    // only publish the computed stops for celestial.js to fill; positions
    // mirror the old CSS gradient and top/bottom are the .sky element's
    // scene-space span (top:-48px, height 40% of the 1080 scene → -48..384).
    window.RBV = window.RBV || {};
    window.RBV.skyGradient = {
      stops: stops.slice(),
      positions: [0, 0.3, 0.6, 0.85, 1],
      top: -48,
      bottom: 384,
    };

    // The vista wing (outside the canvas, only visible when zoomed out past
    // the scene) still needs a CSS gradient — but painted only when it
    // actually changes, so it's off the per-frame path.
    try {
      const positions = [0, 30, 60, 85, 100];
      const parts = stops.map(
        (c, idx) =>
          `${c} ${
            positions[idx] ?? Math.round((idx + 1) * (100 / stops.length))
          }%`,
      );
      const bg = `linear-gradient(to bottom, ${parts.join(", ")})`;
      if (bg !== lastSkyBg) {
        lastSkyBg = bg;
        const wing = document.getElementById("sky-wing");
        if (wing) wing.style.background = bg;
      }
    } catch (err) {
      console.warn("⚠️ Failed to apply blended gradient to wing:", err);
    }
  }
  let lastSkyBg = null;

  // Helpers for debugging and manual override
  window.setSkyPaletteOverride = (name = null) => {
    window.skyPaletteOverride = name;
    updateSkyImage();
    console.debug(`🌈 Sky palette override set to: ${name}`);
  };

  function refreshWorldStateImmediately(reason = "manual") {
    try {
      updateSkyImage();
      updateInfoBar();
      console.debug(`⚡ World visuals refreshed instantly (${reason})`);
    } catch (err) {
      console.warn("⚠️ Failed to refresh world visuals immediately:", err);
    }
  }

  // Function to perform initial sync with server data
  function performInitialSync() {
    if (v.initialSyncDone) return;
    v.initialSyncDone = true;
    console.debug("🔄 Performing initial sync with server data...");

    // Initialize narrative system with server time
    if (narrativeSystem && v.pendingVoyageStartTime) {
      narrativeSystem.startTime = v.pendingVoyageStartTime;
      console.debug("✅ Narrative system synchronized with server time");
    }

    // In dev mode, set our own narrative and skip timeline sync
    if (v.DEV_NORTH_ATLANTIC) {
      const el = document.getElementById("story-text");
      if (el) {
        el.textContent =
          "We are now deep in the North Atlantic, making steady progress. The open ocean stretches to every horizon.";
        el.style.opacity = "1";
      }
      return;
    }

    // Sync narrative with elapsed time if available
    if (
      v.pendingVoyageState &&
      v.pendingVoyageState.elapsedSeconds &&
      narrativeSystem.startTime
    ) {
      const elapsed = v.pendingVoyageState.elapsedSeconds;
      const storyTextElement = document.getElementById("story-text");

      if (storyTextElement) {
        // Find the appropriate narrative event for current elapsed time
        let currentEventIndex = 0;
        for (let i = 0; i < narrativeSystem.events.length; i++) {
          if (elapsed >= narrativeSystem.events[i].time) {
            currentEventIndex = i;
          } else {
            break;
          }
        }

        // Update narrative immediately without fade effect
        const currentEvent = narrativeSystem.events[currentEventIndex];
        if (currentEvent) {
          storyTextElement.textContent = currentEvent.text;
          storyTextElement.style.opacity = "1";
          narrativeSystem.currentEventIndex = currentEventIndex + 1;

          sessionStorage.setItem(
            "narrativeEventIndex",
            narrativeSystem.currentEventIndex.toString(),
          );

          console.debug(`📖 Synced narrative: ${currentEvent.text}`);
        }
      }
    }

    // Update sky and info bar
    refreshWorldStateImmediately("initial-sync");
    console.debug("✅ Initial sync complete");

    // Handle automatic room joining
    if (typeof handleReconnectionRoomJoin === "function") {
      handleReconnectionRoomJoin();
    }
  }

  refreshWorldStateImmediately("script-init");

  // Perform initial sync if we have pending data
  if (v.pendingVoyageStartTime || v.pendingVoyageState) {
    performInitialSync();
  }

  const skyImageInterval = setInterval(updateSkyImage, 1000); // Update every second
  const infoBarInterval = setInterval(updateInfoBar, 1000); // Update every second so the clock visibly advances

  // Expose for the timelapse loop (devScenario) so it can drive the sky
  // gradient / relighting every frame; without this the per-frame call was a
  // silent no-op and the gradient only moved at the 1s interval above.
  window.updateSkyImage = updateSkyImage;
  window.updateInfoBar = updateInfoBar;
  // Celestial calls this each frame so the sky gradient is recomputed from
  // the same sun altitude, in the same frame, as the sun/moon/stars — no
  // cross-loop lag or jitter.
  window.updateSkyGradient = updateSkyGradient;

  console.debug("✅ Initialized sky image and info bar updates.");

  function initClouds() {
    const canvas = document.createElement("canvas");

    const ensureCloudContainer = () => {
      const existing = document.querySelector(".cloud-container");
      if (existing) {
        return existing;
      }
      const parentLayer =
        document.querySelector(".scene-layer") ||
        document.querySelector(".sprite-container") ||
        document.body;
      if (!parentLayer) {
        return null;
      }
      const container = document.createElement("div");
      container.className = "cloud-container";
      parentLayer.appendChild(container);
      return container;
    };

    const cloudContainer = ensureCloudContainer();
    if (!cloudContainer) {
      console.warn("⚠️ Could not find or create .cloud-container for clouds");
      return;
    }

    const existingCanvas = cloudContainer.querySelector("canvas");
    if (existingCanvas) {
      cloudContainer.removeChild(existingCanvas);
    }

    cloudContainer.appendChild(canvas);
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      console.warn("⚠️ Could not acquire 2d context for cloud canvas");
      return;
    }

    function resizeCanvas() {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = 1920 * dpr;
      canvas.height = 540 * dpr;
      canvas.style.width = "1920px";
      canvas.style.height = "540px";
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.scale(dpr, dpr);
    }

    resizeCanvas();
    window.addEventListener("resize", resizeCanvas);

    const clouds = [];
    let currentCloudTexture = desiredCloudTexture || "ms";
    let lastCloudSlot = -1; // Track last processed 30-second cloud slot
    const CLOUD_SLOT_SEC = 30; // Check cloud spawns every 30 voyage-seconds
    const cloudImages = {
      day: new Image(),
      ms: new Image(),
      night: new Image(),
    };

    cloudImages.day.src = "/images/animations/clouds/day.png";
    cloudImages.ms.src = "/images/animations/clouds/ms.png";
    cloudImages.night.src = "/images/animations/clouds/night.png";

    cloudImages.day.onload = () =>
      console.debug("✅ Loaded cloud image: day.png");
    cloudImages.ms.onload = () =>
      console.debug("✅ Loaded cloud image: ms.png");
    cloudImages.night.onload = () =>
      console.debug("✅ Loaded cloud image: night.png");

    function applyCloudTexture(type = "ms") {
      if (!cloudImages[type]) return;
      desiredCloudTexture = type;
      currentCloudTexture = type;
      clouds.forEach((cloud) => {
        cloud.image = cloudImages[type];
      });
      console.debug(`☁️ Cloud texture forced to ${type}.png`);
    }

    function spawnCloud(forceType = null, rng = null, spawnElapsed = null) {
      const r = rng || Math.random;
      const cloudType = forceType || currentCloudTexture;
      const elapsed =
        spawnElapsed !== null
          ? spawnElapsed
          : typeof getElapsedSeconds === "function"
            ? getElapsedSeconds()
            : 0;
      // Stiffer breeze pushes clouds across faster. Deterministic: the wind
      // comes from the shared weather engine at the cloud's spawn time, and
      // no extra r() calls are made, so the seeded sequence stays in sync.
      let windFactor = 1;
      if (window.VoyageWeather) {
        const windKn = window.VoyageWeather.computeWeatherAt(
          elapsed,
          v.voyageStartTime || 0,
        ).windKn;
        windFactor = 0.6 + Math.min(windKn, 30) / 20;
      }
      clouds.push({
        // Draw-space is 1920 wide after the dpr transform; using canvas.width
        // here pushed spawns hundreds of px off-scene on scaled displays
        startX: 1920,
        y: r() * (canvas.height * 0), // Keep clouds near top of canvas
        speed: (0.1 + r() * 0.1) * windFactor, // px/frame at 60fps → px/sec in animate()
        spawnElapsed: elapsed, // voyage-seconds when this cloud was created
        image: cloudImages[cloudType],
      });
    }

    // Admin/dev helper: instantly repopulate the sky to match a cloud-cover
    // value instead of waiting minutes for new spawns to drift in
    window.reseedClouds = (density = 0.5) => {
      clouds.length = 0;
      const count = Math.round(density * 7);
      const elapsedNow =
        typeof getElapsedSeconds === "function" ? getElapsedSeconds() : 0;
      for (let i = 0; i < count; i++) {
        // Evenly staggered fake ages so clouds spread across the sky instead
        // of clumping into an overlapped blob at the right-edge spawn point
        const age = ((i + 0.2 + Math.random() * 0.6) * 320) / Math.max(1, count);
        spawnCloud(null, Math.random, elapsedNow - age);
      }
      lastCloudSlot = Math.floor(elapsedNow / CLOUD_SLOT_SEC);
      console.debug(`☁️ Reseeded ${count} clouds (density ${density})`);
    };

    // Deterministic cloud spawn check for a given time slot
    function checkCloudSlots() {
      const elapsed =
        typeof getElapsedSeconds === "function" ? getElapsedSeconds() : 0;
      const currentSlot = Math.floor(elapsed / CLOUD_SLOT_SEC);
      if (currentSlot <= lastCloudSlot) return;

      // On first run (lastCloudSlot === -1), only look back far enough for
      // clouds that could still be on screen. A cloud crosses ~1920px at
      // speed 0.1-0.2 * 60 = 6-12 px/sec → max ~320 seconds on screen.
      const maxCloudAge = 320; // seconds
      const lookbackSlots = Math.ceil(maxCloudAge / CLOUD_SLOT_SEC);
      const startSlot =
        lastCloudSlot === -1
          ? Math.max(0, currentSlot - lookbackSlots)
          : lastCloudSlot + 1;

      for (let slot = startSlot; slot <= currentSlot; slot++) {
        const seed = ((v.voyageStartTime || 12345) ^ (slot * 4919)) | 0;
        const rng = createSeededRng(seed);
        // Spawn chance scales with the weather engine's cloud cover, so the
        // sky visuals track the reported observation (same seed = same result
        // on every client). Admin overrides (dev panel) win when active.
        let density = 0.5;
        if (window.VoyageWeather) {
          let ws = window.VoyageWeather.computeWeatherAt(
            slot * CLOUD_SLOT_SEC,
            v.voyageStartTime || 0,
          );
          if (window.applyDevWeather) ws = window.applyDevWeather(ws);
          density = ws.cloudCover;
        }
        // Base chance per slot; density of 1.0 gives ~2 clouds per slot
        if (rng() < density * 0.8) {
          spawnCloud(null, rng, slot * CLOUD_SLOT_SEC);
        }
      }
      lastCloudSlot = currentSlot;
    }

    // Sub-second elapsed for smooth rendering (not floored like getElapsedSeconds)
    function getElapsedSmooth() {
      if (v.lastServerElapsedAt > 0) {
        return v.lastServerElapsed + (Date.now() - v.lastServerElapsedAt) / 1000;
      }
      if (v.voyageStartTime) {
        return (Date.now() - v.voyageStartTime) / 1000;
      }
      return 0;
    }

    function animate() {
      // Full backing-store clear regardless of the dpr transform — with
      // canvas.width in logical units, dpr < 1 (browser zoom-out) cleared
      // only part of the canvas and clouds smeared into giant blobs
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.restore();

      const elapsed = getElapsedSmooth();

      // Iterate in reverse so splicing off-screen clouds doesn't skip the
      // next element (forEach + splice(index) drops every other expiring cloud).
      for (let index = clouds.length - 1; index >= 0; index--) {
        const cloud = clouds[index];
        if (!cloud.image.complete) continue; // Skip if image not loaded
        const scaledHeight = cloud.image.height;
        const scaledWidth = cloud.image.width;

        // Compute position from elapsed time — identical on all clients
        // speed is ~0.1-0.2 px/frame at 60fps = ~6-12 px/sec
        const age = elapsed - cloud.spawnElapsed;
        const x = cloud.startX - cloud.speed * 60 * age;

        ctx.save();
        // Time-of-day lighting lives in a continuous CSS filter on the
        // canvas itself (updateSkyImage) — nothing steps per-interval here
        ctx.globalAlpha = 0.96;
        ctx.drawImage(cloud.image, x, cloud.y, scaledWidth, scaledHeight);
        ctx.restore();

        if (x + scaledWidth < 0) {
          clouds.splice(index, 1);
        }
      }

      // Deterministic cloud spawning synced across clients
      checkCloudSlots();

      requestAnimationFrame(animate);
    }

    // Initial spawn to populate the sky using seeded positions
    const initCloudRng = createSeededRng((v.voyageStartTime || 12345) ^ 99991);
    const initElapsed =
      typeof getElapsedSeconds === "function" ? getElapsedSeconds() : 0;
    for (let i = 0; i < 3; i++) {
      // Spawn with a fake earlier time so they appear spread across the sky
      const fakeAge = initCloudRng() * 200; // pretend they spawned 0-200s ago
      spawnCloud(currentCloudTexture, initCloudRng, initElapsed - fakeAge);
    }

    applyCloudTexture(currentCloudTexture);

    animate();
    console.debug("🔄 Started clouds animation loop.");

    window.setCloudTexture = (type = currentCloudTexture) =>
      applyCloudTexture(type);
    window.forceCloudTextureMS = () => applyCloudTexture("ms");
    if (currentCloudTexture !== "ms") {
      console.debug(
        `☁️ Applied queued cloud texture ${currentCloudTexture}.png after init.`,
      );
    }
  }

  // Initialize clouds
  initClouds();

  // ---- Bird sprite system ----
  const birdSystem = {
    SPRITE_SRC: "../images/animations/bird_sprite (1).png",
    FRAME_W: 7, // Each frame width in the sprite sheet
    FRAME_H: 7, // Each frame height in the sprite sheet
    COLS: 4, // Columns in the sprite sheet
    ROWS: 4, // Rows in the sprite sheet
    SCALE: 1, // Original sprite size
    ANIM_SPEED: 150, // ms per frame
    MIN_SPEED: 30, // px/sec flight speed min
    MAX_SPEED: 60, // px/sec flight speed max
    MIN_Y_PCT: 2, // min vertical % in scene (top of sky)
    MAX_Y_PCT: 22, // max vertical % in scene (above city/water)
    SPAWN_INTERVAL: 2, // Check spawns every 2 voyage-seconds
    spriteImg: null,
    container: null,
    birds: [],
    spawnTimer: null,
    animFrame: null,
    lastTick: 0,
    lastSpawnSlot: -1, // Last processed 2-second slot

    // Returns a spawn probability (0–1) based on proximity to land
    getLandFactor(elapsed) {
      const dep = TIMELINE_SECONDS.DEPARTURE_DELAY;
      const swEnd = TIMELINE_SECONDS.SOUTHAMPTON_WATER_END + dep;
      const needles = TIMELINE_SECONDS.NEEDLES_COMPLETE + dep;
      const channel = TIMELINE_SECONDS.CHANNEL_COMPLETE + dep;
      const berthing = TIMELINE_SECONDS.BERTHING_COMPLETE + dep;

      if (elapsed < dep) return 1.0; // At port — max birds
      if (elapsed < swEnd) return 0.8; // Southampton Water
      if (elapsed < needles) {
        // Solent → Needles, taper off
        const t = (elapsed - swEnd) / (needles - swEnd);
        return Math.max(0, 0.8 - t * 0.8); // 0.8 → 0
      }
      if (elapsed < channel) return 0; // Open channel — no birds
      if (elapsed < berthing) {
        // Approaching Cherbourg — ramp up
        const t = (elapsed - channel) / (berthing - channel);
        return Math.min(1.0, t * 1.0);
      }
      return 1.0; // At Cherbourg
    },

    // Generate deterministic spawn data for a given 2-second slot
    getSlotSpawnData(slot) {
      // Seed = v.voyageStartTime XOR slot index → same for all clients
      const seed = ((v.voyageStartTime || 0) ^ (slot * 7919)) | 0;
      const rng = createSeededRng(seed);

      // Mid-ocean scenario: hundreds of miles from land — no gulls out here
      if (v.DEV_NORTH_ATLANTIC) return null;

      const elapsed = slot * this.SPAWN_INTERVAL;
      const factor = this.getLandFactor(elapsed);
      if (factor <= 0) return null;

      // Decide whether to spawn anything
      if (rng() > factor * 0.6) return null;

      const sceneW = this.container?.parentElement?.offsetWidth || 1920;
      const sceneH = this.container?.parentElement?.offsetHeight || 1080;

      // Decide flock vs lone bird
      const isFlock = rng() < 0.4;
      const maxBirds = Math.ceil(factor * 8);
      const goRight = rng() > 0.5;
      const renderW = this.FRAME_W * this.SCALE;
      const startX = goRight ? -renderW : sceneW + renderW;
      const baseY =
        (sceneH *
          (this.MIN_Y_PCT + rng() * (this.MAX_Y_PCT - this.MIN_Y_PCT))) /
        100;
      const baseSpeed =
        this.MIN_SPEED + rng() * (this.MAX_SPEED - this.MIN_SPEED);
      const frameStart = Math.floor(rng() * (this.COLS * this.ROWS));

      const spawns = [];
      if (isFlock) {
        const flockSize = Math.min(2 + Math.floor(rng() * 3), maxBirds);
        for (let i = 0; i < flockSize; i++) {
          const offsetX = (goRight ? -1 : 1) * i * (15 + rng() * 20);
          const offsetY = (rng() - 0.5) * 30 + Math.abs(i) * 8;
          const speedVar = (rng() - 0.5) * 6;
          spawns.push({
            x: startX + offsetX,
            y: Math.max(0, baseY + offsetY),
            speed: baseSpeed + speedVar,
            goRight,
            frameIndex: (frameStart + i) % (this.COLS * this.ROWS),
          });
        }
      } else {
        spawns.push({
          x: startX,
          y: baseY,
          speed: baseSpeed,
          goRight,
          frameIndex: frameStart,
        });
      }

      return { elapsed, spawns };
    },

    init() {
      const sceneLayer = document.querySelector(".scene-layer");
      if (!sceneLayer) {
        console.warn("⚠️ No .scene-layer for birds");
        return;
      }

      this.container = document.createElement("div");
      this.container.className = "bird-container";
      sceneLayer.appendChild(this.container);

      this.spriteImg = new Image();
      this.spriteImg.src = this.SPRITE_SRC;
      this.spriteImg.onload = () => {
        console.debug("🐦 Bird sprite loaded");
        this.start();
      };
      this.spriteImg.onerror = () =>
        console.warn("⚠️ Failed to load bird sprite");
    },

    start() {
      this.lastTick = performance.now();
      this._tick = this._tick.bind(this);
      this.animFrame = requestAnimationFrame(this._tick);

      // Wait for v.voyageStartTime before spawning so seeds are correct
      const tryStart = () => {
        if (!v.voyageStartTime) {
          setTimeout(tryStart, 500);
          return;
        }
        this.catchUp();
        this.spawnTimer = setInterval(() => this.checkSpawns(), 1000);
        console.debug("🐦 Bird spawning synced to v.voyageStartTime");
      };
      tryStart();
    },

    catchUp() {
      const now =
        typeof getElapsedSeconds === "function" ? getElapsedSeconds() : 0;
      const currentSlot = Math.floor(now / this.SPAWN_INTERVAL);
      const sceneW = this.container?.parentElement?.offsetWidth || 1920;
      const renderW = this.FRAME_W * this.SCALE;

      // Look back through recent slots to find birds still on screen
      // A bird takes at most sceneW / MIN_SPEED seconds to cross
      const maxFlightSec = Math.ceil((sceneW + renderW * 4) / this.MIN_SPEED);
      const lookbackSlots = Math.ceil(maxFlightSec / this.SPAWN_INTERVAL);
      const startSlot = Math.max(0, currentSlot - lookbackSlots);

      for (let slot = startSlot; slot <= currentSlot; slot++) {
        const data = this.getSlotSpawnData(slot);
        if (!data) continue;

        const age = now - data.elapsed; // seconds since this batch spawned
        for (const s of data.spawns) {
          // Calculate where this bird would be now
          const currentX = s.x + (s.goRight ? 1 : -1) * s.speed * age;
          // Only add if still on screen
          if (currentX > -renderW * 2 && currentX < sceneW + renderW * 2) {
            this.addBird(currentX, s.y, s.goRight, s.speed, s.frameIndex);
          }
        }
      }

      this.lastSpawnSlot = currentSlot;
      console.debug(
        `🐦 Bird catch-up complete: ${this.birds.length} birds on screen`,
      );
    },

    checkSpawns() {
      const now =
        typeof getElapsedSeconds === "function" ? getElapsedSeconds() : 0;
      const currentSlot = Math.floor(now / this.SPAWN_INTERVAL);

      // Process any new slots since last check
      for (let slot = this.lastSpawnSlot + 1; slot <= currentSlot; slot++) {
        const data = this.getSlotSpawnData(slot);
        if (!data) continue;

        const maxBirds = Math.ceil(this.getLandFactor(now) * 8);
        if (this.birds.length >= maxBirds) break;

        for (const s of data.spawns) {
          if (this.birds.length >= maxBirds) break;
          this.addBird(s.x, s.y, s.goRight, s.speed, s.frameIndex);
        }
      }

      this.lastSpawnSlot = currentSlot;
    },

    addBird(x, y, goRight, speed, frameIndex) {
      const canvas = document.createElement("canvas");
      const renderW = this.FRAME_W * this.SCALE;
      const renderH = this.FRAME_H * this.SCALE;
      canvas.width = renderW;
      canvas.height = renderH;
      canvas.className = "bird-sprite";
      const ctx = canvas.getContext("2d");
      ctx.imageSmoothingEnabled = false;

      // Positioned by transform (see _tick), which the compositor can move
      // without re-laying out the page every frame
      const flip = goRight ? "" : " scaleX(-1)";
      canvas.style.left = "0px";
      canvas.style.top = y + "px";
      canvas.style.transform = `translate3d(${x}px, 0, 0)${flip}`;

      this.container.appendChild(canvas);

      this.birds.push({
        canvas,
        ctx,
        x,
        y,
        speed,
        goRight,
        flip,
        frameIndex,
        frameTimer: 0,
        sceneW: this.container.parentElement?.offsetWidth || 1920,
      });
    },

    destroy() {
      if (this.spawnTimer) {
        clearInterval(this.spawnTimer);
        this.spawnTimer = null;
      }
      if (this.animFrame) {
        cancelAnimationFrame(this.animFrame);
        this.animFrame = null;
      }
      this.birds.forEach((b) => b.canvas.remove());
      this.birds = [];
    },

    _tick(now) {
      const dt = (now - this.lastTick) / 1000;
      this.lastTick = now;

      for (let i = this.birds.length - 1; i >= 0; i--) {
        const b = this.birds[i];

        // Move
        b.x += (b.goRight ? 1 : -1) * b.speed * dt;
        b.canvas.style.transform = `translate3d(${b.x}px, 0, 0)${b.flip}`;

        // Remove if offscreen
        const renderW = this.FRAME_W * this.SCALE;
        if (
          (b.goRight && b.x > b.sceneW + renderW) ||
          (!b.goRight && b.x < -renderW * 2)
        ) {
          b.canvas.remove();
          this.birds.splice(i, 1);
          continue;
        }

        // Animate frame
        b.frameTimer += dt * 1000;
        if (b.frameTimer >= this.ANIM_SPEED) {
          b.frameTimer -= this.ANIM_SPEED;
          b.frameIndex = (b.frameIndex + 1) % (this.COLS * this.ROWS);
        }

        // Draw current frame
        const col = b.frameIndex % this.COLS;
        const row = Math.floor(b.frameIndex / this.COLS);
        b.ctx.clearRect(0, 0, b.canvas.width, b.canvas.height);
        b.ctx.drawImage(
          this.spriteImg,
          col * this.FRAME_W,
          row * this.FRAME_H,
          this.FRAME_W,
          this.FRAME_H,
          0,
          0,
          b.canvas.width,
          b.canvas.height,
        );
      }

      this.animFrame = requestAnimationFrame(this._tick);
    },
  };

  birdSystem.init();

  function initSmoke() {
    const canvas = document.createElement("canvas");
    const smokeContainer = document.querySelector(".smoke-container");
    smokeContainer.appendChild(canvas);
    const ctx = canvas.getContext("2d");

    function resizeCanvas() {
      const dpr = window.devicePixelRatio || 1;
      // Use layout dimensions so CSS transforms (scene scaling) don't double-scale us
      const computedStyles = getComputedStyle(smokeContainer);
      const rawWidth =
        smokeContainer.offsetWidth ||
        smokeContainer.clientWidth ||
        parseFloat(computedStyles.width) ||
        960;
      const rawHeight =
        smokeContainer.offsetHeight ||
        smokeContainer.clientHeight ||
        parseFloat(computedStyles.height) ||
        rawWidth;
      const containerWidth = Math.max(1, rawWidth);
      const containerHeight = Math.max(1, rawHeight);

      canvas.width = containerWidth * dpr;
      canvas.height = containerHeight * dpr;
      canvas.style.width = `${containerWidth}px`;
      canvas.style.height = `${containerHeight}px`;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.scale(dpr, dpr);
    }

    resizeCanvas();
    window.addEventListener("resize", () => {
      resizeCanvas();
      // Update existing particle positions when canvas resizes
      updateParticlePositions();
    });

    const smokeParticles = [];
    const smokeImage = new Image();
    smokeImage.src = "/images/animations/smoke/day.png";
    let currentSmokeTexture = "day";

    smokeImage.onload = () => console.debug("✅ Loaded smoke image: day.png");

    // Expose a setter so the sky system can swap the smoke sprite at dusk/night
    window.setSmokeTexture = (type = "day") => {
      if (type === currentSmokeTexture) return;
      currentSmokeTexture = type;
      smokeImage.src = `/images/animations/smoke/${type}.png`;
      console.debug(`💨 Smoke texture changed to ${type}.png`);
    };

    // Define the positions of the three funnels as simple percentages since container is now positioned like ship
    function getFunnelPositions() {
      // Use actual canvas size so smoke funnels line up with image positions
      const containerWidth =
        canvas.clientWidth || parseFloat(canvas.style.width) || 960;
      const containerHeight =
        canvas.clientHeight ||
        parseFloat(canvas.style.height) ||
        containerWidth;

      return [
        { x: containerWidth * 0.7, y: containerHeight * 0.81 },
        { x: containerWidth * 0.572, y: containerHeight * 0.81 },
        { x: containerWidth * 0.455, y: containerHeight * 0.81 },
      ];
    }

    function initPropellers() {
      const propellerContainer = document.querySelector(".propeller-container");
      if (!propellerContainer) {
        console.warn("⚠️ Propeller container not found");
        return;
      }

      const existingCanvas = propellerContainer.querySelector("canvas");
      if (existingCanvas) {
        existingCanvas.remove();
      }

      const canvas = document.createElement("canvas");
      propellerContainer.appendChild(canvas);
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        console.warn("⚠️ Could not acquire 2d context for propeller canvas");
        return;
      }

      // The scene-layer is always 1920px wide in CSS.
      // The propeller container is 50% = 960px, height 160px.
      // These are FIXED layout values — CSS transforms scale visually but
      // don't change layout dimensions. Never use offsetWidth/getBoundingClientRect
      // inside a transformed parent — they return inconsistent values.
      const CONTAINER_W = 960;
      const CONTAINER_H = 160;

      function resizeCanvas() {
        const dpr = window.devicePixelRatio || 1;
        canvas.width = CONTAINER_W * dpr;
        canvas.height = CONTAINER_H * dpr;
        canvas.style.width = `${CONTAINER_W}px`;
        canvas.style.height = `${CONTAINER_H}px`;
        canvas.style.display = "block";
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.scale(dpr, dpr);
      }

      function updatePropellerBubblePositions() {
        bubbles.forEach((bubble) => {
          const emitter = emitters[bubble.emitterId];
          if (!emitter) return;
          bubble.baseX = CONTAINER_W * emitter.xPct;
          bubble.baseY = CONTAINER_H * emitter.yPct;
        });
      }

      resizeCanvas();
      window.addEventListener("resize", () => {
        resizeCanvas();
        updatePropellerBubblePositions();
      });

      // Emitter positions as fraction of 960px container width.
      // The stern (left edge) of the ship is at x=0.
      // xPct 0.08 ≈ 77px from left edge = stern propeller area.
      const emitters = [
        { xPct: 0.1, yPct: 0.85, radius: 4.5, phase: 0 },
        { xPct: 0.07, yPct: 0.85, radius: 3, phase: Math.PI / 3 },
      ];

      const bubbles = [];

      function spawnBubble(emitter, emitterId, speedFactor, timestamp) {
        const radius = emitter.radius * (0.14 + Math.random() * 0.095);
        const swirl = 0.55 + Math.random() * 0.7;

        bubbles.push({
          emitterId,
          baseX: CONTAINER_W * emitter.xPct,
          baseY: CONTAINER_H * emitter.yPct,
          orbitX: emitter.radius * (1.25 + Math.random() * 0.75),
          orbitY: emitter.radius * (0.85 + Math.random() * 0.55),
          radius,
          alpha: (0.18 + Math.random() * 0.22) * (0.5 + speedFactor * 0.5),
          age: 0,
          life: 64 + Math.random() * 56,
          rise: 0.16 + Math.random() * 0.24 + speedFactor * 0.14,
          drift: (Math.random() - 0.5) * 0.1,
          travelX: -(0.1 + Math.random() * 0.14 + speedFactor * 0.09),
          swirl,
          phase:
            emitter.phase + Math.random() * Math.PI * 2 + timestamp * 0.001,
        });
      }

      function drawBubble(bubble) {
        const orbitAngle = bubble.phase + bubble.age * bubble.swirl * 0.12;
        const lifeRatio = bubble.age / bubble.life;
        const spiralScale = 0.8 + lifeRatio * 1.4;
        const forwardX =
          bubble.baseX +
          bubble.drift * bubble.age +
          bubble.age * bubble.travelX;
        const x =
          forwardX + Math.cos(orbitAngle) * bubble.orbitX * 0.42 * spiralScale;
        const y =
          bubble.baseY +
          Math.sin(orbitAngle) * bubble.orbitY * spiralScale +
          Math.cos(orbitAngle * 0.55 + bubble.phase) *
            bubble.orbitY *
            0.28 *
            spiralScale;
        const alpha = bubble.alpha * Math.max(0, 1 - lifeRatio * 0.95);
        const size = bubble.radius * (0.82 + lifeRatio * 0.35);

        ctx.beginPath();
        ctx.fillStyle = `rgba(170, 220, 255, ${alpha * 0.3})`;
        ctx.arc(x, y, size * 1.1, 0, Math.PI * 2);
        ctx.fill();

        ctx.beginPath();
        ctx.fillStyle = `rgba(210, 236, 255, ${alpha})`;
        ctx.arc(x, y, size, 0, Math.PI * 2);
        ctx.fill();

        ctx.beginPath();
        ctx.fillStyle = `rgba(255, 255, 255, ${alpha * 0.85})`;
        ctx.arc(x - size * 0.2, y - size * 0.2, size * 0.18, 0, Math.PI * 2);
        ctx.fill();
      }

      function animatePropellers(frameTime) {
        ctx.clearRect(0, 0, CONTAINER_W, CONTAINER_H);

        const speed = Math.max(0, Number(window.currentSpeed) || 0);
        const speedFactor = Math.min(speed / 22, 1);

        // Only spawn bubbles when the ship is actually moving
        if (speed > 0.1) {
          emitters.forEach((emitter, emitterId) => {
            const spawnChance = speedFactor * 0.7;
            if (Math.random() < spawnChance) {
              spawnBubble(emitter, emitterId, speedFactor, frameTime);
            }
            if (Math.random() < speedFactor * 0.18) {
              spawnBubble(emitter, emitterId, speedFactor, frameTime);
            }
          });
        }

        for (let index = bubbles.length - 1; index >= 0; index--) {
          const bubble = bubbles[index];
          bubble.age += 1;
          drawBubble(bubble);

          if (bubble.age >= bubble.life) {
            bubbles.splice(index, 1);
          }
        }

        requestAnimationFrame(animatePropellers);
      }

      requestAnimationFrame(animatePropellers);
      console.debug("🔄 Started propeller bubble loop.");
    }

    // Update existing particle positions when canvas resizes
    function updateParticlePositions() {
      const currentFunnelPositions = getFunnelPositions();

      smokeParticles.forEach((particle) => {
        if (
          particle.funnelId !== undefined &&
          currentFunnelPositions[particle.funnelId]
        ) {
          const funnel = currentFunnelPositions[particle.funnelId];
          // Calculate the particle's relative position from its funnel
          const relativeX = particle.originalOffsetX || 0;
          const relativeY = particle.originalOffsetY || 0;

          // Update particle position relative to new funnel position
          particle.x = funnel.x + relativeX;
          // Don't update Y position as smoke should continue rising from current height
        }
      });
    }

    function spawnSmokeParticle() {
      // Get current responsive funnel positions
      const funnelPositions = getFunnelPositions();

      // Create multiple particles per funnel for density
      funnelPositions.forEach((funnel, funnelIndex) => {
        for (let i = 0; i < 1; i++) {
          // Only 1 particle per funnel to keep columns distinct
          const offsetX = (Math.random() - 0.5) * 10; // Reduced horizontal spread (±5px)
          const offsetY = Math.random() * 5; // Minimal vertical variance

          const initialScale = 0.8 + Math.random() * 0.3;
          smokeParticles.push({
            x: funnel.x + offsetX,
            y: funnel.y + offsetY,
            vx: (Math.random() - 0.5) * 0.004, // Start nearly vertical (reduced)
            vy: -0.22 - Math.random() * 0.04, // Slightly slower upward movement
            scale: initialScale,
            initialScale: initialScale,
            opacity: 0.6 + Math.random() * 0.2,
            life: 0,
            maxLife: 250 + Math.random() * 150,
            rotation: Math.random() * Math.PI * 2,
            funnelId: funnelIndex,
            originalOffsetX: offsetX,
            originalOffsetY: offsetY,
            initialVy: -0.22 - Math.random() * 0.04, // Store for blending
            initialVx: (Math.random() - 0.5) * 0.01, // Store for blending
          });
        }
      });
    }

    function animateSmoke() {
      // Full backing-store clear regardless of the dpr transform (see the
      // cloud animate() note — same smear bug at browser zoom-out)
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.restore();

      // Debug rectangle removed; smoke should not be affected by canvas test markers

      smokeParticles.forEach((particle, index) => {
        if (!smokeImage.complete) return; // Skip if image not loaded

        // Update horizontal wind based on current ship speed
        let horizontalWind = 0;
        if (typeof window.currentSpeed === "number") {
          const speed = window.currentSpeed || 0;
          horizontalWind = -0.05 - speed * 0.04; // Original port-drift curve from historic build
        }
        // True wind from the weather engine bends the columns as well:
        // westerlies push the smoke aft with the apparent wind, easterlies
        // stand it up or push it forward. Matters most at the dock, where
        // ship speed is zero but a squall should still flatten the smoke.
        if (window.sceneWind) {
          const dirSign =
            window.sceneWind.dirDeg > 0 && window.sceneWind.dirDeg < 180
              ? 1
              : -1;
          horizontalWind +=
            dirSign * Math.min(window.sceneWind.kn, 30) * 0.008;
        }
        // As the particle ages, blend from initial vertical to horizontal wind
        const bendProgress = Math.min(
          particle.life / (particle.maxLife * 0.6),
          1,
        ); // 0 to 1 over first 60% of life
        particle.vx =
          particle.initialVx * (1 - bendProgress) +
          horizontalWind * bendProgress;

        // Update particle properties
        particle.x += particle.vx;
        particle.y += particle.vy;
        particle.life++;

        // Scale increases as particle ages (up to 2x original size, smooth)
        const ageRatio = particle.life / particle.maxLife;
        particle.scale = particle.initialScale * (1 + ageRatio);

        // Very subtle deceleration over time
        particle.vy *= 0.9998;
        particle.vx *= 0.9998;

        // Opacity fades more rapidly near end of life
        if (ageRatio < 0.7) {
          particle.opacity = Math.max(0, 0.5 * (1 - ageRatio));
        } else {
          // Last 30% of life: fade out faster
          particle.opacity = Math.max(
            0,
            0.5 * (1 - ageRatio) * (1 - (ageRatio - 0.7) * 2.5),
          );
        }

        // Minimal wind drift to keep columns steady
        particle.vx += (Math.random() - 0.5) * 0.0005;
        particle.vy += Math.random() * 0.0005 - 0.00025; // Minimal vertical turbulence

        // Much slower rotation for more realistic effect
        particle.rotation += 0.001;

        // Draw the smoke particle
        ctx.save();
        ctx.globalAlpha = particle.opacity;
        ctx.translate(particle.x, particle.y);
        ctx.rotate(particle.rotation);

        const scaledWidth = smokeImage.width * particle.scale;
        const scaledHeight = smokeImage.height * particle.scale;

        ctx.drawImage(
          smokeImage,
          -scaledWidth / 2,
          -scaledHeight / 2,
          scaledWidth,
          scaledHeight,
        );
        ctx.restore();

        // Remove particle if it's too old or faded
        if (particle.life >= particle.maxLife || particle.opacity <= 0) {
          smokeParticles.splice(index, 1);
        }
      });

      // Spawn new smoke particles at a more realistic rate
      if (Math.random() < 0.2) {
        // Much slower spawn rate (15%) for realistic smoke puffs
        spawnSmokeParticle();
      }

      requestAnimationFrame(animateSmoke);
    }

    animateSmoke();

    // Initial spawn to populate the funnels with smoke immediately
    for (let i = 0; i < 10; i++) {
      spawnSmokeParticle();
      // Distribute initial particles across different heights
      smokeParticles.forEach((particle, index) => {
        if (index >= smokeParticles.length - 9) {
          // Only affect the newly spawned particles
          particle.y -= Math.random() * 100; // Spread them vertically
          particle.life = Math.random() * 100; // Give them random ages
        }
      });
    }

    console.debug("🔄 Started smoke animation loop.");

    // Start propeller bubbles
    initPropellers();
  }

  // Initialize smoke
  initSmoke();

  // Loading screen logic
  const loadingScreen = document.getElementById("loading-screen");
  const progressBar = document.querySelector(".progress");
  const startButton = document.getElementById("start-button");
  const gameContainer = document.querySelector(".game-container");
  const whistleSound = new Audio("/sounds/whistle.mp3");

  let progress = 0;
  const loadingInterval = setInterval(() => {
    progress += 1000;
    progressBar.style.width = `${progress}%`;
    console.debug(`📈 Loading progress: ${progress}%`);

    if (progress >= 100) {
      clearInterval(loadingInterval);
      startButton.style.display = "block";
      console.debug("✅ Loading complete. Start button displayed.");
    }
  }, 500);

  startButton.addEventListener("click", () => {
    console.debug("🚀 Start button clicked.");
    refreshWorldStateImmediately("start-button");
    whistleSound.play();
    loadingScreen.style.transition = "opacity 1s ease";
    loadingScreen.style.opacity = "0";
    setTimeout(() => {
      loadingScreen.style.display = "none";
      gameContainer.style.display = "flex";
      if (musicPlayer.songs.length > 0) {
        // Set the specific song as the first to play
        const desiredSongName =
          "Britannic_ Patroness of the Mediterranean_ Organ Music (Pomp and Circumstance, March No.4)";
        const desiredSongIndex = musicPlayer.songs.findIndex((song) => {
          const songName = song.split("/").pop().replace(".mp3", "");
          return songName === desiredSongName;
        });

        if (desiredSongIndex !== -1) {
          musicPlayer.currentSongIndex = desiredSongIndex;
          document.getElementById("song-select").value = desiredSongIndex;
          console.debug(`🎵 Set current song to: ${desiredSongName}`);
        } else {
          console.warn("⚠️ Desired song not found in the playlist.");
        }

        musicPlayer.isPlaying = true;
        musicPlayer.loadCurrentSong();
        musicPlayer.updatePlayButton();
        console.debug("🎶 Music started.");
      }

      // Smart spawn logic based on voyage progress
      // Wait a moment for v.voyageStartTime to be received from server
      const waitForSpawn = setInterval(() => {
        if (!v.voyageStartTime) return; // Wait for server time

        clearInterval(waitForSpawn);
        const elapsedSeconds = getElapsedSeconds();

        // If ship has already departed (past 12 minutes), spawn on ship
        if (elapsedSeconds >= TIMELINE_SECONDS.DEPARTURE_DELAY) {
          // Check if player was in a room before refresh
          const lastRoomName = localStorage.getItem("lastRoom");
          if (lastRoomName) {
            // Try to find the room by name across all decks
            let lastRoom = null;
            for (const deck in deckRooms) {
              if (deckRooms[deck]) {
                lastRoom = deckRooms[deck].find((r) => r.name === lastRoomName);
                if (lastRoom) break;
              }
            }

            if (lastRoom) {
              console.debug(
                `🔄 Restoring player to last room: ${lastRoom.name}`,
              );
              enterRoom(lastRoom);
              return; // Don't do the spawn logic below
            } else if (
              lastRoomName === "Mars" ||
              lastRoomName === "5741544e4559"
            ) {
              console.debug(
                `🔄 Restoring player to secret room: ${lastRoomName}`,
              );
              enterRoom({
                id: "5741544e4559",
                name: "Mars",
                type: "secret",
                location: {
                  chatRoom: "5741544e4559",
                  image: "Mars.jpg",
                },
              });
              return;
            } else {
              console.debug(
                `⚠️ Last room "${lastRoomName}" not found, proceeding with spawn logic`,
              );
              localStorage.removeItem("lastRoom"); // Clean up invalid data
            }
          }

          // Try to find player's cabin first, otherwise default to promenade
          const cabinRoom =
            typeof findPlayerCabin === "function" ? findPlayerCabin() : null;
          const defaultShipRoom =
            (deckRooms.boat || deckRooms.bd || deckRooms["boat_deck"])?.find?.(
              (r) => r.id === "port_promenade_bd",
            ) || deckRooms?.a?.find?.((r) => r.id === "port_promenade_bd");

          const spawnRoom = cabinRoom || defaultShipRoom;
          if (spawnRoom) {
            enterRoom(spawnRoom);
          } else {
            console.error("❌ Could not find ship spawn location");
          }
        } else {
          // Ship hasn't departed yet - spawn at Southampton docks
          console.debug(
            `⚓ Voyage not yet departed (${elapsedSeconds}s elapsed) - spawning at Southampton`,
          );
          localStorage.removeItem("lastRoom");

          const initialRoom = deckRooms.southampton.find(
            (r) => r.name === "Berth 44 Forward Docks",
          );
          if (initialRoom) {
            enterRoom(initialRoom);
          } else {
            console.error(
              "❌ Initial room not found, defaulting to Berth 44 Forward Docks",
            );
            const defaultRoom = deckRooms.southampton.find(
              (r) => r.name === "Berth 44 Forward Docks",
            );
            if (defaultRoom) enterRoom(defaultRoom);
          }
        }
        console.debug("🔑 Attempted to enter initial room.");
      }, 100); // Check every 100ms until server time arrives
    }, 1000);
  });

  // Helper to find which deck a room belongs to
  function getRoomDeck(roomId) {
    if (!roomId) return null;
    for (const [deck, rooms] of Object.entries(deckRooms)) {
      if (!Array.isArray(rooms)) continue;
      if (
        rooms.some((r) => r.id === roomId || r.location?.chatRoom === roomId)
      ) {
        return deck;
      }
    }
    return null;
  }

  function enterRoom(room) {
    console.debug("🔄 enterRoom called with:", room.name);

    const characterData = JSON.parse(sessionStorage.getItem("character"));
    if (!characterData) {
      console.error("❌ No character data found.");
      return;
    }

    const chatContainer = document.getElementById("chat-container");
    const locationDisplay = document.querySelector(".location-display");

    if (!chatContainer || !locationDisplay) {
      console.error("❌ Required DOM elements not found");
      return;
    }

    // Determine transition pause based on deck change
    const currentDeck = getRoomDeck(currentRoom.name);
    const targetDeck = getRoomDeck(room.location.chatRoom);
    const isSameDeck = currentDeck && targetDeck && currentDeck === targetDeck;
    const slideDurationMs = 800;
    const extraPauseMs = isSameDeck ? 600 : 1000;
    const transitionDelay = slideDurationMs + extraPauseMs;

    // Slide out (down) while leaving current room
    chatContainer.classList.add("slide-out");
    locationDisplay.classList.add("slide-out");

    // Play close door sound if leaving a room
    if (currentRoom.name) {
      closeDoorSound.currentTime = 0;
      closeDoorSound.play();
      socket.emit("leave-room", {
        room: currentRoom.name,
      });
    }

    setTimeout(() => {
      if (!room) {
        console.error("❌ Room object is undefined");
        return;
      }

      // Clear chat display
      document.getElementById("chat-messages").innerHTML = "";

      // Set new room
      currentRoom.name = room.location.chatRoom;
      currentRoom.id = room.id;
      console.debug(`🔑 Set new room: ${currentRoom.name}`);

      // Show room name label for rooms with replaced images
      const roomDisplayNames = {
        grand_staircase_bd: "Grand Staircase",
        gymnasium_bd: "1st Class Gymnasium",
        port_promenade_bd: "First Class Port Promenade",
        starboard_promenade_bd: "First Class Starboard Promenade",
        childrens_playroom_bd: "Children's Playroom",
        port_officers_promenade_bd: "Port Officer's Promenade",
        starboard_officers_promenade_bd: "Starboard Officer's Promenade",
        port_bridge_wing_bd: "Port Bridge Wing",
        starboard_bridge_wing_bd: "Starboard Bridge Wing",
        bridge_bd: "The Bridge",
        wheelhouse_bd: "The Wheelhouse",
        starboard_engineers_promenade_bd: "Starboard Engineer's Promenade",
        port_engineers_promenade_bd: "Port Engineer's Promenade",
        starboard_2nd_class_promenade_bd: "Starboard 2nd Class Promenade",
        port_2nd_class_promenade_bd: "Port 2nd Class Promenade",
        "2nd_class_staircase_bd": "2nd Class Staircase",
        forecastle_b: "Forecastle",
        first_class_b_forward_overlooking_promenade:
          "1st Class Forward Overlooking Promenade",
        first_class_port_b_enclosed_promenade:
          "1st Class Port Enclosed Promenade",
        first_class_starboard_b_enclosed_promenade:
          "1st Class Starboard Enclosed Promenade",
        poop_deck: "Poop Deck",
        grand_staircase_b: "Grand Staircase",
        third_class_smoke_room_b: "3rd Class Smoke Room",
        second_class_smoke_room_b: "2nd Class Smoke Room",
        second_class_starboard_promenade_b: "2nd Class Starboard Promenade",
        second_class_port_promenade_b: "2nd Class Port Promenade",
        b_deck_aft_staircase: "B Deck Aft Staircase",
        restaurant_reception_room: "Restaurant Reception Room",
        a_la_carte_restaurant: "À La Carte Restaurant",
        corridor_a: "The Corridor",
        corridor: "Corridor",
        grand_staircase_a: "Grand Staircase",
        aft_grand_staircase_a: "Aft Grand Staircase",
        first_class_smoking_room_a: "First Class Smoking Room",
        verandah_palm_court_a: "Palm Court",
        first_class_starboard_enclosed_promenade_a:
          "1st Class Starboard Enclosed Promenade",
        first_class_port_enclosed_promenade_a:
          "1st Class Port Enclosed Promenade",
        first_class_port_promenade_a: "1st Class Port Promenade",
        first_class_starboard_promenade_a: "1st Class Starboard Promenade",
        first_a_corridor: "1st A Corridor",
        first_class_forward_overlooking_promenade_a:
          "1st Class Forward Overlooking Promenade",
        second_class_staircase_a: "2nd Class Staircase",
        first_class_lounge_a: "First Class Lounge",
        first_class_reception_d: "First Class Reception Room",
        first_class_dining_room_d: "First Class Dining Room",
        "5741544e4559": "Mars",
      };
      // Every cabin is labelled with its number: cabin_a10 -> "A-10", cabin_b49 -> "B-49".
      const cabinNumber = /^cabin_([a-z])(\d+)$/.exec(currentRoom.name);
      const roomNameLabel = document.getElementById("room-name-label");
      if (roomNameLabel) {
        const displayName =
          roomDisplayNames[currentRoom.name] ||
          (cabinNumber && `${cabinNumber[1].toUpperCase()}-${cabinNumber[2]}`);
        if (displayName) {
          roomNameLabel.textContent = displayName;
          roomNameLabel.style.display = "block";
        } else {
          roomNameLabel.textContent = "";
          roomNameLabel.style.display = "none";
        }
      }
      console.debug(
        `🏨 Entered room with currentRoom.name set to: ${currentRoom.name}`,
      );
      console.debug(
        `🖼️ Available room images:`,
        roomImages[currentRoom.name]
          ? roomImages[currentRoom.name].images.length
          : "none",
      );

      // Always start a newly entered room with a fresh local chat buffer.
      chatHistory.rooms[currentRoom.name] = [];
      socket.emit("join-room", {
        room: currentRoom.name,
      });

      // Update location image using roomImages if available
      const chatRoom = room.location.chatRoom;
      let imageSrc;
      // Helper function to check if room is in Southampton
      const isSouthamptonRoom = (roomObj) => {
        return (
          deckRooms.southampton &&
          deckRooms.southampton.some((r) => r.id === roomObj.id)
        );
      };

      const bstNow = getBSTTime();
      const bstHours = bstNow.getHours();
      const activeInterval = imageIntervals.find(
        (iv) => bstHours >= iv.start && bstHours <= iv.end,
      );

      if (chatRoom === "5741544e4559") {
        imageSrc = "/images/Mars.jpg";
      } else if (roomImages[chatRoom]) {
        const roomData = roomImages[chatRoom];

        let targetImages = roomData.images;
        let isMsVariant = false;

        if (
          activeInterval &&
          activeInterval.className.startsWith("ms") &&
          roomData.variants &&
          roomData.variants.ms &&
          roomData.variants.ms.length > 0
        ) {
          targetImages = roomData.variants.ms;
          isMsVariant = true;
        }

        // Sanitize index
        if (roomData.currentIndex >= targetImages.length) {
          roomData.currentIndex = 0;
        }
        const imageToShow = targetImages[roomData.currentIndex];

        // If a sunset variant exists and we are in an ms-* interval show it
        if (isMsVariant) {
          imageSrc = `/images/animations/locations/${encodeURIComponent(
            "britannic (sunset)",
          )}/${imageToShow}`;
        } else {
          // Regular behaviour
          // Check if this is a Southampton location
          if (isSouthamptonRoom(room)) {
            imageSrc = `/images/animations/locations/southampton/${imageToShow}`;
          } else {
            imageSrc = `/images/animations/locations/britannic/${imageToShow}`;
          }
        }
      } else {
        // Check if this is a Southampton location
        if (isSouthamptonRoom(room)) {
          imageSrc = `/images/animations/locations/southampton/${room.location.image}`;
        } else {
          // Check for matching variant for the location name itself
          // fallback to plain Britannic path
          imageSrc = `/images/animations/locations/britannic/${room.location.image}`;
        }
      }
      function finishRoomEnter() {
        // Update displays and play open door sound
        chatContainer.style.display = "block";
        locationDisplay.style.display = "block";
        openDoorSound.currentTime = 0;
        openDoorSound.play();

        chatContainer.classList.remove("slide-out");
        locationDisplay.classList.remove("slide-out");
        chatContainer.classList.add("slide-in");
        locationDisplay.classList.add("slide-in");

        const systemMessage = {
          type: "system",
          message: `You have entered ${room.name}`,
          room: currentRoom.name,
          timestamp: Date.now(),
        };
        addChatMessage(systemMessage);

        // Remove slide-in class after the fixed slide animation completes
        setTimeout(() => {
          chatContainer.classList.remove("slide-in");
          locationDisplay.classList.remove("slide-in");
        }, 800);

        // Update minigame visibility if applicable
        const minigameBtn = document.getElementById("gym-minigame-btn");
        if (minigameBtn) {
          minigameBtn.style.display =
            room.type === "gymnasium" ? "flex" : "none";
        } else {
          console.warn("⚠️ Gym minigame button not found");
        }

        const videoPokerBtn = document.getElementById("video-poker-btn");
        if (videoPokerBtn) {
          if (
            room.id === "first_class_lounge_a" ||
            room.id === "first_class_smoking_room_a"
          ) {
            videoPokerBtn.style.display = "flex";
          } else {
            videoPokerBtn.style.display = "none";
          }
        } else {
          console.warn("⚠️ Video poker button not found");
        }

        // Show games toggle button in specific rooms
        const gamesToggleBtn = document.getElementById("games-toggle-btn");
        if (gamesToggleBtn) {
          if (
            room.id === "first_class_lounge_a" ||
            room.id === "first_class_smoking_room_a"
          ) {
            gamesToggleBtn.style.display = "block";
          } else {
            gamesToggleBtn.style.display = "none";
            gamesToggleBtn.textContent = "Games";
            const gamesPopup = document.querySelector(".games-popup");
            if (gamesPopup) {
              gamesPopup.remove();
            }
          }
        }

        localStorage.setItem("lastRoom", room.name);
        console.debug(`💾 Saved last room to localStorage: ${room.name}`);

        const interiorTypes = [
          "grand-staircase",
          "gymnasium",
          "playroom",
          "bridge",
          "lounge",
          "smoking-room",
          "dining-room",
          "reception-room",
          "cabin",
          "corridor",
          "reading-writing-room",
        ];

        const eatDrinkBtn = document.getElementById("eat-drink-btn");
        if (eatDrinkBtn) {
          // Close a menu left open in the previous room
          const eatDrinkPopup = document.querySelector(".eat-drink-popup");
          if (eatDrinkPopup) eatDrinkPopup.remove();

          const isDiningRoom =
            room.id === "first_class_dining_room_d" ||
            room.id === "a_la_carte_restaurant";
          const isOutdoorRoom = room.type && !interiorTypes.includes(room.type);

          eatDrinkBtn.style.display =
            isDiningRoom || isOutdoorRoom ? "block" : "none";
          eatDrinkBtn.dataset.tobaccoOnly = isOutdoorRoom ? "true" : "false";
          // Outdoor rooms only offer tobacco, so the button says so
          eatDrinkBtn.textContent = isOutdoorRoom ? "Tobacco" : "Eat & Drink";
        }

        // Engine order telegraph: bridge/wheelhouse prop only
        if (window.RBV && window.RBV.telegraph) {
          if (room.id === "bridge_bd" || room.id === "wheelhouse_bd") {
            window.RBV.telegraph.show();
          } else {
            window.RBV.telegraph.hide();
          }
        }

        if (interiorTypes.includes(room.type)) {
          if (interiorSound.paused) {
            interiorSound
              .play()
              .catch((error) =>
                console.error("Error playing interior sound:", error),
              );
          }
          exteriorSound.pause();
        } else {
          interiorSound.pause();
          if (exteriorSound.paused) {
            exteriorSound
              .play()
              .catch((error) =>
                console.error("Error playing exterior sound:", error),
              );
          }
        }
      }

      if (imageSrc) {
        drawLocationImage(imageSrc, false, {
          onLoad: finishRoomEnter,
          onError: finishRoomEnter,
        });
      } else {
        console.warn("⚠️ No image source available for room", room.name);
        finishRoomEnter();
      }

      // Preload room variants and images (if any)
      try {
        locationImageSystem.preloadRoomImages(currentRoom.name);
      } catch (e) {
        console.warn("⚠️ Error while preloading room images:", e);
      }

      // Remove any existing cabin action buttons
      const prevCabinActions = document.getElementById("cabin-action-buttons");
      if (prevCabinActions) prevCabinActions.remove();

      // Add shower, toilet, and sleep buttons for all cabin types
      if (room.type === "cabin") {
        const locationDisplay = document.querySelector(".location-display");
        const actionDiv = document.createElement("div");
        actionDiv.id = "cabin-action-buttons";
        actionDiv.style.position = "absolute";
        actionDiv.style.top = "18px";
        actionDiv.style.right = "18px";
        actionDiv.style.display = "flex";
        actionDiv.style.gap = "8px";
        actionDiv.style.zIndex = "20";

        // Shower button
        const showerBtn = document.createElement("button");
        showerBtn.className = "cabin-action-btn";
        showerBtn.title = "Take a Shower";
        showerBtn.innerHTML = '<span class="material-icons">shower</span>';
        showerBtn.onclick = function () {
          addChatMessage({
            type: "system",
            message: "You take a refreshing shower.",
            room: currentRoom.name,
            timestamp: Date.now(),
          });
          statusBars.hygiene.value = 100;
          const hygieneBar = document.querySelector(".bar.hygiene");
          if (hygieneBar) hygieneBar.style.width = "100%";
          saveStatsToServer();
        };

        // Toilet button
        const toiletBtn = document.createElement("button");
        toiletBtn.className = "cabin-action-btn";
        toiletBtn.title = "Use the Toilet";
        toiletBtn.innerHTML = '<span class="material-icons">wc</span>';
        toiletBtn.onclick = function () {
          addChatMessage({
            type: "system",
            message: "You use the toilet.",
            room: currentRoom.name,
            timestamp: Date.now(),
          });
          statusBars.bladder.value = 100;
          const bladderBar = document.querySelector(".bar.bladder");
          if (bladderBar) bladderBar.style.width = "100%";
          saveStatsToServer();
        };

        // Sleep button
        const sleepBtn = document.createElement("button");
        sleepBtn.className = "cabin-action-btn";
        sleepBtn.title = "Go to Sleep";
        sleepBtn.innerHTML = '<span class="material-icons">bed</span>';
        sleepBtn.onclick = function () {
          addChatMessage({
            type: "system",
            message: "You lie down and get some rest.",
            room: currentRoom.name,
            timestamp: Date.now(),
          });
          statusBars.energy.value = 100;
          const energyBar = document.querySelector(".bar.energy");
          if (energyBar) energyBar.style.width = "100%";
          saveStatsToServer();
        };

        actionDiv.appendChild(showerBtn);
        actionDiv.appendChild(toiletBtn);
        actionDiv.appendChild(sleepBtn);
        locationDisplay.appendChild(actionDiv);
      }

      // Remove any existing Enter Britannic button
      const prevEnterBritannicBtn = document.getElementById(
        "enter-britannic-btn",
      );
      if (prevEnterBritannicBtn) prevEnterBritannicBtn.remove();

      // Add the "Go Aboard" button for First Class Gangway and Boarding Tower
      if (room.id === "first_class_gangway" || room.id === "boarding_tower") {
        const locationDisplay = document.querySelector(".location-display");
        const enterBritannicBtn = document.createElement("button");
        enterBritannicBtn.id = "enter-britannic-btn";
        enterBritannicBtn.className = "enter-britannic-btn";
        enterBritannicBtn.textContent = "Go Aboard";
        enterBritannicBtn.style.position = "absolute";
        enterBritannicBtn.style.bottom = "10px";
        enterBritannicBtn.style.left = "50%";
        enterBritannicBtn.style.transform = "translateX(-50%)";
        enterBritannicBtn.style.zIndex = "20";

        enterBritannicBtn.onclick = function () {
          // Find the D-Deck First Class Reception Room
          const receptionRoom = deckRooms.d_deck.find(
            (r) => r.id === "first_class_reception_d",
          );
          if (receptionRoom) {
            const message =
              room.id === "boarding_tower"
                ? "You board the RMS Britannic by the Boarding Tower."
                : "You board the RMS Britannic by the First Class Gangway.";

            addChatMessage({
              type: "system",
              message: message,
              room: currentRoom.name,
              timestamp: Date.now(),
            });
            enterRoom(receptionRoom);
          }
        };

        locationDisplay.appendChild(enterBritannicBtn);
      }
    }, transitionDelay);
  }

  // When sending a message
  function sendMessage() {
    const message = chatInput.value.trim();
    const characterData = JSON.parse(sessionStorage.getItem("character"));
    const userId = socket.id;
    const currentColor = document.getElementById("chat-color-picker").value;

    if (message && currentRoom.name && characterData) {
      const messageData = {
        room: currentRoom.name,
        message,
        timestamp: Date.now(),
      };

      console.debug("✉️ Sending message:", messageData);
      socket.emit("chat-message", messageData);
      chatInput.value = "";
    }
  }

  function updateChatDisplay() {
    console.debug("🔄 Updating chat display for room:", currentRoom.name);
    const chatMessages = document.getElementById("chat-messages");
    chatMessages.innerHTML = "";

    let messagesToShow = [];
    if (isGlobalChat) {
      // Collect all messages from all rooms
      Object.values(chatHistory.rooms).forEach((roomMessages) => {
        messagesToShow = messagesToShow.concat(roomMessages);
      });
      // Sort by timestamp
      messagesToShow.sort((a, b) => a.timestamp - b.timestamp);
    } else {
      // Get messages only for current room
      messagesToShow = chatHistory.rooms[currentRoom.name] || [];
    }

    console.debug(`📦 Found ${messagesToShow.length} messages to display`);

    messagesToShow.forEach((data) => {
      const messageDiv = document.createElement("div");
      messageDiv.className = `chat-message ${data.type || "user"}`;
      messageDiv.setAttribute("data-user-id", data.userId);

      if (data.type === "system") {
        messageDiv.textContent = data.message;
      } else {
        const fullName = `${data.character.forename} ${data.character.surname}`;
        if (isGlobalChat) {
          const roomName = getRoomNameById(data.room);
          const roomSpan = document.createElement("span");
          roomSpan.textContent = roomName;
          roomSpan.style.textDecoration = "underline";
          roomSpan.style.cursor = "pointer";
          roomSpan.addEventListener("click", () => {
            // Find the room object and enter it
            const room = findRoomById(data.room);
            if (room) {
              enterRoom(room);
            }
          });
          messageDiv.appendChild(document.createTextNode(`${fullName} `));
          messageDiv.appendChild(roomSpan);
          messageDiv.appendChild(document.createTextNode(`: ${data.message}`));
        } else {
          messageDiv.textContent = `${fullName}: ${data.message}`;
        }
        messageDiv.style.color = data.color || "#c0932b";
      }

      chatMessages.appendChild(messageDiv);
    });

    // Only scroll to bottom if explicitly requested (not automatic on mode switch)
    // This prevents jarring scroll behavior when switching between local/global chat
    console.debug(
      `✅ Updated chat display with ${messagesToShow.length} messages`,
    );
  }

  // Add a toggle for global chat
  function toggleGlobalChat() {
    isGlobalChat = !isGlobalChat;
    console.debug(`🔄 Toggled global chat. Now isGlobalChat: ${isGlobalChat}`);

    const systemMessage = {
      type: "system",
      message: `Switched to ${
        isGlobalChat ? "global" : getRoomNameById(currentRoom.name)
      } chat`,
      room: currentRoom.name, // room.id
      timestamp: Date.now(),
    };
    addChatMessage(systemMessage);

    // Re-render preserved chat history for the new mode
    updateChatDisplay();

    // Scroll to bottom after mode switch to show latest messages
    const chatMessagesElement = document.getElementById("chat-messages");
    setTimeout(() => {
      chatMessagesElement.scrollTop = chatMessagesElement.scrollHeight;
    }, 10); // Small delay to ensure DOM updates are complete
  }

  // Helper function to get room name by ID
  function getRoomNameById(roomId) {
    for (const deck in deckRooms) {
      const room = deckRooms[deck].find((r) => r.id === roomId);
      if (room) return room.name;
    }
    return "Unknown";
  }

  // Helper function to find room object by ID
  function findRoomById(roomId) {
    for (const deck in deckRooms) {
      const room = deckRooms[deck].find((r) => r.id === roomId);
      if (room) return room;
    }
    return null;
  }

  // Socket event listeners
  socket.on("chat-message", (data) => {
    try {
      if (data.character && data.character.forename && data.character.surname) {
        addChatMessage(data);
        console.debug(
          `✉️ Message from ${data.character.forename}: ${data.message}`,
        );
      } else {
        console.warn("⚠️ Received chat message without character data:", data);
      }
    } catch (error) {
      console.error(`❌ Error handling incoming message: ${error.message}`);
    }
  });

  // Handle join room errors (admin-only mode)
  socket.on("join-error", (error) => {
    console.warn("🚫 Join room error:", error);
    alert(error.message || "Unable to join the game at this time.");
  });

  // Handle admin-only mode disconnection
  socket.on("admin-only-mode", (data) => {
    console.warn("🚫 Admin-only mode:", data);
    alert(data.message || "Game access is restricted to administrators only.");
    // Redirect to registration page
    window.location.href = "/";
  });

  // Handle room message history when joining a room
  socket.on("room-message-history", (data) => {
    const { room, messages } = data;
    console.debug(
      `📚 Received ${messages.length} messages from room history for: ${room}`,
    );

    // Intentionally ignore replayed room history so entering a room starts fresh.
    if (!chatHistory.rooms[room]) {
      chatHistory.rooms[room] = [];
    }
  });

  socket.on("user-joined", (data) => {
    console.debug("📢 User joined:", data);
    addChatMessage({
      type: "system",
      message: `${data.character.forename} ${data.character.surname} has entered the room`,
      room: currentRoom.name, // room.id
      timestamp: Date.now(),
    });
    console.debug("📝 Added user-joined system message.");
  });

  socket.on("user-left", (data) => {
    console.debug("📢 User left:", data);
    addChatMessage({
      type: "system",
      message: `${data.character.forename} ${data.character.surname} has left the room`,
      room: currentRoom.name, // room.id
      timestamp: Date.now(),
    });
    console.debug("📝 Added user-left system message.");
  });

  // Function to add a chat message
  function addChatMessage(data) {
    console.debug("📝 Adding chat message:", data);

    // Store message in room history
    if (!chatHistory.rooms[data.room]) {
      chatHistory.rooms[data.room] = [];
    }
    chatHistory.rooms[data.room].push(data);
    // Cap per-room history to prevent unbounded memory growth
    if (chatHistory.rooms[data.room].length > 200) {
      chatHistory.rooms[data.room].shift();
    }

    // Update display if needed
    if (isGlobalChat || data.room === currentRoom.name) {
      const messageDiv = document.createElement("div");
      messageDiv.className = `chat-message ${data.type || "user"}`;
      if (data.userId) {
        messageDiv.setAttribute("data-user-id", data.userId);
      }

      if (data.type === "system") {
        messageDiv.textContent = data.message;
      } else {
        const nameParts = [];
        if (data.displayName) {
          nameParts.push(data.displayName);
        } else {
          if (data.character?.forename) nameParts.push(data.character.forename);
          if (data.character?.surname) nameParts.push(data.character.surname);
        }
        const fullName = nameParts.join(" ") || "Passenger";
        const messageColor = data.color || "#c0932b";

        // Check if this is an action message (/me command)
        const isActionMessage = data.isAction || false;
        const isInlineMe = data.inlineMe || false;

        // Build the display text
        let displayText;
        if (isInlineMe) {
          // Inline /me: name is already in the message, no prefix needed
          displayText = data.message;
        } else if (isActionMessage) {
          // Prefix /me: name + space + message (no colon)
          displayText = `${fullName} ${data.message}`;
        } else {
          // Normal message: name + colon + message
          displayText = `${fullName}: ${data.message}`;
        }

        // Only show room name if in global chat mode
        if (isGlobalChat) {
          const roomName = getRoomNameById(data.room);
          const roomSpan = document.createElement("span");
          roomSpan.textContent = `(${roomName})`;
          roomSpan.style.textDecoration = "underline";
          roomSpan.style.cursor = "pointer";
          roomSpan.addEventListener("click", () => {
            // Find the room object and enter it
            const room = findRoomById(data.room);
            if (room) {
              enterRoom(room);
            }
          });
          messageDiv.appendChild(roomSpan);
          messageDiv.appendChild(document.createTextNode(` ${displayText}`));
        } else {
          // Local chat mode
          messageDiv.textContent = displayText;
        }
        messageDiv.style.color = messageColor;
      }

      // Add to chat display
      const chatMessages = document.getElementById("chat-messages");
      chatMessages.appendChild(messageDiv);
      // Prune oldest nodes so the live DOM stays bounded like the history
      // array (200/room). Without this the chat element grows unbounded
      // between room switches (updateChatDisplay is the only other reset).
      while (chatMessages.childElementCount > 200) {
        chatMessages.removeChild(chatMessages.firstElementChild);
      }
      chatMessages.scrollTop = chatMessages.scrollHeight;
    }
  }

  // Show settings popup when settings button is clicked
  document
    .querySelector(".panel1-buttons button:first-child")
    .addEventListener("click", () => {
      // Close deckplans popup if it's open
      const deckplansPopup = document.getElementById("deckplans-popup");
      if (deckplansPopup && deckplansPopup.style.display === "block") {
        deckplansPopup.style.display = "none";
        openMapSound.pause();
      }
      document.getElementById("rules-popup").style.display = "none";
      document.getElementById("settings-popup").style.display = "block";
    });

  // Close settings popup when close button is clicked
  document.querySelector(".close-settings").addEventListener("click", () => {
    document.getElementById("settings-popup").style.display = "none";
  });

  // Report button functionality
  const reportBtn = document.getElementById("report-btn");
  const reportModal = document.getElementById("report-modal");
  const closeReportModal = document.getElementById("close-report-modal");
  const cancelReport = document.getElementById("cancel-report");
  const reportForm = document.getElementById("report-form");

  if (
    !reportBtn ||
    !reportModal ||
    !closeReportModal ||
    !cancelReport ||
    !reportForm
  ) {
    console.error("❌ Report system elements not found:", {
      reportBtn: !!reportBtn,
      reportModal: !!reportModal,
      closeReportModal: !!closeReportModal,
      cancelReport: !!cancelReport,
      reportForm: !!reportForm,
    });
  } else {
    console.debug("✅ Report system elements found");

    reportBtn.addEventListener("click", () => {
      reportModal.style.display = "block";
      console.debug("🚨 Report modal opened");
    });

    closeReportModal.addEventListener("click", () => {
      reportModal.style.display = "none";
      reportForm.reset();
    });

    cancelReport.addEventListener("click", () => {
      reportModal.style.display = "none";
      reportForm.reset();
    });

    window.addEventListener("click", (event) => {
      if (event.target === reportModal) {
        reportModal.style.display = "none";
        reportForm.reset();
      }
    });

    // Handle report form submission
    reportForm.addEventListener("submit", async (e) => {
      e.preventDefault();

      const formData = new FormData(reportForm);
      const reportData = {
        type: formData.get("report-type"),
        description: formData.get("report-description"),
        reportedUser: formData.get("reported-user") || null,
        reporterName: sessionStorage.getItem("character")
          ? JSON.parse(sessionStorage.getItem("character")).forename +
            " " +
            JSON.parse(sessionStorage.getItem("character")).surname
          : "Anonymous",
        room: currentRoom ? currentRoom.name : "Unknown",
      };

      try {
        const response = await fetch("/api/report", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(reportData),
        });

        const result = await response.json();

        if (result.success) {
          alert("Thank you. Your report has been sent to the moderators.");
          reportModal.style.display = "none";
          reportForm.reset();
          console.info("✅ Report submitted successfully");
        } else {
          const failureMessage =
            result.details ||
            result.error ||
            "The report could not be sent. Please try again.";
          alert(failureMessage);
          console.error("❌ Report submission failed:", result.error);
        }
      } catch (error) {
        alert(
          "The report could not be sent. Please check your connection and try again.",
        );
        console.error("❌ Report submission error:", error);
      }
    });
  }

  // Add Deckplans button functionality
  const deckplansBtn = document.getElementById("deckplans-btn");
  const closeDeckplansBtn = document.querySelector(".close-deckplans");

  deckplansBtn.addEventListener("click", () => {
    // Close settings popup if it's open
    const settingsPopup = document.getElementById("settings-popup");
    if (settingsPopup && settingsPopup.style.display === "block") {
      settingsPopup.style.display = "none";
    }
    document.getElementById("rules-popup").style.display = "none";
    deckplansPopup.style.display = "block";
    openMapSound.currentTime = 0; // Reset to start
    openMapSound.play();

    // Show appropriate deckplan based on player location
    if (isPlayerInSouthampton()) {
      showSouthamptonDeckplan();
    } else {
      showBritannicDeckplans();
    }

    console.debug("🗺️ Deckplans popup opened and sound played.");
  });

  closeDeckplansBtn.addEventListener("click", () => {
    deckplansPopup.style.display = "none";
    openMapSound.pause();
  });

  window.addEventListener("click", (event) => {
    if (event.target === deckplansPopup) {
      deckplansPopup.style.display = "none";
    }
  });

  // Deck plan functionality
  const deckButtons = document.querySelectorAll(".deck-btn");
  const currentDeckImage = document.getElementById("current-deck");
  const roomMarkers = document.getElementById("room-markers");

  // Cache last-known room counts so tooltips keep their values when popup is
  // reopened or the DOM is rebuilt
  const roomCountsCache = new Map();

  // Room tooltip text, worded like the passenger drawer:
  // "First Class Lounge · 2 passengers"
  function roomCountLabel(roomName, count) {
    const total = Math.max(0, Number(count) || 0);
    return `${roomName} · ${total} passenger${total === 1 ? "" : "s"}`;
  }

  // No native title on the marker: #room-tooltip already shows the name and
  // count, and a title put the browser's own tooltip on top of it
  function setMarkerCountAttr(el, roomId, roomName) {
    const cached = roomCountsCache.get(roomId) ?? 0;
    el.setAttribute("data-user-count", String(cached));
    el.setAttribute("aria-label", roomName);
  }

  // Helper function to check if player is in Southampton
  function isPlayerInSouthampton() {
    return (
      deckRooms.southampton &&
      deckRooms.southampton.some(
        (r) => r.location.chatRoom === currentRoom.name,
      )
    );
  }

  // Function to show Southampton deckplan
  function showSouthamptonDeckplan() {
    // Reset popup size to default
    deckplansPopup.style.width = "";
    deckplansPopup.style.maxWidth = "";
    // The town map and the Berth 44 plans are not the ship's plans
    deckplansPopup.querySelector("h2").textContent = "Southampton";

    // Hide all Britannic deck buttons
    deckButtons.forEach((button) => {
      button.style.display = "none";
    });

    // Remove existing Southampton category buttons if any
    const existingSouthamptonButtons = document.querySelector(
      ".southampton-category-buttons",
    );
    if (existingSouthamptonButtons) {
      existingSouthamptonButtons.remove();
    }

    // Create Southampton category buttons
    const deckButtonsContainer = document.querySelector(".deck-buttons");
    const southamptonButtonsDiv = document.createElement("div");
    southamptonButtonsDiv.className =
      "southampton-category-buttons deck-buttons";
    southamptonButtonsDiv.innerHTML = `
      <button class="deck-btn southampton-category-btn active" data-southampton-category="town">Town of Southampton</button>
      <button class="deck-btn southampton-category-btn" data-southampton-category="berth44ground">Berth 44 Ground</button>
      <button class="deck-btn southampton-category-btn" data-southampton-category="berth44second">Berth 44 2nd Floor</button>
    `;
    deckButtonsContainer.parentNode.insertBefore(
      southamptonButtonsDiv,
      deckButtonsContainer.nextSibling,
    );

    // Add event listeners for Southampton category buttons
    document.querySelectorAll(".southampton-category-btn").forEach((button) => {
      button.addEventListener("click", () => {
        // Remove active class from all Southampton category buttons
        document
          .querySelectorAll(".southampton-category-btn")
          .forEach((btn) => btn.classList.remove("active"));
        // Add active class to clicked button
        button.classList.add("active");

        const category = button.getAttribute("data-southampton-category");
        showSouthamptonCategory(category);
      });
    });

    // Show the default category (Town of Southampton)
    showSouthamptonCategory("town");

    console.debug("🗺️ Showing Southampton deckplan");
  }

  // Function to show specific Southampton category
  function showSouthamptonCategory(category) {
    roomMarkers.innerHTML = "";
    const existingSvg = document.querySelector(".deck-svg-overlay");
    if (existingSvg) existingSvg.remove();

    const deckplanDisplay = document.querySelector(".deckplan-display");

    if (category === "town") {
      // Show Town of Southampton map
      currentDeckImage.src = "/images/decks/southampton.png";

      // Reset to smaller width for town map (444x600)
      deckplanDisplay.style.maxWidth = "444px";
      deckplanDisplay.style.width = "100%";

      // Add Southampton SVG overlay with Berth 44 Walkaway
      const svgOverlay = document.createElement("div");
      svgOverlay.className = "deck-svg-overlay";
      svgOverlay.innerHTML = `
        <svg style="width:100%; position:absolute; top:0; left:0;" xmlns="http://www.w3.org/2000/svg" 
             xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 444 600">
          <!-- Berth 44 Walkaway -->
          <a xlink:href="#" class="room-marker berth-walkaway" data-room-id="berth_44_walkaway">
            <g>
              <polygon class="image-mapper-shape" points="223,564 228,543 231,543 227,564 223,563"></polygon>
            </g>
          </a>
        </svg>
      `;
      document.querySelector(".deckplan-display").appendChild(svgOverlay);

      // Add event listener for the Southampton room
      const room = deckRooms.southampton.find(
        (r) => r.id === "berth_44_walkaway",
      );
      if (room) {
        const link = document.querySelector(
          '.room-marker[data-room-id="berth_44_walkaway"]',
        );
        if (link) {
          link.setAttribute("data-room-name", room.name);
          {
            const cached = roomCountsCache.get(
              link.getAttribute("data-room-id"),
            );
            link.setAttribute("data-user-count", String(cached ?? 0));
          }
          setMarkerCountAttr(link, room.location.chatRoom, room.name);

          link.addEventListener("click", (e) => {
            e.preventDefault();
            console.debug(
              `🔍 Southampton room area clicked: berth_44_walkaway`,
            );
            enterRoom(room);
            deckplansPopup.style.display = "none"; // Close popup on selection
          });

          // Add tooltip functionality
          const tooltip = document.getElementById("room-tooltip");
          link.addEventListener("mouseenter", (e) => {
            const userCount = link.getAttribute("data-user-count") || "0";
            tooltip.textContent = roomCountLabel(room.name, userCount);
            tooltip.style.display = "block";
            tooltip.style.left = `${e.clientX + 5}px`;
            tooltip.style.top = `${e.clientY + 5}px`;
          });
          link.addEventListener("mousemove", (e) => {
            tooltip.style.left = `${e.clientX + 5}px`;
            tooltip.style.top = `${e.clientY + 5}px`;
          });
          link.addEventListener("mouseleave", () => {
            tooltip.style.display = "none";
          });
        }
      }
    } else if (category === "berth44ground") {
      // Show Berth 44 Ground map (1132x222 original dimensions)
      currentDeckImage.src = "/images/decks/berth44ground.jpg";

      // Set width to accommodate the wider berth44ground image
      deckplanDisplay.style.maxWidth = "1132px";
      deckplanDisplay.style.width = "100%";

      // Add SVG overlay for Berth 44 Ground
      const svgOverlay = document.createElement("div");
      svgOverlay.className = "deck-svg-overlay";
      svgOverlay.innerHTML = `
        <svg style="width:100%; position:absolute; top:0; left:0;" xmlns="http://www.w3.org/2000/svg" 
             xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 1132 222">
          <!-- Dockside Cafe & Bar -->
          <a xlink:href="#" class="room-marker cafe" data-room-id="dockside_cafe">
            <g>
              <polygon class="image-mapper-shape" points="57,161 186,161 186,181 56,181 57,161"></polygon>
            </g>
          </a>
          <!-- Berth 44 Forward Docks -->
          <a xlink:href="#" class="room-marker docks" data-room-id="berth_44_forward">
            <g>
              <polygon class="image-mapper-shape" points="13,69 365,69 365,110 13,110 13,68"></polygon>
            </g>
          </a>
          <!-- First Class Gangway -->
          <a xlink:href="#" class="room-marker gangway" data-room-id="first_class_gangway">
            <g>
              <polygon class="image-mapper-shape" points="365,103 365,58 383,58 382,103 366,103"></polygon>
            </g>
          </a>
          <!-- Crew Gangway -->
          <a xlink:href="#" class="room-marker crew-gangway" data-room-id="crew_gangway">
            <g>
              <polygon class="image-mapper-shape" points="210,53 218,53 218,68 210,68"></polygon>
            </g>
          </a>
          <!-- 3rd Class Gangway -->
          <a xlink:href="#" class="room-marker third-class-gangway" data-room-id="third_class_gangway">
            <g>
              <polygon class="image-mapper-shape" points="952,79,952,54,966,55,966,79"></polygon>
            </g>
          </a>
          <!-- Berth 44 Aft Docks -->
          <a xlink:href="#" class="room-marker aft-docks" data-room-id="berth_44_aft">
            <g>
              <polygon class="image-mapper-shape" points="1019,69 1020,111 1121,111 1120,69"></polygon>
            </g>
          </a>
        </svg>
      `;
      document.querySelector(".deckplan-display").appendChild(svgOverlay);

      // Add event listener for Dockside Cafe
      const docksideCafe = deckRooms.southampton.find(
        (r) => r.id === "dockside_cafe",
      );
      if (docksideCafe) {
        const link = document.querySelector(
          '.room-marker[data-room-id="dockside_cafe"]',
        );
        if (link) {
          link.setAttribute("data-room-name", docksideCafe.name);
          {
            const cached = roomCountsCache.get(
              link.getAttribute("data-room-id"),
            );
            link.setAttribute("data-user-count", String(cached ?? 0));
          }
          setMarkerCountAttr(
            link,
            docksideCafe.location.chatRoom,
            docksideCafe.name,
          );

          link.addEventListener("click", (e) => {
            e.preventDefault();
            console.debug(
              `🔍 Berth 44 Ground room area clicked: dockside_cafe`,
            );
            enterRoom(docksideCafe);
            deckplansPopup.style.display = "none"; // Close popup on selection
          });

          // Add tooltip functionality
          const tooltip = document.getElementById("room-tooltip");
          link.addEventListener("mouseenter", (e) => {
            const userCount = link.getAttribute("data-user-count") || "0";
            tooltip.textContent = roomCountLabel(docksideCafe.name, userCount);
            tooltip.style.display = "block";
            tooltip.style.left = `${e.clientX + 5}px`;
            tooltip.style.top = `${e.clientY + 5}px`;
          });
          link.addEventListener("mousemove", (e) => {
            tooltip.style.left = `${e.clientX + 5}px`;
            tooltip.style.top = `${e.clientY + 5}px`;
          });
          link.addEventListener("mouseleave", () => {
            tooltip.style.display = "none";
          });
        }
      }

      // Add event listener for Berth 44 Forward Docks
      const berth44Forward = deckRooms.southampton.find(
        (r) => r.id === "berth_44_forward",
      );
      if (berth44Forward) {
        const link = document.querySelector(
          '.room-marker[data-room-id="berth_44_forward"]',
        );
        if (link) {
          link.setAttribute("data-room-name", berth44Forward.name);
          {
            const cached = roomCountsCache.get(
              link.getAttribute("data-room-id"),
            );
            link.setAttribute("data-user-count", String(cached ?? 0));
          }
          setMarkerCountAttr(
            link,
            berth44Forward.location.chatRoom,
            berth44Forward.name,
          );

          link.addEventListener("click", (e) => {
            e.preventDefault();
            console.debug(
              `🔍 Berth 44 Ground room area clicked: berth_44_forward`,
            );
            enterRoom(berth44Forward);
            deckplansPopup.style.display = "none"; // Close popup on selection
          });

          // Add tooltip functionality
          const tooltip = document.getElementById("room-tooltip");
          link.addEventListener("mouseenter", (e) => {
            const userCount = link.getAttribute("data-user-count") || "0";
            tooltip.textContent = roomCountLabel(
              berth44Forward.name,
              userCount,
            );
            tooltip.style.display = "block";
            tooltip.style.left = `${e.clientX + 5}px`;
            tooltip.style.top = `${e.clientY + 5}px`;
          });
          link.addEventListener("mousemove", (e) => {
            tooltip.style.left = `${e.clientX + 5}px`;
            tooltip.style.top = `${e.clientY + 5}px`;
          });
          link.addEventListener("mouseleave", () => {
            tooltip.style.display = "none";
          });
        }
      }

      // Add event listener for First Class Gangway
      const firstClassGangway = deckRooms.southampton.find(
        (r) => r.id === "first_class_gangway",
      );
      if (firstClassGangway) {
        const link = document.querySelector(
          '.room-marker[data-room-id="first_class_gangway"]',
        );
        if (link) {
          link.setAttribute("data-room-name", firstClassGangway.name);
          {
            const cached = roomCountsCache.get(
              link.getAttribute("data-room-id"),
            );
            link.setAttribute("data-user-count", String(cached ?? 0));
          }
          setMarkerCountAttr(
            link,
            firstClassGangway.location.chatRoom,
            firstClassGangway.name,
          );

          link.addEventListener("click", (e) => {
            e.preventDefault();
            console.debug(
              `🔍 Berth 44 Ground room area clicked: first_class_gangway`,
            );
            enterRoom(firstClassGangway);
            deckplansPopup.style.display = "none"; // Close popup on selection
          });

          // Add tooltip functionality
          const tooltip = document.getElementById("room-tooltip");
          link.addEventListener("mouseenter", (e) => {
            const userCount = link.getAttribute("data-user-count") || "0";
            tooltip.textContent = roomCountLabel(
              firstClassGangway.name,
              userCount,
            );
            tooltip.style.display = "block";
            tooltip.style.left = `${e.clientX + 5}px`;
            tooltip.style.top = `${e.clientY + 5}px`;
          });
          link.addEventListener("mousemove", (e) => {
            tooltip.style.left = `${e.clientX + 5}px`;
            tooltip.style.top = `${e.clientY + 5}px`;
          });
          link.addEventListener("mouseleave", () => {
            tooltip.style.display = "none";
          });
        }
      }

      // Add event listener for Crew Gangway
      const crewGangway = deckRooms.southampton.find(
        (r) => r.id === "crew_gangway",
      );
      if (crewGangway) {
        const link = document.querySelector(
          '.room-marker[data-room-id="crew_gangway"]',
        );
        if (link) {
          link.setAttribute("data-room-name", crewGangway.name);
          {
            const cached = roomCountsCache.get(
              link.getAttribute("data-room-id"),
            );
            link.setAttribute("data-user-count", String(cached ?? 0));
          }
          setMarkerCountAttr(
            link,
            crewGangway.location.chatRoom,
            crewGangway.name,
          );

          link.addEventListener("click", (e) => {
            e.preventDefault();
            console.debug(`🔍 Berth 44 Ground room area clicked: crew_gangway`);
            enterRoom(crewGangway);
            deckplansPopup.style.display = "none"; // Close popup on selection
          });

          // Add tooltip functionality
          const tooltip = document.getElementById("room-tooltip");
          link.addEventListener("mouseenter", (e) => {
            const userCount = link.getAttribute("data-user-count") || "0";
            tooltip.textContent = roomCountLabel(crewGangway.name, userCount);
            tooltip.style.display = "block";
            tooltip.style.left = `${e.clientX + 5}px`;
            tooltip.style.top = `${e.clientY + 5}px`;
          });
          link.addEventListener("mousemove", (e) => {
            tooltip.style.left = `${e.clientX + 5}px`;
            tooltip.style.top = `${e.clientY + 5}px`;
          });
          link.addEventListener("mouseleave", () => {
            tooltip.style.display = "none";
          });
        }
      }

      // Add event listener for 3rd Class Gangway
      const thirdClassGangway = deckRooms.southampton.find(
        (r) => r.id === "third_class_gangway",
      );
      if (thirdClassGangway) {
        const link = document.querySelector(
          '.room-marker[data-room-id="third_class_gangway"]',
        );
        if (link) {
          link.setAttribute("data-room-name", thirdClassGangway.name);
          {
            const cached = roomCountsCache.get(
              link.getAttribute("data-room-id"),
            );
            link.setAttribute("data-user-count", String(cached ?? 0));
          }
          setMarkerCountAttr(
            link,
            thirdClassGangway.location.chatRoom,
            thirdClassGangway.name,
          );

          link.addEventListener("click", (e) => {
            e.preventDefault();
            console.debug(
              `🔍 Berth 44 Ground room area clicked: third_class_gangway`,
            );
            enterRoom(thirdClassGangway);
            deckplansPopup.style.display = "none"; // Close popup on selection
          });

          // Add tooltip functionality
          const tooltip = document.getElementById("room-tooltip");
          link.addEventListener("mouseenter", (e) => {
            const userCount = link.getAttribute("data-user-count") || "0";
            tooltip.textContent = roomCountLabel(
              thirdClassGangway.name,
              userCount,
            );
            tooltip.style.display = "block";
            tooltip.style.left = `${e.clientX + 5}px`;
            tooltip.style.top = `${e.clientY + 5}px`;
          });
          link.addEventListener("mousemove", (e) => {
            tooltip.style.left = `${e.clientX + 5}px`;
            tooltip.style.top = `${e.clientY + 5}px`;
          });
          link.addEventListener("mouseleave", () => {
            tooltip.style.display = "none";
          });
        }
      }

      // Add event listener for Berth 44 Aft Docks
      const berth44Aft = deckRooms.southampton.find(
        (r) => r.id === "berth_44_aft",
      );
      if (berth44Aft) {
        const link = document.querySelector(
          '.room-marker[data-room-id="berth_44_aft"]',
        );
        if (link) {
          link.setAttribute("data-room-name", berth44Aft.name);
          {
            const cached = roomCountsCache.get(
              link.getAttribute("data-room-id"),
            );
            link.setAttribute("data-user-count", String(cached ?? 0));
          }
          setMarkerCountAttr(
            link,
            berth44Aft.location.chatRoom,
            berth44Aft.name,
          );

          link.addEventListener("click", (e) => {
            e.preventDefault();
            console.debug(`🔍 Berth 44 Ground room area clicked: berth_44_aft`);
            enterRoom(berth44Aft);
            deckplansPopup.style.display = "none"; // Close popup on selection
          });

          // Add tooltip functionality
          const tooltip = document.getElementById("room-tooltip");
          link.addEventListener("mouseenter", (e) => {
            const userCount = link.getAttribute("data-user-count") || "0";
            tooltip.textContent = roomCountLabel(berth44Aft.name, userCount);
            tooltip.style.display = "block";
            tooltip.style.left = `${e.clientX + 5}px`;
            tooltip.style.top = `${e.clientY + 5}px`;
          });
          link.addEventListener("mousemove", (e) => {
            tooltip.style.left = `${e.clientX + 5}px`;
            tooltip.style.top = `${e.clientY + 5}px`;
          });
          link.addEventListener("mouseleave", () => {
            tooltip.style.display = "none";
          });
        }
      }
    } else if (category === "berth44second") {
      // Show Berth 44 2nd Floor map (770x150 original dimensions)
      currentDeckImage.src = "/images/decks/berth44second.jpg";

      // Set width to accommodate the berth44second image
      deckplanDisplay.style.maxWidth = "770px";
      deckplanDisplay.style.width = "100%";

      // Add SVG overlay for Berth 44 2nd Floor
      const svgOverlay = document.createElement("div");
      svgOverlay.className = "deck-svg-overlay";
      svgOverlay.innerHTML = `
        <svg style="width:100%; position:absolute; top:0; left:0;" xmlns="http://www.w3.org/2000/svg" 
             xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 770 150">
          <!-- 1st & 2nd Class Covered Walkway -->
          <a xlink:href="#" class="room-marker covered-walkway" data-room-id="covered_walkway">
            <g>
              <polygon class="image-mapper-shape" points="246,70 659,71 659,79 246,79 246,70"></polygon>
            </g>
          </a>
          <!-- 1st Class Boarding Tower -->
          <a xlink:href="#" class="room-marker boarding-tower" data-room-id="boarding_tower">
            <g>
              <polygon class="image-mapper-shape" points="259,69 260,52 283,53 283,69 259,69"></polygon>
            </g>
          </a>
        </svg>
      `;
      document.querySelector(".deckplan-display").appendChild(svgOverlay);

      // Add event listener for 1st & 2nd Class Covered Walkway
      const coveredWalkway = deckRooms.southampton.find(
        (r) => r.id === "covered_walkway",
      );
      if (coveredWalkway) {
        const link = document.querySelector(
          '.room-marker[data-room-id="covered_walkway"]',
        );
        if (link) {
          link.setAttribute("data-room-name", coveredWalkway.name);
          link.setAttribute("data-user-count", "0");
          setMarkerCountAttr(
            link,
            coveredWalkway.location.chatRoom,
            coveredWalkway.name,
          );

          link.addEventListener("click", (e) => {
            e.preventDefault();
            console.debug(
              `🔍 Berth 44 2nd Floor room area clicked: covered_walkway`,
            );
            enterRoom(coveredWalkway);
            deckplansPopup.style.display = "none"; // Close popup on selection
          });

          // Add tooltip functionality
          const tooltip = document.getElementById("room-tooltip");
          link.addEventListener("mouseenter", (e) => {
            const userCount = link.getAttribute("data-user-count") || "0";
            tooltip.textContent = roomCountLabel(
              coveredWalkway.name,
              userCount,
            );
            tooltip.style.display = "block";
            tooltip.style.left = `${e.clientX + 5}px`;
            tooltip.style.top = `${e.clientY + 5}px`;
          });
          link.addEventListener("mousemove", (e) => {
            tooltip.style.left = `${e.clientX + 5}px`;
            tooltip.style.top = `${e.clientY + 5}px`;
          });
          link.addEventListener("mouseleave", () => {
            tooltip.style.display = "none";
          });
        }
      }

      // Add event listener for 1st Class Boarding Tower
      const boardingTower = deckRooms.southampton.find(
        (r) => r.id === "boarding_tower",
      );
      if (boardingTower) {
        const link = document.querySelector(
          '.room-marker[data-room-id="boarding_tower"]',
        );
        if (link) {
          link.setAttribute("data-room-name", boardingTower.name);
          link.setAttribute("data-user-count", "0");
          setMarkerCountAttr(
            link,
            boardingTower.location.chatRoom,
            boardingTower.name,
          );

          link.addEventListener("click", (e) => {
            e.preventDefault();
            console.debug(
              `🔍 Berth 44 2nd Floor room area clicked: boarding_tower`,
            );
            enterRoom(boardingTower);
            deckplansPopup.style.display = "none"; // Close popup on selection
          });

          // Add tooltip functionality
          const tooltip = document.getElementById("room-tooltip");
          link.addEventListener("mouseenter", (e) => {
            const userCount = link.getAttribute("data-user-count") || "0";
            tooltip.textContent = roomCountLabel(boardingTower.name, userCount);
            tooltip.style.display = "block";
            tooltip.style.left = `${e.clientX + 5}px`;
            tooltip.style.top = `${e.clientY + 5}px`;
          });
          link.addEventListener("mousemove", (e) => {
            tooltip.style.left = `${e.clientX + 5}px`;
            tooltip.style.top = `${e.clientY + 5}px`;
          });
          link.addEventListener("mouseleave", () => {
            tooltip.style.display = "none";
          });
        }
      }
    }

    console.debug(`🗺️ Showing Southampton category: ${category}`);

    const southamptonMarkers = deckplansPopup
      ? deckplansPopup.querySelectorAll(".room-marker[data-room-id]")
      : [];
    emitRoomCountBatch(
      Array.from(southamptonMarkers || []).map((el) =>
        el.getAttribute("data-room-id"),
      ),
    );
  } // Function to show Britannic deckplans
  // Passenger-class fill colours for the deck overlay (mirror of the CSS
  // .room-marker.<class>-class rules and RBV.data.roomClassColors; the
  // room editor reads the same palette).
  function renderShipDeckOverlay(deck) {
    const viewBoxes = window.deckViewBoxes || {};
    const viewBox = viewBoxes[deck];
    const rooms = deckRooms[deck];
    if (!viewBox || !Array.isArray(rooms)) return; // no data → image only

    const shapes = rooms
      .filter((r) => r.coordinates)
      .map((r) => {
        const cls = r.class || "first";
        const typeTok = r.type ? " " + r.type : "";
        return (
          '<a xlink:href="#" class="room-marker ' +
          cls +
          "-class" +
          typeTok +
          '" data-room-id="' +
          r.id +
          '"><g><polygon class="image-mapper-shape" points="' +
          r.coordinates +
          '"></polygon></g></a>'
        );
      })
      .join("\n");

    const svgOverlay = document.createElement("div");
    svgOverlay.className = "deck-svg-overlay";
    svgOverlay.innerHTML =
      '<svg style="width:100%; position:absolute; top:0; left:0;" ' +
      'xmlns="http://www.w3.org/2000/svg" ' +
      'xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="' +
      viewBox +
      '">\n' +
      shapes +
      "\n</svg>";
    document.querySelector(".deckplan-display").appendChild(svgOverlay);

    const tooltip = document.getElementById("room-tooltip");
    const svgRoomIds = new Set();
    svgOverlay.querySelectorAll(".room-marker").forEach((link) => {
      const roomId = link.getAttribute("data-room-id");
      const room = rooms.find((r) => r.id === roomId);
      if (!room) return;
      link.setAttribute("data-room-name", room.name);
      link.setAttribute(
        "data-user-count",
        String(roomCountsCache.get(roomId) ?? 0),
      );
      svgRoomIds.add(roomId);
      setMarkerCountAttr(link, roomId, room.name);
      link.addEventListener("click", (e) => {
        e.preventDefault();
        console.debug(`🔍 SVG room area clicked: ${roomId}`);
        enterRoom(room);
      });
      link.addEventListener("mouseenter", (e) => {
        const userCount = link.getAttribute("data-user-count") || "0";
        tooltip.textContent = roomCountLabel(room.name, userCount);
        tooltip.style.display = "block";
        tooltip.style.left = `${e.clientX + 5}px`;
        tooltip.style.top = `${e.clientY + 5}px`;
      });
      link.addEventListener("mousemove", (e) => {
        tooltip.style.left = `${e.clientX + 5}px`;
        tooltip.style.top = `${e.clientY + 5}px`;
      });
      link.addEventListener("mouseleave", () => {
        tooltip.style.display = "none";
      });
    });
    emitRoomCountBatch(Array.from(svgRoomIds));
    console.debug(
      `🗺️ Built ${svgRoomIds.size} room markers for ${deck} from data`,
    );
  }

  function showBritannicDeckplans() {
    // The ship plans are long, detailed 3200 px drawings: widen the popup for
    // them and let the plan fill it (Southampton resets the popup size).
    deckplansPopup.style.width = "95vw";
    deckplansPopup.style.maxWidth = "1800px";
    deckplansPopup.querySelector("h2").textContent = "Ship Deckplans";

    const deckplanDisplay = document.querySelector(".deckplan-display");
    if (deckplanDisplay) {
      deckplanDisplay.style.maxWidth = "none";
      deckplanDisplay.style.width = "100%";
    }

    // Remove Southampton category buttons if they exist
    const existingSouthamptonButtons = document.querySelector(
      ".southampton-category-buttons",
    );
    if (existingSouthamptonButtons) {
      existingSouthamptonButtons.remove();
    }

    // Show all Britannic deck buttons
    deckButtons.forEach((button) => {
      button.style.display = "inline-block";
    });

    // Auto-switch to the deck containing the player's current room
    let currentDeck = "boat_deck"; // Default fallback
    for (const [deckName, rooms] of Object.entries(deckRooms)) {
      if (
        rooms.some(
          (room) =>
            room.location && room.location.chatRoom === currentRoom.name,
        )
      ) {
        currentDeck = deckName;
        break;
      }
    }
    document.querySelector(`[data-deck="${currentDeck}"]`).click();
    console.debug("🗺️ Showing Britannic deckplans");
  }

  deckButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const deck = button.getAttribute("data-deck");
      deckButtons.forEach((b) => b.classList.toggle("active", b === button));
      console.debug(`🖱️ Deck button clicked: ${deck}`);
      currentDeckImage.src = `/images/decks/${deck}.jpg`;
      roomMarkers.innerHTML = "";
      const existingSvg = document.querySelector(".deck-svg-overlay");
      if (existingSvg) existingSvg.remove();

      // Ship-deck room overlays are built from deckRooms data
      // (coordinates + passenger class) by renderShipDeckOverlay below,
      // not from hardcoded inline SVG. Decks without a viewBox entry
      // (c/e/f/lo/tank) simply show the plan image with no room markers.
      renderShipDeckOverlay(deck);

      if (deckRooms[deck]) {
        console.debug(`✅ Found ${deckRooms[deck].length} rooms for ${deck}`);
        const roomsToRequest = new Set();
        deckRooms[deck].forEach((room) => {
          if (room.isSVG) {
            console.debug(`ℹ️ Room ${room.name} is SVG, skipping marker`);
          } else if (room.x !== undefined && room.y !== undefined) {
            console.debug(
              `📍 Creating marker for ${room.name} at ${room.x}%, ${room.y}%`,
            );
            const marker = document.createElement("div");
            marker.className = `room-marker ${room.type} ${room.id}`;
            marker.style.left = `${room.x}%`;
            marker.style.top = `${room.y}%`;
            marker.setAttribute("data-room-id", room.location.chatRoom);
            marker.setAttribute("data-room-name", room.name);
            {
              const cached = roomCountsCache.get(
                marker.getAttribute("data-room-id"),
              );
              marker.setAttribute("data-user-count", String(cached ?? 0));
            }
            setMarkerCountAttr(marker, room.location.chatRoom, room.name);

            marker.addEventListener("click", () => {
              console.debug(`🔍 Room marker clicked: ${room.name}`);
              enterRoom(room);
            });

            // Add tooltip functionality
            const tooltip = document.getElementById("room-tooltip");
            marker.addEventListener("mouseenter", (e) => {
              const userCount = marker.getAttribute("data-user-count") || "0";
              tooltip.textContent = roomCountLabel(room.name, userCount);
              tooltip.style.display = "block";
              tooltip.style.left = `${e.clientX + 5}px`;
              tooltip.style.top = `${e.clientY + 5}px`;
            });
            marker.addEventListener("mousemove", (e) => {
              tooltip.style.left = `${e.clientX + 5}px`;
              tooltip.style.top = `${e.clientY + 5}px`;
            });
            marker.addEventListener("mouseleave", () => {
              tooltip.style.display = "none";
            });

            roomMarkers.appendChild(marker);
            console.debug(`📍 Added room marker for: ${room.name}`);
            roomsToRequest.add(room.location.chatRoom);
          } else {
            console.warn(
              `🚫 Skipped adding marker for ${room.name} (no coordinates)`,
            );
          }
        });
        emitRoomCountBatch(Array.from(roomsToRequest));
      } else {
        console.warn(`❌ No rooms found for deck: ${deck}`);
      }
    });
  });

  // Note: Deck plan initialization is now handled dynamically in deckplans button click
  console.debug("🗺️ Initialized deck plans functionality.");

  // The room markers put #room-tooltip just right of the cursor, which runs
  // off the window for rooms near the bow: flip it to the cursor's left there
  const roomTooltip = document.getElementById("room-tooltip");
  document.addEventListener("mousemove", (e) => {
    if (!roomTooltip || roomTooltip.style.display !== "block") return;
    const width = roomTooltip.offsetWidth;
    if (e.clientX + 5 + width > window.innerWidth) {
      roomTooltip.style.left = `${e.clientX - 5 - width}px`;
    }
  });

  function emitRoomCountBatch(roomIds) {
    if (!socket || !roomIds || !roomIds.length) return;
    const uniqueRooms = Array.from(new Set(roomIds.filter(Boolean)));
    if (!uniqueRooms.length) return;
    socket.emit("request-room-counts", uniqueRooms);
  }

  let locationCanvas = null;
  let locationCanvasCtx = null;
  let currentLocationImageSrc = null;

  function ensureLocationCanvas() {
    if (!locationCanvas) {
      locationCanvas = document.querySelector(".location-canvas");
      locationCanvasCtx = locationCanvas
        ? locationCanvas.getContext("2d")
        : null;
      if (locationCanvas) {
        resizeLocationCanvas();
        window.addEventListener("resize", resizeLocationCanvas);
      }
    }
    return locationCanvasCtx;
  }

  function resizeLocationCanvas() {
    if (!locationCanvas) return;
    const dpr = window.devicePixelRatio || 1;
    const displayWidth = locationCanvas.clientWidth || 960;
    const displayHeight = locationCanvas.clientHeight || 540;
    locationCanvas.width = Math.floor(displayWidth * dpr);
    locationCanvas.height = Math.floor(displayHeight * dpr);
    if (locationCanvasCtx) {
      locationCanvasCtx.setTransform(1, 0, 0, 1, 0, 0);
    }
    if (currentLocationImageSrc) {
      drawLocationImage(currentLocationImageSrc, true);
    }
  }

  function drawLocationImage(imagePath, isResize = false, callbacks = {}) {
    const ctx = ensureLocationCanvas();
    if (!ctx || !imagePath) return;
    console.debug("🔍 drawLocationImage called:", { imagePath, isResize });
    if (!isResize && imagePath === currentLocationImageSrc) {
      // Already showing: still tell the caller, or entering a room that shares the
      // picture (or re-entering the same room) never slides the panels back in.
      if (typeof callbacks.onLoad === "function") {
        callbacks.onLoad({
          imagePath,
          width: locationCanvas.width,
          height: locationCanvas.height,
        });
      }
      return;
    }

    const canvas = locationCanvas;
    if (!canvas) return;

    const { onLoad, onError } = callbacks;
    const renderImage = new Image();
    renderImage.onload = () => {
      const { width, height } = canvas;
      ctx.clearRect(0, 0, width, height);

      ctx.drawImage(renderImage, 0, 0, width, height);
      currentLocationImageSrc = imagePath;
      // Release reference to help GC
      renderImage.onload = null;
      renderImage.onerror = null;
      if (typeof onLoad === "function") {
        onLoad({ imagePath, width, height });
      }
    };
    renderImage.onerror = (err) => {
      console.error("❌ Failed to draw location image", imagePath, err);
      renderImage.onload = null;
      renderImage.onerror = null;
      if (typeof onError === "function") {
        onError(err);
      }
    };
    renderImage.src = imagePath;
  }

  // Update room count from server
  socket.on("room-count", ({ roomId, count }) => {
    // Cache the count so we can reuse it when the deckplan re-renders
    try {
      roomCountsCache.set(roomId, Number(count));
    } catch (e) {
      console.warn("Could not cache room count", roomId, e);
    }

    if (
      roomId === currentRoom.name &&
      typeof setRoomPlayersCount === "function"
    ) {
      setRoomPlayersCount(count);
    }

    const markers = document.querySelectorAll(
      `.room-marker[data-room-id="${roomId}"]`,
    );
    markers.forEach((marker) => {
      marker.setAttribute("data-user-count", count);
      const roomName = marker.getAttribute("data-room-name");

      // Update tooltip if it's currently being displayed for this room
      const tooltip = document.getElementById("room-tooltip");
      if (tooltip && tooltip.style.display === "block") {
        if (tooltip.textContent.startsWith(`${roomName} · `)) {
          tooltip.textContent = roomCountLabel(roomName, count);
        }
      }
    });
  });

  const chatColorPicker = document.getElementById("chat-color-picker");
  let chatColorEmitTimeout = null;

  const updateMessagesForUser = (userIdentifier, color) => {
    if (!userIdentifier || !color) return;
    const userMessages = document.querySelectorAll(
      `.chat-message[data-user-id="${userIdentifier}"]`,
    );
    userMessages.forEach((msg) => {
      if (!msg.classList.contains("system")) {
        msg.style.color = color;
      }
    });
  };

  const applyOwnChatColor = (color) => {
    document.documentElement.style.setProperty("--user-chat-color", color);
    if (socket && socket.id) {
      updateMessagesForUser(socket.id, color);
    }
  };

  const emitChatColorChange = (color) => {
    if (!color) return;
    socket.emit("change-chat-color", color);
  };

  if (chatColorPicker) {
    chatColorPicker.addEventListener("input", (e) => {
      const selectedColor = e.target.value;
      console.debug(`🎨 Chat color preview: ${selectedColor}`);
      applyOwnChatColor(selectedColor);

      if (chatColorEmitTimeout) {
        clearTimeout(chatColorEmitTimeout);
      }

      chatColorEmitTimeout = setTimeout(() => {
        chatColorEmitTimeout = null;
        console.debug(`📤 Sending chat color update: ${selectedColor}`);
        emitChatColorChange(selectedColor);
      }, 250);
    });

    chatColorPicker.addEventListener("change", (e) => {
      const selectedColor = e.target.value;
      if (chatColorEmitTimeout) {
        clearTimeout(chatColorEmitTimeout);
        chatColorEmitTimeout = null;
      }
      applyOwnChatColor(selectedColor);
      emitChatColorChange(selectedColor);
    });
  }

  socket.on("assign-chat-color", (color) => {
    console.debug(`🎨 Assigned chat color from server: ${color}`);
    applyOwnChatColor(color);
    if (chatColorPicker) {
      chatColorPicker.value = color;
    }
  });

  socket.on("update-chat-color", ({ socketId, userId, color }) => {
    const idToLookup = socketId || userId;
    console.debug(`🎨 User ${idToLookup} changed chat color to: ${color}`);
    updateMessagesForUser(idToLookup, color);

    if (socket && socket.id && idToLookup === socket.id) {
      // Keep local CSS variable in sync if update originated elsewhere
      document.documentElement.style.setProperty("--user-chat-color", color);
      if (chatColorPicker) {
        chatColorPicker.value = color;
      }
    }
  });

  socket.on("game-user-count", (count) => {
    console.debug("🎮 Received game-user-count:", count);
    document.getElementById("people").textContent = `Passengers: ${count}`;
  });

  // Add this inside your DOMContentLoaded event listener
  const rulesBtn = document.getElementById("rules-btn");
  const rulesPopup = document.getElementById("rules-popup");
  const closeRulesBtn = document.querySelector(".close-rules");

  rulesBtn.addEventListener("click", () => {
    // Rules opens where Settings does and over the deck plans: close those
    // first, as they already close each other
    document.getElementById("settings-popup").style.display = "none";
    if (deckplansPopup.style.display === "block") {
      deckplansPopup.style.display = "none";
      openMapSound.pause();
    }
    rulesPopup.style.display = "block";
    console.debug("📋 Rules popup opened");
  });

  closeRulesBtn.addEventListener("click", () => {
    rulesPopup.style.display = "none";
    console.debug("📋 Rules popup closed");
  });

  // Close rules popup when clicking outside
  window.addEventListener("click", (event) => {
    if (event.target === rulesPopup) {
      rulesPopup.style.display = "none";
      console.debug("📋 Rules popup closed by clicking outside");
    }
  });

  // The refresh button steps through the room's pictures
  const refreshBtn = document.getElementById("refresh-location-btn");

  if (refreshBtn) {
    refreshBtn.addEventListener("click", () => {
      // Log the action for debugging
      console.debug(
        `🔄 Refresh button clicked, currentRoom.name: ${currentRoom.name}`,
      );

      // Check if there's a current room and images available
      if (!currentRoom.name || !roomImages[currentRoom.name]) {
        console.warn("⚠️ Cannot refresh: No images available for this room");
        return;
      }

      // Use the centralized cycleImage function
      locationImageSystem.cycleImage(currentRoom.name);
    });
  }

  // Dev helper — iterate all images for the specified room and log results
  window.testCycleRoomImages = async (roomName, delay = 800) => {
    try {
      if (!roomName) roomName = currentRoom?.name;
      if (!roomName)
        return console.warn("testCycleRoomImages: No room specified");
      const roomData = roomImages[roomName];
      if (!roomData) return console.warn(`No roomImages entry for ${roomName}`);
      const images = roomData.images || [];
      console.debug(
        `🔎 testCycleRoomImages: testing ${images.length} images for ${roomName}`,
      );

      for (let i = 0; i < images.length; i++) {
        const candidate = images[i];
        const isSouthampton =
          deckRooms.southampton &&
          deckRooms.southampton.some((r) => r.location.chatRoom === roomName);
        const p = isSouthampton
          ? `/images/animations/locations/southampton/${candidate}`
          : `/images/animations/locations/britannic/${candidate}`;
        console.debug(`🔁 Trying ${i + 1}/${images.length}: ${p}`);
        await new Promise((resolve) => {
          drawLocationImage(p, false, {
            onLoad: () => {
              console.debug(`✅ Success: ${p}`);
              setTimeout(resolve, delay);
            },
            onError: (err) => {
              console.warn(`❌ Fail: ${p}`, err);
              setTimeout(resolve, delay);
            },
          });
        });
      }
      console.debug(
        "✅ testCycleRoomImages: Completed testing images for",
        roomName,
      );
    } catch (err) {
      console.error("❌ testCycleRoomImages error:", err);
    }
  };

  window.showRoomImagesList = (roomName) => {
    if (!roomName) roomName = currentRoom?.name;
    if (!roomName) return console.warn("showRoomImagesList: no room specified");
    if (!roomImages[roomName])
      return console.warn(`No roomImages entry for ${roomName}`);
    console.debug(
      `📋 Images for ${roomName}:`,
      roomImages[roomName].images || [],
    );
    if (roomImages[roomName].variants)
      console.debug(`📋 Variants:`, roomImages[roomName].variants);
  };

  const SECRET_ROOM_ALIAS = "5741544e4559";
  window[SECRET_ROOM_ALIAS] = () => {
    if (typeof enterRoom !== "function") return;
    enterRoom({
      id: SECRET_ROOM_ALIAS,
      name: "Mars",
      type: "secret",
      location: {
        chatRoom: SECRET_ROOM_ALIAS,
        image: "Mars.jpg",
      },
    });
  };

  const locationImageSystem = {
    // Rooms whose images have been fetched once. The files then sit in the browser's
    // own HTTP cache, which it trims as it needs to, so no Image objects are kept here.
    preloadedRooms: new Set(),
    // Images still downloading; each is dropped as soon as it loads or fails.
    pendingPreloads: new Set(),

    preload(src) {
      const img = new Image();
      this.pendingPreloads.add(img);
      img.onload = img.onerror = () => {
        img.onload = img.onerror = null;
        this.pendingPreloads.delete(img);
      };
      img.src = src;
    },

    preloadRoomImages(roomName) {
      if (!roomImages[roomName]) return;

      const imageSet = roomImages[roomName].images;
      console.debug(`🖼️ Preloading ${imageSet.length} images for ${roomName}`);

      // Skip if already preloaded for this room
      if (this.preloadedRooms.has(roomName)) return;
      this.preloadedRooms.add(roomName);

      // Check if this is a Southampton location
      const isSouthamptonImage =
        deckRooms.southampton &&
        deckRooms.southampton.some((r) => r.location.chatRoom === roomName);
      const folder = isSouthamptonImage ? "southampton" : "britannic";
      imageSet.forEach((imageName) => {
        this.preload(`/images/animations/locations/${folder}/${imageName}`);
      });

      // Preload time-of-day variants if present (e.g., ms or night)
      const variants = roomImages[roomName].variants || {};
      console.debug(
        `🖼️ Preloading variant folders for ${roomName}:`,
        Object.keys(variants),
      );
      Object.keys(variants).forEach((key) => {
        // Map variant key to folder name if necessary
        const variantFolder =
          key === "ms"
            ? "britannic (sunset)"
            : key === "night"
              ? "britannic (night)"
              : "britannic";
        variants[key].forEach((vImage) => {
          // The browser encodes the space in a plain path the same way, so one request does
          this.preload(
            `/images/animations/locations/${encodeURIComponent(variantFolder)}/${vImage}`,
          );
        });
      });
    },

    cycleImage(roomName) {
      if (!roomImages[roomName]) return false;
      const roomData = roomImages[roomName];
      const canvasCtx = ensureLocationCanvas();
      if (!canvasCtx) return false;

      // Determine active variant and target images
      const currentBST = getBSTTime();
      const activeInterval = imageIntervals.find(
        (iv) =>
          currentBST.getHours() >= iv.start && currentBST.getHours() <= iv.end,
      );

      let targetImages = roomData.images;
      let isMsVariant = false;

      if (
        activeInterval &&
        activeInterval.className.startsWith("ms") &&
        roomData.variants &&
        roomData.variants.ms &&
        roomData.variants.ms.length > 0
      ) {
        targetImages = roomData.variants.ms;
        isMsVariant = true;
      }

      // Calculate next index and update immediately
      const previousIndex = roomData.currentIndex;
      roomData.currentIndex = (roomData.currentIndex + 1) % targetImages.length;
      const newImage = targetImages[roomData.currentIndex];

      console.debug(
        `🔄 Cycling room image to: ${newImage} (${roomData.currentIndex + 1}/${
          targetImages.length
        })`,
      );

      // Set new image source right away
      // Check if this is a Southampton location
      const isSouthamptonImage =
        deckRooms.southampton &&
        deckRooms.southampton.some((r) => r.location.chatRoom === roomName);

      if (isMsVariant) {
        const candidateFolders = [
          "britannic (sunset)",
          encodeURIComponent("britannic (sunset)"),
          "britannic",
        ];
        let msTried = 0;
        const msTryNext = () => {
          if (msTried >= candidateFolders.length) {
            console.warn(
              `⚠️ All MS variants failed for ${roomName}, leaving default`,
              candidateFolders,
            );
            // Revert index on error
            roomData.currentIndex = previousIndex;
            return;
          }
          const folder = candidateFolders[msTried++];
          const msPath = `/images/animations/locations/${folder}/${newImage}`;
          console.debug(`🔁 Trying MS variant path: ${msPath}`);
          drawLocationImage(msPath, false, {
            onLoad: () => console.debug(`✅ Loaded MS variant ${msPath}`),
            onError: () => {
              console.warn(`❌ Failed to load MS variant ${msPath}`);
              msTryNext();
            },
          });
        };
        msTryNext();
      } else {
        const newImagePath = isSouthamptonImage
          ? `/images/animations/locations/southampton/${newImage}`
          : `/images/animations/locations/britannic/${newImage}`;

        drawLocationImage(newImagePath, false, {
          onLoad: () => {
            console.debug(`✅ Loaded ${newImagePath}`);
          },
          onError: () => {
            console.error(`❌ Failed to load image: ${newImagePath}`);
            addChatMessage({
              type: "system",
              message: `There was a problem changing the view.`,
              room: roomName,
              timestamp: Date.now(),
            });
            roomData.currentIndex = previousIndex;
          },
        });
      }

      return true;
    },
  };

  document.addEventListener("DOMContentLoaded", function () {
    const nameElement = document.getElementById("character-name");
    const characterData = JSON.parse(sessionStorage.getItem("character"));

    if (characterData && nameElement) {
      nameElement.textContent = `${characterData.forename} ${characterData.surname}`;
      nameElement.style.cursor = "pointer"; // Indicate clickability
      nameElement.addEventListener("click", showProfilePopup);
    }

    // Function to show the profile popup
    function showProfilePopup() {
      const characterData = JSON.parse(sessionStorage.getItem("character"));
      if (!characterData) {
        console.error("No character data found.");
        return;
      }

      const profilePopup = document.getElementById("profile-popup");
      const avatarImg = document.getElementById("profile-avatar-img");
      const nameElement = document.getElementById("profile-name");
      const dobElement = document.getElementById("profile-dob");
      const bioElement = document.getElementById("profile-bio");

      // Populate avatar
      avatarImg.src = characterData.avatar || "/images/default-avatar.png";

      // Populate name
      nameElement.textContent = `${characterData.forename} ${characterData.surname}`;

      // Populate and format date of birth
      if (characterData.birthdate) {
        const birthDate = new Date(characterData.birthdate);
        dobElement.textContent = birthDate.toLocaleDateString("en-GB", {
          year: "numeric",
          month: "long",
          day: "numeric",
        });
      } else {
        dobElement.textContent = "Not given";
      }

      // Populate bio
      bioElement.textContent = characterData.bio || "No biography provided.";

      // Display the popup
      profilePopup.style.display = "block";
    }

    // Close popup with close button
    document.querySelector(".close-profile").addEventListener("click", () => {
      document.getElementById("profile-popup").style.display = "none";
    });

    // Close popup when clicking outside
    window.addEventListener("click", (event) => {
      const profilePopup = document.getElementById("profile-popup");
      if (event.target === profilePopup) {
        profilePopup.style.display = "none";
      }
    });
  });

  // Video Poker Game
  const videoPokerBtn = document.getElementById("video-poker-btn");
  const videoPokerPopup = document.getElementById("video-poker-popup");
  const closeVideoPokerBtn = document.querySelector(".close-video-poker");
  const dealDrawBtn = document.getElementById("deal-draw-btn");
  const vpHoldBtn = document.getElementById("vp-hold-btn");
  const handRanking = document.querySelector(".hand-ranking");
  const vpStatus = document.querySelector(".vp-status");
  const vpCards = document.querySelectorAll(".vp-card");

  // Poker game state
  const vpBetSelect = document.getElementById("vp-bet-select");

  const videoPoker = {
    hand: [],
    held: [false, false, false, false, false],
    phase: "idle",
    currentBet: 0,

    init() {
      this.phase = "idle";
      this.held = [false, false, false, false, false];
      this.currentBet = 0;
      dealDrawBtn.textContent = "Deal";
      if (vpHoldBtn) vpHoldBtn.style.opacity = "0.5";
      if (vpBetSelect) vpBetSelect.disabled = false;
      handRanking.textContent = "";
      handRanking.classList.remove("win");
      if (vpStatus) vpStatus.textContent = "Press Deal to begin";

      // Reset all cards to card-back
      vpCards.forEach((card) => {
        card.classList.add("card-back");
        card.classList.remove("held", "dealing");
        const rank = card.querySelector(".rank");
        const suit = card.querySelector(".suit");
        if (rank) rank.textContent = "";
        if (suit) suit.textContent = "";
      });
    },

    updateCardDisplay() {
      for (let i = 0; i < 5; i++) {
        const card = document.querySelector(`.vp-card[data-index="${i}"]`);
        const rank = card.querySelector(".rank");
        const suit = card.querySelector(".suit");

        if (this.hand[i]) {
          card.classList.remove("card-back");
          rank.textContent = this.hand[i].rank;
          suit.textContent = this.hand[i].symbol;
          // The server sends "red" or "black"; print them in card inks
          const ink = this.hand[i].color === "red" ? "#a8151c" : "#1c1712";
          rank.style.color = ink;
          suit.style.color = ink;
          if (this.phase !== "deal" || !this.held[i]) {
            card.classList.add("dealing");
            setTimeout(() => card.classList.remove("dealing"), 400);
          }
          card.classList.toggle("held", this.held[i]);
        }
      }
    },

    toggleHold(index) {
      if (this.phase !== "deal") return;
      this.held[index] = !this.held[index];
      const card = document.querySelector(`.vp-card[data-index="${index}"]`);
      card.classList.toggle("held", this.held[index]);
    },
  };

  // Initialize video poker button event
  if (videoPokerBtn) {
    videoPokerBtn.addEventListener("click", () => {
      openVideoPokerGame();
    });
  }

  // Close poker popup when close button is clicked
  if (closeVideoPokerBtn) {
    closeVideoPokerBtn.addEventListener("click", () => {
      videoPokerPopup.style.display = "none";
    });
  }

  // "Deal" button — sends bet to server, waits for dealt hand
  dealDrawBtn.addEventListener("click", () => {
    const betAmount = parseFloat(vpBetSelect ? vpBetSelect.value : 0);
    if (betAmount > 0 && playerMoney < betAmount) {
      if (vpStatus) vpStatus.textContent = "Not enough money for that bet";
      return;
    }
    dealDrawBtn.disabled = true;
    socket.emit("poker-deal", { bet: betAmount });
  });

  // Server dealt cards
  socket.on("poker-dealt", ({ hand, money }) => {
    playerMoney = money;
    updateMoneyDisplay();
    videoPoker.hand = hand;
    videoPoker.phase = "deal";
    videoPoker.held = [false, false, false, false, false];
    videoPoker.updateCardDisplay();
    dealDrawBtn.textContent = "Deal";
    dealDrawBtn.disabled = false;
    if (vpHoldBtn) vpHoldBtn.style.opacity = "1";
    if (vpBetSelect) vpBetSelect.disabled = true;
    handRanking.textContent = "";
    handRanking.classList.remove("win");
    const betAmount = parseFloat(vpBetSelect ? vpBetSelect.value : 0);
    if (vpStatus)
      vpStatus.textContent =
        betAmount > 0
          ? `Bet: £${betAmount.toFixed(2)} — choose cards to hold, then press Draw`
          : "Choose cards to hold, then press Draw";
  });

  socket.on("poker-error", ({ message }) => {
    if (vpStatus) vpStatus.textContent = message;
    dealDrawBtn.disabled = false;
  });

  // "Draw" button — sends held cards to server, waits for result
  if (vpHoldBtn) {
    vpHoldBtn.addEventListener("click", () => {
      if (videoPoker.phase !== "deal") return;
      vpHoldBtn.disabled = true;
      socket.emit("poker-hold", { held: [...videoPoker.held] });
    });
  }

  // Server evaluated the hand
  socket.on(
    "poker-result",
    ({ hand, rank, multiplier, winnings, bet, money }) => {
      playerMoney = money;
      updateMoneyDisplay();
      videoPoker.hand = hand;
      videoPoker.phase = "idle";
      videoPoker.updateCardDisplay();
      if (vpHoldBtn) {
        vpHoldBtn.style.opacity = "0.5";
        vpHoldBtn.disabled = false;
      }
      if (vpBetSelect) vpBetSelect.disabled = false;

      handRanking.textContent = rank;
      const isWin = multiplier > 0;
      handRanking.classList.toggle("win", isWin);

      // .hand-ranking already names the hand; the status gives the money
      if (isWin && bet > 0) {
        if (vpStatus) vpStatus.textContent = `You win £${winnings.toFixed(2)}`;
      } else if (bet > 0) {
        if (vpStatus) vpStatus.textContent = `You lose £${bet.toFixed(2)}`;
      } else {
        if (vpStatus)
          vpStatus.textContent = isWin ? "A winning hand" : "No win";
      }
    },
  );

  // Card click event for selecting holds
  vpCards.forEach((card) => {
    card.addEventListener("click", () => {
      const index = parseInt(card.getAttribute("data-index"));
      videoPoker.toggleHold(index);
    });
  });

  function openVideoPokerGame() {
    if (!videoPokerPopup) return;
    // Move poker popup into location-display so it overlays the room image
    const locationDisplay = document.querySelector(".location-display");
    if (locationDisplay && !locationDisplay.contains(videoPokerPopup)) {
      locationDisplay.appendChild(videoPokerPopup);
    }
    videoPokerPopup.style.display = "block";
    videoPoker.init();
  }

  const gamesToggleBtn = document.getElementById("games-toggle-btn");
  if (gamesToggleBtn) {
    gamesToggleBtn.addEventListener("click", () => {
      const existingPopup = document.querySelector(".games-popup");
      if (existingPopup) {
        existingPopup.remove();
        gamesToggleBtn.textContent = "Games";
      } else {
        showGamesOptions();
        gamesToggleBtn.textContent = "Close Games";
      }
    });
  }

  function showGamesOptions() {
    const existingPopup = document.querySelector(".games-popup");
    if (existingPopup) {
      existingPopup.remove();
    }

    const locationDisplay = document.querySelector(".location-display");
    if (!locationDisplay) return;

    const popup = document.createElement("div");
    popup.className = "games-popup";
    popup.innerHTML = `
      <div class="gp-icons">
        <button class="gp-icon" type="button" data-game="video-poker" data-label="Poker">
          <span class="material-icons">casino</span>
        </button>
      </div>
      <div class="gp-tooltip" style="display:none"></div>
    `;

    // Tooltip on hover
    popup.querySelectorAll(".gp-icon").forEach((btn) => {
      btn.addEventListener("mouseenter", () => {
        const tip = popup.querySelector(".gp-tooltip");
        tip.textContent = btn.dataset.label;
        tip.style.display = "block";
      });
      btn.addEventListener("mouseleave", () => {
        popup.querySelector(".gp-tooltip").style.display = "none";
      });
    });

    locationDisplay.appendChild(popup);

    const pokerCard = popup.querySelector('[data-game="video-poker"]');
    if (pokerCard) {
      pokerCard.addEventListener("click", () => {
        popup.remove();
        if (gamesToggleBtn) {
          gamesToggleBtn.textContent = "Games";
        }
        openVideoPokerGame();
        console.debug("🎰 Video Poker launched from games popup");
      });
    }
  }

  // Eat/Drink button functionality (toggle menu)
  const eatDrinkBtn = document.getElementById("eat-drink-btn");
  if (eatDrinkBtn) {
    eatDrinkBtn.addEventListener("click", () => {
      const existingPopup = document.querySelector(".eat-drink-popup");
      if (existingPopup) {
        existingPopup.remove();
        eatDrinkBtn.textContent =
          eatDrinkBtn.dataset.tobaccoOnly === "true"
            ? "Tobacco"
            : "Eat & Drink";
      } else {
        const onlyTobacco = eatDrinkBtn.dataset.tobaccoOnly === "true";
        showEatDrinkOptions(onlyTobacco);
        eatDrinkBtn.textContent = "Close Menu";
      }
    });
  }

  // Function to show eat/drink options
  function showEatDrinkOptions(onlyTobacco = false) {
    const popup = document.createElement("div");
    popup.className = "eat-drink-popup";

    const tobaccoOnlySidebar = `
          <div class="edm-category" data-category="tobacco">
            <div class="edm-category-header">
              <span class="edm-arrow">▼</span> Tobacco
            </div>
            <div class="edm-subcategories" style="display:flex">
              <div class="edm-subcat-btn active" data-top="tobacco" data-sub="all">All</div>
              <div class="edm-subcat-btn" data-top="tobacco" data-sub="cigars">Cigars</div>
              <div class="edm-subcat-btn" data-top="tobacco" data-sub="pipes">Pipes</div>
              <div class="edm-subcat-btn" data-top="tobacco" data-sub="cigarettes">Cigarettes</div>
            </div>
          </div>
    `;

    const fullSidebar = `
          <div class="edm-category" data-category="food">
            <div class="edm-category-header">
              <span class="edm-arrow">▼</span> Food
            </div>
            <div class="edm-subcategories" style="display:flex">
              <div class="edm-subcat-btn active" data-top="food" data-sub="all">All</div>
              <div class="edm-subcat-btn" data-top="food" data-sub="entree">Entrée</div>
              <div class="edm-subcat-btn" data-top="food" data-sub="light_meal">Light Meal</div>
              <div class="edm-subcat-btn" data-top="food" data-sub="side">Side</div>
              <div class="edm-subcat-btn" data-top="food" data-sub="fruit">Fruit</div>
              <div class="edm-subcat-btn" data-top="food" data-sub="ice_cream">Ice Cream</div>
              <div class="edm-subcat-btn" data-top="food" data-sub="cakes">Cakes</div>
              <div class="edm-subcat-btn" data-top="food" data-sub="desserts">Desserts</div>
            </div>
          </div>
          <div class="edm-category" data-category="soft_beverages">
            <div class="edm-category-header">
              <span class="edm-arrow">▶</span> Soft Beverages
            </div>
            <div class="edm-subcategories">
              <div class="edm-subcat-btn active" data-top="soft_beverages" data-sub="all">All</div>
              <div class="edm-subcat-btn" data-top="soft_beverages" data-sub="common">Common</div>
              <div class="edm-subcat-btn" data-top="soft_beverages" data-sub="tea">Tea</div>
              <div class="edm-subcat-btn" data-top="soft_beverages" data-sub="coffee">Coffee</div>
              <div class="edm-subcat-btn" data-top="soft_beverages" data-sub="juice">Juice</div>
              <div class="edm-subcat-btn" data-top="soft_beverages" data-sub="hot_beverages">Hot Beverages</div>
            </div>
          </div>
          <div class="edm-category" data-category="alcoholic_beverages">
            <div class="edm-category-header">
              <span class="edm-arrow">▶</span> Alcoholic Beverages
            </div>
            <div class="edm-subcategories">
              <div class="edm-subcat-btn active" data-top="alcoholic_beverages" data-sub="all">All</div>
              <div class="edm-subcat-btn" data-top="alcoholic_beverages" data-sub="beer">Beer</div>
              <div class="edm-subcat-btn" data-top="alcoholic_beverages" data-sub="cocktails">Cocktails</div>
              <div class="edm-subcat-btn" data-top="alcoholic_beverages" data-sub="wines_and_champagne">Wines & Champagne</div>
              <div class="edm-subcat-btn" data-top="alcoholic_beverages" data-sub="spirits">Spirits</div>
            </div>
          </div>
          <div class="edm-category" data-category="tobacco">
            <div class="edm-category-header">
              <span class="edm-arrow">▶</span> Tobacco
            </div>
            <div class="edm-subcategories">
              <div class="edm-subcat-btn active" data-top="tobacco" data-sub="all">All</div>
              <div class="edm-subcat-btn" data-top="tobacco" data-sub="cigars">Cigars</div>
              <div class="edm-subcat-btn" data-top="tobacco" data-sub="pipes">Pipes</div>
              <div class="edm-subcat-btn" data-top="tobacco" data-sub="cigarettes">Cigarettes</div>
            </div>
          </div>
    `;

    popup.innerHTML = `
      <div class="edm-body">
        <div class="edm-sidebar">
          ${onlyTobacco ? tobaccoOnlySidebar : fullSidebar}
        </div>
        <div class="edm-content">
          <div class="edm-items-grid"></div>
        </div>
      </div>
      <div class="edm-tooltip" style="display:none"></div>
    `;

    // Remove any existing popup
    const existingPopup = document.querySelector(".eat-drink-popup");
    if (existingPopup) existingPopup.remove();

    const locationDisplay = document.querySelector(".location-display");
    locationDisplay.appendChild(popup);

    const itemsGrid = popup.querySelector(".edm-items-grid");
    const tooltip = popup.querySelector(".edm-tooltip");

    // --- Render items into grid ---
    function renderItems(topCategory, subCategory) {
      itemsGrid.innerHTML = "";
      if (typeof MENU_DATA === "undefined") return;

      const filtered = MENU_DATA.filter((item) => {
        if (item.topCategory !== topCategory) return false;
        if (subCategory !== "all" && item.subCategory !== subCategory)
          return false;
        return true;
      });

      filtered.forEach((item) => {
        const card = document.createElement("div");
        card.className = "edm-item-card";
        card.innerHTML = `
          <img src="${item.localImage}" alt="${item.name}" onerror="this.onerror=null;this.src='${item.image}'" />
          <span class="edm-item-name">${item.name}</span>
        `;

        // Tooltip on hover
        card.addEventListener("mouseenter", (e) => {
          const desc = item.description.replace(/\n/g, "<br>");
          let statsHtml = "";
          if (item.hungry)
            statsHtml += `<span class="edm-stat edm-stat-hunger"><span class="material-icons">restaurant</span> ${item.hungry > 0 ? "+" : ""}${item.hungry}</span>`;
          if (item.thirsty)
            statsHtml += `<span class="edm-stat edm-stat-thirst"><span class="material-icons">water_drop</span> ${item.thirsty > 0 ? "+" : ""}${item.thirsty}</span>`;
          if (item.drunk)
            statsHtml += `<span class="edm-stat edm-stat-drunk"><span class="material-icons">sports_bar</span> ${item.drunk > 0 ? "+" : ""}${item.drunk}</span>`;
          if (item.warm)
            statsHtml += `<span class="edm-stat edm-stat-warm"><span class="material-icons">local_fire_department</span> ${item.warm > 0 ? "+" : ""}${item.warm}</span>`;
          if (item.price)
            statsHtml += `<span class="edm-stat edm-stat-price"><span class="material-icons">payments</span> £${Number(item.price).toFixed(2)}</span>`;

          tooltip.innerHTML = `
            <div class="edm-tooltip-title">${item.name}</div>
            <div class="edm-tooltip-desc">${desc}</div>
            ${statsHtml ? `<div class="edm-tooltip-stats">${statsHtml}</div>` : ""}
          `;
          tooltip.style.display = "block";
        });

        card.addEventListener("mouseleave", () => {
          tooltip.style.display = "none";
        });

        // Click to consume
        card.addEventListener("click", () => {
          consumeItem(item);
        });

        itemsGrid.appendChild(card);
      });

      if (filtered.length === 0) {
        itemsGrid.innerHTML =
          '<div class="edm-no-items">No items available</div>';
      }
    }

    // --- Consume item ---
    function consumeItem(item) {
      // Free items — apply immediately
      if (!item.price || item.price <= 0) {
        applyConsumption(item);
        return;
      }

      // Paid items — server validates and deducts money
      if (playerMoney < item.price) {
        console.debug(`💰 Cannot afford ${item.name} (£${item.price})`);
        return;
      }

      socket.emit("purchase-item", {
        itemKey: menuItemKey(item),
        topCategory: item.topCategory,
        subCategory: item.subCategory,
        name: item.name,
      });
      socket.once("purchase-result", (result) => {
        if (!result.success) {
          console.debug(`💰 Purchase denied: ${result.message}`);
          return;
        }
        if (typeof result.money === "number") {
          playerMoney = result.money;
          updateMoneyDisplay();
        }
        applyConsumption(item);
      });
    }

    function applyConsumption(item) {
      playConsumptionSound(item);

      if (item.hungry) {
        statusBars.hunger.value = Math.min(
          100,
          statusBars.hunger.value + item.hungry,
        );
        const bar = document.querySelector(".bar.hunger");
        if (bar) {
          bar.style.width = `${statusBars.hunger.value}%`;
          bar.style.setProperty(
            "--hunger-hue",
            (statusBars.hunger.value / 100) * 120,
          );
        }
      }
      if (item.thirsty) {
        statusBars.thirst.value = Math.min(
          100,
          statusBars.thirst.value + item.thirsty,
        );
        const bar = document.querySelector(".bar.thirst");
        if (bar) {
          bar.style.width = `${statusBars.thirst.value}%`;
          bar.style.setProperty(
            "--thirst-hue",
            (statusBars.thirst.value / 100) * 120,
          );
        }
      }
      if (item.drunk && statusBars.intoxication) {
        statusBars.intoxication.value = Math.min(
          100,
          statusBars.intoxication.value + item.drunk,
        );
        const bar = document.querySelector(".bar.intoxication");
        if (bar) {
          bar.style.width = `${statusBars.intoxication.value}%`;
          bar.style.setProperty(
            "--intoxication-hue",
            120 - (statusBars.intoxication.value / 100) * 120,
          );
        }
      }

      console.debug(
        `🍽️ Consumed ${item.name} | hunger:${item.hungry} thirst:${item.thirsty} drunk:${item.drunk}`,
      );
      saveStatsToServer();
    }

    // Default open category depends on outdoor/tobacco-only mode
    if (onlyTobacco) {
      const tobaccoCat = popup.querySelector('[data-category="tobacco"]');
      if (tobaccoCat) tobaccoCat.classList.add("open");
      renderItems("tobacco", "all");
    } else {
      const foodCat = popup.querySelector('[data-category="food"]');
      if (foodCat) foodCat.classList.add("open");
      renderItems("food", "all");
    }

    // Accordion category toggling
    const categories = popup.querySelectorAll(".edm-category");
    categories.forEach((cat) => {
      const header = cat.querySelector(".edm-category-header");
      const arrow = cat.querySelector(".edm-arrow");
      const subcats = cat.querySelector(".edm-subcategories");
      const topCat = cat.dataset.category;

      header.addEventListener("click", () => {
        const isOpen = cat.classList.contains("open");

        // Close all categories
        categories.forEach((c) => {
          c.classList.remove("open");
          c.querySelector(".edm-arrow").textContent = "▶";
          c.querySelector(".edm-subcategories").style.display = "none";
        });

        // Toggle clicked category
        if (!isOpen) {
          cat.classList.add("open");
          arrow.textContent = "▼";
          subcats.style.display = "flex";

          // Reset subcategory filter to "All"
          const subBtns = subcats.querySelectorAll(".edm-subcat-btn");
          subBtns.forEach((b) => b.classList.remove("active"));
          subBtns[0].classList.add("active");

          renderItems(topCat, "all");
        }
      });

      // Subcategory filtering
      const subBtns = cat.querySelectorAll(".edm-subcat-btn");
      subBtns.forEach((btn) => {
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          subBtns.forEach((b) => b.classList.remove("active"));
          btn.classList.add("active");
          renderItems(btn.dataset.top, btn.dataset.sub);
        });
      });
    });
  }

  // Room Player List functionality
  const roomPlayersBtn = document.getElementById("players-btn");
  const roomPlayersPopup = document.getElementById("players-popup");
  const roomPlayersDrawer = document.getElementById("players-drawer");
  const locationDisplay = document.querySelector(".location-display");

  if (
    locationDisplay &&
    roomPlayersDrawer &&
    roomPlayersDrawer.parentElement !== locationDisplay
  ) {
    locationDisplay.appendChild(roomPlayersDrawer);
  }

  function setRoomPlayersCount(count = 0) {
    if (!roomPlayersBtn) return;
    const total = Math.max(0, Number(count) || 0);
    const label = `${total} Passenger${total === 1 ? "" : "s"}`;
    const countText = roomPlayersBtn.querySelector(".players-count-text");

    if (countText) {
      countText.textContent = label;
    } else {
      roomPlayersBtn.textContent = label;
    }

    roomPlayersBtn.setAttribute("aria-label", label);
  }

  function formatPassengerBirthdate(birthdate) {
    if (!birthdate) return "";
    const date = new Date(birthdate);
    if (Number.isNaN(date.getTime())) return "";
    return date.toLocaleDateString("en-GB", {
      month: "long",
      day: "numeric",
      year: "numeric",
      timeZone: "UTC",
    });
  }

  function calculatePassengerAge(birthdate) {
    if (!birthdate) return null;
    const born = new Date(birthdate);
    if (Number.isNaN(born.getTime())) return null;
    const voyageDate = new Date("1912-04-10T12:00:00Z");
    let age = voyageDate.getUTCFullYear() - born.getUTCFullYear();
    const monthDiff = voyageDate.getUTCMonth() - born.getUTCMonth();
    if (
      monthDiff < 0 ||
      (monthDiff === 0 && voyageDate.getUTCDate() < born.getUTCDate())
    ) {
      age--;
    }
    return age;
  }

  function openPlayerInfo(player) {
    const playerInfoPopup = document.getElementById("player-info");
    const playerContent = document.getElementById("player-content");
    if (!playerInfoPopup || !playerContent || !player) return;

    const birthdateText = formatPassengerBirthdate(player.birthdate);
    const age = calculatePassengerAge(player.birthdate);
    const ageText = Number.isFinite(age) ? ` (${age})` : "";
    const bioText = player.bio || "No biography provided.";

    playerContent.innerHTML = DOMPurify.sanitize(`
      <div class="player-popup-header">
        <div class="player-popup-avatar">
          <img src="${player.avatar || "/images/default-avatar.png"}" alt="${player.name}" />
        </div>
        <div class="player-popup-meta">
          <div class="player-popup-name">${player.name}${ageText}</div>
          ${birthdateText ? `<div class="player-popup-birthdate">${birthdateText}</div>` : ""}
        </div>
      </div>
      <div class="player-popup-bio">${bioText}</div>
    `);

    playerInfoPopup.style.display = "flex";
  }

  // Function to request room players from server
  function requestRoomPlayers() {
    if (!socket || !currentRoom.name) {
      console.error(
        "❌ Cannot request room players: socket or room not available",
      );
      return;
    }

    console.debug(`👥 Requesting players for room: ${currentRoom.name}`);
    socket.emit("request-room-players", currentRoom.name);
  }

  // "1st_class_cabins" -> "First Class", as on the character card
  function passengerClassLabel(cabinType) {
    const type = String(cabinType || "");
    if (type.startsWith("1st_")) return "First Class";
    if (type.startsWith("2nd_")) return "Second Class";
    if (type.startsWith("3rd_")) return "Third Class";
    return "Passenger";
  }

  // Function to display room players in popup
  function displayRoomPlayers(players) {
    const playersList = document.getElementById("players-list");
    if (!playersList) {
      console.error("❌ Room players list element not found");
      return;
    }

    const playerCount = Array.isArray(players) ? players.length : 0;
    setRoomPlayersCount(playerCount);

    // Clear existing content
    playersList.innerHTML = "";

    if (!players || players.length === 0) {
      playersList.innerHTML =
        "<div class='no-players'>No passengers in this room</div>";
      return;
    }

    // Create player entries
    players.forEach((player) => {
      const playerDiv = document.createElement("div");
      playerDiv.className = "room-player-item";

      // Get character data from session storage to compare
      const currentCharacter = JSON.parse(sessionStorage.getItem("character"));
      const isCurrentPlayer =
        currentCharacter &&
        `${currentCharacter.forename} ${currentCharacter.surname}` ===
          player.name;

      playerDiv.innerHTML = DOMPurify.sanitize(`
        <button type="button" class="player-avatar player-avatar-button" aria-label="View bio for ${player.name}">
          <img src="${player.avatar || "/images/default-avatar.png"}" alt="${
            player.name
          }" />
        </button>
        <div class="player-info">
          <div class="player-name">${player.name}${
            isCurrentPlayer ? " (You)" : ""
          }</div>
          <div class="player-class">${passengerClassLabel(player.cabin)}</div>
          <div class="player-cabin">${
            player.cabin_number || player.cabin || "No cabin assigned"
          }</div>
        </div>
      `);

      const avatarButton = playerDiv.querySelector(".player-avatar-button");
      if (avatarButton) {
        avatarButton.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          openPlayerInfo(player);
        });
      }

      playersList.appendChild(playerDiv);
    });

    console.debug(`👥 Displayed ${players.length} players in room`);
  }

  setRoomPlayersCount(0);

  // Event listeners for room players button
  if (roomPlayersBtn && roomPlayersPopup) {
    roomPlayersBtn.addEventListener(
      "click",
      (event) => {
        event.stopPropagation();
        event.preventDefault();

        const willOpen = !roomPlayersPopup.classList.contains("open");
        roomPlayersDrawer?.classList.toggle("open", willOpen);
        roomPlayersDrawer?.setAttribute(
          "aria-expanded",
          willOpen ? "true" : "false",
        );
        roomPlayersPopup.classList.toggle("open", willOpen);
        roomPlayersPopup.setAttribute(
          "aria-hidden",
          willOpen ? "false" : "true",
        );
        roomPlayersBtn.classList.toggle("open", willOpen);
        roomPlayersBtn.setAttribute(
          "aria-expanded",
          willOpen ? "true" : "false",
        );

        if (willOpen) {
          requestRoomPlayers();
        }

        console.debug(
          `👥 Room players panel ${willOpen ? "opened" : "closed"}`,
        );
      },
      true,
    );
  }

  // Close player info popup
  const closePlayerInfoBtn = document.querySelector(".close-player-info");
  const playerInfoPopup = document.getElementById("player-info");
  if (closePlayerInfoBtn) {
    closePlayerInfoBtn.addEventListener("click", () => {
      if (playerInfoPopup) {
        playerInfoPopup.style.display = "none";
        console.debug("👤 Player info popup closed");
      }
    });
  }

  if (playerInfoPopup) {
    playerInfoPopup.addEventListener("click", (event) => {
      if (event.target === playerInfoPopup) {
        playerInfoPopup.style.display = "none";
        console.debug("👤 Player info popup closed from backdrop");
      }
    });
  }

  // Close room players popup when clicking outside
  window.addEventListener("click", (event) => {
    if (
      roomPlayersPopup &&
      roomPlayersPopup.classList.contains("open") &&
      !(roomPlayersDrawer && roomPlayersDrawer.contains(event.target))
    ) {
      roomPlayersDrawer?.classList.remove("open");
      roomPlayersDrawer?.setAttribute("aria-expanded", "false");
      roomPlayersPopup.classList.remove("open");
      roomPlayersPopup.setAttribute("aria-hidden", "true");
      roomPlayersBtn?.classList.remove("open");
      roomPlayersBtn?.setAttribute("aria-expanded", "false");
      console.debug("👥 Room players popup closed by clicking outside");
    }
  });

  // Socket listener for room players response
  if (socket) {
    socket.on("room-players", (data) => {
      console.debug("👥 Received room players data:", data);
      if (data.roomId === currentRoom.name) {
        displayRoomPlayers(data.players);
      }
    });
  }

  // Departure Sequence
  const DEPARTURE_SEQUENCE_ENABLED = true;
  let departureStarted = false;
  let currentSpeed = 0; // pixels per frame (60fps)
  let targetSpeed = 7 / 60; // 7 pixels per second = 7/60 pixels per frame
  let departurePosition = 0;

  function startDepartureSequence() {
    if (!DEPARTURE_SEQUENCE_ENABLED) {
      console.debug("🚧 Departure sequence disabled for testing");
      return;
    }
    if (departureStarted) return;
    departureStarted = true;

    console.debug("🚢 Starting departure sequence...");

    // Only teleport if player is in Southampton
    let shouldTeleport = false;
    if (typeof isPlayerInSouthampton === "function") {
      shouldTeleport = isPlayerInSouthampton();
    } else if (window.currentRoom && deckRooms && deckRooms.southampton) {
      // currentRoom.name stores chatRoom; compare to Southampton rooms' chatRoom
      shouldTeleport = deckRooms.southampton.some(
        (r) => r.location && r.location.chatRoom === currentRoom.name,
      );
    }
    console.debug("🧭 Teleport check:", { shouldTeleport, currentRoom });
    if (shouldTeleport) {
      // Prefer using enterRoom with a real room object
      const target =
        (deckRooms.boat || deckRooms.bd || deckRooms["boat_deck"])?.find?.(
          (r) => r.id === "port_promenade_bd",
        ) ||
        deckRooms?.a?.find?.((r) => r.id === "port_promenade_bd") ||
        null;
      if (target && typeof enterRoom === "function") {
        enterRoom(target);
      } else {
        // Fallback: construct minimal room shape compatible with enterRoom
        const fallbackRoom = {
          id: "port_promenade_bd",
          name: "1st Class Port Promenade",
          location: {
            chatRoom: "port_promenade_bd",
            image: "first class promenade.webp",
          },
        };
        if (typeof enterRoom === "function") enterRoom(fallbackRoom);
      }
    }

    // Play whistle sound
    const whistleSound = new Audio("/sounds/whistle.mp3");
    whistleSound.volume = 0.7;
    whistleSound.play();
    console.debug("📯 Playing ship whistle...");

    // Start "Leaving Port" music midway through whistle (assuming whistle is ~3 seconds)
    setTimeout(() => {
      const primarySrc = "/sounds/music (not in game)/Leaving Port.mp3";
      const fallbackSrc =
        "/sounds/music/[TITANIC] - Leaving Port (Complete Score _ Film Version) - RadioKidCharlemagne (youtube).mp3";

      musicPlayer.playEventMusic(primarySrc, {
        fallbackSrc,
        volume: 0.5,
        fadeOutMs: 2000,
        fadeInMs: 3000,
      });
    }, 1500); // 1.5 seconds into whistle

    // Start ship movement animation
    animateDeparture();
  }

  function animateDeparture() {
    const southamptonCity = document.querySelector(".southampton-city");
    const dock = document.querySelector(".location.dock");
    const waves = document.querySelector(".waves");
    const water = document.querySelector(".water");
    const swater = document.querySelector(".swater");
    const isleOfWight = document.querySelector(".isle-of-wight");
    const cherbourg = document.querySelector(".cherbourg-night");
    const landMiddle = document.querySelector(".land-middle");
    const landEnd = document.querySelector(".land-end");
    // Use container elements so JS only animates horizontal position
    // and doesn't clobber the yacht image transform used for scale/centering.
    const yacht1 = document.querySelector(".yacht-1-container");
    const yacht2 = document.querySelector(".yacht-2-container");
    const yacht3 = document.querySelector(".yacht-3-container");
    const DEPARTURE_DELAY_MS = TIMELINE_MS.DEPARTURE_DELAY;
    const SOUTHAMPTON_WATER_END_MS = TIMELINE_MS.SOUTHAMPTON_WATER_END;
    const NEEDLES_COMPLETE_MS = TIMELINE_MS.NEEDLES_COMPLETE;

    if (!southamptonCity || !dock) {
      console.warn("⚠️ Southampton elements not found for departure");
      return;
    }

    let southamptonElementsHidden = false;
    const hideSouthamptonVisuals = (reason = "timeline-sync") => {
      if (southamptonElementsHidden) return;
      southamptonElementsHidden = true;
      [southamptonCity, dock].forEach((el) => {
        if (el) {
          el.style.display = "none";
        }
      });
      console.debug(`🌊 Southampton scenery hidden (${reason})`);
    };

    const maybeHideSouthamptonVisuals = (
      elapsedVoyageMs,
      reason = "timeline-sync",
    ) => {
      if (southamptonElementsHidden) return;
      const elapsedSinceDepartureMs = Math.max(
        0,
        elapsedVoyageMs - DEPARTURE_DELAY_MS,
      );
      if (elapsedSinceDepartureMs >= SOUTHAMPTON_WATER_END_MS) {
        hideSouthamptonVisuals(reason);
      }
    };

    let coastalTerrainHidden = false;
    const hideCoastalTerrain = (reason = "timeline-sync") => {
      if (coastalTerrainHidden) return;
      coastalTerrainHidden = true;
      [landMiddle, landEnd].forEach((el) => {
        if (el) {
          el.style.opacity = "0";
          el.style.display = "none";
        }
      });
      console.debug(`🌫️ Coastal terrain hidden (${reason})`);
    };

    const maybeHideCoastalTerrain = (
      elapsedVoyageMs,
      reason = "timeline-sync",
    ) => {
      if (coastalTerrainHidden) return;
      const elapsedSinceDepartureMs = Math.max(
        0,
        elapsedVoyageMs - DEPARTURE_DELAY_MS,
      );
      if (elapsedSinceDepartureMs >= NEEDLES_COMPLETE_MS) {
        hideCoastalTerrain(reason);
      }
    };

    // Make land_middle scroll like waves
    if (landMiddle) {
      landMiddle.classList.add("scrolling");
    }

    const DEPARTURE_START = 0;
    const SOUTHAMPTON_WATER_END = TIMELINE_MS.SOUTHAMPTON_WATER_END;
    const NEEDLES_PASS = TIMELINE_MS.NEEDLES_PASS;
    const NEEDLES_COMPLETE = TIMELINE_MS.NEEDLES_COMPLETE;
    const CHANNEL_COMPLETE = TIMELINE_MS.CHANNEL_COMPLETE;
    const APPROACH_COMPLETE = TIMELINE_MS.APPROACH_COMPLETE;
    const BERTHING_COMPLETE = TIMELINE_MS.BERTHING_COMPLETE;
    const LAND_END_START = TIMELINE_MS.NEEDLES_PASS - 60 * 1000;

    const acceleration = SHIP_ACCELERATION;

    // Use server voyage time for synchronization
    const startTime = v.voyageStartTime || Date.now(); // Use server time if available
    const elapsedAtStart = v.voyageStartTime ? getElapsedSeconds() * 1000 : 0; // How much time has already passed
    maybeHideSouthamptonVisuals(elapsedAtStart, "late-join bootstrap");
    maybeHideCoastalTerrain(elapsedAtStart, "late-join bootstrap");

    // Calculate initial speed and positions from SERVER STATE, not local calculations
    let currentSpeed = 0; // Will be set by server or calculated below
    let targetSpeed = 6; // Will be set by server or calculated below

    // If we have server-provided speed, use it immediately
    if (typeof window.currentSpeed === "number") {
      currentSpeed = window.currentSpeed;
    } else {
      // Fallback if server speed not yet received
      if (
        elapsedSinceDeparture >= 1200 &&
        elapsedSinceDeparture < CHANNEL_COMPLETE / 1000
      ) {
        currentSpeed = 19;
      }
    }
    if (typeof window.targetSpeed === "number") {
      targetSpeed = window.targetSpeed;
    }

    // Calculate initial positions based on elapsed time (for late joiners)
    // Southampton should be fully off-screen after ~20 minutes
    let departurePosition = 0;
    let wavesPosition = 0;
    const SCENE_WIDTH = 1920; // Fixed scene width for calculations

    const getCherbourgWidth = () => {
      if (!cherbourg) return SCENE_WIDTH;
      // Get the current scale factor to normalize width
      const root = document.documentElement;
      const scale =
        parseFloat(getComputedStyle(root).getPropertyValue("--scale")) || 1;

      const rectWidth = cherbourg.getBoundingClientRect().width;
      if (rectWidth > 0) return rectWidth / scale; // Return unscaled width

      const computedWidth = parseFloat(
        window.getComputedStyle(cherbourg).width || "",
      );
      if (!Number.isNaN(computedWidth) && computedWidth > 0) {
        return computedWidth; // computed style is already unscaled (CSS pixels)
      }
      return SCENE_WIDTH * 0.85; // fall back to expected art width
    };

    const cherbourgOffscreenRight = () => {
      const width = getCherbourgWidth();
      const buffer = Math.max(50, width * 0.05); // keep extra margin offscreen
      return SCENE_WIDTH + width / 2 + buffer;
    };

    const computeCherbourgStart = () => {
      if (!cherbourg) {
        return cherbourgOffscreenRight();
      }
      // We want to start offscreen in the fixed coordinate system
      return cherbourgOffscreenRight();
    };

    let cherbourgPosition = computeCherbourgStart();
    let cherbourgArrived = false;

    if (cherbourg) {
      // Ensure hidden until approach logic deliberately reveals it
      cherbourg.style.opacity = "0";
      cherbourg.style.left = `${Math.round(cherbourgPosition)}px`;
    }

    if (elapsedAtStart > 0) {
      const elapsedSinceVoyageStart = elapsedAtStart / 1000;
      // Calculate elapsed time since DEPARTURE (not voyage start)
      // Departure happens at 720 seconds (12 minutes)
      const elapsedSinceDeparture = Math.max(
        0,
        elapsedSinceVoyageStart - TIMELINE_SECONDS.DEPARTURE_DELAY,
      );

      // Calculate position based on actual speed profile, not average speed
      // During acceleration (0-500s): position = 0.5 * acceleration * t^2
      // During constant speed: position = previous_position + speed * t

      const acceleration = 0.012; // knots per second
      const timeToReach6Knots = 6 / acceleration; // ~500 seconds

      if (elapsedSinceDeparture <= timeToReach6Knots) {
        // Still accelerating from 0 to 6 knots - use kinematic equation
        // position = 0.5 * a * t^2
        departurePosition =
          0.5 * acceleration * Math.pow(elapsedSinceDeparture, 2);
        wavesPosition = departurePosition;
        waterPosition = departurePosition;
        swaterPosition = departurePosition;
        landMiddlePosition = departurePosition;
        // If the player's session fast-forwarded into the Cherbourg window,
        // position the Cherbourg sprite according to elapsed progress so it
        // doesn't suddenly jump in from nowhere.
        if (
          typeof cherbourg !== "undefined" &&
          elapsedAtStart >= CHANNEL_COMPLETE
        ) {
          const elapsedSinceChannel =
            (elapsedAtStart - CHANNEL_COMPLETE) / 1000; // seconds
          const chDuration = (BERTHING_COMPLETE - CHANNEL_COMPLETE) / 1000; // seconds
          const progress = Math.min(1, elapsedSinceChannel / chDuration);
          const targetLeft = SCENE_WIDTH * 0.68;
          // If server-synchronized speed indicates we're still fast (> threshold)
          // keep Cherbourg off-screen for dramatic reveal while slowing.
          if (currentSpeed > v.CHERBOURG_SHOW_KNOTS) {
            cherbourgPosition = Math.max(
              cherbourgPosition,
              cherbourgOffscreenRight(),
            );
          } else {
            // Slow progress-based placement for late joiners when speed already below threshold
            cherbourgPosition =
              SCENE_WIDTH - progress * (SCENE_WIDTH - targetLeft);
          }
          if (progress >= 1) cherbourgArrived = true;
        }
      } else if (elapsedSinceDeparture < 1200) {
        // Reached 6 knots, now moving at constant speed
        // Position during acceleration: 0.5 * 0.012 * 500^2 = 1500
        const positionAtEndOfAcceleration =
          0.5 * acceleration * Math.pow(timeToReach6Knots, 2);
        const timeAtConstantSpeed = elapsedSinceDeparture - timeToReach6Knots;
        departurePosition =
          positionAtEndOfAcceleration + 6 * timeAtConstantSpeed;
        wavesPosition = departurePosition;
        waterPosition = departurePosition;
        swaterPosition = departurePosition;
        landMiddlePosition = departurePosition;
      } else {
        // Southampton is completely off-screen (after 20 minutes from departure)
        departurePosition = SCENE_WIDTH * 3; // Way off screen
        // Reset wave positions to 0 for infinite scroll to avoid large number issues
        wavesPosition = 0;
        waterPosition = 0;
        swaterPosition = 0;
        landMiddlePosition = elapsedSinceDeparture * 6;
      }

      console.debug(
        `🎬 Starting animation from position: ${departurePosition.toFixed(
          1,
        )}px (${Math.floor(
          elapsedSinceDeparture / 60,
        )}min since departure, speed=${currentSpeed.toFixed(1)}kts)`,
      );
    }
    // startTime already defined above - using server voyage time
    let lastTimestamp = Date.now();
    let isleOfWightPassing = false;
    let isleOfWightCompleted = false;
    let landEndStarted = false;
    let yachtTimers = [];

    // Yacht spawning system - yachts scroll from right to left like Isle of Wight
    const yachtElements = [yacht1, yacht2, yacht3];
    const activeYachts = []; // Track yachts currently crossing the screen

    const spawnYachtRandomly = () => {
      const elapsed = Date.now() - startTime;
      // Spawn yachts after Southampton departure and before Isle of Wight
      if (elapsed > SOUTHAMPTON_WATER_END && elapsed < NEEDLES_PASS) {
        // Pick a random yacht that isn't already active
        const availableYachts = yachtElements.filter(
          (yacht) => yacht && !activeYachts.find((a) => a.element === yacht),
        );

        if (availableYachts.length > 0) {
          const randomYacht =
            availableYachts[Math.floor(Math.random() * availableYachts.length)];
          const viewportWidth = window.innerWidth;

          // Add yacht to active list with initial position (off-screen right)
          activeYachts.push({
            element: randomYacht,
            position: viewportWidth,
            startPosition: viewportWidth, // Track where it started
          });

          randomYacht.classList.add("visible");
          randomYacht.style.opacity = "1";
          const rect = randomYacht.getBoundingClientRect();
          const innerImg =
            randomYacht.querySelector("img") ||
            randomYacht.querySelector(".southampton-yacht");
          const imgRect = innerImg ? innerImg.getBoundingClientRect() : null;
          const naturalW = innerImg ? innerImg.naturalWidth : -1;
          const naturalH = innerImg ? innerImg.naturalHeight : -1;
          // If the image has not yet finished loading and its natural size is 0,
          // add an onload hook so we can inspect its actual dimensions once loaded.
          if (
            innerImg &&
            innerImg.complete &&
            naturalW === 0 &&
            naturalH === 0
          ) {
            // Image says it's complete but reports zero natural size - that is unusual
            console.warn(
              "⚠️ Yacht image reports complete but natural size 0 — forcing a re-layout check",
              innerImg.src,
            );
          }
          if (innerImg && !innerImg.complete) {
            innerImg.addEventListener(
              "load",
              () => {
                console.debug(
                  "🔁 Yacht image loaded during spawn:",
                  innerImg.src,
                  {
                    naturalWidth: innerImg.naturalWidth,
                    naturalHeight: innerImg.naturalHeight,
                    rectAfterLoad: innerImg.getBoundingClientRect(),
                  },
                );
              },
              { once: true },
            );
          }
          console.debug("⛵ A yacht appears in the distance...", {
            elem: randomYacht,
            rect,
            imgRect,
            imgSrc: innerImg ? innerImg.src : null,
            imgLoaded: innerImg ? innerImg.complete : null,
            naturalWidth: naturalW,
            naturalHeight: naturalH,
          });
          // If the container bounding box is still zero width/height, but we
          // have a valid natural size from the image, ensure the container is
          // forced to that size for visibility (this helps debug image styling
          // or layout-caused collapses during testing).
          if (
            rect.width === 0 &&
            rect.height === 0 &&
            innerImg &&
            innerImg.naturalWidth > 0
          ) {
            randomYacht.style.width = `${innerImg.naturalWidth}px`;
            randomYacht.style.height = `${innerImg.naturalHeight}px`;
            console.debug(
              "🛠️ Forced container size to image natural size:",
              randomYacht.getBoundingClientRect(),
              {
                forcedWidth: innerImg.naturalWidth,
                forcedHeight: innerImg.naturalHeight,
              },
            );
          }
        }
      }
    };

    // Expose a test API to allow spawning a yacht manually from the console
    // Useful for testing without waiting for the timeline.
    window.spawnYachtNow = () => {
      try {
        spawnYachtRandomly();
        console.debug("🔧 spawnYachtNow executed");
      } catch (e) {
        console.error("🔧 spawnYachtNow failed", e);
      }
    };

    // Force spawn all available yachts for debugging
    window.spawnAllYachtsNow = () => {
      const available = yachtElements.filter((yacht) => yacht);
      available.forEach((y) => {
        activeYachts.push({
          element: y,
          position: window.innerWidth,
          startPosition: window.innerWidth,
        });
        y.classList.add("visible");
        y.style.opacity = "1";
        const inner =
          y.querySelector("img") || y.querySelector(".southampton-yacht");
        console.debug("🔧 spawned (all) ", y, y.getBoundingClientRect(), {
          imgSrc: inner ? inner.src : null,
          imgLoaded: inner ? inner.complete : null,
          naturalWidth: inner ? inner.naturalWidth : null,
          naturalHeight: inner ? inner.naturalHeight : null,
        });
      });
      // Do NOT auto-update alignment — yachts should remain where CSS puts them.
    };

    // Alignment helper — quickly compute the pixel difference between yachts
    // and the water surface and set CSS `--yacht-offset` to keep them pinned
    // to the same waterline when resizing. Call from the console if you need to tune.
    window.alignYachtsToShip = (desiredDelta = 0) => {
      // Prefer the water element (swater/water) as the alignment reference.
      const water =
        document.querySelector(".swater") || document.querySelector(".water");
      let waterRect = null;
      if (!water) {
        const brit = document.querySelector(".britannic");
        if (!brit) {
          console.warn("alignYachtsToShip: water or Britannic not found");
          return;
        }
        waterRect = brit.getBoundingClientRect();
      } else {
        waterRect = water.getBoundingClientRect();
      }
      const yachts = Array.from(
        document.querySelectorAll(
          ".yacht-1-container, .yacht-2-container, .yacht-3-container",
        ),
      );
      if (yachts.length === 0) {
        console.warn("alignYachtsToShip: No yacht containers found");
        return;
      }

      const diffs = yachts.map((y) => {
        const r = y.getBoundingClientRect();
        return r.bottom - waterRect.bottom;
      });
      const avgDiff = diffs.reduce((a, b) => a + b, 0) / diffs.length;
      const root = document.documentElement;
      const curOffsetStr =
        getComputedStyle(root).getPropertyValue("--yacht-offset") || "0px";
      const curOffset = parseFloat(curOffsetStr) || 0;

      // newOffset will move the yachts by -avgDiff (to align to brit bottom) then add desiredDelta
      const newOffset = Math.round(curOffset - avgDiff + desiredDelta);
      root.style.setProperty("--yacht-offset", `${newOffset}px`);
      console.debug("alignYachtsToShip applied", {
        avgDiff,
        curOffset,
        newOffset,
      });
    };

    // Developer helpers to tune yacht vertical offset at runtime
    window.setYachtOffset = (px) => {
      const root = document.documentElement;
      const n = Number(px);
      if (Number.isNaN(n)) {
        console.warn("setYachtOffset: invalid value", px);
        return;
      }
      root.style.setProperty("--yacht-offset", `${n}px`);
      console.debug(`✨ Yacht offset set to ${n}px`);
    };

    window.incYachtOffset = (delta = 10) => {
      const root = document.documentElement;
      let cur = parseFloat(
        getComputedStyle(root).getPropertyValue("--yacht-offset") || "0",
      );
      if (Number.isNaN(cur)) {
        // If we have a calc or non-numeric custom property, derive the current
        // offset from baseline - water-bottom so we can adjust numerically.
        const baseline = parseFloat(
          getComputedStyle(root).getPropertyValue("--yacht-baseline") || "0",
        );
        const water = parseFloat(
          getComputedStyle(root).getPropertyValue("--water-bottom") || "0",
        );
        cur = baseline - water;
      }
      const next = Math.round(cur + Number(delta));
      root.style.setProperty("--yacht-offset", `${next}px`);
      console.debug(`✨ Yacht offset changed ${cur}->${next}px`);
    };

    // Per-yacht controls: change each yacht's vertical offset and horizontal position
    window.setIndividualYachtOffset = (index, px) => {
      // index: 1|2|3, px: number or string with units
      if (![1, 2, 3].includes(Number(index))) {
        console.warn("setIndividualYachtOffset: invalid index", index);
        return;
      }
      const root = document.documentElement;
      const v = typeof px === "string" ? px : `${Number(px)}px`;
      root.style.setProperty(`--yacht-offset-${index}`, v);
      console.debug(`🚤 Yacht ${index} offset set to ${v}`);
    };

    window.setYachtLeft = (index, value) => {
      // Set the left position of a yacht container; value can be percent or px
      const idx = Number(index);
      if (![1, 2, 3].includes(idx)) {
        console.warn("setYachtLeft: invalid index", index);
        return;
      }
      const el = document.querySelector(`.yacht-${idx}-container`);
      if (!el) {
        console.warn("setYachtLeft: container not found", idx);
        return;
      }
      el.style.left = value;
      console.debug(`🚤 Yacht ${idx} left position now ${value}`);
    };

    window.setYachtScale = (index, scale) => {
      const idx = Number(index);
      if (![1, 2, 3].includes(idx)) {
        console.warn("setYachtScale: invalid index", index);
        return;
      }
      // Setting the CSS variable for scale already in use by the stylesheet
      document.documentElement.style.setProperty(
        `--yacht-scale-${idx}`,
        String(scale),
      );
      console.debug(`🚤 Yacht ${idx} scale set to`, scale);
    };

    window.resetYachtOffsets = () => {
      const root = document.documentElement;
      [1, 2, 3].forEach((i) =>
        root.style.removeProperty(`--yacht-offset-${i}`),
      );
      console.debug("↩️ Yacht offsets reset to default");
    };

    // Debug helper to force Cherbourg night sprite for testing
    window.showCherbourgNight = (show = true) => {
      try {
        const el = document.querySelector(".cherbourg-night");
        if (!el) return console.warn("cherbourg-night element not found");
        el.style.opacity = show ? 1 : 0;
        console.debug(`🌙 Cherbourg night sprite ${show ? "shown" : "hidden"}`);
      } catch (e) {
        console.error("Failed to toggle cherbourg-night:", e);
      }
    };

    // Brightness helper: set CSS custom properties for the night sprite
    window.setCherbourgBrightness = (
      brightness = 1.35,
      saturation = 1.2,
      contrast = 1.05,
    ) => {
      try {
        const root = document.documentElement;
        root.style.setProperty("--cherbourg-brightness", String(brightness));
        root.style.setProperty("--cherbourg-saturation", String(saturation));
        root.style.setProperty("--cherbourg-contrast", String(contrast));
        console.debug(
          `🌙 Cherbourg sprite tuned: brightness=${brightness} saturation=${saturation} contrast=${contrast}`,
        );
      } catch (e) {
        console.error("Failed to set cherbourg brightness:", e);
      }
    };

    window.resetCherbourgBrightness = () => {
      try {
        const root = document.documentElement;
        root.style.removeProperty("--cherbourg-brightness");
        root.style.removeProperty("--cherbourg-saturation");
        root.style.removeProperty("--cherbourg-contrast");
        console.debug("🌙 Cherbourg sprite brightness reset to CSS defaults.");
      } catch (e) {
        console.error("Failed to reset cherbourg brightness:", e);
      }
    };

    // Position helper — adjust left and bottom (accepts any valid CSS value)
    window.setCherbourgPosition = (left = "50%", bottom = "68%") => {
      try {
        const root = document.documentElement;
        root.style.setProperty("--cherbourg-left", left);
        root.style.setProperty("--cherbourg-bottom", bottom);
        const el = document.querySelector(".cherbourg-night");
        if (el) el.style.left = "";
        console.debug(
          `📍 Cherbourg position set: left=${left}, bottom=${bottom}`,
        );
      } catch (e) {
        console.error("Failed to set cherbourg position:", e);
      }
    };

    // Size helper — change the width of Cherbourg night sprite (accepts CSS units)
    window.setCherbourgSize = (size = "85vw") => {
      try {
        const root = document.documentElement;
        root.style.setProperty("--cherbourg-width", size);
        console.debug(`📏 Cherbourg width set to: ${size}`);
      } catch (e) {
        console.error("Failed to set cherbourg size:", e);
      }
    };

    // Reset cherbourg size to default (removes inline var)
    window.resetCherbourgSize = () => {
      try {
        const root = document.documentElement;
        root.style.removeProperty("--cherbourg-width");
        console.debug("📏 Cherbourg width reset to default");
      } catch (e) {
        console.error("Failed to reset cherbourg size:", e);
      }
    };

    window.getYachtBaseline = () => {
      const root = document.documentElement;
      const val = getComputedStyle(root).getPropertyValue("--yacht-baseline");
      let num = parseFloat(val);
      if (!Number.isFinite(num)) {
        // Fallback: create a temporary element using the variable and read its
        // computed bottom in pixels. This resolves calc() values to a numeric px.
        try {
          const tmp = document.createElement("div");
          tmp.style.position = "absolute";
          tmp.style.bottom = "var(--yacht-baseline)";
          tmp.style.left = "-9999px";
          tmp.style.width = "1px";
          tmp.style.height = "1px";
          tmp.style.visibility = "hidden";
          document.body.appendChild(tmp);
          const bottomPx = getComputedStyle(tmp).getPropertyValue("bottom");
          document.body.removeChild(tmp);
          num = parseFloat(bottomPx) || null;
        } catch (e) {
          console.warn("getYachtBaseline: fallback parse failed", e);
          num = null;
        }
      }
      console.debug(`--yacht-baseline: ${val} => ${num}px`);
      return num;
    };

    window.getYachtOffsets = () => {
      const root = document.documentElement;
      return [1, 2, 3].map((i) => {
        const v = getComputedStyle(root).getPropertyValue(
          `--yacht-offset-${i}`,
        );
        let px = parseFloat(v);
        if (!Number.isFinite(px)) {
          // If the CSS variable is a calc(), compute by reading the container's
          // computed bottom and subtracting the shared baseline (in px).
          const baseline = window.getYachtBaseline() || 0;
          const container = document.querySelector(`.yacht-${i}-container`);
          if (container) {
            const bottomStr =
              getComputedStyle(container).getPropertyValue("bottom");
            const bottomPx = parseFloat(bottomStr) || 0;
            px = bottomPx - baseline;
          } else {
            px = 0;
          }
        }
        return { index: i, value: v, px };
      });
    };

    // Returns current layout & offsets for each yacht container
    window.getYachtPositions = () => {
      const root = document.documentElement;
      const baseline = window.getYachtBaseline();
      const res = [1, 2, 3].map((i) => {
        const selector = `.yacht-${i}-container`;
        const el = document.querySelector(selector);
        if (!el) return { index: i, present: false, selector };

        const cs = getComputedStyle(el);
        const bottomCss = cs.getPropertyValue("bottom");
        const leftCss = cs.getPropertyValue("left");
        const bottomPx = parseFloat(bottomCss) || null;
        const leftPx = parseFloat(leftCss) || null;

        // Per-yacht offset variable
        const offsetVar =
          getComputedStyle(root).getPropertyValue(`--yacht-offset-${i}`) ||
          null;

        const rect = el.getBoundingClientRect();
        const img =
          el.querySelector("img") || el.querySelector(".southampton-yacht");
        const innerRect = img ? img.getBoundingClientRect() : null;

        // Try to parse computed transform scale on the image
        let scale = null;
        if (img) {
          const t = getComputedStyle(img).transform;
          if (t && t !== "none") {
            const m = t.match(/matrix\(([^)]+)\)/);
            if (m) {
              const values = m[1].split(",").map((v) => parseFloat(v));
              scale = { x: values[0], y: values[3] };
            } else {
              const m3 = t.match(/matrix3d\(([^)]+)\)/);
              if (m3) {
                const values = m3[1].split(",").map((v) => parseFloat(v));
                scale = { x: values[0], y: values[5] };
              }
            }
          } else {
            // read the CSS var as fallback
            const cssScale = getComputedStyle(root).getPropertyValue(
              `--yacht-scale-${i}`,
            );
            scale = cssScale ? { approx: parseFloat(cssScale) } : null;
          }
        }

        const deltaFromBaselinePx =
          baseline != null && bottomPx != null ? bottomPx - baseline : null;

        return {
          index: i,
          present: true,
          selector,
          bottomCss,
          leftCss,
          bottomPx,
          leftPx,
          offsetVar,
          deltaFromBaselinePx,
          baselinePx: baseline,
          containerRect: rect,
          imageRect: innerRect,
          scale,
        };
      });

      console.debug("🛥️ Yacht positions:", res);
      return res;
    };

    // ...existing code...

    const alignWithRaf = (delta = 64) => {
      requestAnimationFrame(() => window.alignYachtsToShip(delta));
    };

    // Initial alignment intentionally disabled — yachts should rest where CSS positions them
    // alignWithRaf();

    if (!window.__yachtAlignResizeListener) {
      window.__yachtAlignResizeListener = true;
      // Don't auto-align on resize; keep yachts positioned by CSS for natural placement
    }

    // Schedule random yacht appearances
    const scheduleNextYacht = () => {
      const elapsed = Date.now() - startTime;
      if (elapsed < NEEDLES_PASS) {
        // Random interval between 20-40 seconds
        const nextSpawn = 20000 + Math.random() * 20000;
        const timer = setTimeout(() => {
          // Drop the fired handle so the array doesn't grow for the whole phase
          const idx = yachtTimers.indexOf(timer);
          if (idx !== -1) yachtTimers.splice(idx, 1);
          spawnYachtRandomly();
          scheduleNextYacht();
        }, nextSpawn);
        yachtTimers.push(timer);
      }
    };

    // Start yacht spawning after Southampton Water
    const elapsedSinceStart = Date.now() - startTime;
    setTimeout(
      () => {
        scheduleNextYacht();
      },
      Math.max(0, SOUTHAMPTON_WATER_END - elapsedSinceStart),
    );

    // One step per display frame, so the sea, coast and yachts move in step
    // with the screen's refresh (a 16 ms timer drifts against 60 Hz and
    // judders). Browsers pause animation frames in background tabs, so a slow
    // timer keeps the voyage moving there; every step uses the real time
    // elapsed, so positions come out the same either way.
    let frameId = null;
    let hiddenTimer = null;
    let stopped = false;
    const stepDeparture = () => {
      if (stopped) return;
      if (!departureStarted) {
        stopped = true;
        cancelAnimationFrame(frameId);
        clearInterval(hiddenTimer);
        yachtTimers.forEach((timer) => clearTimeout(timer));
        return;
      }
      const now = Date.now();
      const delta = (now - lastTimestamp) / 1000; // seconds
      const elapsedTime = now - startTime; // milliseconds since voyage start
      maybeHideSouthamptonVisuals(elapsedTime, "timeline progression");
      maybeHideCoastalTerrain(elapsedTime, "timeline progression");
      lastTimestamp = now;

      // Determine target speed based on journey phase (only if not already set by server)
      if (typeof window.targetSpeed !== "number") {
        if (elapsedTime < SOUTHAMPTON_WATER_END) {
          targetSpeed = 6; // Southampton Water - 6 knots
        } else if (elapsedTime < CHANNEL_COMPLETE) {
          targetSpeed = 12; // Solent and early Channel - 12 knots
          // Transition to 19 knots after passing Needles
          if (elapsedTime > NEEDLES_COMPLETE) {
            targetSpeed = 19; // Open Channel cruising speed
          }
        } else if (elapsedTime < BERTHING_COMPLETE) {
          const elapsedCherbourg = Math.max(
            0,
            (elapsedTime - CHANNEL_COMPLETE) / 1000,
          );
          targetSpeed = Math.max(
            0,
            19 - elapsedCherbourg * CHERBOURG_DECEL_RATE,
          );
        } else {
          targetSpeed = 0; // Berthed - full stop
        }
      }

      // Sync with server-provided speeds (always respect server state)
      if (typeof window.currentSpeed === "number") {
        currentSpeed = window.currentSpeed;
        window.currentSpeed = undefined; // Clear flag so we only sync once
      } else if (
        v.voyageStartTime ||
        v.pendingVoyageStartTime ||
        v.latestVoyageState
      ) {
        // Fall back to local calculation when the server hasn't pushed speed yet.
        // This avoids a static ocean for late-joiners or transient disconnects.
        const anchor = v.voyageStartTime || v.pendingVoyageStartTime;
        const elapsedSeconds = anchor
          ? Math.floor((Date.now() - anchor) / 1000)
          : v.latestVoyageState?.elapsedSeconds || 0;
        try {
          const st = calculateVoyageState(elapsedSeconds);
          if (st && typeof st.speedValue === "number") {
            // Use server-derived model locally so visuals remain consistent
            currentSpeed = st.speedValue;
            targetSpeed = st.targetSpeed ?? targetSpeed;
            // No debug logging here to keep the console quiet for playtests
          }
        } catch (err) {
          // Do nothing; keep fallback to whichever speed was last seen
          console.warn(
            "⚠️ Wave fallback speed calculation failed:",
            err.message,
          );
        }
      }
      if (typeof window.targetSpeed === "number") {
        targetSpeed = window.targetSpeed;
        window.targetSpeed = undefined; // Clear flag so we only sync once
      }

      // Smoothly adjust speed toward target
      if (currentSpeed < targetSpeed) {
        currentSpeed = Math.min(
          currentSpeed + acceleration * delta,
          targetSpeed,
        );
      } else if (currentSpeed > targetSpeed) {
        currentSpeed = Math.max(
          currentSpeed - acceleration * delta,
          targetSpeed,
        );
      }

      window.currentSpeed = currentSpeed;
      departurePosition += currentSpeed * delta;
      wavesPosition += currentSpeed * delta;
      waterPosition += currentSpeed * delta;
      swaterPosition += currentSpeed * delta;

      // Update waves opacity based on speed
      const wavesElement = document.querySelector(".waves");
      if (wavesElement) {
        wavesElement.style.opacity = Math.min(1, currentSpeed / 19);
      }

      // Always update land_middle position (it will keep scrolling)
      landMiddlePosition += currentSpeed * delta;

      // Apply transform to move elements left
      southamptonCity.style.transform = `translateX(-${departurePosition}px)`;
      dock.style.transform = `translateX(-${departurePosition}px)`;

      // Animate waves background position for infinite scroll effect (stays in place on screen)
      if (waves) {
        waves.style.backgroundPosition = `${-wavesPosition}px 0`;
      }

      // Animate water background position for infinite scroll effect (like waves)
      if (water) {
        water.style.backgroundPosition = `${-waterPosition}px 0`;
      }

      // Keep the vista wing water phase-locked to the scene water so the
      // texture scrolls straight through the scene edge without a seam
      const wingWater = document.getElementById("water-wing");
      const vista = window.__vista;
      if (wingWater && vista && vista.active) {
        wingWater.style.backgroundPosition = `${
          vista.sceneLeft - waterPosition * vista.scale
        }px 0`;
      }

      // Animate swater background position for infinite scroll effect (like waves)
      if (swater) {
        swater.style.backgroundPosition = `${-swaterPosition}px 0`;
      }

      // Animate land_middle background position - continues scrolling but fades out at Isle of Wight
      if (landMiddle) {
        landMiddle.style.backgroundPosition = `${-landMiddlePosition}px 0`;

        // Start fading out land when Isle of Wight appears
        if (elapsedTime >= NEEDLES_PASS) {
          const fadeProgress = Math.min(
            (elapsedTime - NEEDLES_PASS) / 30000,
            1,
          ); // Fade over 30 seconds
          landMiddle.style.opacity = Math.max(0, 1 - fadeProgress);
        }
      } // Isle of Wight passage logic
      if (
        elapsedTime >= NEEDLES_PASS &&
        elapsedTime < NEEDLES_COMPLETE &&
        !isleOfWightCompleted
      ) {
        if (!isleOfWightPassing) {
          console.debug("🏝️ Passing Isle of Wight (The Needles)...");
          isleOfWightPassing = true;
        }

        // Calculate how far through the 8-minute passage we are
        const passageElapsed = elapsedTime - NEEDLES_PASS;
        const passageDuration = NEEDLES_COMPLETE - NEEDLES_PASS; // 8 minutes = 480,000ms
        const passageProgress = passageElapsed / passageDuration;

        // Move Isle of Wight from right to left over 8 minutes
        // Start from right edge (off-screen) and move to left edge (off-screen)
        const viewportWidth = SCENE_WIDTH;
        // Start at viewportWidth (off-screen right) and end at -viewportWidth (off-screen left)
        // This makes it cross the entire screen from right to left
        isleOfWightPosition =
          viewportWidth - viewportWidth * 2 * passageProgress;

        if (isleOfWight) {
          isleOfWight.style.transform = `translateX(${isleOfWightPosition}px)`;
          isleOfWight.style.opacity = "1";
        }
      } else if (elapsedTime >= NEEDLES_COMPLETE && !isleOfWightCompleted) {
        console.debug("✅ Isle of Wight passage complete");
        isleOfWightCompleted = true;
        if (isleOfWight) {
          isleOfWight.style.opacity = "0"; // Fade out after passing
        }
      }

      // Cherbourg scroll-in: start after Channel complete and move at ship speed
      if (cherbourg) {
        const viewportWidth = SCENE_WIDTH;
        const targetLeft = viewportWidth * 0.5; // 50% from left, around Britannic position

        // Display the sprite once we've slowed enough during the approach
        if (elapsedTime >= CHANNEL_COMPLETE) {
          if (currentSpeed <= v.CHERBOURG_SHOW_KNOTS) {
            // Begin slow drift inwards when ship has slowed enough.
          } else {
            // Keep off-screen until the ship slows down enough to begin the reveal
            // Ensure the position remains off-screen if not yet allowed to approach
            cherbourgPosition = Math.max(
              cherbourgPosition,
              cherbourgOffscreenRight(),
            );
            cherbourg.style.left = `${Math.round(cherbourgPosition)}px`;
          }
        }

        // Only move while not arrived and during approach/berthing
        if (elapsedTime >= CHANNEL_COMPLETE && !cherbourgArrived) {
          // If we have reached the end of the timeline (berthing complete), snap to final position
          if (elapsedTime >= BERTHING_COMPLETE) {
            cherbourgPosition = targetLeft;
            cherbourgArrived = true;
            cherbourg.style.opacity = "1";
          }
          // Otherwise, if we are in the approach phase and speed is low enough, animate
          else if (currentSpeed <= v.CHERBOURG_SHOW_KNOTS) {
            // Dynamic factor: width / 4500 ensures we cover the distance (approx 0.8w)
            // within the available knot-seconds (approx 3950).
            // 0.8w / 3950 ~= w / 4937. Using w/4500 provides a safety margin to arrive early.
            const dynamicFactor = viewportWidth / 4500;
            const slowMove = Math.max(0.25, currentSpeed * dynamicFactor);

            // Calculate next position and clamp to prevent overshooting
            const nextPosition = cherbourgPosition - slowMove * delta;
            if (nextPosition <= targetLeft) {
              cherbourgPosition = targetLeft;
              cherbourgArrived = true;
            } else {
              cherbourgPosition = nextPosition;
            }

            // Make visible once movement begins
            cherbourg.style.opacity = "1";
          }

          // Apply left position (centered via translateX(-50%) in CSS)
          cherbourg.style.left = `${Math.round(cherbourgPosition)}px`;
        }

        // Cherbourg will be revealed by its position; no opacity toggles needed
      } // Yacht scrolling logic - move yachts at ship speed from right to left
      for (let i = activeYachts.length - 1; i >= 0; i--) {
        const yacht = activeYachts[i];

        // Move yacht at ship's speed (like everything else)
        yacht.position -= currentSpeed * delta;

        if (yacht.position < -SCENE_WIDTH) {
          // Yacht has crossed the screen, remove it
          yacht.element.classList.remove("visible");
          yacht.element.style.opacity = "0";
          activeYachts.splice(i, 1);
          console.debug("⛵ Yacht has passed out of view");
        } else {
          // Update yacht container transform with translateX only so the
          // yacht image inside can keep its `translate(-50%, 0) scale(...)`.
          yacht.element.style.transform = `translateX(${yacht.position}px)`;
        }
      }

    };
    const onFrame = () => {
      stepDeparture();
      if (!stopped) frameId = requestAnimationFrame(onFrame);
    };
    hiddenTimer = setInterval(() => {
      if (document.hidden) stepDeparture();
    }, 250);
    frameId = requestAnimationFrame(onFrame);
  }

  // Start departure sequence synchronized with server time (7 minutes after voyage start)
  if (DEPARTURE_SEQUENCE_ENABLED) {
    // Check repeatedly if it's time to start departure
    const checkDepartureTime = setInterval(() => {
      if (!v.voyageStartTime) return; // Wait for server time

      const elapsedSeconds = getElapsedSeconds();

      // If we're past departure time but haven't started yet
      if (elapsedSeconds >= TIMELINE_SECONDS.DEPARTURE_DELAY) {
        clearInterval(checkDepartureTime);

        // Check if departure already happened (player joined late or refreshed)
        if (elapsedSeconds > TIMELINE_SECONDS.DEPARTURE_DELAY + 5) {
          // 5 second grace period after departure
          console.info(
            `🚢 Departure already occurred (${Math.floor(
              elapsedSeconds / 60,
            )} min elapsed) - skipping sequence`,
          );
          departureStarted = true; // Mark as started to prevent re-triggering
          // Start animation at current state without playing sounds/music/teleport
          animateDeparture();
        } else {
          // Normal departure - play full sequence
          console.debug(
            "🚢 Starting departure at server-synced 12 minute mark",
          );
          startDepartureSequence();
        }
      }
    }, 1000); // Check every second
  } else {
    console.debug("🚧 Departure sequence scheduling skipped (disabled)");
  }
});
