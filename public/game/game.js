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
// enterRoom's move to the next room waits for the slide-out; a second pick in
// that time replaces the first instead of entering both rooms in turn.
// Declared up here: the first enterRoom can run while this file is still
// starting (voyage data that arrived first places the player).
let roomTransitionTimer = null;

// Who plays in this tab: the room to come back to is kept per player, as one
// computer may be shared and one browser may have several characters logged
// in, a tab each (core/me.js)
function playerKey() {
  try {
    const id = sessionStorage.getItem("playerId");
    if (id) return id;
    const c = JSON.parse(sessionStorage.getItem("character")) || {};
    return [c.forename, c.surname, c.cabin_number].join("|");
  } catch (e) {
    return "";
  }
}
// The rooms to come back to, by player: { [playerKey]: { id, name } }, the
// most recently used last (a handful kept)
const LAST_ROOMS_KEY = "rbv:lastRooms";
function lastRooms() {
  try {
    const all = JSON.parse(localStorage.getItem(LAST_ROOMS_KEY));
    return all && typeof all === "object" && !Array.isArray(all) ? all : {};
  } catch (e) {
    return {};
  }
}
// This player's room to come back to (null: none). A room given replaces it,
// null forgets it.
function setLastRoom(room) {
  try {
    const all = lastRooms();
    const key = playerKey();
    delete all[key];
    if (room) all[key] = { id: room.id || "", name: room.name || "" };
    const keys = Object.keys(all);
    for (const k of keys.slice(0, Math.max(0, keys.length - 12))) delete all[k];
    localStorage.setItem(LAST_ROOMS_KEY, JSON.stringify(all));
  } catch (e) {}
}
// This player's room to come back to, or null. One saved before rooms were
// kept per player ("lastRoom" / "lastRoomId") is taken as this player's, once.
function savedLastRoom() {
  try {
    const oldId = localStorage.getItem("lastRoomId");
    const oldName = localStorage.getItem("lastRoom");
    if (oldId || oldName) {
      localStorage.removeItem("lastRoom");
      localStorage.removeItem("lastRoomId");
      setLastRoom({ id: oldId || "", name: oldName || "" });
    }
    return lastRooms()[playerKey()] || null;
  } catch (e) {
    return null;
  }
}
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



// Single DOMContentLoaded event listener
document.addEventListener("DOMContentLoaded", function () {

  // Initialize music player
  musicPlayer.init();

  // Initialize narrative system
  narrativeSystem.init();

  // Initialize chat elements
  const chatInput = document.getElementById("chat-input");
  const sendButton = document.getElementById("send-message");
  const chatContainer = document.getElementById("chat-container");
  const deckplansPopup = document.getElementById("deckplans-popup");


  // Get character data from sessionStorage
  const characterData = JSON.parse(sessionStorage.getItem("character"));
  if (characterData) {
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
      } else {
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
  }

  // Add event listeners for chat functionality
  sendButton.addEventListener("click", sendMessage);
  chatInput.addEventListener("keypress", function (e) {
    if (e.key === "Enter") {
      sendMessage();
    }
  });

  // Add event listener for global chat toggle
  const globalChatToggle = document.getElementById("global-chat-toggle");
  globalChatToggle.addEventListener("click", toggleGlobalChat);


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
        // In full daylight the filter changes nothing, yet a filter on a
        // moving layer costs the browser a pass of its own every frame: none
        const filt =
          b === "1.00" && warm === "0.00"
            ? "none"
            : `brightness(${b}) sepia(${warm})`;
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
        const wB = (0.24 + 0.76 * lit).toFixed(2);
        const wFilt = wB === "1.00" ? "none" : `brightness(${wB})`;
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
    }

    // Show the location picture of the current time of day (night, sunrise/sunset or day)
    try {
      swapLocationImagesForSky();
    } catch (err) {
    }
  }

  // Which picture set the location view shows. The sun's real altitude decides, as it does for the sky's colours
  // (the hour only until the celestial layer is up). Sunrise and sunset share one set ("twilight").
  // window.locationTimeOfDayOverride ("day" | "twilight" | "night") forces one for testing.
  function locationTimeOfDay() {
    const tod = window.RBV && window.RBV.data && window.RBV.data.timeOfDayImages;
    if (!tod) return "day";
    if (window.locationTimeOfDayOverride) return window.locationTimeOfDayOverride;
    const alt =
      window.RBV && window.RBV.celestial
        ? window.RBV.celestial.sunAltDeg
        : undefined;
    if (typeof alt === "number") return tod.forSunAltitude(alt);
    const h = getBSTTime().getHours();
    const iv = imageIntervals.find((i) => h >= i.start && h <= i.end);
    return tod.forPalette(iv && iv.className);
  }

  // A Britannic location picture's path in the given time of day's set (the day picture where that set has none)
  function britannicImagePath(imageName, tod = locationTimeOfDay()) {
    const t = window.RBV && window.RBV.data && window.RBV.data.timeOfDayImages;
    return t
      ? t.path(imageName, tod)
      : `/images/animations/locations/britannic/${imageName}`;
  }

  // Called every second: when the time of day crosses into another set, the room's picture follows (drawLocationImage
  // does nothing while the path is unchanged)
  function swapLocationImagesForSky() {
    if (!currentRoom || !currentRoom.name) return;
    const roomName = currentRoom.name;
    const roomData = roomImages[roomName];
    if (!roomData) return;
    const imgName = roomData.images[roomData.currentIndex];
    if (!imgName) return;
    const isSouthampton =
      deckRooms.southampton &&
      deckRooms.southampton.some((r) => r.location.chatRoom === roomName);
    if (isSouthampton) {
      drawLocationImage(`/images/animations/locations/southampton/${imgName}`);
      return;
    }
    let p = britannicImagePath(imgName);
    if (failedLocationImages.has(p)) p = britannicImagePath(imgName, "day");
    drawLocationImage(p, false, {
      onError: () => {
        // a missing version is not asked for again every second
        failedLocationImages.add(p);
        drawLocationImage(britannicImagePath(imgName, "day"), false);
      },
    });
  }
  const failedLocationImages = new Set();

  // Developer helper: force a time of day's pictures ("day" | "twilight" | "night"; null to follow the sun again)
  window.forceSetRoomVariant = (variant = "twilight") => {
    window.locationTimeOfDayOverride = variant === "ms" ? "twilight" : variant;
    try {
      swapLocationImagesForSky();
    } catch (e) {
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
    }
  }
  let lastSkyBg = null;

  // Helpers for debugging and manual override
  window.setSkyPaletteOverride = (name = null) => {
    window.skyPaletteOverride = name;
    updateSkyImage();
  };

  function refreshWorldStateImmediately(reason = "manual") {
    try {
      updateSkyImage();
      updateInfoBar();
    } catch (err) {
    }
  }

  // Function to perform initial sync with server data
  function performInitialSync() {
    if (v.initialSyncDone) return;
    v.initialSyncDone = true;

    // Initialize narrative system with server time
    if (narrativeSystem && v.pendingVoyageStartTime) {
      narrativeSystem.startTime = v.pendingVoyageStartTime;
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

        }
      }
    }

    // Update sky and info bar
    refreshWorldStateImmediately("initial-sync");

    // Placing the player is left to the Start button (waitForSpawn), which
    // brings them back to the room they were in. Placing them here as well,
    // while the Start screen still showed, put every reloaded player in their
    // cabin, saved the cabin as the room to come back to, and told the cabin
    // and the next room "has entered" / "has left".
  }

  // modules/voyageSync.js calls this when the server's voyage data arrives.
  // It lives inside this file's DOMContentLoaded closure, so since the split
  // into modules the module could not see it: every "voyage-start-time" and
  // "voyage-state" event threw "performInitialSync is not defined" and the
  // first sync never ran unless the data happened to arrive before this
  // script did.
  window.performInitialSync = performInitialSync;

  // A dropped connection comes back as a brand-new socket that stands in no
  // room on the server. Without rejoining, the player kept seeing the room
  // but heard no chat in it, was missing from its passenger list and could not
  // ring the telegraph until the next change of room.
  let socketWasConnected = socket.connected;
  socket.on("connect", () => {
    if (!socketWasConnected) {
      socketWasConnected = true;
      return;
    }
    if (!currentRoom.name) return;
    socket.emit("join-room", { room: currentRoom.name });
    socket.emit("request-room-players", currentRoom.name);
  });

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
      return;
    }

    const existingCanvas = cloudContainer.querySelector("canvas");
    if (existingCanvas) {
      cloudContainer.removeChild(existingCanvas);
    }

    cloudContainer.appendChild(canvas);
    const ctx = canvas.getContext("2d");
    if (!ctx) {
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
      {};
    cloudImages.ms.onload = () =>
      {};
    cloudImages.night.onload = () =>
      {};

    function applyCloudTexture(type = "ms") {
      if (!cloudImages[type]) return;
      desiredCloudTexture = type;
      currentCloudTexture = type;
      clouds.forEach((cloud) => {
        cloud.image = cloudImages[type];
      });
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
    };

    // Deterministic cloud spawn check for a given time slot
    let cloudSkySeed = null;
    function checkCloudSlots() {
      // The sky comes from the voyage's own seed and weather: none before the
      // server's voyage clock. When it arrives (or changes), the clouds placed
      // meanwhile go and the sky is laid out afresh from the last few minutes
      // (left alone, the first check after it replayed every cloud slot since
      // departure, from a stand-in overcast sky).
      if (!v.voyageStartTime) return;
      if (cloudSkySeed !== v.voyageStartTime) {
        cloudSkySeed = v.voyageStartTime;
        clouds.length = 0;
        lastCloudSlot = -1;
      }
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

    // Clouds drift 6-12 px a second: redrawn on the scene's shared frames,
    // about 30 a second (RBV.sceneFrame, core/rbv.js). Their place comes from
    // the voyage clock, not from the frame count.
    function animate(now) {
      requestAnimationFrame(animate);
      if (!RBV.sceneFrame(now)) return;
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

    requestAnimationFrame(animate);

    window.setCloudTexture = (type = currentCloudTexture) =>
      applyCloudTexture(type);
    window.forceCloudTextureMS = () => applyCloudTexture("ms");
    if (currentCloudTexture !== "ms") {
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
        return;
      }

      this.container = document.createElement("div");
      this.container.className = "bird-container";
      sceneLayer.appendChild(this.container);

      this.spriteImg = new Image();
      this.spriteImg.src = this.SPRITE_SRC;
      this.spriteImg.onload = () => {
        this.start();
      };
      this.spriteImg.onerror = () =>
        {};
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
      // on the scene's shared frames (RBV.sceneFrame, core/rbv.js)
      if (!RBV.sceneFrame(now)) {
        this.animFrame = requestAnimationFrame(this._tick);
        return;
      }
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

        // Draw the wing-beat frame only when it changes (the bird itself
        // moves by transform)
        if (b.drawnFrame === b.frameIndex) continue;
        b.drawnFrame = b.frameIndex;
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
    let smokeDpr = 1;

    function resizeCanvas() {
      const dpr = window.devicePixelRatio || 1;
      smokeDpr = dpr;
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
    // The day, dusk and night sprites, all loaded at the start: swapping one
    // image's src stopped the smoke dead until the new picture had loaded
    const smokeImages = {};
    ["day", "ms", "night"].forEach((type) => {
      smokeImages[type] = new Image();
      smokeImages[type].src = `/images/animations/smoke/${type}.png`;
    });
    let currentSmokeTexture = "day";

    // Expose a setter so the sky system can swap the smoke sprite at dusk/night
    window.setSmokeTexture = (type = "day") => {
      if (smokeImages[type]) currentSmokeTexture = type;
    };
    const smokeSprite = () => {
      const img = smokeImages[currentSmokeTexture];
      if (img.complete && img.naturalWidth) return img;
      const day = smokeImages.day;
      return day.complete && day.naturalWidth ? day : null;
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

      // One bubble (its halo, body and glint) drawn once, then stamped for
      // every bubble with drawImage at the bubble's size and alpha. Three
      // path fills and three colour strings per bubble, for some 160 bubbles
      // on every frame, were nearly half of the page's script time; the
      // bubbles are only a pixel or two across, so the stamp looks the same.
      const BUBBLE_R = 4; // the stamp's body radius, in its own pixels
      const bubbleStamp = document.createElement("canvas");
      const BUBBLE_STAMP = Math.ceil(BUBBLE_R * 1.1) * 2 + 2;
      bubbleStamp.width = BUBBLE_STAMP;
      bubbleStamp.height = BUBBLE_STAMP;
      (() => {
        const s = bubbleStamp.getContext("2d");
        const c = BUBBLE_STAMP / 2;
        s.fillStyle = "rgba(170, 220, 255, 0.3)";
        s.beginPath();
        s.arc(c, c, BUBBLE_R * 1.1, 0, Math.PI * 2);
        s.fill();
        s.fillStyle = "rgb(210, 236, 255)";
        s.beginPath();
        s.arc(c, c, BUBBLE_R, 0, Math.PI * 2);
        s.fill();
        s.fillStyle = "rgba(255, 255, 255, 0.85)";
        s.beginPath();
        s.arc(c - BUBBLE_R * 0.2, c - BUBBLE_R * 0.2, BUBBLE_R * 0.18, 0, Math.PI * 2);
        s.fill();
      })();

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
        if (alpha <= 0.004) return;

        // the stamp scaled so its body is the bubble's size
        const d = (BUBBLE_STAMP * size) / BUBBLE_R;
        ctx.globalAlpha = alpha;
        ctx.drawImage(bubbleStamp, x - d / 2, y - d / 2, d, d);
      }

      // Worked out in steps of a 60th of a second whatever the screen's
      // refresh (as the smoke), drawn on the scene's shared frames
      const BUBBLE_STEP_MS = 1000 / 60;
      let bubbleLastTime = null;
      let bubbleBacklog = 0;

      function stepBubbles(frameTime) {
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
          if (bubble.age >= bubble.life) {
            bubbles.splice(index, 1);
          }
        }
      }

      function animatePropellers(frameTime) {
        requestAnimationFrame(animatePropellers);
        if (!RBV.sceneFrame(frameTime)) return;
        if (bubbleLastTime === null) bubbleLastTime = frameTime;
        bubbleBacklog += Math.min(250, Math.max(0, frameTime - bubbleLastTime));
        bubbleLastTime = frameTime;
        while (bubbleBacklog >= BUBBLE_STEP_MS) {
          stepBubbles(frameTime);
          bubbleBacklog -= BUBBLE_STEP_MS;
        }
        // nothing to clear or draw while there is no wash (the ship at rest)
        if (!bubbles.length && !washShown) return;
        ctx.clearRect(0, 0, CONTAINER_W, CONTAINER_H);
        for (let index = bubbles.length - 1; index >= 0; index--) {
          drawBubble(bubbles[index]);
        }
        ctx.globalAlpha = 1;
        washShown = bubbles.length > 0;
      }
      let washShown = false;

      requestAnimationFrame(animatePropellers);
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

    // The smoke is worked out in steps of a 60th of a second, however often
    // the screen refreshes (stepped once per frame, it rose twice as fast on
    // a 120 Hz screen and slowed when frames were dropped), and drawn on the
    // scene's shared frames, about 30 a second (it rises about 13 px a second)
    const SMOKE_STEP_MS = 1000 / 60;
    let smokeLastTime = null;
    let smokeBacklog = 0;

    function stepSmoke() {
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
        horizontalWind += dirSign * Math.min(window.sceneWind.kn, 30) * 0.008;
      }

      // Backwards, so taking a puff out does not skip the next one (it was
      // neither moved nor drawn that frame: a flicker in the column)
      for (let index = smokeParticles.length - 1; index >= 0; index--) {
        const particle = smokeParticles[index];
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

        // Remove particle if it's too old or faded
        if (particle.life >= particle.maxLife || particle.opacity <= 0) {
          smokeParticles.splice(index, 1);
        }
      }

      // Spawn new smoke particles at a more realistic rate
      if (Math.random() < 0.2) {
        // Much slower spawn rate (15%) for realistic smoke puffs
        spawnSmokeParticle();
      }
    }

    function drawSmoke() {
      // Full backing-store clear regardless of the dpr transform (see the
      // cloud animate() note — same smear bug at browser zoom-out)
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const sprite = smokeSprite();
      if (sprite) {
        // oldest first, newest on top, as before; each puff placed and
        // turned by one transform instead of save/translate/rotate/restore
        const dpr = smokeDpr;
        for (const particle of smokeParticles) {
          const cos = Math.cos(particle.rotation) * dpr;
          const sin = Math.sin(particle.rotation) * dpr;
          ctx.setTransform(cos, sin, -sin, cos, particle.x * dpr, particle.y * dpr);
          ctx.globalAlpha = particle.opacity;
          const scaledWidth = sprite.width * particle.scale;
          const scaledHeight = sprite.height * particle.scale;
          ctx.drawImage(
            sprite,
            -scaledWidth / 2,
            -scaledHeight / 2,
            scaledWidth,
            scaledHeight,
          );
        }
      }
      ctx.globalAlpha = 1;
      ctx.setTransform(smokeDpr, 0, 0, smokeDpr, 0, 0);
    }

    function animateSmoke(now) {
      requestAnimationFrame(animateSmoke);
      if (!RBV.sceneFrame(now)) return;
      if (smokeLastTime === null) smokeLastTime = now;
      // a tab in the background gets no frames: that gap is not caught up
      smokeBacklog += Math.min(250, Math.max(0, now - smokeLastTime));
      smokeLastTime = now;
      while (smokeBacklog >= SMOKE_STEP_MS) {
        stepSmoke();
        smokeBacklog -= SMOKE_STEP_MS;
      }
      drawSmoke();
    }

    requestAnimationFrame(animateSmoke);

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

    if (progress >= 100) {
      clearInterval(loadingInterval);
      startButton.style.display = "block";
    }
  }, 500);

  startButton.addEventListener("click", () => {
    refreshWorldStateImmediately("start-button");
    whistleSound.play().catch(() => {});
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
        } else {
        }

        musicPlayer.isPlaying = true;
        musicPlayer.loadCurrentSong();
        musicPlayer.updatePlayButton();
      }

      // Smart spawn logic based on voyage progress
      // Wait a moment for v.voyageStartTime to be received from server
      const waitForSpawn = setInterval(() => {
        if (!v.voyageStartTime) return; // Wait for server time

        clearInterval(waitForSpawn);
        const elapsedSeconds = getElapsedSeconds();
        // (in the North Atlantic the ship has sailed, whatever the clock says)
        const departed =
          v.DEV_NORTH_ATLANTIC || elapsedSeconds >= TIMELINE_SECONDS.DEPARTURE_DELAY;

        // Back to the room the player was in before the reload or the closed
        // window: by id (several rooms share a name), else by name for a
        // room saved before ids were. Once the ship has sailed, a room ashore
        // is no longer there to go back to.
        const saved = savedLastRoom();
        const lastRoomId = saved && saved.id;
        const lastRoomName = saved && saved.name;
        if (lastRoomId || lastRoomName) {
          const findLast = (match) => {
            for (const deck in deckRooms) {
              if (!Array.isArray(deckRooms[deck])) continue;
              if (departed && deck === "southampton") continue;
              const hit = deckRooms[deck].find(match);
              if (hit) return hit;
            }
            return null;
          };
          const lastRoom =
            (lastRoomId && findLast((r) => r.id === lastRoomId)) ||
            (lastRoomName && findLast((r) => r.name === lastRoomName));

          if (lastRoom) {
            enterRoom(lastRoom);
            return; // Don't do the spawn logic below
          } else if (
            lastRoomName === "Mars" ||
            lastRoomName === "5741544e4559"
          ) {
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
          }
          // Nowhere to go back to
          setLastRoom(null);
        }

        // If ship has already departed (past 12 minutes), spawn on ship
        if (departed) {
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
            console.error("Could not find ship spawn location");
          }
        } else {
          // Ship hasn't departed yet - spawn at Southampton docks
          const initialRoom = deckRooms.southampton.find(
            (r) => r.name === "Berth 44 Forward Docks",
          );
          if (initialRoom) {
            enterRoom(initialRoom);
          } else {
            console.error(
              "Initial room not found, defaulting to Berth 44 Forward Docks",
            );
            const defaultRoom = deckRooms.southampton.find(
              (r) => r.name === "Berth 44 Forward Docks",
            );
            if (defaultRoom) enterRoom(defaultRoom);
          }
        }
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

    const characterData = JSON.parse(sessionStorage.getItem("character"));
    if (!characterData) {
      console.error("No character data found.");
      return;
    }

    // Picking a room puts the deck plan away (only Southampton's did)
    const deckPlans = document.getElementById("deckplans-popup");
    if (deckPlans) deckPlans.style.display = "none";
    const roomTooltip = document.getElementById("room-tooltip");
    if (roomTooltip) roomTooltip.style.display = "none";

    // Already here: nothing to leave or join (doing both told the room
    // "has left" and "has entered" for nothing)
    const targetRoomName = room && room.location && room.location.chatRoom;
    if (
      !roomTransitionTimer &&
      currentRoom.name &&
      targetRoomName === currentRoom.name
    ) {
      return;
    }
    if (roomTransitionTimer) {
      clearTimeout(roomTransitionTimer);
      roomTransitionTimer = null;
    }

    const chatContainer = document.getElementById("chat-container");
    const locationDisplay = document.querySelector(".location-display");

    if (!chatContainer || !locationDisplay) {
      console.error("Required DOM elements not found");
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
      closeDoorSound.play().catch(() => {});
      socket.emit("leave-room", {
        room: currentRoom.name,
      });
      // The last room's passengers go with it; the server sends the next
      // room's list once we have joined it
      clearRoomPlayers();
    }

    roomTransitionTimer = setTimeout(() => {
      roomTransitionTimer = null;
      if (!room) {
        console.error("Room object is undefined");
        return;
      }

      // Clear chat display
      document.getElementById("chat-messages").innerHTML = "";

      // Set new room
      currentRoom.name = room.location.chatRoom;
      currentRoom.id = room.id;

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

      if (chatRoom === "5741544e4559") {
        imageSrc = "/images/Mars.jpg";
      } else if (roomImages[chatRoom]) {
        const roomData = roomImages[chatRoom];
        if (roomData.currentIndex >= roomData.images.length) {
          roomData.currentIndex = 0;
        }
        const imageToShow = roomData.images[roomData.currentIndex];
        // The Britannic's pictures in the time of day's set (night, sunrise/sunset), the day picture otherwise
        imageSrc = isSouthamptonRoom(room)
          ? `/images/animations/locations/southampton/${imageToShow}`
          : britannicImagePath(imageToShow);
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
        openDoorSound.play().catch(() => {});

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

        // The card table is in the first class smoking room and lounge
        const gamesToggleBtn = document.getElementById("games-toggle-btn");
        if (gamesToggleBtn) {
          const hasGames =
            room.id === "first_class_lounge_a" ||
            room.id === "first_class_smoking_room_a";
          gamesToggleBtn.style.display = hasGames ? "block" : "none";
          // a games list left open in the last room goes with it
          closeGamesMenu();
          if (!hasGames) closeVideoPokerGame();
        }

        // The room to come back to after a reload; by id, since several rooms
        // share a name (three Grand Staircases), and for this player only
        // (a computer may be shared, a browser may play several characters)
        setLastRoom(room);

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

          // What is served where:
          //   a dining room      the whole menu;
          //   a smoking room, lounge, reception room, the Palm Court
          //                      drinks and light fare under "Eat & Drink",
          //                      tobacco under its own button;
          //   an open deck       tobacco only.
          // A room is looked up by its id, never by its type alone: the à la
          // carte restaurant's type is "first-class", which is not in the
          // interior list, so it was treated as an open deck and offered
          // tobacco only.
          const diningRooms = [
            "first_class_dining_room_d",
            "a_la_carte_restaurant",
            "dockside_cafe",
          ];
          const loungeRooms = [
            "first_class_smoking_room_a",
            "second_class_smoke_room_b",
            "third_class_smoke_room_b",
            "first_class_lounge_a",
            "verandah_palm_court_a",
            "first_class_reception_d",
            "restaurant_reception_room",
          ];
          const isDiningRoom = diningRooms.includes(room.id);
          const isLoungeRoom = loungeRooms.includes(room.id);
          const isOutdoorRoom =
            !isDiningRoom &&
            !isLoungeRoom &&
            room.type &&
            !interiorTypes.includes(room.type);
          const menuMode = isDiningRoom
            ? "full"
            : isLoungeRoom
              ? "drinks"
              : isOutdoorRoom
                ? "tobacco"
                : "";

          eatDrinkBtn.dataset.menuMode = menuMode;
          eatDrinkBtn.dataset.tobaccoOnly =
            menuMode === "tobacco" ? "true" : "false";
          eatDrinkBtn.style.display = menuMode ? "block" : "none";
          // Open decks only offer tobacco, so the button says so
          eatDrinkBtn.textContent =
            menuMode === "tobacco" ? "Tobacco" : "Eat & Drink";

          const tobaccoBtn = document.getElementById("tobacco-btn");
          if (tobaccoBtn) {
            tobaccoBtn.style.display = menuMode === "drinks" ? "block" : "none";
            tobaccoBtn.textContent = "Tobacco";
          }
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
        finishRoomEnter();
      }

      // Preload room variants and images (if any)
      try {
        locationImageSystem.preloadRoomImages(currentRoom.name);
      } catch (e) {
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

  // Sending a line. The server answers each one: a line it refused, or one
  // lost with the connection, is said so in the chat, and the words go back
  // in the box to send again.
  const CHAT_NOT_SENT = {
    "too-fast": "Not sent: you are writing faster than the chat allows. Wait a moment.",
    "too-long": "Not sent: that message is too long.",
  };
  const CHAT_NO_CONNECTION = "Not sent: no connection to the ship. Try again in a moment.";
  function sendMessage() {
    const message = chatInput.value.trim();
    const characterData = JSON.parse(sessionStorage.getItem("character"));
    if (!message || !currentRoom.name || !characterData) return;

    const room = currentRoom.name;
    const notSent = (text) => {
      if (!chatInput.value) chatInput.value = message;
      addChatMessage({ type: "system", room, timestamp: Date.now(), message: text });
    };
    if (!socket.connected) {
      notSent(CHAT_NO_CONNECTION);
      return;
    }
    chatInput.value = "";
    socket
      .timeout(10000)
      .emit("chat-message", { room, message, timestamp: Date.now() }, (err, res) => {
        if (!err && res && res.ok) return;
        notSent((!err && res && CHAT_NOT_SENT[res.reason]) || CHAT_NO_CONNECTION);
      });
  }

  // The chat follows the newest line only for a reader already at the
  // bottom; one who scrolled up to read stays where they are, and a button
  // offers the way back down.
  // (declarations, not constants: a line can arrive before this file has
  // run down to here)
  function chatAtBottom(el) {
    return el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  }
  function setNewChatHint(show) {
    let hint = chatContainer.querySelector(".chat-new-hint");
    if (!hint) {
      if (!show) return;
      hint = document.createElement("button");
      hint.type = "button";
      hint.className = "chat-new-hint";
      hint.textContent = "New messages";
      hint.addEventListener("click", () => {
        const el = document.getElementById("chat-messages");
        el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
        setNewChatHint(false);
      });
      chatContainer.appendChild(hint);
    }
    hint.style.display = show ? "block" : "none";
  }
  document.getElementById("chat-messages").addEventListener(
    "scroll",
    (e) => {
      if (chatAtBottom(e.currentTarget)) setNewChatHint(false);
    },
    { passive: true },
  );

  function updateChatDisplay() {
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
    setNewChatHint(false);
  }

  // Add a toggle for global chat
  function toggleGlobalChat() {
    isGlobalChat = !isGlobalChat;

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
      } else {
      }
    } catch (error) {
      console.error(`Error handling incoming message: ${error.message}`);
    }
  });

  // Handle join room errors (admin-only mode)
  socket.on("join-error", (error) => {
    alert(error.message || "Unable to join the game at this time.");
  });

  // Handle admin-only mode disconnection
  socket.on("admin-only-mode", (data) => {
    alert(data.message || "Game access is restricted to administrators only.");
    // Redirect to registration page
    window.location.href = "/";
  });

  // Handle room message history when joining a room
  socket.on("room-message-history", (data) => {
    const { room, messages } = data;

    // Intentionally ignore replayed room history so entering a room starts fresh.
    if (!chatHistory.rooms[room]) {
      chatHistory.rooms[room] = [];
    }
  });

  // Arrivals and departures of the room one stands in (the server sends the
  // updated passenger list along with them)
  const isThisRoom = (data) =>
    data && data.character && (!data.roomId || data.roomId === currentRoom.name);

  socket.on("user-joined", (data) => {
    if (!isThisRoom(data)) return;
    addChatMessage({
      type: "system",
      message: `${data.character.forename} ${data.character.surname} has entered the room`,
      room: currentRoom.name, // room.id
      timestamp: Date.now(),
    });
  });

  socket.on("user-left", (data) => {
    if (!isThisRoom(data)) return;
    addChatMessage({
      type: "system",
      message: `${data.character.forename} ${data.character.surname} has left the room`,
      room: currentRoom.name, // room.id
      timestamp: Date.now(),
    });
  });

  // Function to add a chat message
  function addChatMessage(data) {

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
          // the room is the game's own words, in the reader's language
          // (the line around it is a player's, and stays as written)
          roomSpan.dataset.i18n = "";
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
      const follow = chatAtBottom(chatMessages);
      chatMessages.appendChild(messageDiv);
      // Prune oldest nodes so the live DOM stays bounded like the history
      // array (200/room). Without this the chat element grows unbounded
      // between room switches (updateChatDisplay is the only other reset).
      const heightBefore = chatMessages.scrollHeight;
      while (chatMessages.childElementCount > 200) {
        chatMessages.removeChild(chatMessages.firstElementChild);
      }
      if (follow) {
        chatMessages.scrollTo({ top: chatMessages.scrollHeight, behavior: "instant" });
        setNewChatHint(false);
      } else {
        // lines taken off the top would pull the text being read upwards
        const removed = heightBefore - chatMessages.scrollHeight;
        if (removed > 0) {
          chatMessages.scrollTo({ top: chatMessages.scrollTop - removed, behavior: "instant" });
        }
        setNewChatHint(true);
      }
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
    console.error("Report system elements not found:", {
      reportBtn: !!reportBtn,
      reportModal: !!reportModal,
      closeReportModal: !!closeReportModal,
      cancelReport: !!cancelReport,
      reportForm: !!reportForm,
    });
  } else {

    reportBtn.addEventListener("click", () => {
      reportModal.style.display = "block";
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
        } else {
          const failureMessage =
            result.details ||
            result.error ||
            "The report could not be sent. Please try again.";
          alert(failureMessage);
          console.error("Report submission failed:", result.error);
        }
      } catch (error) {
        alert(
          "The report could not be sent. Please check your connection and try again.",
        );
        console.error("Report submission error:", error);
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
    openMapSound.play().catch(() => {});

    // Show appropriate deckplan based on player location
    if (isPlayerInSouthampton()) {
      showSouthamptonDeckplan();
    } else {
      showBritannicDeckplans();
    }

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
            enterRoom(room);
            deckplansPopup.style.display = "none"; // Close popup on selection
          });

          // Add tooltip functionality
          const tooltip = document.getElementById("room-tooltip");
          link.addEventListener("mouseenter", (e) => {
            const userCount = link.getAttribute("data-user-count") || "0";
            tooltip.textContent = roomCountLabel(room.name, userCount);
            tooltip.style.display = "block";
            tooltip.style.left = `${uiPx(e.clientX + 5)}px`;
            tooltip.style.top = `${uiPx(e.clientY + 5)}px`;
          });
          link.addEventListener("mousemove", (e) => {
            tooltip.style.left = `${uiPx(e.clientX + 5)}px`;
            tooltip.style.top = `${uiPx(e.clientY + 5)}px`;
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
            enterRoom(docksideCafe);
            deckplansPopup.style.display = "none"; // Close popup on selection
          });

          // Add tooltip functionality
          const tooltip = document.getElementById("room-tooltip");
          link.addEventListener("mouseenter", (e) => {
            const userCount = link.getAttribute("data-user-count") || "0";
            tooltip.textContent = roomCountLabel(docksideCafe.name, userCount);
            tooltip.style.display = "block";
            tooltip.style.left = `${uiPx(e.clientX + 5)}px`;
            tooltip.style.top = `${uiPx(e.clientY + 5)}px`;
          });
          link.addEventListener("mousemove", (e) => {
            tooltip.style.left = `${uiPx(e.clientX + 5)}px`;
            tooltip.style.top = `${uiPx(e.clientY + 5)}px`;
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
            tooltip.style.left = `${uiPx(e.clientX + 5)}px`;
            tooltip.style.top = `${uiPx(e.clientY + 5)}px`;
          });
          link.addEventListener("mousemove", (e) => {
            tooltip.style.left = `${uiPx(e.clientX + 5)}px`;
            tooltip.style.top = `${uiPx(e.clientY + 5)}px`;
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
            tooltip.style.left = `${uiPx(e.clientX + 5)}px`;
            tooltip.style.top = `${uiPx(e.clientY + 5)}px`;
          });
          link.addEventListener("mousemove", (e) => {
            tooltip.style.left = `${uiPx(e.clientX + 5)}px`;
            tooltip.style.top = `${uiPx(e.clientY + 5)}px`;
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
            enterRoom(crewGangway);
            deckplansPopup.style.display = "none"; // Close popup on selection
          });

          // Add tooltip functionality
          const tooltip = document.getElementById("room-tooltip");
          link.addEventListener("mouseenter", (e) => {
            const userCount = link.getAttribute("data-user-count") || "0";
            tooltip.textContent = roomCountLabel(crewGangway.name, userCount);
            tooltip.style.display = "block";
            tooltip.style.left = `${uiPx(e.clientX + 5)}px`;
            tooltip.style.top = `${uiPx(e.clientY + 5)}px`;
          });
          link.addEventListener("mousemove", (e) => {
            tooltip.style.left = `${uiPx(e.clientX + 5)}px`;
            tooltip.style.top = `${uiPx(e.clientY + 5)}px`;
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
            tooltip.style.left = `${uiPx(e.clientX + 5)}px`;
            tooltip.style.top = `${uiPx(e.clientY + 5)}px`;
          });
          link.addEventListener("mousemove", (e) => {
            tooltip.style.left = `${uiPx(e.clientX + 5)}px`;
            tooltip.style.top = `${uiPx(e.clientY + 5)}px`;
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
            enterRoom(berth44Aft);
            deckplansPopup.style.display = "none"; // Close popup on selection
          });

          // Add tooltip functionality
          const tooltip = document.getElementById("room-tooltip");
          link.addEventListener("mouseenter", (e) => {
            const userCount = link.getAttribute("data-user-count") || "0";
            tooltip.textContent = roomCountLabel(berth44Aft.name, userCount);
            tooltip.style.display = "block";
            tooltip.style.left = `${uiPx(e.clientX + 5)}px`;
            tooltip.style.top = `${uiPx(e.clientY + 5)}px`;
          });
          link.addEventListener("mousemove", (e) => {
            tooltip.style.left = `${uiPx(e.clientX + 5)}px`;
            tooltip.style.top = `${uiPx(e.clientY + 5)}px`;
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
            tooltip.style.left = `${uiPx(e.clientX + 5)}px`;
            tooltip.style.top = `${uiPx(e.clientY + 5)}px`;
          });
          link.addEventListener("mousemove", (e) => {
            tooltip.style.left = `${uiPx(e.clientX + 5)}px`;
            tooltip.style.top = `${uiPx(e.clientY + 5)}px`;
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
            enterRoom(boardingTower);
            deckplansPopup.style.display = "none"; // Close popup on selection
          });

          // Add tooltip functionality
          const tooltip = document.getElementById("room-tooltip");
          link.addEventListener("mouseenter", (e) => {
            const userCount = link.getAttribute("data-user-count") || "0";
            tooltip.textContent = roomCountLabel(boardingTower.name, userCount);
            tooltip.style.display = "block";
            tooltip.style.left = `${uiPx(e.clientX + 5)}px`;
            tooltip.style.top = `${uiPx(e.clientY + 5)}px`;
          });
          link.addEventListener("mousemove", (e) => {
            tooltip.style.left = `${uiPx(e.clientX + 5)}px`;
            tooltip.style.top = `${uiPx(e.clientY + 5)}px`;
          });
          link.addEventListener("mouseleave", () => {
            tooltip.style.display = "none";
          });
        }
      }
    }


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

    // the room data goes into the markup as attribute text only (escaped),
    // whatever the room editor ever writes into it
    const shapes = rooms
      .filter((r) => r.coordinates)
      .map((r) => {
        const cls = r.class || "first";
        const typeTok = r.type ? " " + r.type : "";
        return (
          '<a xlink:href="#" class="room-marker ' +
          escapeHtml(cls + "-class" + typeTok) +
          '" data-room-id="' +
          escapeHtml(r.id) +
          '"><g><polygon class="image-mapper-shape" points="' +
          escapeHtml(r.coordinates) +
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
      escapeHtml(viewBox) +
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
        enterRoom(room);
      });
      link.addEventListener("mouseenter", (e) => {
        const userCount = link.getAttribute("data-user-count") || "0";
        tooltip.textContent = roomCountLabel(room.name, userCount);
        tooltip.style.display = "block";
        tooltip.style.left = `${uiPx(e.clientX + 5)}px`;
        tooltip.style.top = `${uiPx(e.clientY + 5)}px`;
      });
      link.addEventListener("mousemove", (e) => {
        tooltip.style.left = `${uiPx(e.clientX + 5)}px`;
        tooltip.style.top = `${uiPx(e.clientY + 5)}px`;
      });
      link.addEventListener("mouseleave", () => {
        tooltip.style.display = "none";
      });
    });
    emitRoomCountBatch(Array.from(svgRoomIds));
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
  }

  deckButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const deck = button.getAttribute("data-deck");
      deckButtons.forEach((b) => b.classList.toggle("active", b === button));
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
        const roomsToRequest = new Set();
        deckRooms[deck].forEach((room) => {
          if (room.isSVG) {
          } else if (room.x !== undefined && room.y !== undefined) {
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
              enterRoom(room);
            });

            // Add tooltip functionality
            const tooltip = document.getElementById("room-tooltip");
            marker.addEventListener("mouseenter", (e) => {
              const userCount = marker.getAttribute("data-user-count") || "0";
              tooltip.textContent = roomCountLabel(room.name, userCount);
              tooltip.style.display = "block";
              tooltip.style.left = `${uiPx(e.clientX + 5)}px`;
              tooltip.style.top = `${uiPx(e.clientY + 5)}px`;
            });
            marker.addEventListener("mousemove", (e) => {
              tooltip.style.left = `${uiPx(e.clientX + 5)}px`;
              tooltip.style.top = `${uiPx(e.clientY + 5)}px`;
            });
            marker.addEventListener("mouseleave", () => {
              tooltip.style.display = "none";
            });

            roomMarkers.appendChild(marker);
            roomsToRequest.add(room.location.chatRoom);
          } else {
          }
        });
        emitRoomCountBatch(Array.from(roomsToRequest));
      } else {
      }
    });
  });

  // Note: Deck plan initialization is now handled dynamically in deckplans button click

  // The room markers put #room-tooltip just right of the cursor, which runs
  // off the window for rooms near the bow: flip it to the cursor's left there
  const roomTooltip = document.getElementById("room-tooltip");
  document.addEventListener("mousemove", (e) => {
    if (!roomTooltip || roomTooltip.style.display !== "block") return;
    const width = roomTooltip.offsetWidth;
    // (the page may be zoomed to fit a narrow window: lengths in its pixels)
    if (uiPx(e.clientX + 5) + width > uiPx(window.innerWidth)) {
      roomTooltip.style.left = `${uiPx(e.clientX - 5) - width}px`;
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
    // the picture's WebP copy where it has one; the original if that fails
    const lighter = lighterPicture(imagePath);
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
      if (renderImage.src && lighter !== imagePath && !renderImage.dataset.original) {
        renderImage.dataset.original = "1";
        renderImage.src = imagePath;
        return;
      }
      console.error("Failed to draw location image", imagePath, err);
      renderImage.onload = null;
      renderImage.onerror = null;
      if (typeof onError === "function") {
        onError(err);
      }
    };
    renderImage.src = lighter;
  }

  // A room's day picture as its WebP copy (data/dayImages.js), a tenth of the
  // size of the PNG or JPEG; any other picture as it is
  function lighterPicture(imagePath) {
    const day = window.RBV && window.RBV.data && window.RBV.data.dayImages;
    return day ? day.lighter(imagePath) : imagePath;
  }

  // Head counts from the server, several rooms in one message
  socket.on("room-counts", (counts) => {
    if (!counts || typeof counts !== "object") return;
    for (const [roomId, count] of Object.entries(counts)) {
      applyRoomCount({ roomId, count });
    }
  });
  socket.on("room-count", (data) => data && applyRoomCount(data));

  function applyRoomCount({ roomId, count }) {
    // Cache the count so we can reuse it when the deckplan re-renders
    try {
      roomCountsCache.set(roomId, Number(count));
    } catch (e) {
    }

    if (
      roomId === currentRoom.name &&
      typeof setRoomPlayersCount === "function"
    ) {
      setRoomPlayersCount(count);
    }

    const markers = document.querySelectorAll(
      `.room-marker[data-room-id="${CSS.escape(String(roomId))}"]`,
    );
    markers.forEach((marker) => {
      marker.setAttribute("data-user-count", count);
      const roomName = marker.getAttribute("data-room-name");

      // Update tooltip if it's currently being displayed for this room
      const tooltip = document.getElementById("room-tooltip");
      if (tooltip && tooltip.style.display === "block") {
        // the tooltip may show the room's name in the reader's language
        const shown = tooltip.textContent;
        const named =
          window.RBV_I18N && typeof window.RBV_I18N.tr === "function"
            ? window.RBV_I18N.tr(roomName)
            : roomName;
        if (shown.startsWith(`${roomName} · `) || shown.startsWith(`${named} · `)) {
          tooltip.textContent = roomCountLabel(roomName, count);
        }
      }
    });
  }

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
      applyOwnChatColor(selectedColor);

      if (chatColorEmitTimeout) {
        clearTimeout(chatColorEmitTimeout);
      }

      chatColorEmitTimeout = setTimeout(() => {
        chatColorEmitTimeout = null;
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

  const onAssignedChatColor = (color) => {
    applyOwnChatColor(color);
    if (chatColorPicker) {
      chatColorPicker.value = color;
    }
  };
  socket.on("assign-chat-color", onAssignedChatColor);
  // sent as the game connects, possibly before this listened (core/socket.js)
  if (RBV.socketLatest && RBV.socketLatest["assign-chat-color"]) {
    onAssignedChatColor(RBV.socketLatest["assign-chat-color"]);
  }

  socket.on("update-chat-color", ({ socketId, userId, color }) => {
    const idToLookup = socketId || userId;
    updateMessagesForUser(idToLookup, color);

    if (socket && socket.id && idToLookup === socket.id) {
      // Keep local CSS variable in sync if update originated elsewhere
      document.documentElement.style.setProperty("--user-chat-color", color);
      if (chatColorPicker) {
        chatColorPicker.value = color;
      }
    }
  });

  const showGameUserCount = (count) => {
    document.getElementById("people").textContent = `Passengers: ${count}`;
  };
  socket.on("game-user-count", showGameUserCount);
  // sent as the game connects, possibly before this listened (core/socket.js)
  if (RBV.socketLatest && typeof RBV.socketLatest["game-user-count"] === "number") {
    showGameUserCount(RBV.socketLatest["game-user-count"]);
  }

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
  });

  closeRulesBtn.addEventListener("click", () => {
    rulesPopup.style.display = "none";
  });

  // Close rules popup when clicking outside
  window.addEventListener("click", (event) => {
    if (event.target === rulesPopup) {
      rulesPopup.style.display = "none";
    }
  });

  // The refresh button steps through the room's pictures
  const refreshBtn = document.getElementById("refresh-location-btn");

  if (refreshBtn) {
    refreshBtn.addEventListener("click", () => {
      // Log the action for debugging

      // Check if there's a current room and images available
      if (!currentRoom.name || !roomImages[currentRoom.name]) {
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
        return;
      const roomData = roomImages[roomName];
      if (!roomData) return;
      const images = roomData.images || [];

      for (let i = 0; i < images.length; i++) {
        const candidate = images[i];
        const isSouthampton =
          deckRooms.southampton &&
          deckRooms.southampton.some((r) => r.location.chatRoom === roomName);
        const p = isSouthampton
          ? `/images/animations/locations/southampton/${candidate}`
          : `/images/animations/locations/britannic/${candidate}`;
        await new Promise((resolve) => {
          drawLocationImage(p, false, {
            onLoad: () => {
              setTimeout(resolve, delay);
            },
            onError: (err) => {
              setTimeout(resolve, delay);
            },
          });
        });
      }
    } catch (err) {
      console.error("testCycleRoomImages error:", err);
    }
  };

  window.showRoomImagesList = (roomName) => {
    if (!roomName) roomName = currentRoom?.name;
    if (!roomName) return;
    if (!roomImages[roomName])
      return;
    if (roomImages[roomName].variants)
      {}
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
      // the same file drawLocationImage will ask for (a day picture's WebP copy)
      img.src = lighterPicture(src);
    },

    preloadRoomImages(roomName) {
      if (!roomImages[roomName]) return;

      const imageSet = roomImages[roomName].images;
      // Southampton's pictures, or the Britannic's in the time of day's set; once a room and set
      const isSouthamptonImage =
        deckRooms.southampton &&
        deckRooms.southampton.some((r) => r.location.chatRoom === roomName);
      const tod = isSouthamptonImage ? "day" : locationTimeOfDay();
      const key = `${roomName}|${tod}`;
      if (this.preloadedRooms.has(key)) return;
      this.preloadedRooms.add(key);
      imageSet.forEach((imageName) => {
        this.preload(
          isSouthamptonImage
            ? `/images/animations/locations/southampton/${imageName}`
            : britannicImagePath(imageName, tod),
        );
      });
    },

    cycleImage(roomName) {
      if (!roomImages[roomName]) return false;
      const roomData = roomImages[roomName];
      const canvasCtx = ensureLocationCanvas();
      if (!canvasCtx) return false;

      const targetImages = roomData.images;
      // Calculate next index and update immediately
      const previousIndex = roomData.currentIndex;
      roomData.currentIndex = (roomData.currentIndex + 1) % targetImages.length;
      const newImage = targetImages[roomData.currentIndex];


      const isSouthamptonImage =
        deckRooms.southampton &&
        deckRooms.southampton.some((r) => r.location.chatRoom === roomName);
      const dayPath = isSouthamptonImage
        ? `/images/animations/locations/southampton/${newImage}`
        : britannicImagePath(newImage, "day");
      // the Britannic's pictures in the time of day's set (night, sunrise/sunset), the day picture otherwise
      const newImagePath = isSouthamptonImage
        ? dayPath
        : britannicImagePath(newImage);

      const failed = () => {
        console.error(`Failed to load image: ${newImagePath}`);
        addChatMessage({
          type: "system",
          message: `There was a problem changing the view.`,
          room: roomName,
          timestamp: Date.now(),
        });
        roomData.currentIndex = previousIndex;
      };
      drawLocationImage(newImagePath, false, {
        onLoad: () => {
        },
        onError: () => {
          if (newImagePath === dayPath) return failed();
          // a missing night or sunset version: the day picture
          failedLocationImages.add(newImagePath);
          drawLocationImage(dayPath, false, { onError: failed });
        },
      });

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
      avatarImg.src = characterData.avatar || "/images/default-avatar.svg";

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

  // Draw poker, jacks or better. The server shuffles, deals, draws and pays;
  // this only shows the table. The cards in /images/cards/ are Byron Knoll's
  // Vector Playing Cards (public domain) with a back by BdRGames (CC0); see
  // scripts/cards/make_cards.js.
  const videoPokerPopup = document.getElementById("video-poker-popup");
  const closeVideoPokerBtn = videoPokerPopup.querySelector(".close-video-poker");
  const dealDrawBtn = document.getElementById("deal-draw-btn");
  const vpStatus = videoPokerPopup.querySelector(".vp-status");
  const vpCards = Array.from(videoPokerPopup.querySelectorAll(".vp-card"));
  const vpStakes = Array.from(videoPokerPopup.querySelectorAll(".vp-stake"));
  const vpPayRows = Array.from(
    videoPokerPopup.querySelectorAll(".vp-payouts [data-hand]"),
  );

  // The table is laid over the room picture, above the room's name, buttons
  // and passengers' tab (the tab used to lie over its buttons)
  const vpRoomPicture = document.querySelector(".location-display");
  if (vpRoomPicture) vpRoomPicture.appendChild(videoPokerPopup);

  const CARD_DIR = "/images/cards/";
  const CARD_RANKS = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"];
  const CARD_SUITS = ["clubs", "diamonds", "hearts", "spades"];
  const RANK_WORD = { A: "Ace", K: "King", Q: "Queen", J: "Jack" };
  const cardSrc = (card) =>
    card
      ? `${CARD_DIR}${card.suit}-${String(card.rank).toLowerCase()}.webp`
      : `${CARD_DIR}back.webp`;
  const cardName = (card) => `${RANK_WORD[card.rank] || card.rank} of ${card.suit}`;
  const pounds = (n) => `£${Number.isInteger(n) ? n : Number(n).toFixed(2)}`;
  // "Two Pair" -> "Two pair", as the pay table prints it
  const handName = (rank) =>
    rank ? rank.charAt(0) + rank.slice(1).toLowerCase() : "";

  // the faces are fetched once, when the table is first opened
  let cardFacesLoaded = false;
  function loadCardFaces() {
    if (cardFacesLoaded) return;
    cardFacesLoaded = true;
    CARD_SUITS.forEach((suit) =>
      CARD_RANKS.forEach((rank) => {
        new Image().src = cardSrc({ suit, rank });
      }),
    );
  }

  const videoPoker = {
    hand: [],
    held: [false, false, false, false, false],
    phase: "idle", // idle, dealing, deal (choosing holds), drawing
    stake: 0,
  };

  function vpSetPhase(phase) {
    videoPoker.phase = phase;
    videoPokerPopup.dataset.phase = phase;
    dealDrawBtn.textContent =
      phase === "deal" || phase === "drawing" ? "Draw" : "Deal";
    dealDrawBtn.disabled = phase === "dealing" || phase === "drawing";
    vpStakes.forEach((b) => {
      b.disabled = phase !== "idle";
    });
  }

  // fresh: which cards were just dealt (they drop onto the baize)
  function vpShowCards(fresh) {
    vpCards.forEach((el, i) => {
      const card = videoPoker.hand[i];
      const held = !!videoPoker.held[i];
      el.querySelector("img").src = cardSrc(card);
      el.classList.toggle("card-back", !card);
      el.classList.toggle("held", held);
      el.setAttribute("aria-pressed", held ? "true" : "false");
      el.setAttribute(
        "aria-label",
        card ? cardName(card) + (held ? ", held" : "") : "Card face down",
      );
      if (fresh && fresh[i]) {
        el.classList.remove("dealt");
        void el.offsetWidth; // start the drop again
        el.style.setProperty("--deal-delay", `${i * 60}ms`);
        el.classList.add("dealt");
      }
    });
  }

  function vpMarkPayRow(rank) {
    vpPayRows.forEach((row) =>
      row.classList.toggle("win", !!rank && row.dataset.hand === rank),
    );
  }

  function vpSetStake(bet) {
    videoPoker.stake = bet;
    vpStakes.forEach((b) =>
      b.setAttribute(
        "aria-pressed",
        Number(b.dataset.bet) === bet ? "true" : "false",
      ),
    );
  }

  function vpReset() {
    videoPoker.hand = [];
    videoPoker.held = [false, false, false, false, false];
    vpShowCards();
    vpMarkPayRow(null);
    vpSetPhase("idle");
    vpStatus.textContent = "";
  }

  function openVideoPokerGame() {
    loadCardFaces();
    // a hand in play stays on the table when it is closed and opened again
    if (videoPoker.phase === "idle") vpReset();
    videoPokerPopup.classList.add("open");
    videoPokerPopup.setAttribute("aria-hidden", "false");
    dealDrawBtn.focus();
  }

  // (also called on entering a room, so it looks the table up itself)
  function closeVideoPokerGame() {
    const popup = document.getElementById("video-poker-popup");
    if (!popup || !popup.classList.contains("open")) return;
    popup.classList.remove("open");
    popup.setAttribute("aria-hidden", "true");
  }

  closeVideoPokerBtn.addEventListener("click", closeVideoPokerGame);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeVideoPokerGame();
  });

  vpStakes.forEach((b) =>
    b.addEventListener("click", () => {
      if (videoPoker.phase !== "idle") return;
      vpSetStake(Number(b.dataset.bet) || 0);
    }),
  );

  vpCards.forEach((el, i) =>
    el.addEventListener("click", () => {
      if (videoPoker.phase !== "deal" || !videoPoker.hand[i]) return;
      videoPoker.held[i] = !videoPoker.held[i];
      vpShowCards();
    }),
  );

  // One button: Deal, then Draw
  dealDrawBtn.addEventListener("click", () => {
    if (videoPoker.phase === "idle") {
      const bet = videoPoker.stake;
      if (bet > 0 && playerMoney < bet) {
        vpStatus.textContent = `You haven't enough money for a ${pounds(bet)} stake.`;
        return;
      }
      vpSetPhase("dealing");
      socket.emit("poker-deal", { bet });
    } else if (videoPoker.phase === "deal") {
      vpSetPhase("drawing");
      socket.emit("poker-hold", { held: [...videoPoker.held] });
    }
  });

  socket.on("poker-dealt", ({ hand, money }) => {
    playerMoney = money;
    updateMoneyDisplay();
    videoPoker.hand = hand;
    videoPoker.held = [false, false, false, false, false];
    vpMarkPayRow(null);
    vpShowCards([true, true, true, true, true]);
    vpSetPhase("deal");
    vpStatus.textContent = "";
  });

  // a refused deal or draw ends the hand (the server has let it go)
  socket.on("poker-error", ({ message } = {}) => {
    vpStatus.textContent = message || "The table could not deal that hand.";
    vpSetPhase("idle");
  });

  socket.on("poker-result", ({ hand, rank, multiplier, winnings, bet, money }) => {
    playerMoney = money;
    updateMoneyDisplay();
    const replaced = videoPoker.held.map((h) => !h);
    videoPoker.hand = hand;
    videoPoker.held = [false, false, false, false, false];
    vpShowCards(replaced);
    vpSetPhase("idle");
    const won = multiplier > 0;
    vpMarkPayRow(won ? rank : null);
    const name = handName(rank);
    if (won && bet > 0) vpStatus.textContent = `${name}. ${pounds(winnings)} paid.`;
    else if (won) vpStatus.textContent = `${name}.`;
    else if (bet > 0) vpStatus.textContent = `${name}. The ${pounds(bet)} stake is lost.`;
    else vpStatus.textContent = `${name}. No win.`;
  });

  // Games: a short paper list under the button
  const gamesToggleBtn = document.getElementById("games-toggle-btn");

  // (also called on entering a room)
  function closeGamesMenu() {
    const popup = document.querySelector(".games-popup");
    if (popup) popup.remove();
    const btn = document.getElementById("games-toggle-btn");
    if (btn) btn.textContent = "Games";
  }

  if (gamesToggleBtn) {
    gamesToggleBtn.addEventListener("click", () => {
      if (document.querySelector(".games-popup")) {
        closeGamesMenu();
        return;
      }
      // one thing over the picture at a time
      const menu = document.querySelector(".eat-drink-popup");
      if (menu) menu.remove();
      resetMenuButtons();
      collapsePlayersDrawer();
      showGamesOptions();
      gamesToggleBtn.textContent = "Close Games";
    });
  }

  function showGamesOptions() {
    const locationDisplay = document.querySelector(".location-display");
    if (!locationDisplay) return;
    const popup = document.createElement("div");
    popup.className = "games-popup";
    popup.innerHTML = `
      <button type="button" class="gp-item" data-game="video-poker">Poker</button>`;
    locationDisplay.appendChild(popup);
    popup
      .querySelector('[data-game="video-poker"]')
      .addEventListener("click", () => {
        closeGamesMenu();
        openVideoPokerGame();
      });
  }

  // Log Out: needs and money saved, the session ended on the server, then
  // back to the page where one logs in
  const logoutBtn = document.getElementById("logout-btn");
  if (logoutBtn) {
    logoutBtn.addEventListener("click", async () => {
      logoutBtn.disabled = true;
      try {
        if (typeof window.saveStatsToServer === "function") window.saveStatsToServer();
      } catch (e) {}
      // this tab's character only: others logged in on the browser, in other
      // tabs, carry on
      let player = "";
      try {
        player = sessionStorage.getItem("playerId") || "";
      } catch (e) {}
      try {
        await fetch("/api/logout", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ player }),
        });
      } catch (e) {}
      // nothing of this player stays in the tab for whoever uses it next
      // (the room to come back to is kept, under this player's name)
      try {
        ["character", "playerId", "userEmail", "narrativeEventIndex"].forEach((k) =>
          sessionStorage.removeItem(k),
        );
        localStorage.removeItem("rbvrpg:lastStats");
      } catch (e) {}
      window.location.href = "/main/main.html";
    });
  }

  // Eat/Drink button functionality (toggle menu)
  const eatDrinkBtn = document.getElementById("eat-drink-btn");
  const tobaccoBtn = document.getElementById("tobacco-btn");

  function resetMenuButtons() {
    if (eatDrinkBtn) {
      eatDrinkBtn.textContent =
        eatDrinkBtn.dataset.menuMode === "tobacco" ? "Tobacco" : "Eat & Drink";
    }
    if (tobaccoBtn) tobaccoBtn.textContent = "Tobacco";
  }

  // One menu at a time: a button closes its own menu, or swaps the other's
  function toggleMenu(btn, mode) {
    const existingPopup = document.querySelector(".eat-drink-popup");
    const wasOwn = existingPopup && existingPopup.dataset.owner === btn.id;
    if (existingPopup) existingPopup.remove();
    resetMenuButtons();
    if (wasOwn) return;
    closeGamesMenu();
    collapsePlayersDrawer();
    showEatDrinkOptions(mode, btn.id);
    btn.textContent = "Close Menu";
  }

  if (eatDrinkBtn) {
    eatDrinkBtn.addEventListener("click", () => {
      toggleMenu(
        eatDrinkBtn,
        eatDrinkBtn.dataset.menuMode ||
          (eatDrinkBtn.dataset.tobaccoOnly === "true" ? "tobacco" : "full"),
      );
    });
  }
  if (tobaccoBtn) {
    tobaccoBtn.addEventListener("click", () => toggleMenu(tobaccoBtn, "tobacco"));
  }

  // Function to show eat/drink options. mode: "full" (a dining room),
  // "drinks" (a smoking room or lounge: drinks first, light fare, no
  // entrées) or "tobacco"
  function showEatDrinkOptions(mode = "full", ownerId = "eat-drink-btn") {
    if (mode === true) mode = "tobacco"; // (the old call: onlyTobacco)
    if (mode === false) mode = "full";
    const onlyTobacco = mode === "tobacco";
    const popup = document.createElement("div");
    popup.className = "eat-drink-popup";
    popup.dataset.mode = mode;
    popup.dataset.owner = ownerId;

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

    // A smoking room or lounge: the bar first, then light fare
    const drinksSidebar = `
          <div class="edm-category" data-category="alcoholic_beverages">
            <div class="edm-category-header">
              <span class="edm-arrow">▼</span> Alcoholic Beverages
            </div>
            <div class="edm-subcategories" style="display:flex">
              <div class="edm-subcat-btn active" data-top="alcoholic_beverages" data-sub="all">All</div>
              <div class="edm-subcat-btn" data-top="alcoholic_beverages" data-sub="beer">Beer</div>
              <div class="edm-subcat-btn" data-top="alcoholic_beverages" data-sub="cocktails">Cocktails</div>
              <div class="edm-subcat-btn" data-top="alcoholic_beverages" data-sub="wines_and_champagne">Wines & Champagne</div>
              <div class="edm-subcat-btn" data-top="alcoholic_beverages" data-sub="spirits">Spirits</div>
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
          <div class="edm-category" data-category="food">
            <div class="edm-category-header">
              <span class="edm-arrow">▶</span> Light Fare
            </div>
            <div class="edm-subcategories">
              <div class="edm-subcat-btn active" data-top="food" data-sub="all">All</div>
              <div class="edm-subcat-btn" data-top="food" data-sub="light_meal">Light Meal</div>
              <div class="edm-subcat-btn" data-top="food" data-sub="side">Side</div>
              <div class="edm-subcat-btn" data-top="food" data-sub="fruit">Fruit</div>
              <div class="edm-subcat-btn" data-top="food" data-sub="cakes">Cakes</div>
              <div class="edm-subcat-btn" data-top="food" data-sub="desserts">Desserts</div>
            </div>
          </div>
    `;

    popup.innerHTML = `
      <div class="edm-body">
        <div class="edm-sidebar">
          ${onlyTobacco ? tobaccoOnlySidebar : mode === "drinks" ? drinksSidebar : fullSidebar}
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

      // (a smoking room or lounge serves no entrées or ices: its "All" is
      // only what its own headings list)
      const lightFare = ["light_meal", "side", "fruit", "cakes", "desserts"];
      const filtered = MENU_DATA.filter((item) => {
        if (item.topCategory !== topCategory) return false;
        if (subCategory !== "all" && item.subCategory !== subCategory)
          return false;
        if (
          mode === "drinks" &&
          topCategory === "food" &&
          !lightFare.includes(item.subCategory)
        )
          return false;
        return true;
      });

      filtered.forEach((item) => {
        // Built as elements, the menu's own words as text: no item's name or
        // picture can become markup or script (and no inline handler)
        const card = document.createElement("div");
        card.className = "edm-item-card";
        const img = document.createElement("img");
        img.alt = item.name;
        img.addEventListener(
          "error",
          () => {
            if (item.image) img.src = item.image;
          },
          { once: true },
        );
        img.src = item.localImage;
        const label = document.createElement("span");
        label.className = "edm-item-name";
        label.textContent = item.name;
        card.append(img, label);

        // Tooltip on hover
        card.addEventListener("mouseenter", (e) => {
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
            <div class="edm-tooltip-title">${escapeHtml(item.name)}</div>
            <div class="edm-tooltip-desc"></div>
            ${statsHtml ? `<div class="edm-tooltip-stats">${statsHtml}</div>` : ""}
          `;
          // one text, its line breaks kept by the stylesheet (pre-line): a
          // description cut into lines could not be put into another
          // language whole
          tooltip.querySelector(".edm-tooltip-desc").textContent =
            item.description || "";
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

      saveStatsToServer();
    }

    // Default open category depends on outdoor/tobacco-only mode
    if (onlyTobacco) {
      const tobaccoCat = popup.querySelector('[data-category="tobacco"]');
      if (tobaccoCat) tobaccoCat.classList.add("open");
      renderItems("tobacco", "all");
    } else if (mode === "drinks") {
      const barCat = popup.querySelector(
        '[data-category="alcoholic_beverages"]',
      );
      if (barCat) barCat.classList.add("open");
      renderItems("alcoholic_beverages", "all");
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

  // The passengers' list and the room's menus share the picture, and the list
  // was drawn over any menu left open: one at a time
  function collapsePlayersDrawer() {
    const drawer = document.getElementById("players-drawer");
    const list = document.getElementById("players-popup");
    const btn = document.getElementById("players-btn");
    if (!list || !list.classList.contains("open")) return;
    if (drawer) {
      drawer.classList.remove("open");
      drawer.setAttribute("aria-expanded", "false");
    }
    list.classList.remove("open");
    list.setAttribute("aria-hidden", "true");
    if (btn) {
      btn.classList.remove("open");
      btn.setAttribute("aria-expanded", "false");
    }
  }

  function closeRoomMenus() {
    const menu = document.querySelector(".eat-drink-popup");
    if (menu) menu.remove();
    resetMenuButtons();
    closeGamesMenu();
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
    // The player's own words, as text (line breaks kept)
    const bioText = escapeHtml(player.bio || "No biography provided.").replace(
      /\r?\n/g,
      "<br>",
    );
    const nameText = escapeHtml(player.name);

    playerContent.innerHTML = DOMPurify.sanitize(`
      <div class="player-popup-header">
        <div class="player-popup-avatar">
          <img src="${escapeHtml(player.avatar || "/images/default-avatar.svg")}" alt="${nameText}" />
        </div>
        <div class="player-popup-meta">
          <div class="player-popup-name">${nameText}${ageText}</div>
          ${birthdateText ? `<div class="player-popup-birthdate">${escapeHtml(birthdateText)}</div>` : ""}
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
        "Cannot request room players: socket or room not available",
      );
      return;
    }

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

  // Empties the passenger list between rooms
  function clearRoomPlayers() {
    const playersList = document.getElementById("players-list");
    if (playersList) playersList.innerHTML = "";
    setRoomPlayersCount(0);
  }

  // Function to display room players in popup
  function displayRoomPlayers(players) {
    const playersList = document.getElementById("players-list");
    if (!playersList) {
      console.error("Room players list element not found");
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

      const safeName = escapeHtml(player.name);
      const cabinShown = player.cabin_number || player.cabin;
      // "(You)" and "No cabin assigned" are the game's own words inside a
      // passenger's name and cabin (data-i18n: put into the reader's language)
      playerDiv.innerHTML = DOMPurify.sanitize(`
        <button type="button" class="player-avatar player-avatar-button" aria-label="View bio for ${safeName}">
          <img src="${escapeHtml(player.avatar || "/images/default-avatar.svg")}" alt="${safeName}" />
        </button>
        <div class="player-info">
          <div class="player-name">${safeName}${
            isCurrentPlayer ? ' <span data-i18n="">(You)</span>' : ""
          }</div>
          <div class="player-class">${escapeHtml(passengerClassLabel(player.cabin))}</div>
          <div class="player-cabin">${
            cabinShown
              ? escapeHtml(cabinShown)
              : '<span data-i18n="">No cabin assigned</span>'
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
          closeRoomMenus();
          requestRoomPlayers();
        }

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
      }
    });
  }

  if (playerInfoPopup) {
    playerInfoPopup.addEventListener("click", (event) => {
      if (event.target === playerInfoPopup) {
        playerInfoPopup.style.display = "none";
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
    }
  });

  // Socket listener for room players response
  if (socket) {
    socket.on("room-players", (data) => {
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
      return;
    }
    if (departureStarted) return;
    departureStarted = true;


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
    whistleSound.play().catch(() => {});

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
      return;
    }

    // Endless scrolling layers (.water, .swater, .waves, .land-middle) hold a
    // .scroll-track two tiles wide; a tile is the layer's own width (fixed,
    // since the scene is laid out at 1920 and scaled as a whole). Sliding the
    // track by transform, wrapped every tile, looks exactly like scrolling the
    // background but needs no repaint.
    const trackTileW = new Map();
    const slideTrack = (layer, position) => {
      const track = layer && layer.firstElementChild;
      if (!track) return;
      let tileW = trackTileW.get(layer);
      if (!tileW) {
        tileW = layer.offsetWidth; // read once: a layout read every frame would cost more than it saves
        if (!tileW) return; // not laid out (hidden): try again next frame
        trackTileW.set(layer, tileW);
      }
      const x = ((position % tileW) + tileW) % tileW;
      track.style.transform = `translate3d(${-x}px, 0, 0)`;
    };

    let southamptonElementsHidden = false;
    const hideSouthamptonVisuals = (reason = "timeline-sync") => {
      if (southamptonElementsHidden) return;
      southamptonElementsHidden = true;
      [southamptonCity, dock].forEach((el) => {
        if (el) {
          el.style.display = "none";
        }
      });
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
          }
          if (innerImg && !innerImg.complete) {
            innerImg.addEventListener(
              "load",
              () => {
              },
              { once: true },
            );
          }
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
          }
        }
      }
    };

    // Expose a test API to allow spawning a yacht manually from the console
    // Useful for testing without waiting for the timeline.
    window.spawnYachtNow = () => {
      try {
        spawnYachtRandomly();
      } catch (e) {
        console.error("spawnYachtNow failed", e);
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
    };

    // Developer helpers to tune yacht vertical offset at runtime
    window.setYachtOffset = (px) => {
      const root = document.documentElement;
      const n = Number(px);
      if (Number.isNaN(n)) {
        return;
      }
      root.style.setProperty("--yacht-offset", `${n}px`);
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
    };

    // Per-yacht controls: change each yacht's vertical offset and horizontal position
    window.setIndividualYachtOffset = (index, px) => {
      // index: 1|2|3, px: number or string with units
      if (![1, 2, 3].includes(Number(index))) {
        return;
      }
      const root = document.documentElement;
      const v = typeof px === "string" ? px : `${Number(px)}px`;
      root.style.setProperty(`--yacht-offset-${index}`, v);
    };

    window.setYachtLeft = (index, value) => {
      // Set the left position of a yacht container; value can be percent or px
      const idx = Number(index);
      if (![1, 2, 3].includes(idx)) {
        return;
      }
      const el = document.querySelector(`.yacht-${idx}-container`);
      if (!el) {
        return;
      }
      el.style.left = value;
    };

    window.setYachtScale = (index, scale) => {
      const idx = Number(index);
      if (![1, 2, 3].includes(idx)) {
        return;
      }
      // Setting the CSS variable for scale already in use by the stylesheet
      document.documentElement.style.setProperty(
        `--yacht-scale-${idx}`,
        String(scale),
      );
    };

    window.resetYachtOffsets = () => {
      const root = document.documentElement;
      [1, 2, 3].forEach((i) =>
        root.style.removeProperty(`--yacht-offset-${i}`),
      );
    };

    // Debug helper to force Cherbourg night sprite for testing
    window.showCherbourgNight = (show = true) => {
      try {
        const el = document.querySelector(".cherbourg-night");
        if (!el) return;
        el.style.opacity = show ? 1 : 0;
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
      } catch (e) {
        console.error("Failed to set cherbourg position:", e);
      }
    };

    // Size helper — change the width of Cherbourg night sprite (accepts CSS units)
    window.setCherbourgSize = (size = "85vw") => {
      try {
        const root = document.documentElement;
        root.style.setProperty("--cherbourg-width", size);
      } catch (e) {
        console.error("Failed to set cherbourg size:", e);
      }
    };

    // Reset cherbourg size to default (removes inline var)
    window.resetCherbourgSize = () => {
      try {
        const root = document.documentElement;
        root.style.removeProperty("--cherbourg-width");
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
          num = null;
        }
      }
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

      // Endless scroll of the wake, sea and coast: slide each layer's strip
      slideTrack(waves, wavesPosition);
      slideTrack(water, waterPosition);

      // Keep the vista wing water phase-locked to the scene water so the
      // texture scrolls straight through the scene edge without a seam
      const wingWater = document.getElementById("water-wing");
      const vista = window.__vista;
      if (wingWater && vista && vista.active) {
        wingWater.style.backgroundPosition = `${
          vista.sceneLeft - waterPosition * vista.scale
        }px 0`;
      }

      slideTrack(swater, swaterPosition);

      // land_middle keeps scrolling but fades out at the Isle of Wight
      if (landMiddle) {
        slideTrack(landMiddle, landMiddlePosition);

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
        } else {
          // Update yacht container transform with translateX only so the
          // yacht image inside can keep its `translate(-50%, 0) scale(...)`.
          yacht.element.style.transform = `translateX(${yacht.position}px)`;
        }
      }

    };
    // on the scene's shared frames (RBV.sceneFrame, core/rbv.js)
    const onFrame = (now) => {
      if (RBV.sceneFrame(now)) stepDeparture();
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
      // In the North Atlantic the ship sailed long ago: no departure to play
      const atSea = !!v.DEV_NORTH_ATLANTIC;

      // If we're past departure time but haven't started yet
      if (atSea || elapsedSeconds >= TIMELINE_SECONDS.DEPARTURE_DELAY) {
        clearInterval(checkDepartureTime);

        // Check if departure already happened (player joined late or refreshed)
        if (atSea || elapsedSeconds > TIMELINE_SECONDS.DEPARTURE_DELAY + 5) {
          // 5 second grace period after departure
          departureStarted = true; // Mark as started to prevent re-triggering
          // Start animation at current state without playing sounds/music/teleport
          animateDeparture();
        } else {
          // Normal departure - play full sequence
          startDepartureSequence();
        }
      }
    }, 1000); // Check every second
  } else {
  }
});
