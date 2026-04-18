const socket = io({
  auth: {
    email: sessionStorage.getItem("userEmail"),
  },
});

socket.on("stats-loaded", (statsData) => {
  console.debug("📊 Received stats from server:", statsData);
  applyStatsToState(statsData);
  persistStatsLocally();
  console.debug("📊 Stats loaded and visual bars updated");
});

let currentRoom = { name: null, id: null };
const chatHistory = {
  rooms: {},
};
let isGlobalChat = false; // Global chat toggle state
console.debug("✅ Initialized socket connection and global variables.");

// Global voyage start time (will be set by server)
let voyageStartTime = null;

// Store pending sync data until functions are ready
let pendingVoyageState = null;
let pendingVoyageStartTime = null;
let initialSyncDone = false;
let lastServerElapsed = 0;
let lastServerElapsedAt = 0;
let latestVoyageState = null; // Track most recent server-authoritative snapshot

// Mirror the server-side voyage timeline so refreshes show the same speed/location
const TIMELINE_SECONDS = {
  DEPARTURE_DELAY: 12 * 60,
  SOUTHAMPTON_WATER_END: 20 * 60,
  NEEDLES_COMPLETE: 5130, // 1h 25m 30s
  CHANNEL_COMPLETE: 5 * 60 * 60,
  APPROACH_COMPLETE: 18_900,
  BERTHING_COMPLETE: 19_500,
};

const SHIP_ACCELERATION = 0.012; // knots per second^2, matches server model
const CHERBOURG_DECEL_RATE =
  19 / (TIMELINE_SECONDS.BERTHING_COMPLETE - TIMELINE_SECONDS.CHANNEL_COMPLETE);
// Speed threshold at which Cherbourg should appear and begin the slow move
const CHERBOURG_SHOW_KNOTS = 10; // show when ship slowed to 10 knots or below
// Factor applied to ship speed once Cherbourg begins to drift in. Keep low for a gentle motion.
const CHERBOURG_SLOW_MOVE_FACTOR = 0.15; // 15% of ship speed (clamped with a minimum)

// Seeded PRNG (mulberry32) — deterministic random from voyageStartTime so all clients match
function createSeededRng(seed) {
  let s = seed | 0;
  return function () {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Logging control
const RBV_LOG_LEVELS = {
  error: 0,
  warn: 1,
  info: 2,
  log: 2,
  debug: 3,
  trace: 4,
};

const storedLogLevel = localStorage.getItem("rbvrpg:logLevel") || "warn";
let activeLogLevel = RBV_LOG_LEVELS[storedLogLevel] ?? RBV_LOG_LEVELS.info;

const originalConsole = {
  log: console.log.bind(console),
  info: console.info.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console),
  debug: console.debug
    ? console.debug.bind(console)
    : console.log.bind(console),
};

function shouldLog(level) {
  return activeLogLevel >= (RBV_LOG_LEVELS[level] ?? RBV_LOG_LEVELS.info);
}

console.log = (...args) => {
  if (shouldLog("log")) {
    originalConsole.log("[RBVRPG]", ...args);
  }
};

console.info = (...args) => {
  if (shouldLog("info")) {
    originalConsole.info("[RBVRPG]", ...args);
  }
};

console.warn = (...args) => {
  if (shouldLog("warn")) {
    originalConsole.warn("[RBVRPG]", ...args);
  }
};

console.error = (...args) => {
  originalConsole.error("[RBVRPG]", ...args);
};

console.debug = (...args) => {
  if (shouldLog("debug")) {
    originalConsole.debug("[RBVRPG]", ...args);
  }
};

window.RBVLog = {
  setLevel(levelName) {
    if (levelName in RBV_LOG_LEVELS) {
      activeLogLevel = RBV_LOG_LEVELS[levelName];
      localStorage.setItem("rbvrpg:logLevel", levelName);
    }
  },
  getLevel() {
    return Object.keys(RBV_LOG_LEVELS).find(
      (key) => RBV_LOG_LEVELS[key] === activeLogLevel,
    );
  },
  levels: Object.keys(RBV_LOG_LEVELS),
  originalConsole,
};

// ── DEV-ONLY: North Atlantic override ──────────────────────────────
// Flip to true to freeze the voyage in open ocean. Change DEV_HOUR
// to test any time of day (0-23, fractional OK e.g. 17.5 = 5:30 PM).
// Set back to false when done.
const DEV_NORTH_ATLANTIC = false;
const DEV_HOUR = 12; // 0 = midnight, 6 = sunrise, 12 = noon, 17 = sunset, 22 = night
// ── end dev override ───────────────────────────────────────────────

// Listen for voyage start time from server
socket.on("voyage-start-time", (serverStartTime) => {
  voyageStartTime = serverStartTime;
  pendingVoyageStartTime = serverStartTime;
  console.debug(
    `⏰ Received voyage start time from server: ${new Date(
      voyageStartTime,
    ).toISOString()}`,
  );

  // Try to sync immediately if functions are available
  if (
    typeof updateInfoBar === "function" &&
    typeof updateSkyImage === "function"
  ) {
    performInitialSync();
  }
});

// Listen for current voyage state from server (for immediate sync on refresh)
socket.on("voyage-state", (currentVoyageState) => {
  console.debug(
    "🚢 Received current voyage state from server:",
    currentVoyageState,
  );

  // Store for later if functions aren't ready yet
  pendingVoyageState = currentVoyageState;
  latestVoyageState = currentVoyageState;

  // Track server elapsed time for clock-skew-free interpolation
  if (typeof currentVoyageState.elapsedSeconds === "number") {
    lastServerElapsed = currentVoyageState.elapsedSeconds;
    lastServerElapsedAt = Date.now();
  }

  // Keep voyage values in sync; the info bar itself is rendered via updateInfoBar().
  if (DEV_NORTH_ATLANTIC) {
    window.currentSpeed = 22;
    window.targetSpeed = 22;
  } else {
    // Set window.currentSpeed for visual effects (smoke, wind)
    window.currentSpeed = currentVoyageState.speedValue;
    // Set target speed for smooth acceleration/deceleration
    window.targetSpeed = currentVoyageState.targetSpeed;
  }
  console.debug(
    `💨 Set window.currentSpeed to ${window.currentSpeed} and targetSpeed to ${window.targetSpeed} for visual effects`,
  );

  // Update sky immediately with server-synced time if function is available
  if (typeof updateSkyImage === "function") {
    updateSkyImage();
    console.debug("🌤️ Updated sky with server voyage state");
  }

  if (typeof updateInfoBar === "function") {
    updateInfoBar();
  }

  // Try to perform full sync if functions are available
  if (
    typeof updateInfoBar === "function" &&
    typeof updateSkyImage === "function"
  ) {
    performInitialSync();
  }
});

// Listen for server narrative events (registered once at top level, NOT inside voyage-state)
socket.on("narrative-event", (data) => {
  try {
    // Suppress narrative events in dev North Atlantic mode — show our own text
    if (DEV_NORTH_ATLANTIC) {
      const el = document.getElementById("story-text");
      if (el)
        el.textContent =
          "We are now deep in the North Atlantic, making steady progress. The open ocean stretches to every horizon.";
      return;
    }
    console.debug("📣 Received narrative-event from server:", data);
    const storyTextElement = document.getElementById("story-text");
    if (storyTextElement) {
      storyTextElement.style.opacity = "0";
      setTimeout(() => {
        storyTextElement.textContent = data.text;
        storyTextElement.style.opacity = "1";
      }, 500);
    }

    // Advance client's narrative index to avoid replaying
    if (narrativeSystem) {
      narrativeSystem.currentEventIndex = data.index + 1;
      sessionStorage.setItem(
        "narrativeEventIndex",
        narrativeSystem.currentEventIndex.toString(),
      );
    }
  } catch (err) {
    console.error("❌ Failed to process narrative-event:", err);
  }
});

// Receive the current narrative index for this connection from the server
socket.on("narrative-current", (data) => {
  console.debug("📣 Received narrative-current from server:", data);
  const storyTextElement = document.getElementById("story-text");
  if (storyTextElement && data && data.text) {
    storyTextElement.textContent = data.text;
    storyTextElement.style.opacity = "1";
  }
  if (narrativeSystem && data && typeof data.index === "number") {
    narrativeSystem.currentEventIndex = data.index + 1;
    sessionStorage.setItem(
      "narrativeEventIndex",
      narrativeSystem.currentEventIndex.toString(),
    );
  }
});

// Handle automatic room joining for reconnections
function handleReconnectionRoomJoin() {
  // Only auto-join if not already in a room
  if (currentRoom.name) {
    console.debug(`🔄 Already in room ${currentRoom.name}, skipping auto-join`);
    return;
  }

  const characterData = JSON.parse(sessionStorage.getItem("character"));
  if (!characterData) {
    console.warn("⚠️ No character data found, cannot auto-join room");
    return;
  }

  const voyageAnchor = voyageStartTime || pendingVoyageStartTime || null;
  const elapsedSeconds = voyageAnchor
    ? Math.max(0, Math.floor((Date.now() - voyageAnchor) / 1000))
    : 0;

  if (!voyageAnchor) {
    console.warn(
      "⚠️ Voyage start time not yet available; defaulting spawn to Southampton",
    );
  }

  if (elapsedSeconds >= TIMELINE_SECONDS.DEPARTURE_DELAY) {
    // Voyage has departed - spawn on ship
    console.debug(
      `🚢 Voyage already departed (${Math.floor(
        elapsedSeconds / 60,
      )} min elapsed) - auto-joining ship`,
    );

    // Try to find player's cabin first, otherwise default to promenade
    const cabinRoom = findPlayerCabin();
    const defaultShipRoom =
      (deckRooms.boat || deckRooms.bd || deckRooms["boat_deck"])?.find?.(
        (r) => r.id === "port_promenade_bd",
      ) || deckRooms?.a?.find?.((r) => r.id === "port_promenade_bd");

    const fallbackRoom =
      (deckRooms.boat || deckRooms.bd || deckRooms["boat_deck"])?.[0] ||
      deckRooms?.a?.[0] ||
      deckRooms?.southampton?.[0] ||
      null;
    const spawnRoom = cabinRoom || defaultShipRoom || fallbackRoom;
    if (spawnRoom) {
      enterRoom(spawnRoom);
      console.debug(`🚪 Auto-joined ship room: ${spawnRoom.name}`);
    } else {
      console.error("❌ Could not find ship spawn location for reconnection");
    }
  } else {
    // Voyage hasn't departed yet - spawn at Southampton
    console.debug(
      `⚓ Voyage not yet departed (${elapsedSeconds}s elapsed) - auto-joining Southampton`,
    );

    const initialRoom = deckRooms.southampton?.find(
      (r) => r.name === "Berth 44 Forward Docks",
    );
    const fallbackRoom =
      initialRoom ||
      deckRooms?.southampton?.[0] ||
      (deckRooms.boat || deckRooms.bd || deckRooms["boat_deck"])?.[0] ||
      null;

    if (fallbackRoom) {
      enterRoom(fallbackRoom);
      console.debug(`🚪 Auto-joined Southampton room: ${fallbackRoom.name}`);
    } else {
      console.error(
        "❌ Could not determine any spawn location during reconnection",
      );
    }
  }
}

// Narrative System
const narrativeSystem = {
  startTime: null,
  currentEventIndex: 0,
  events: [
    {
      time: 0,
      text: "Final preparations are being made for departure...",
    },
    {
      time: 720, // 12 minutes - Departure begins
      text: "The ship's horn echoes across Southampton Water. The moorings are cast off, and Britannic slowly pulls away from the dock.",
    },
    {
      time: 930, // 15 minutes 30 seconds - Southampton Water end
      text: "We depart Southampton Water and enter the Solent, increasing to cruising speed.",
    },
    {
      time: 2730, // 45 minutes 30 seconds
      text: "The Solent stretches ahead as we make our way toward the open sea.",
    },
    {
      time: 4380, // 1h 13m - Isle of Wight visible
      text: "The Isle of Wight coastline becomes visible on the starboard side.",
    },
    {
      time: 4980, // 1h 23m - Nab Tower
      text: "We are now passing the Nab Tower, a few miles East of us.",
    },
    {
      time: 5460, // 1h 31m - Isle of Wight fades
      text: "The Isle of Wight fades astern as we enter the English Channel proper.",
    },
    {
      time: 6330, // 1h 45m 30s
      text: "The engines settle into their steady rhythm for the channel crossing.",
    },
    {
      time: 11130, // 3h 5m 30s
      text: "The English coast has disappeared from view. Only open water surrounds us now.",
    },
    {
      time: 14730, // 4h 5m 30s - Mid-channel
      text: "We are now deep in the English Channel, making steady progress toward France.",
    },
    {
      time: 18330, // 5h 5m 30s - French coast visible
      text: "The French coast appears on the horizon as we approach Cherbourg.",
    },
  ],

  weatherConditions: [
    "Clear skies, calm seas",
    "Light clouds, gentle breeze",
    "Overcast skies, moderate waves",
    "Sunny intervals, fresh winds",
    "Scattered clouds, choppy waters",
    "Clear horizon, steady winds",
  ],

  init() {
    // Load current event index from sessionStorage to prevent replaying on reconnect
    const savedIndex = sessionStorage.getItem("narrativeEventIndex");
    if (savedIndex !== null) {
      this.currentEventIndex = parseInt(savedIndex, 10);
    }

    // startTime will be set by server via socket event
    // Don't set it here anymore
    this.updateNarrative();
    this.updateWeather();

    // Server pushes narrative-event every 5 seconds — no local narrative timer needed
    // Update weather every 2 minutes
    this._weatherInterval = setInterval(() => this.updateWeather(), 120000);

    console.debug("✅ Narrative system initialized (waiting for server time)");
  },

  updateNarrative() {
    if (!this.startTime) return;

    const elapsed = getElapsedSeconds();
    const storyTextElement = document.getElementById("story-text");

    if (!storyTextElement) return;

    // Check if we have a new event to display
    const nextEvent = this.events[this.currentEventIndex];
    if (nextEvent && elapsed >= nextEvent.time) {
      storyTextElement.style.opacity = "0";

      setTimeout(() => {
        storyTextElement.textContent = nextEvent.text;
        storyTextElement.style.opacity = "1";
        this.currentEventIndex++;

        // Save current event index to sessionStorage to prevent replaying on reconnect
        sessionStorage.setItem(
          "narrativeEventIndex",
          this.currentEventIndex.toString(),
        );

        console.debug(`📖 Narrative event: ${nextEvent.text}`);
      }, 500);
    }
  },

  updateWeather() {
    const weatherElement = document.getElementById("current-weather");
    if (!weatherElement) return;

    const randomWeather =
      this.weatherConditions[
        Math.floor(Math.random() * this.weatherConditions.length)
      ];

    weatherElement.style.opacity = "0";
    setTimeout(() => {
      weatherElement.textContent = `Weather: ${randomWeather}`;
      weatherElement.style.opacity = "1";
      console.debug(`🌤️ Weather updated: ${randomWeather}`);
    }, 300);
  },
};

function setScale() {
  const root = document.documentElement;
  const styles = getComputedStyle(root);
  const baseWidth =
    parseFloat(styles.getPropertyValue("--scene-width")) || 1920;

  const baseHeight =
    parseFloat(styles.getPropertyValue("--scene-height")) || 1080;
  const waterBaseline =
    parseFloat(styles.getPropertyValue("--water-bottom")) || 150;
  const manualOffset =
    parseFloat(styles.getPropertyValue("--scene-manual-offset")) || 0;

  const widthRatio = window.innerWidth / baseWidth;
  const sceneHeight = baseHeight * widthRatio;
  const viewportHeight = window.innerHeight;
  // Compute the offset required to keep the waterline touching the viewport bottom.
  // The water element sits `waterBaseline` px above the scene-layer bottom in design canvas
  // units. After scaling, that becomes waterBaseline * widthRatio. To compensate so the
  // water contacts the viewport bottom, set the bottom offset to the negative of that
  // visual distance.
  const desiredOffset = viewportHeight - sceneHeight;
  const waterCorrection = -waterBaseline * widthRatio;

  // Use the larger of the two adjustments so the scene either fills tall viewports
  // or drops low enough for the water to touch the bottom edge.
  let bottomOffset = Math.max(desiredOffset, waterCorrection);

  // Add the manual user offset after the clamp.
  bottomOffset += manualOffset;

  root.style.setProperty("--scale", widthRatio.toString());
  root.style.setProperty("--scene-bottom-offset", `${bottomOffset}px`);
}

window.addEventListener("resize", setScale);
setScale(); // Initial call to set the scale

// Initialize the open_map audio
const openMapSound = new Audio("/sounds/open_map.mp3");
openMapSound.preload = "auto";

console.debug("✅ Initialized open_map audio.");

// Initialize door sound effects
const openDoorSound = new Audio("/sounds/open_door.mp3");
const closeDoorSound = new Audio("/sounds/close_door.mp3");
openDoorSound.preload = "auto";
closeDoorSound.preload = "auto";

const eatSound = new Audio("/sounds/eat.mp3");
const drinkSound = new Audio("/sounds/drink.mp3");
eatSound.preload = "auto";
drinkSound.preload = "auto";

function playConsumptionSound(item) {
  let soundToPlay = null;

  if (item?.topCategory === "food") {
    soundToPlay = eatSound;
  } else if (
    item?.topCategory === "soft_beverages" ||
    item?.topCategory === "alcoholic_beverages"
  ) {
    soundToPlay = drinkSound;
  } else if ((item?.hungry ?? 0) > 0) {
    soundToPlay = eatSound;
  } else if ((item?.thirsty ?? 0) > 0) {
    soundToPlay = drinkSound;
  }

  if (!soundToPlay) {
    return;
  }

  soundToPlay.currentTime = 0;
  soundToPlay.play().catch(() => {});
}

const interiorSound = new Audio("/sounds/ship_interior.mp3");
interiorSound.loop = true; // Loop the ambient sound
interiorSound.volume = 0.5; // Set volume (adjustable as needed)

const exteriorSound = new Audio("/sounds/ship_exterior.mp3");
exteriorSound.loop = true; // Loop the ambient sound
exteriorSound.volume = 0.5; // Set volume (adjustable as needed)

const deckRooms = {
  boat_deck: [
    {
      id: "grand_staircase_bd",
      name: "Grand Staircase",
      type: "grand-staircase",
      isSVG: true,
      location: {
        image: "grand stair1.png",
        chatRoom: "grand_staircase_bd",
      },
    },
    {
      id: "gymnasium_bd",
      name: "1st Class Gymnasium",
      x: 59.3,
      y: 61,
      type: "gymnasium",
      isSVG: true,
      location: {
        image: "1st gym1.png",
        chatRoom: "gymnasium_bd",
      },
    },
    {
      id: "port_promenade_bd",
      name: "1st Class Port Promenade",
      x: 36,
      y: 15,
      type: "promenade",
      isSVG: true,
      location: {
        image: "first class promenade.webp",
        chatRoom: "port_promenade_bd",
      },
    },
    {
      id: "starboard_promenade_bd",
      name: "1st Class Starboard Promenade",
      x: 36,
      y: 83.1, // Mirror position on opposite side
      type: "promenade",
      isSVG: true,
      location: {
        image: "BD first starb prom1.png",
        chatRoom: "starboard_promenade_bd",
      },
    },
    {
      id: "childrens_playroom_bd",
      name: "Children's Playroom",
      x: 59.3, // Position adjusted to fit on the deck plan (adjust as needed)
      y: 30.1, // Position adjusted to fit on the deck plan (adjust as needed)
      type: "playroom",
      isSVG: true,
      location: {
        image: "Childrens Playroom.png",
        chatRoom: "childrens_playroom_bd",
      },
    },
    {
      id: "port_officers_promenade_bd",
      name: "Port Officer's Promenade",
      x: 81,
      y: 15.3,
      type: "promenade",
      isSVG: true,
      location: {
        image: "Port Officer's Promenade.png", // Ensure this exists
        chatRoom: "port_officers_promenade_bd",
      },
    },
    {
      id: "starboard_officers_promenade_bd",
      name: "Starboard Officer's Promenade",
      x: 81,
      y: 71.1,
      type: "promenade",
      isSVG: true,
      location: {
        image: "Starboard Officer's Promenade.png", // Ensure this image exists
        chatRoom: "starboard_officers_promenade_bd",
      },
    },
    {
      id: "port_bridge_wing_bd",
      name: "Port Bridge Wing",
      x: 96.1, // Adjust coordinates as needed
      y: 14, // Adjust coordinates as needed
      type: "bridge_wing",
      isSVG: true,
      location: {
        image: "Port Bridge Wing.png", // First image
        chatRoom: "port_bridge_wing_bd",
      },
    },
    {
      id: "starboard_bridge_wing_bd",
      name: "Starboard Bridge Wing",
      x: 96.1, // Same x position
      y: 62, // Mirrored y position
      type: "bridge_wing",
      isSVG: true,
      location: {
        image: "Starboard Bridge Wing.png", // First image
        chatRoom: "starboard_bridge_wing_bd",
      },
    },
    {
      id: "bridge_bd",
      name: "the Bridge",
      x: 96, // Same x position as bridge wings
      y: 41, // Positioned between port (14) and starboard (62) bridge wings
      type: "bridge",
      isSVG: true,
      location: {
        image: "Bridge.png", // First image
        chatRoom: "bridge_bd",
      },
    },
    {
      id: "wheelhouse_bd",
      name: "the Wheelhouse",
      x: 96, // Same x position as bridge
      y: 41, // Same y position as bridge
      type: "wheelhouse",
      isSVG: true,
      location: {
        image: "wheelhouse1.png", // First image
        chatRoom: "wheelhouse_bd",
      },
    },
    {
      id: "starboard_engineers_promenade_bd",
      name: "Starboard Engineer's Promenade",
      type: "promenade",
      isSVG: true,
      location: {
        image: "starb engineers prom1.png", // First image
        chatRoom: "starboard_engineers_promenade_bd",
      },
    },
    {
      id: "port_engineers_promenade_bd",
      name: "Port Engineer's Promenade",
      type: "promenade",
      isSVG: true,
      location: {
        image: "port engineers prom1.png", // First image
        chatRoom: "port_engineers_promenade_bd",
      },
    },
    {
      id: "starboard_2nd_class_promenade_bd",
      name: "Starboard 2nd Class Promenade",
      type: "promenade",
      isSVG: true,
      location: {
        image: "starb 2nd class prom1.png", // First image
        chatRoom: "starboard_2nd_class_promenade_bd",
      },
    },
    {
      id: "port_2nd_class_promenade_bd",
      name: "Port 2nd Class Promenade",
      type: "promenade",
      isSVG: true,
      location: {
        image: "port 2nd class prom1.png", // First image
        chatRoom: "port_2nd_class_promenade_bd",
      },
    },
    {
      id: "2nd_class_staircase_bd",
      name: "2nd Class Staircase",
      type: "staircase",
      isSVG: true,
      location: {
        image: "2nd class staircasebd1.png", // First image
        chatRoom: "2nd_class_staircase_bd",
      },
    },
  ],
  b_deck: [
    {
      id: "forecastle_b",
      name: "Forecastle",
      type: "forecastle",
      isSVG: true,
      location: {
        image: "forecastle1.png",
        chatRoom: "forecastle_b",
      },
    },
    {
      id: "first_class_b_forward_overlooking_promenade",
      name: "1st Class B-Deck Forward Overlooking Promenade",
      type: "promenade",
      isSVG: true,
      location: {
        images: [
          "1C B overlook prom1.png",
          "1C B overlook prom2.png",
          "1C B overlook prom3.png",
          "1C B overlook prom4.png",
          "1C B overlook prom5.png",
          "1C B overlook prom6.png",
        ],
        chatRoom: "first_class_b_forward_overlooking_promenade",
      },
    },
    {
      id: "first_class_port_b_enclosed_promenade",
      name: "1st Class Port B-Deck Enclosed Promenade",
      type: "promenade",
      isSVG: true,
      location: {
        image: "placeholder.jpg",
        chatRoom: "first_class_port_b_enclosed_promenade",
      },
    },
    {
      id: "first_class_starboard_b_enclosed_promenade",
      name: "1st Class Starboard B-Deck Enclosed Promenade",
      type: "promenade",
      isSVG: true,
      location: {
        image: "placeholder.jpg",
        chatRoom: "first_class_starboard_b_enclosed_promenade",
      },
    },
    {
      id: "poop_deck",
      name: "Poop Deck",
      type: "poop-deck",
      isSVG: true,
      location: {
        image: "placeholder.jpg",
        chatRoom: "poop_deck",
      },
    },
    {
      id: "grand_staircase_b",
      name: "Grand Staircase",
      type: "grand-staircase",
      isSVG: true,
      location: {
        image: "placeholder.jpg",
        chatRoom: "grand_staircase_b",
      },
    },
    {
      id: "third_class_smoke_room_b",
      name: "3rd Class Smoke Room",
      type: "third-class-smoking-room",
      isSVG: true,
      location: {
        image: "placeholder.jpg",
        chatRoom: "third_class_smoke_room_b",
      },
    },
    {
      id: "second_class_smoke_room_b",
      name: "2nd Class Smoke Room",
      type: "second-class",
      isSVG: true,
      location: {
        image: "placeholder.jpg",
        chatRoom: "second_class_smoke_room_b",
      },
    },
    {
      id: "second_class_starboard_promenade_b",
      name: "2nd Class Starboard Promenade",
      type: "second-class",
      isSVG: true,
      location: {
        image: "placeholder.jpg",
        chatRoom: "second_class_starboard_promenade_b",
      },
    },
    {
      id: "second_class_port_promenade_b",
      name: "2nd Class Port Promenade",
      type: "second-class",
      isSVG: true,
      location: {
        image: "placeholder.jpg",
        chatRoom: "second_class_port_promenade_b",
      },
    },
    {
      id: "b_deck_aft_staircase",
      name: "B-Deck Aft Staircase",
      type: "first-class",
      isSVG: true,
      location: {
        image: "placeholder.jpg",
        chatRoom: "b_deck_aft_staircase",
      },
    },
    {
      id: "restaurant_reception_room",
      name: "Restaurant Reception Room",
      type: "first-class",
      isSVG: true,
      location: {
        image: "placeholder.jpg",
        chatRoom: "restaurant_reception_room",
      },
    },
    {
      id: "a_la_carte_restaurant",
      name: "À La Carte Restaurant",
      type: "first-class",
      isSVG: true,
      location: {
        image: "placeholder.jpg",
        chatRoom: "a_la_carte_restaurant",
      },
    },
    {
      id: "cabin_b81",
      name: "Cabin B-81",
      type: "cabin",
      isSVG: true,
      location: {
        image: "ROOM PIC FOR B59 B51 B65 B73 B81.png",
        chatRoom: "cabin_b81",
      },
    },
    {
      id: "cabin_b83",
      name: "Cabin B-83",
      type: "cabin",
      isSVG: true,
      location: {
        image: "ROOM PIC FOR B63 B57 B53 B71 B77 B83.png",
        chatRoom: "cabin_b83",
      },
    },
    {
      id: "cabin_b79",
      name: "Cabin B-79",
      type: "cabin",
      isSVG: true,
      location: {
        image: "ROOM PIC FOR B49 B55 B67 B79.png",
        chatRoom: "cabin_b79",
      },
    },
    {
      id: "cabin_b77",
      name: "Cabin B-77",
      type: "cabin",
      isSVG: true,
      location: {
        image: "ROOM PIC FOR B63 B57 B53 B71 B77 B83.png",
        chatRoom: "cabin_b77",
      },
    },
    {
      id: "cabin_b75",
      name: "Cabin B-75",
      type: "cabin",
      isSVG: true,
      location: {
        image: "ROOM PIC FOR B75.png",
        chatRoom: "cabin_b75",
      },
    },
    {
      id: "cabin_b73",
      name: "Cabin B-73",
      type: "cabin",
      isSVG: true,
      location: {
        image: "ROOM PIC FOR B59 B51 B65 B73 B81.png",
        chatRoom: "cabin_b73",
      },
    },
    {
      id: "cabin_b71",
      name: "Cabin B-71",
      type: "cabin",
      isSVG: true,
      location: {
        image: "ROOM PIC FOR B63 B57 B53 B71 B77 B83.png",
        chatRoom: "cabin_b71",
      },
    },
    {
      id: "cabin_b69",
      name: "Cabin B-69",
      type: "cabin",
      isSVG: true,
      location: {
        image: "ROOM PIC FOR B59 B51 B65 B73 B81.png",
        chatRoom: "cabin_b69",
      },
    },
    {
      id: "cabin_b67",
      name: "Cabin B-67",
      type: "cabin",
      isSVG: true,
      location: {
        image: "ROOM PIC FOR B49 B55 B67 B79.png",
        chatRoom: "cabin_b67",
      },
    },
    {
      id: "cabin_b63",
      name: "Cabin B-63",
      type: "cabin",
      isSVG: true,
      location: {
        image: "ROOM PIC FOR B63 B57 B53 B71 B77 B83.png",
        chatRoom: "cabin_b63",
      },
    },
    {
      id: "cabin_b65",
      name: "Cabin B-65",
      type: "cabin",
      isSVG: true,
      location: {
        image: "ROOM PIC FOR B59 B51 B65 B73 B81.png",
        chatRoom: "cabin_b65",
      },
    },
    {
      id: "cabin_b61",
      name: "Cabin B-61",
      type: "cabin",
      isSVG: true,
      location: {
        image: "ROOM PIC FOR B61.png",
        chatRoom: "cabin_b61",
      },
    },
    {
      id: "cabin_b57",
      name: "Cabin B-57",
      type: "cabin",
      isSVG: true,
      location: {
        image: "ROOM PIC FOR B63 B57 B53 B71 B77 B83.png",
        chatRoom: "cabin_b57",
      },
    },
    {
      id: "cabin_b59",
      name: "Cabin B-59",
      type: "cabin",
      isSVG: true,
      location: {
        image: "ROOM PIC FOR B59 B51 B65 B73 B81.png",
        chatRoom: "cabin_b59",
      },
    },
    {
      id: "cabin_b55",
      name: "Cabin B-55",
      type: "cabin",
      isSVG: true,
      location: {
        image: "ROOM PIC FOR B49 B55 B67 B79.png",
        chatRoom: "cabin_b55",
      },
    },
    {
      id: "cabin_b53",
      name: "Cabin B-53",
      type: "cabin",
      isSVG: true,
      location: {
        image: "ROOM PIC FOR B63 B57 B53 B71 B77 B83.png",
        chatRoom: "cabin_b53",
      },
    },
    {
      id: "cabin_b51",
      name: "Cabin B-51",
      type: "cabin",
      isSVG: true,
      location: {
        image: "ROOM PIC FOR B59 B51 B65 B73 B81.png",
        chatRoom: "cabin_b51",
      },
    },
    {
      id: "cabin_b49",
      name: "Cabin B-49",
      type: "cabin",
      isSVG: true,
      location: {
        image: "ROOM PIC FOR B49 B55 B67 B79.png",
        chatRoom: "cabin_b49",
      },
    },
  ],
  a_deck: [
    {
      id: "first_class_lounge_a",
      name: "First Class Lounge",
      type: "lounge",
      isSVG: true,
      location: {
        image: "First Class Lounge A Deck.jpg",
        chatRoom: "first_class_lounge_a",
      },
    },
    {
      id: "corridor_a",
      name: "the Corridor",
      type: "corridor",
      isSVG: true,
      location: {
        image: "Corridor.png", // Adjust image name as needed
        chatRoom: "corridor_a",
      },
    },
    {
      id: "corridor",
      name: "Corridor",
      type: "corridor",
      isSVG: true,
      location: {
        image: "a corridor1.png",
        chatRoom: "corridor",
      },
    },
    {
      id: "reading_writing_room_a",
      name: "Reading & Writing Room",
      type: "reading-writing-room",
      isSVG: true,
      location: {
        image: "Reading and Writing Room.jpg", // Adjust this if the image name differs
        chatRoom: "reading_writing_room_a",
      },
    },
  ],
  d_deck: [
    {
      id: "first_class_reception_d",
      name: "First Class Reception Room",
      coordinates: "582,4,675,5,676,105,583,106,582,4",
      type: "reception-room",
      isSVG: true,
      location: {
        image: "First Class Reception1.png", // Fallback image
        chatRoom: "first_class_reception_d",
      },
    },
    {
      id: "first_class_dining_room_d",
      name: "First Class Dining Room",
      coordinates:
        "453,5,581,4,581,44,555,44,555,68,582,68,582,107,454,107,454,69,485,69,485,44,452,44,453,5",
      type: "dining-room",
      isSVG: true,
      location: {
        image: "First Class Dining Room.jpg", // Fallback image
        chatRoom: "first_class_dining_room_d",
      },
    },
  ],
};

deckRooms.a_deck.push({
  id: "grand_staircase_a",
  name: "Grand Staircase (A-Deck)",
  type: "grand-staircase",
  isSVG: true,
  location: {
    image: "gsc A1.png",
    chatRoom: "grand_staircase_a",
  },
});

deckRooms.a_deck.push({
  id: "aft_corridor_a",
  name: "Aft Corridor",
  type: "corridor",
  isSVG: true,
  location: {
    image: "aft corridor.jpg", // First image as fallback
    chatRoom: "aft_corridor_a",
  },
});

deckRooms.a_deck.push({
  id: "aft_grand_staircase_a",
  name: "Aft Grand Staircase",
  type: "grand-staircase",
  isSVG: true,
  location: {
    image: "Aft Grand Staircase.png", // Fallback image
    chatRoom: "aft_grand_staircase_a",
  },
});

deckRooms.a_deck.push({
  id: "first_class_smoking_room_a",
  name: "First Class Smoking Room",
  type: "smoking-room",
  isSVG: true,
  location: {
    image: "First Class Smoking.png", // Fallback image
    chatRoom: "first_class_smoking_room_a",
  },
});

// Palm Court (Verandah) - add deckRooms entry so the SVG overlay can
// find this room and automatically bind click/tooltip handlers
deckRooms.a_deck.push({
  id: "verandah_palm_court_a",
  name: "Palm Court (A-Deck)",
  type: "palm-court",
  isSVG: true,
  location: {
    image: "Palm Court.png",
    chatRoom: "verandah_palm_court_a",
  },
});

deckRooms.a_deck.push({
  id: "first_class_starboard_enclosed_promenade_a",
  name: "1st Class Starboard Enclosed Promenade",
  type: "promenade",
  isSVG: true,
  location: {
    image: "1st starb A enclosed prom1.png",
    chatRoom: "first_class_starboard_enclosed_promenade_a",
  },
});

deckRooms.a_deck.push({
  id: "first_class_port_enclosed_promenade_a",
  name: "1st Class Port Enclosed Promenade",
  type: "promenade",
  isSVG: true,
  location: {
    image: "1st port A enclosed prom1.png",
    chatRoom: "first_class_port_enclosed_promenade_a",
  },
});

deckRooms.a_deck.push({
  id: "first_class_port_promenade_a",
  name: "1st Class Port Promenade",
  type: "promenade",
  isSVG: true,
  location: {
    image: "1st A port prom1.png",
    chatRoom: "first_class_port_promenade_a",
  },
});

deckRooms.a_deck.push({
  id: "first_class_starboard_promenade_a",
  name: "1st Class Starboard Promenade",
  type: "promenade",
  isSVG: true,
  location: {
    image: "1st A starb prom1.png",
    chatRoom: "first_class_starboard_promenade_a",
  },
});

deckRooms.a_deck.push({
  id: "first_a_corridor",
  name: "1st A Corridor",
  type: "corridor",
  isSVG: true,
  location: {
    image: "1st A corridor1.png",
    chatRoom: "first_a_corridor",
  },
});

deckRooms.a_deck.push(
  {
    id: "cabin_a1",
    name: "Cabin A1",
    type: "cabin",
    isSVG: true,
    location: {
      image: "Cabin A1.png",
      chatRoom: "cabin_a1",
    },
  },
  {
    id: "cabin_a2",
    name: "Cabin A2",
    type: "cabin",
    isSVG: true,
    location: {
      image: "Cabin A2.png",
      chatRoom: "cabin_a2",
    },
  },
  {
    id: "cabin_a3",
    name: "Cabin A3",
    type: "cabin",
    isSVG: true,
    location: {
      image: "Cabin A3.jpg",
      chatRoom: "cabin_a3",
    },
  },
  {
    id: "cabin_a4",
    name: "Cabin A4",
    type: "cabin",
    isSVG: true,
    location: {
      image: "Cabin A4.jpg",
      chatRoom: "cabin_a4",
    },
  },
  {
    id: "cabin_a5",
    name: "Cabin A5",
    type: "cabin",
    isSVG: true,
    location: {
      image: "Cabin A5.jpg",
      chatRoom: "cabin_a5",
    },
  },
  {
    id: "cabin_a6",
    name: "Cabin A6",
    type: "cabin",
    isSVG: true,
    location: {
      image: "Cabin A6.jpg",
      chatRoom: "cabin_a6",
    },
  },
  {
    id: "cabin_a7",
    name: "Cabin A7",
    type: "cabin",
    isSVG: true,
    location: {
      image: "Cabin A7.jpg",
      chatRoom: "cabin_a7",
    },
  },
  {
    id: "cabin_a8",
    name: "Cabin A8",
    type: "cabin",
    isSVG: true,
    location: {
      image: "Cabin A8.jpg",
      chatRoom: "cabin_a8",
    },
  },
  {
    id: "cabin_a9",
    name: "Cabin A9",
    type: "cabin",
    isSVG: true,
    location: {
      image: "Cabin A9.jpg",
      chatRoom: "cabin_a9",
    },
  },
  {
    id: "cabin_a10",
    name: "Cabin A10",
    type: "cabin",
    isSVG: true,
    location: {
      image: "Cabin A10.jpg",
      chatRoom: "cabin_a10",
    },
  },
  {
    id: "cabin_a11",
    name: "Cabin A11",
    type: "cabin",
    isSVG: true,
    location: {
      image: "placeholder.jpg",
      chatRoom: "cabin_a11",
    },
  },
  {
    id: "cabin_a12",
    name: "Cabin A12",
    type: "cabin",
    isSVG: true,
    location: {
      image: "placeholder.jpg",
      chatRoom: "cabin_a12",
    },
  },
  {
    id: "cabin_a14",
    name: "Cabin A14",
    type: "cabin",
    isSVG: true,
    location: {
      image: "placeholder.jpg",
      chatRoom: "cabin_a14",
    },
  },
  {
    id: "cabin_a15",
    name: "Cabin A15",
    type: "cabin",
    isSVG: true,
    location: {
      image: "placeholder.jpg",
      chatRoom: "cabin_a15",
    },
  },
  {
    id: "cabin_a16",
    name: "Cabin A16",
    type: "cabin",
    isSVG: true,
    location: {
      image: "placeholder.jpg",
      chatRoom: "cabin_a16",
    },
  },
  {
    id: "cabin_a17",
    name: "Cabin A17",
    type: "cabin",
    isSVG: true,
    location: {
      image: "placeholder.jpg",
      chatRoom: "cabin_a17",
    },
  },
  {
    id: "cabin_a18",
    name: "Cabin A18",
    type: "cabin",
    isSVG: true,
    location: {
      image: "placeholder.jpg",
      chatRoom: "cabin_a18",
    },
  },
  {
    id: "cabin_a19",
    name: "Cabin A19",
    type: "cabin",
    isSVG: true,
    location: {
      image: "placeholder.jpg",
      chatRoom: "cabin_a19",
    },
  },
  {
    id: "cabin_a20",
    name: "Cabin A20",
    type: "cabin",
    isSVG: true,
    location: {
      image: "placeholder.jpg",
      chatRoom: "cabin_a20",
    },
  },
  {
    id: "cabin_a21",
    name: "Cabin A21",
    type: "cabin",
    isSVG: true,
    location: {
      image: "placeholder.jpg",
      chatRoom: "cabin_a21",
    },
  },
  {
    id: "cabin_a22",
    name: "Cabin A22",
    type: "cabin",
    isSVG: true,
    location: {
      image: "placeholder.jpg",
      chatRoom: "cabin_a22",
    },
  },
  {
    id: "cabin_a23",
    name: "Cabin A23",
    type: "cabin",
    isSVG: true,
    location: {
      image: "placeholder.jpg",
      chatRoom: "cabin_a23",
    },
  },
  {
    id: "cabin_a30",
    name: "Cabin A30",
    type: "cabin",
    isSVG: true,
    location: {
      image: "A30.png",
      chatRoom: "cabin_a30",
    },
  },
  {
    id: "cabin_a32",
    name: "Cabin A32",
    type: "cabin",
    isSVG: true,
    location: {
      image: "A32.png",
      chatRoom: "cabin_a32",
    },
  },
  {
    id: "cabin_a34",
    name: "Cabin A34",
    type: "cabin",
    isSVG: true,
    location: {
      image: "A34.png",
      chatRoom: "cabin_a34",
    },
  },
  {
    id: "cabin_a36",
    name: "Cabin A36",
    type: "cabin",
    isSVG: true,
    location: {
      image: "A36.png",
      chatRoom: "cabin_a36",
    },
  },
  {
    id: "first_class_forward_overlooking_promenade_a",
    name: "1st Class Forward Overlooking Promenade",
    type: "promenade",
    isSVG: true,
    location: {
      image: "1st A overlook prom1.png",
      chatRoom: "first_class_forward_overlooking_promenade_a",
    },
  },
  {
    id: "second_class_staircase_a",
    name: "2nd Class Staircase",
    type: "staircase",
    isSVG: true,
    location: {
      image: "2nd class staircase1.png",
      chatRoom: "second_class_staircase_a",
    },
  },
);

// Southampton location (off-ship)
deckRooms.southampton = [
  {
    id: "berth_44_walkaway",
    name: "Berth 44",
    type: "walkaway",
    location: {
      image: "berth 44 walkaway.jpg",
      chatRoom: "berth_44_walkaway",
    },
  },
  {
    id: "dockside_cafe",
    name: "Dockside Cafe & Bar",
    type: "cafe",
    location: {
      image: "dockside cafe.jpg",
      chatRoom: "dockside_cafe",
    },
  },
  {
    id: "berth_44_forward",
    name: "Berth 44 Forward Docks",
    type: "docks",
    location: {
      image: "berth44 forward1.jpg",
      chatRoom: "berth_44_forward",
    },
  },
  {
    id: "first_class_gangway",
    name: "First Class Gangway",
    type: "gangway",
    location: {
      image: "firstclassgangway.jpg",
      chatRoom: "first_class_gangway",
    },
  },
  {
    id: "crew_gangway",
    name: "Crew Gangway",
    type: "crew-gangway",
    location: {
      image: "crew gangway.jpg",
      chatRoom: "crew_gangway",
    },
  },
  {
    id: "third_class_gangway",
    name: "3rd Class Gangway",
    type: "third-class-gangway",
    location: {
      image: "3rd class gangway.jpg",
      chatRoom: "third_class_gangway",
    },
  },
  {
    id: "berth_44_aft",
    name: "Berth 44 Aft Docks",
    type: "aft-docks",
    location: {
      image: "berth 44 aft docks1.jpg",
      chatRoom: "berth_44_aft",
    },
  },
  {
    id: "covered_walkway",
    name: "1st & 2nd Class Covered Walkway",
    type: "covered-walkway",
    location: {
      image: "berth 44 walkaway.jpg",
      chatRoom: "covered_walkway",
    },
  },
  {
    id: "boarding_tower",
    name: "1st Class Boarding Tower",
    type: "boarding-tower",
    location: {
      image: "placeholder.jpg",
      chatRoom: "boarding_tower",
    },
  },
];

console.debug("✅ Defined deckRooms:", deckRooms);

// Define room images for rooms with multiple variants
const roomImages = {
  grand_staircase_bd: {
    images: [
      "grand stair1.png",
      "grand stair2.png",
      "grand stair3.png",
      "grand stair4.png",
      "grand stair5.png",
      "grand stair6.png",
      "grand stair7.png",
      "grand stair8.png",
      "grand stair9.png",
      "grand stair10.png",
    ],
    currentIndex: 0,
  },
  childrens_playroom_bd: {
    images: [
      "Childrens Playroom.png",
      "Childrens Playroom2.png",
      "Childrens Playroom3.png",
    ],
    currentIndex: 0,
  },
  gymnasium_bd: {
    images: [
      "1st gym1.png",
      "1st gym2.png",
      "1st gym3.png",
      "1st gym4.png",
      "1st gym5.png",
    ],
    currentIndex: 0,
  },
  port_officers_promenade_bd: {
    images: [
      "Port Officer's Promenade.png",
      "Port Officer's Promenade2.png",
      "Port Officer's Promenade3.png",
    ],
    variants: {
      ms: [
        "Port Officer's Promenade (ms).png",
        "Port Officer's Promenade2.png",
        "Port Officer Promenade3.png",
      ],
    },
    currentIndex: 0,
  },
  starboard_officers_promenade_bd: {
    images: [
      "Starboard Officer's Promenade.png",
      "Starboard Officer's Promenade2.png",
      "Starboard Officer's Promenade3.png",
    ],
    variants: {
      ms: [
        "Starboard Officer's Promenade.png",
        "Starboard Officer's Promenade2.png",
        "Starboard Officer's Promenade3.png",
      ],
    },
    currentIndex: 0,
  },
  port_bridge_wing_bd: {
    images: [
      "Port Bridge Wing.png",
      "Port Bridge Wing2.png",
      "Port Bridge Wing3.png",
      "Port Bridge Wing4.png",
      "Port Bridge Wing5.png",
    ],
    variants: {
      ms: [
        "Port Bridge Wing.png",
        "Port Bridge Wing2.png",
        "Port Bridge Wing3.png",
        "Port Bridge Wing4.png",
        "Port Bridge Wing5.png",
      ],
    },
    currentIndex: 0,
  },
  starboard_bridge_wing_bd: {
    images: [
      "Starboard Bridge Wing.png",
      "Starboard Bridge Wing2.png",
      "Starboard Bridge Wing3.png",
      "Starboard Bridge Wing4.png",
      "Starboard Bridge Wing5.png",
    ],
    variants: {
      ms: [
        "Starboard Bridge Wing.png",
        "Starboard Bridge Wing2.png",
        "Starboard Bridge Wing3.png",
        "Starboard Bridge Wing4.png",
        "Starboard Bridge Wing5.png",
      ],
    },
    currentIndex: 0,
  },
  bridge_bd: {
    images: [
      "Bridge.png",
      "Bridge2.png",
      "Bridge3.png",
      "Bridge4.png",
      "Bridge5.png",
      "Bridge6.png",
    ],
    variants: {
      ms: [
        "Bridge.png",
        "Bridge2.png",
        "Bridge3.png",
        "Bridge4.png",
        "Bridge5.png",
        "Bridge6.png",
      ],
    },
    currentIndex: 0,
  },
  first_class_lounge_a: {
    images: [
      "First Class Lounge1.png",
      "First Class Lounge2.png",
      "First Class Lounge3.png",
      "First Class Lounge4.png",
      "First Class Lounge5.png",
      "First Class Lounge6.png",
      "First Class Lounge7.png",
      "First Class Lounge8.png",
      "First Class Lounge9.png",
      "First Class Lounge10.png",
      "First Class Lounge11.png",
      "First Class Lounge12.png",
      "First Class Lounge13.png",
    ],
    currentIndex: 0,
  },
  corridor_a: {
    images: ["Corridor.png", "Corridor2.png", "Corridor3.png", "Corridor4.png"],
    currentIndex: 0,
  },
  corridor: {
    images: [
      "a corridor1.png",
      "a corridor2.png",
      "a corridor3.png",
      "a corridor4.png",
    ],
    currentIndex: 0,
  },
  grand_staircase_a: {
    images: [
      "gsc A1.png",
      "gsc A2.png",
      "gsc A3.png",
      "gsc A4.png",
      "gsc A5.png",
      "gsc A6.png",
      "gsc A7.png",
      "gsc A8.png",
      "gsc A9.png",
    ],
    currentIndex: 0,
  },
  aft_grand_staircase_a: {
    images: [
      "Aft Grand Staircase.png",
      "Aft Grand Staircase2.png",
      "Aft Grand Staircase3.png",
      "Aft Grand Staircase4.png",
    ],
    currentIndex: 0,
  },
  first_class_smoking_room_a: {
    images: [
      "First Class Smoking.png",
      "First Class Smoking2.png",
      "First Class Smoking3.png",
      "First Class Smoking4.png",
      "First Class Smoking5.png",
      "First Class Smoking6.png",
      "First Class Smoking7.png",
      "First Class Smoking8.png",
      "First Class Smoking9.png",
      "First Class Smoking10.png",
      "First Class Smoking11.png",
    ],
    currentIndex: 0,
  },
};
roomImages.verandah_palm_court_a = {
  images: [
    "Palm Court.png",
    "Palm Court2.png",
    "Palm Court3.png",
    "Palm Court4.png",
    "Palm Court5.png",
  ],
  currentIndex: 0,
};

roomImages.first_class_reception_d = {
  images: [
    "First Class Reception1.png",
    "First Class Reception2.png",
    "First Class Reception3.png",
    "First Class Reception4.png",
    "First Class Reception5.png",
    "First Class Reception6.png",
    "First Class Reception7.png",
    "First Class Reception8.png",
    "First Class Reception9.png",
  ],
  currentIndex: 0,
};

roomImages.first_class_dining_room_d = {
  images: [
    "First Class Dining1.png",
    "First Class Dining2.png",
    "First Class Dining3.png",
    "First Class Dining4.png",
    "First Class Dining5.png",
    "First Class Dining6.png",
    "First Class Dining7.png",
    "First Class Dining8.png",
    "First Class Dining9.png",
    "First Class Dining10.png",
    "First Class Dining11.png",
    "First Class Dining12.png",
    "First Class Dining13.png",
    "First Class Dining14.png",
    "First Class Dining15.png",
    "First Class Dining16.png",
    "First Class Dining17.png",
    "First Class Dining18.png",
    "First Class Dining19.png",
    "First Class Dining20.png",
    "First Class Dining21.png",
    "First Class Dining22.png",
    "First Class Dining23.png",
  ],
  currentIndex: 0,
};

// Add Southampton room images
roomImages.berth_44_walkaway = {
  images: ["berth 44 walkaway.jpg"],
  currentIndex: 0,
};

roomImages.dockside_cafe = {
  images: ["dockside cafe.jpg"],
  currentIndex: 0,
};

roomImages.berth_44_forward = {
  images: ["berth44 forward1.jpg"],
  currentIndex: 0,
};

roomImages.first_class_gangway = {
  images: ["firstclassgangway.jpg"],
  currentIndex: 0,
};

roomImages.crew_gangway = {
  images: ["crew gangway.jpg"],
  currentIndex: 0,
};

roomImages.third_class_gangway = {
  images: ["3rd class gangway.jpg"],
  currentIndex: 0,
};

roomImages.berth_44_aft = {
  images: ["berth 44 aft docks1.jpg"],
  currentIndex: 0,
};

roomImages.covered_walkway = {
  images: ["berth 44 walkaway.jpg"],
  currentIndex: 0,
};

roomImages.boarding_tower = {
  images: ["1st class tower1.jpg", "1st class tower2.jpg"],
  currentIndex: 0,
};

roomImages.first_class_starboard_enclosed_promenade_a = {
  images: [
    "1st starb A enclosed prom1.png",
    "1st starb A enclosed prom2.png",
    "1st starb A enclosed prom3.png",
    "1st starb A enclosed prom4.png",
    "1st starb A enclosed prom5.png",
  ],
  currentIndex: 0,
};

roomImages.first_class_port_enclosed_promenade_a = {
  images: [
    "1st port A enclosed prom1.png",
    "1st port A enclosed prom2.png",
    "1st port A enclosed prom3.png",
    "1st port A enclosed prom4.png",
    "1st port A enclosed prom5.png",
  ],
  currentIndex: 0,
};

roomImages.first_class_port_promenade_a = {
  images: [
    "1st A port prom1.png",
    "1st A port prom2.png",
    "1st A port prom3.png",
    "1st A port prom4.png",
    "1st A port prom5.png",
    "1st A port prom6.png",
    "1st A port prom7.png",
    "1st A port prom8.png",
    "1st A port prom9.png",
    "1st A port prom10.png",
  ],
  variants: {
    ms: ["1st Class Port Promenade (ms).png"],
  },
  currentIndex: 0,
};

roomImages.first_class_starboard_promenade_a = {
  images: [
    "1st A starb prom1.png",
    "1st A starb prom2.png",
    "1st A starb prom3.png",
    "1st A starb prom4.png",
    "1st A starb prom5.png",
    "1st A starb prom6.png",
    "1st A starb prom7.png",
    "1st A starb prom8.png",
    "1st A starb prom9.png",
    "1st A starb prom10.png",
  ],
  variants: {
    ms: ["1st Class Starboard Promenade (ms).png"],
  },
  currentIndex: 0,
};

roomImages.first_a_corridor = {
  images: ["1st A corridor1.png", "1st A corridor2.png", "1st A corridor3.png"],
  currentIndex: 0,
};

roomImages.first_class_forward_overlooking_promenade_a = {
  images: [
    "1st A overlook prom1.png",
    "1st A overlook prom2.png",
    "1st A overlook prom3.png",
    "1st A overlook prom4.png",
    "1st A overlook prom5.png",
    "1st A overlook prom6.png",
  ],
  currentIndex: 0,
};

roomImages.second_class_staircase_a = {
  images: [
    "2nd class staircase1.png",
    "2nd class staircase2.png",
    "2nd class staircase3.png",
  ],
  currentIndex: 0,
};

roomImages.first_class_b_forward_overlooking_promenade = {
  images: [
    "1C B overlook prom1.png",
    "1C B overlook prom2.png",
    "1C B overlook prom3.png",
    "1C B overlook prom4.png",
    "1C B overlook prom5.png",
    "1C B overlook prom6.png",
  ],
  currentIndex: 0,
};

roomImages.wheelhouse_bd = {
  images: [
    "wheelhouse1.png",
    "wheelhouse2.png",
    "wheelhouse3.png",
    "wheelhouse4.png",
    "wheelhouse5.png",
  ],
  currentIndex: 0,
};

roomImages.starboard_engineers_promenade_bd = {
  images: [
    "starb engineers prom1.png",
    "starb engineers prom2.png",
    "starb engineers prom3.jpg",
    "starb engineers prom4.jpg",
    "starb engineers prom5.jpg",
  ],
  variants: {
    ms: ["starb engineers prom1.png", "starb engineers prom2.png"],
  },
  currentIndex: 0,
};

roomImages.port_engineers_promenade_bd = {
  images: [
    "port engineers prom1.png",
    "port engineers prom2.png",
    "port engineers prom3.png",
  ],
  variants: {
    ms: [
      "port engineers prom1.png",
      "port engineers prom2.png",
      "port engineers prom3.png",
    ],
  },
  currentIndex: 0,
};

roomImages.starboard_2nd_class_promenade_bd = {
  images: [
    "starb 2nd class prom1.png",
    "starb 2nd class prom2.png",
    "starb 2nd class prom3.png",
    "starb 2nd class prom4.png",
  ],
  variants: {
    ms: [
      "starb 2nd class prom1.png",
      "starb 2nd class prom2.png",
      "starb 2nd class prom3.png",
      "starb 2nd class prom4.png",
    ],
  },
  currentIndex: 0,
};

roomImages.port_2nd_class_promenade_bd = {
  images: [
    "port 2nd class prom1.png",
    "port 2nd class prom2.png",
    "port 2nd class prom3.png",
    "port 2nd class prom4.png",
  ],
  variants: {
    ms: [
      "port 2nd class prom1.png",
      "port 2nd class prom2.png",
      "port 2nd class prom4.png",
    ],
  },
  currentIndex: 0,
};

// Boat Deck - First Class Port Promenade (bd) defaults and sunset variant
roomImages.port_promenade_bd = {
  images: [
    "BD first port prom1.png",
    "BD first port prom2.png",
    "BD first port prom3.png",
    "BD first port prom4.png",
    "BD first port prom5.png",
    "BD first port prom6.png",
    "BD first port prom7.png",
  ],
  currentIndex: 0,
  variants: {
    ms: ["1st Class Port Promenade (ms).png"],
    night: [],
  },
};

// Boat Deck - First Class Starboard Promenade replacement set
roomImages.starboard_promenade_bd = {
  images: [
    "BD first starb prom1.png",
    "BD first starb prom2.png",
    "BD first starb prom3.png",
    "BD first starb prom4.png",
    "BD first starb prom5.png",
    "BD first starb prom6.png",
  ],
  currentIndex: 0,
};

roomImages["2nd_class_staircase_bd"] = {
  images: [
    "2nd class staircasebd1.png",
    "2nd class staircasebd2.png",
    "2nd class staircasebd3.png",
    "2nd class staircasebd4.png",
  ],
  currentIndex: 0,
};

roomImages.forecastle_b = {
  images: [
    "forecastle1.png",
    "forecastle2.png",
    "forecastle3.png",
    "forecastle4.png",
  ],
  variants: {
    ms: [
      "forecastle1.png",
      "forecastle2.png",
      "forecastle3.png",
      "forecastle4.png",
    ],
  },
  currentIndex: 0,
};

roomImages.first_class_port_b_enclosed_promenade = {
  images: [
    "1st B port enclosed prom1.png",
    "1st B port enclosed prom2.png",
    "1st B port enclosed prom3.png",
    "1st B port enclosed prom4.png",
    "1st B port enclosed prom5.png",
  ],
  variants: {
    ms: [
      "1st B port enclosed prom1.png",
      "1st B port enclosed prom2.png",
      "1st B port enclosed prom3.png",
      "1st B port enclosed prom4.png",
      "1st B port enclosed prom5.png",
    ],
  },
  currentIndex: 0,
};

roomImages.first_class_starboard_b_enclosed_promenade = {
  images: [
    "1st B starb enclosed prom1.png",
    "1st B starb enclosed prom2.png",
    "1st B starb enclosed prom3.png",
    "1st B starb enclosed prom4.png",
    "1st B starb enclosed prom5.png",
  ],
  variants: {
    ms: [
      "1st B starb enclosed prom1.png",
      "1st B starb enclosed prom2.png",
      "1st B starb enclosed prom3.png",
      "1st B starb enclosed prom4.png",
    ],
  },
  currentIndex: 0,
};

roomImages.poop_deck = {
  images: [
    "poop1.png",
    "poop2.png",
    "poop3.png",
    "poop4.png",
    "poop5.png",
    "poop6.png",
    "poop7.png",
    "poop8.png",
    "poop9.png",
    "poop10.png",
    "poop11.png",
    "poop12.png",
    "poop13.png",
    "poop14.png",
    "poop15.png",
  ],
  currentIndex: 0,
};

roomImages.grand_staircase_b = {
  images: [
    "B deck gd1.png",
    "B deck gd2.png",
    "B deck gd3.png",
    "B deck gd4.png",
    "B deck gd5.png",
    "B deck gd6.png",
    "B deck gd7.png",
    "B deck gd8.png",
    "B deck gd9.png",
  ],
  currentIndex: 0,
};

roomImages.third_class_smoke_room_b = {
  images: [
    "3rd class SR1.png",
    "3rd class SR2.png",
    "3rd class SR3.png",
    "3rd class SR4.png",
    "3rd class SR5.png",
    "3rd class SR6.png",
  ],
  currentIndex: 0,
};

roomImages.second_class_smoke_room_b = {
  images: [
    "2nd smoke1.png",
    "2nd smoke2.png",
    "2nd smoke3.png",
    "2nd smoke4.png",
    "2nd smoke5.png",
  ],
  currentIndex: 0,
};

roomImages.second_class_starboard_promenade_b = {
  images: [
    "2nd class b starb prom1.png",
    "2nd class b starb prom2.png",
    "2nd class b starb prom3.png",
    "2nd class b starb prom4.png",
    "2nd class b starb prom5.png",
    "2nd class b starb prom6.png",
    "2nd class b starb prom7.png",
  ],
  currentIndex: 0,
};

roomImages.second_class_port_promenade_b = {
  images: [
    "2nd class b prom1.png",
    "2nd class b prom2.png",
    "2nd class b prom3.png",
    "2nd class b prom4.png",
    "2nd class b prom5.png",
    "2nd class b prom6.png",
    "2nd class b prom7.png",
  ],
  currentIndex: 0,
};

roomImages.b_deck_aft_staircase = {
  images: [
    "b aft staircase1.png",
    "b aft staircase2.png",
    "b aft staircase3.png",
    "b aft staircase4.png",
  ],
  currentIndex: 0,
};

roomImages.restaurant_reception_room = {
  images: [
    "reception room1.png",
    "reception room2.png",
    "reception room3.png",
    "reception room4.png",
    "reception room5.png",
  ],
  currentIndex: 0,
};

roomImages.a_la_carte_restaurant = {
  images: [
    "carte1.png",
    "carte2.png",
    "carte3.png",
    "carte4.jpg",
    "carte5.png",
    "carte6.png",
    "carte7.png",
    "carte8.png",
    "carte9.png",
    "carte10.png",
    "carte11.png",
    "carte12.png",
    "carte13.png",
    "carte14.png",
  ],
  currentIndex: 0,
};

console.debug("✅ Defined roomImages:", roomImages);

// Music Player definition
const musicPlayer = {
  songs: [],
  currentSongIndex: 0,
  audio: new Audio(),
  isPlaying: false,
  isShuffleOn: false,
  isRepeatOn: false,
  originalPlaylist: [], // Store original song order

  init() {
    console.debug("🔧 Initializing music player...");
    const songSelect = document.getElementById("song-select");

    try {
      fetch("/api/get-songs")
        .then((response) => {
          if (!response.ok)
            throw new Error(`HTTP error! status: ${response.status}`);
          return response.json();
        })
        .then((songs) => {
          if (Array.isArray(songs)) {
            this.songs = songs;
            console.debug(`✅ Loaded ${songs.length} songs.`);

            // Populate dropdown
            songSelect.innerHTML = '<option value="">Select a song...</option>';
            songs.forEach((song, index) => {
              const songName = song.split("/").pop().replace(".mp3", "");
              const option = document.createElement("option");
              option.value = index;
              option.textContent = songName;
              songSelect.appendChild(option);
            });

            if (this.songs.length > 0) {
              this.currentSongIndex = Math.floor(
                Math.random() * this.songs.length,
              );
              this.loadCurrentSong();
              songSelect.value = this.currentSongIndex;
            }
          }
        })
        .catch((error) => {
          console.error("❌ Error loading songs:", error);
          document.getElementById("current-song").textContent =
            "Error loading music";
        });

      // Add song selection handler
      songSelect.addEventListener("change", (e) => {
        const selectedIndex = parseInt(e.target.value);
        if (!isNaN(selectedIndex)) {
          this.currentSongIndex = selectedIndex;
          this.loadCurrentSong();
          if (this.isPlaying) {
            this.audio.play();
          }
        }
      });

      this.audio.addEventListener("ended", () => {
        console.debug("🔁 Current song ended. Playing next.");
        this.playNext();
        songSelect.value = this.currentSongIndex;
      });

      // Initialize controls
      document.getElementById("play-pause").addEventListener("click", () => {
        console.debug("🎮 Play/Pause button clicked.");
        this.togglePlay();
      });
      document.getElementById("next-track").addEventListener("click", () => {
        console.debug("➡️ Next track button clicked.");
        this.playNext();
      });
      document.getElementById("prev-track").addEventListener("click", () => {
        console.debug("⬅️ Previous track button clicked.");
        this.playPrev();
      });
      document.getElementById("mute-toggle").addEventListener("click", () => {
        console.debug("🔇 Mute toggle button clicked.");
        this.toggleMute();
      });
      document
        .getElementById("volume-slider")
        .addEventListener("input", (e) => {
          console.debug(`🔊 Volume set to: ${e.target.value}`);
          this.setVolume(e.target.value);
        });
      document
        .getElementById("shuffle")
        .addEventListener("click", () => this.toggleShuffle());
      document
        .getElementById("repeat")
        .addEventListener("click", () => this.toggleRepeat());
    } catch (error) {
      console.error("❌ Failed to initialize music player:", error);
    }
  },

  loadCurrentSong() {
    console.debug(
      `🎵 Loading song index ${this.currentSongIndex}: ${
        this.songs[this.currentSongIndex]
      }`,
    );
    this.audio.src = this.songs[this.currentSongIndex];
    this.updateNowPlaying();
    if (this.isPlaying) {
      this.audio
        .play()
        .then(() => {
          console.debug("▶️ Playing current song.");
        })
        .catch((error) => {
          console.error("❌ Error playing song:", error);
        });
    }
  },

  togglePlay() {
    if (this.audio.paused) {
      this.audio
        .play()
        .then(() => {
          this.isPlaying = true;
          console.debug("▶️ Music playing.");
        })
        .catch((error) => {
          console.error("❌ Error playing music:", error);
        });
    } else {
      this.audio.pause();
      this.isPlaying = false;
      console.debug("⏸ Music paused.");
    }
    this.updatePlayButton();
  },

  playNext() {
    if (this.songs.length === 0) return;

    if (this.isRepeatOn) {
      // Just replay the current song
      this.loadCurrentSong();
      if (this.isPlaying) this.audio.play();
      return;
    }

    this.currentSongIndex = (this.currentSongIndex + 1) % this.songs.length;
    this.loadCurrentSong();
    if (this.isPlaying) this.audio.play();
  },

  playPrev() {
    if (this.songs.length === 0) return;
    this.currentSongIndex =
      (this.currentSongIndex - 1 + this.songs.length) % this.songs.length;
    console.debug(
      `🔄 Playing previous song. New index: ${this.currentSongIndex}`,
    );
    this.loadCurrentSong();
  },

  toggleMute() {
    this.audio.muted = !this.audio.muted;
    console.debug(`🔇 Mute state changed to: ${this.audio.muted}`);
    document.getElementById("mute-toggle").textContent = this.audio.muted
      ? "🔇"
      : "🔊";
  },

  setVolume(value) {
    this.audio.volume = value / 100;
    console.debug(`🔊 Volume set to: ${this.audio.volume}`);
  },

  updateNowPlaying() {
    if (this.songs.length === 0) {
      document.getElementById("current-song").textContent =
        "No songs available";
      return;
    }
    const songName = this.songs[this.currentSongIndex]
      .split("/")
      .pop()
      .replace(".mp3", "");
    document.getElementById("current-song").textContent =
      `Now Playing: ${songName}`;
    console.debug(`🆕 Now Playing updated to: ${songName}`);
  },

  updatePlayButton() {
    document.getElementById("play-pause").textContent = this.isPlaying
      ? "⏸"
      : "⏯";
    console.debug(`🎮 Play button updated to: ${this.isPlaying ? "⏸" : "⏯"}`);
  },

  toggleShuffle() {
    this.isShuffleOn = !this.isShuffleOn;
    const shuffleBtn = document.getElementById("shuffle");

    if (this.isShuffleOn) {
      shuffleBtn.classList.add("active");
      // Store original playlist and shuffle current one
      this.originalPlaylist = [...this.songs];
      this.songs = this.shuffleArray([...this.songs]);
    } else {
      shuffleBtn.classList.remove("active");
      // Restore original playlist order
      if (this.originalPlaylist.length) {
        this.songs = [...this.originalPlaylist];
      }
    }
  },

  toggleRepeat() {
    this.isRepeatOn = !this.isRepeatOn;
    const repeatBtn = document.getElementById("repeat");

    if (this.isRepeatOn) {
      repeatBtn.classList.add("active");
    } else {
      repeatBtn.classList.remove("active");
    }
  },

  shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
  },

  // Smoothly fade the regular music volume to a target over a duration (ms)
  fadeTo(targetVolume, duration = 2000) {
    return new Promise((resolve) => {
      if (this._fadeInterval) clearInterval(this._fadeInterval);
      const startVolume = this.audio.volume;
      const steps = 30; // ~30 steps for smooth fade
      const stepTime = duration / steps;
      const volumeStep = (targetVolume - startVolume) / steps;
      let currentStep = 0;

      this._fadeInterval = setInterval(() => {
        currentStep++;
        if (currentStep >= steps) {
          this.audio.volume = targetVolume;
          clearInterval(this._fadeInterval);
          this._fadeInterval = null;
          resolve();
        } else {
          this.audio.volume = Math.max(
            0,
            Math.min(1, startVolume + volumeStep * currentStep),
          );
        }
      }, stepTime);
    });
  },

  // Play event music: fade out regular music, play the event track, then fade back in
  async playEventMusic(
    src,
    {
      fallbackSrc = null,
      volume = 0.5,
      fadeOutMs = 2000,
      fadeInMs = 3000,
    } = {},
  ) {
    // Remember volume to restore later
    const savedVolume = this.audio.volume;
    const wasPlaying = this.isPlaying && !this.audio.paused;

    // Fade out regular music
    if (wasPlaying) {
      await this.fadeTo(0, fadeOutMs);
      this.audio.pause();
    }

    // Play the event track
    const eventAudio = new Audio(src);
    eventAudio.volume = volume;

    const tryPlay = (audioSrc) => {
      return new Promise((resolve) => {
        eventAudio.src = audioSrc;
        eventAudio.addEventListener("ended", resolve, { once: true });
        eventAudio
          .play()
          .then(() => console.debug(`🎵 Playing event music: ${audioSrc}`))
          .catch((e) => {
            console.warn(`⚠️ Error playing event music: ${e}`);
            resolve(); // Don't block if playback fails
          });
      });
    };

    try {
      await tryPlay(src);
    } catch {
      if (fallbackSrc) {
        console.warn("⚠️ Primary event track failed, trying fallback.");
        await tryPlay(fallbackSrc);
      }
    }

    // Fade regular music back in
    if (wasPlaying) {
      this.audio.volume = 0;
      this.audio.play().catch(() => {});
      await this.fadeTo(savedVolume, fadeInMs);
    }
    console.debug("🎵 Event music finished, regular music restored.");
  },
};

console.debug("✅ Defined musicPlayer object.");

const statusBars = {
  hunger: { value: 100, rate: 0.005 }, // More realistic timing
  thirst: { value: 100, rate: 0.007 }, // More realistic timing
  energy: { value: 100, rate: 0.003 }, // More realistic timing
  hygiene: { value: 100, rate: 0.002 }, // More realistic timing
  bladder: { value: 100, rate: 0.006 }, // More realistic timing
  intoxication: { value: 0, rate: 0.01 }, // More realistic timing
};

// Player money (persisted alongside stats)
let playerMoney = 0;
function updateMoneyDisplay() {
  const el = document.getElementById("character-money");
  if (el) el.textContent = `\u00a3${playerMoney.toFixed(2)}`;
}

const STORED_STATS_KEY = "rbvrpg:lastStats";
let statsSyncTimer = null;
const STAT_SYNC_DELAY = 30000; // 30 seconds debounce for server sync

function clampStat(value) {
  return Math.max(0, Math.min(100, Number(value) || 0));
}

function applyStatsToState(stats) {
  Object.entries(stats).forEach(([key, value]) => {
    if (statusBars[key]) {
      statusBars[key].value =
        key === "intoxication" ? clampStat(value) : clampStat(value);
    }
  });

  if (typeof stats.money === "number") {
    playerMoney = stats.money;
    updateMoneyDisplay();
  }

  Object.keys(statusBars).forEach((key) => {
    const bar = document.querySelector(`.bar.${key}`);
    if (!bar) return;
    const value = statusBars[key].value;
    bar.style.width = `${value}%`;
    const hue =
      key === "intoxication" ? 120 - (value / 100) * 120 : (value / 100) * 120;
    bar.style.setProperty(`--${key}-hue`, hue);
    bar.style.animation =
      value < 20 && key !== "intoxication" ? "pulse 2s infinite" : "none";
  });
}

function persistStatsLocally() {
  const snapshot = {
    hunger: statusBars.hunger.value,
    thirst: statusBars.thirst.value,
    energy: statusBars.energy.value,
    hygiene: statusBars.hygiene.value,
    bladder: statusBars.bladder.value,
    intoxication: statusBars.intoxication.value,
    money: playerMoney,
    savedAt: Date.now(),
  };
  try {
    localStorage.setItem(STORED_STATS_KEY, JSON.stringify(snapshot));
  } catch (err) {
    console.warn("⚠️ Failed to persist stats locally:", err);
  }
}

function restoreStatsFromStorage() {
  try {
    const stored = localStorage.getItem(STORED_STATS_KEY);
    if (!stored) return;
    const parsed = JSON.parse(stored);
    if (!parsed) return;
    applyStatsToState(parsed);
    console.debug("📦 Restored stats from local storage snapshot", parsed);
  } catch (err) {
    console.warn("⚠️ Failed to restore stats snapshot:", err);
  }
}

function scheduleStatsSync() {
  if (statsSyncTimer) return;
  statsSyncTimer = setTimeout(() => {
    statsSyncTimer = null;
    saveStatsToServer();
  }, STAT_SYNC_DELAY);
}

restoreStatsFromStorage();
function updateStatusBars() {
  let statsChanged = false;
  Object.entries(statusBars).forEach(([key, status]) => {
    const previous = status.value;
    // Only decrease intoxication if it's above 0
    if (key === "intoxication") {
      if (status.value > 0) {
        status.value = Math.max(0, status.value - status.rate);
      }
    } else {
      status.value = Math.max(0, Math.min(100, status.value - status.rate));
    }

    const bar = document.querySelector(`.bar.${key}`);
    if (bar) {
      bar.style.width = `${status.value}%`;

      // Calculate hue based on value
      let hue;
      if (key === "intoxication") {
        hue = 120 - (status.value / 100) * 120; // Green (0%) to Red (100%)
      } else {
        hue = (status.value / 100) * 120; // Red (0%) to Green (100%)
      }
      bar.style.setProperty(`--${key}-hue`, hue);

      if (status.value < 20 && key !== "intoxication") {
        bar.style.animation = "pulse 2s infinite";
      } else {
        bar.style.animation = "none";
      }
    }

    if (!statsChanged && Math.abs(previous - status.value) > 0.01) {
      statsChanged = true;
    }
  });

  if (statsChanged) {
    persistStatsLocally();
    scheduleStatsSync();
  }
}

// Update status bars every second
const statusBarsInterval = setInterval(updateStatusBars, 1000);

// Function to save current stats to server
function saveStatsToServer() {
  const statsData = {
    hunger: statusBars.hunger.value,
    thirst: statusBars.thirst.value,
    energy: statusBars.energy.value,
    hygiene: statusBars.hygiene.value,
    bladder: statusBars.bladder.value,
    intoxication: statusBars.intoxication.value,
  };

  console.debug("💾 Saving stats to server:", statsData);
  socket.emit("save-stats", statsData);
  persistStatsLocally();
}

window.addEventListener("beforeunload", () => {
  try {
    saveStatsToServer();
  } catch (err) {
    console.warn("⚠️ Failed to persist stats on unload:", err);
  }
  // Clean up intervals to prevent leaks
  clearInterval(statusBarsInterval);
  if (narrativeSystem._narrativeInterval)
    clearInterval(narrativeSystem._narrativeInterval);
  if (narrativeSystem._weatherInterval)
    clearInterval(narrativeSystem._weatherInterval);
});

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
    cabinElement.textContent = `${cabinNumber}`; // e.g., "A-17"

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

  function calculateVoyageState(elapsedSeconds) {
    let location = "Southampton";
    let speedValue = 0;
    let targetSpeed = 0;

    // Seconds after actual departure (0 while still alongside)
    const elapsedSinceDeparture = Math.max(
      0,
      elapsedSeconds - TIMELINE_SECONDS.DEPARTURE_DELAY,
    );

    if (elapsedSeconds < TIMELINE_SECONDS.DEPARTURE_DELAY) {
      // Still alongside the quay
      location = "Southampton";
      speedValue = 0;
      targetSpeed = 0;
    } else if (elapsedSinceDeparture < TIMELINE_SECONDS.SOUTHAMPTON_WATER_END) {
      // Accelerate from 0 → 6 knots through Southampton Water
      location = "Southampton Water";
      targetSpeed = 6;
      const timeToReach6Knots = 6 / SHIP_ACCELERATION;
      if (elapsedSinceDeparture < timeToReach6Knots) {
        speedValue = Math.min(6, elapsedSinceDeparture * SHIP_ACCELERATION);
      } else {
        speedValue = 6;
      }
    } else if (elapsedSinceDeparture < TIMELINE_SECONDS.NEEDLES_COMPLETE) {
      // The Solent run, 6 → 12 knots
      location = "The Solent";
      targetSpeed = 12;
      const elapsedInSolent =
        elapsedSinceDeparture - TIMELINE_SECONDS.SOUTHAMPTON_WATER_END;
      const timeToReach12Knots = (12 - 6) / SHIP_ACCELERATION;
      if (elapsedInSolent < timeToReach12Knots) {
        speedValue = Math.min(12, 6 + elapsedInSolent * SHIP_ACCELERATION);
      } else {
        speedValue = 12;
      }
    } else if (elapsedSinceDeparture < TIMELINE_SECONDS.CHANNEL_COMPLETE) {
      // Open channel, 12 → 19 knots
      location = "English Channel";
      targetSpeed = 19;
      const elapsedInChannel =
        elapsedSinceDeparture - TIMELINE_SECONDS.NEEDLES_COMPLETE;
      const timeToReach19Knots = (19 - 12) / SHIP_ACCELERATION;
      if (elapsedInChannel < timeToReach19Knots) {
        speedValue = Math.min(19, 12 + elapsedInChannel * SHIP_ACCELERATION);
      } else {
        speedValue = 19;
      }
    } else if (elapsedSinceDeparture < TIMELINE_SECONDS.BERTHING_COMPLETE) {
      // Continuous slowdown from 19 → 0 knots across the Cherbourg sequence
      const elapsedSinceChannel = Math.max(
        0,
        elapsedSinceDeparture - TIMELINE_SECONDS.CHANNEL_COMPLETE,
      );
      speedValue = Math.max(0, 19 - elapsedSinceChannel * CHERBOURG_DECEL_RATE);
      targetSpeed = Math.max(0, speedValue - CHERBOURG_DECEL_RATE);

      if (speedValue > 6) {
        location = "Approaching Cherbourg";
      } else if (speedValue > 0) {
        location = "Cherbourg Harbor";
      } else {
        location = "Cherbourg";
      }
    } else {
      location = "Cherbourg";
      speedValue = 0;
      targetSpeed = 0;
    }

    return {
      location,
      speedValue,
      targetSpeed,
      speed: `${speedValue.toFixed(1)} knots`,
      elapsedSeconds,
    };
  }

  // Returns elapsed voyage seconds using server-provided time to avoid clock skew.
  // Interpolates locally between 3-second server broadcasts.
  function getElapsedSeconds() {
    if (lastServerElapsedAt > 0) {
      return (
        lastServerElapsed +
        Math.floor((Date.now() - lastServerElapsedAt) / 1000)
      );
    }
    // Fallback before first server broadcast
    if (voyageStartTime) {
      return Math.floor((Date.now() - voyageStartTime) / 1000);
    }
    return 0;
  }

  function getBSTTime() {
    // DEV override: return the frozen hour when North Atlantic mode is active
    if (DEV_NORTH_ATLANTIC) {
      const h = Math.floor(DEV_HOUR);
      const m = Math.round((DEV_HOUR - h) * 60);
      const t = new Date();
      t.setHours(h, m, 0, 0);
      return t;
    }

    // Use server-synced elapsed time for synchronization
    const elapsedSeconds = getElapsedSeconds();
    if (elapsedSeconds === 0 && !voyageStartTime) {
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

    skyImages.forEach((img) => (img.style.opacity = 0)); // Hide all images

    // 1. Determine active interval and show correct sky element
    const interval = imageIntervals.find(
      (interval) => hours >= interval.start && hours <= interval.end,
    );

    if (interval) {
      // Restrict to sky elements to avoid picking clouds or other day-tagged elements
      const image = document.querySelector(`.sky.${interval.className}`);
      if (image) {
        image.style.opacity = 1; // Show the appropriate image
        // console.debug(`🌅 Displaying sky image: ${interval.className}`);
      }
      syncCloudTextureWithSky(interval);
    }

    // 2. Apply gradient (Now that the element is visible)
    // Smooth gradient update for a progressive sky
    try {
      updateSkyGradient(bstTime);
    } catch (err) {
      console.warn("⚠️ updateSkyGradient failed:", err);
    }

    // Also update Britannic image (day / md / night)
    try {
      const britDay = document.querySelector(".britannic-day");
      const britMd = document.querySelector(".britannic-md");
      const britNight = document.querySelector(".britannic-night");

      // Determine target sprite based on interval (Stable State)
      let targetSprite = null;
      if (interval && interval.className === "day") {
        targetSprite = britDay;
      } else if (interval && interval.className.startsWith("ms")) {
        targetSprite = britMd;
      } else {
        targetSprite = britNight;
      }

      // Check for transition windows (30 seconds before hour change)
      // We align these with the imageIntervals boundaries
      let isTransitioning = false;
      let transitionProgress = 0;
      let outgoing = null;
      let incoming = null;

      // 1. Night -> MS (00:59:30) - Aligns with interval change at 01:00
      if (hours === 0 && minutes === 59 && seconds >= 30) {
        isTransitioning = true;
        outgoing = britNight;
        incoming = britMd;
      }
      // 2. MS -> Day (06:59:30) - Aligns with interval change at 07:00
      else if (hours === 6 && minutes === 59 && seconds >= 30) {
        isTransitioning = true;
        outgoing = britMd;
        incoming = britDay;
      }
      // 3. Day -> MS (16:59:30) - Aligns with interval change at 17:00
      else if (hours === 16 && minutes === 59 && seconds >= 30) {
        isTransitioning = true;
        outgoing = britDay;
        incoming = britMd;
      }
      // 4. MS -> Night (22:59:30) - Aligns with interval change at 23:00
      else if (hours === 22 && minutes === 59 && seconds >= 30) {
        isTransitioning = true;
        outgoing = britMd;
        incoming = britNight;
      }

      if (isTransitioning) {
        transitionProgress = (seconds - 30) / 30; // 0 to 1

        // Disable CSS transitions for manual control
        [britDay, britMd, britNight].forEach((el) => {
          if (el) el.style.transition = "none";
        });

        // Setup layers: Outgoing on top, Incoming behind
        if (outgoing) {
          outgoing.style.zIndex = 4;
          outgoing.style.opacity = 1 - transitionProgress; // Fade out
        }
        if (incoming) {
          incoming.style.zIndex = 3;
          incoming.style.opacity = 1; // Visible behind
        }

        // Hide others
        [britDay, britMd, britNight].forEach((el) => {
          if (el && el !== outgoing && el !== incoming) {
            el.style.opacity = 0;
            el.style.zIndex = 0;
          }
        });
      } else {
        // Stable state
        [britDay, britMd, britNight].forEach((el) => {
          if (el) {
            // Re-enable transition for smooth state correction if needed
            el.style.transition = "opacity 1s ease-in-out";
            if (el === targetSprite) {
              el.style.opacity = 1;
              el.style.zIndex = 3;
            } else {
              el.style.opacity = 0;
              el.style.zIndex = 0;
            }
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

    if (DEV_NORTH_ATLANTIC) {
      location = "North Atlantic";
      speed = "22.0 knots";
      window.currentSpeed = 22;
      window.targetSpeed = 22;
    } else if (voyageStartTime) {
      const elapsedSeconds = getElapsedSeconds();
      const state = calculateVoyageState(elapsedSeconds);
      location = state.location;
      speed = state.speed;
      window.currentSpeed = state.speedValue;
      window.targetSpeed = state.targetSpeed;
    } else if (latestVoyageState) {
      // Fallback while waiting on voyageStartTime handshake
      location = latestVoyageState.location;
      speed = latestVoyageState.speed;
      window.currentSpeed = latestVoyageState.speedValue;
      window.targetSpeed = latestVoyageState.targetSpeed;
    }

    const date = `${bstTime.getDate()} of ${bstTime.toLocaleString("default", {
      month: "long",
    })}, ${bstTime.getHours().toString().padStart(2, "0")}:${bstTime
      .getMinutes()
      .toString()
      .padStart(2, "0")}:${bstTime.getSeconds().toString().padStart(2, "0")}`;

    renderInfoBarText(location, speed, date);

    console.debug("🗓️ Updated info bar:", { location, speed, date });
  }

  // ---- Sky gradient interpolation helpers ----
  const SKY_PALETTES = {
    night: ["#0f1419", "#1a2332", "#2d3748", "#4a5568", "#718096"], // Deep nautical night
    "ms-5": ["#0f172a", "#1e293b", "#334155", "#475569", "#64748b"], // Pre-dawn / Post-dusk (Cool blue-grays)
    "ms-4": ["#1e293b", "#334155", "#475569", "#64748b", "#94a3b8"], // Twilight (Lighter blue-grays)
    "ms-3": ["#0f172a", "#1e293b", "#334155", "#ea580c", "#f59e0b"], // Sunset/Sunrise Peak (Blue-grays to warm orange-gold)
    "ms-2": ["#1e293b", "#334155", "#64748b", "#fb923c", "#f59e0b"], // Vibrant transition (Blue to orange-gold)
    "ms-1": ["#334155", "#64748b", "#94a3b8", "#fed7aa", "#fdbcb4"], // Soft transition (Gray-blues to peach)
    "ms-0": ["#475569", "#94a3b8", "#cbd5e1", "#fef3c7", "#fed7aa"], // Bright morning/evening (Light grays to cream)
    day: ["#0ea5e9", "#38bdf8", "#7dd3fc", "#bae6fd", "#e0f2fe"], // Clear Day
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
    const hours = bstTime.getHours();
    const minutes = bstTime.getMinutes();
    const seconds = bstTime.getSeconds();
    const totalSeconds = hours * 3600 + minutes * 60 + seconds;

    // Special 30-second transition logic
    // Sunset: 16:59:30 -> 17:00:00 (Day -> MS-0)
    // Sunrise: 04:59:30 -> 05:00:00 (Night -> MS-5)

    let currPaletteName = null;
    let nextPaletteName = null;
    let t = 0;

    // Check for Sunset Transition (16:59:30 - 17:00:00)
    if (hours === 16 && minutes === 59 && seconds >= 30) {
      currPaletteName = "day";
      nextPaletteName = "ms-0";
      t = (seconds - 30) / 30;
    }
    // Check for Sunrise Transition (04:59:30 - 05:00:00)
    else if (hours === 4 && minutes === 59 && seconds >= 30) {
      currPaletteName = "night";
      nextPaletteName = "ms-5";
      t = (seconds - 30) / 30;
    } else {
      // Standard interpolation based on intervals
      const intervalIndex = imageIntervals.findIndex(
        (iv) => hours >= iv.start && hours <= iv.end,
      );

      if (intervalIndex >= 0) {
        const current = imageIntervals[intervalIndex];
        const next =
          imageIntervals[(intervalIndex + 1) % imageIntervals.length];

        currPaletteName = current.className;
        nextPaletteName = current.className === "day" ? "day" : next.className;

        // Calculate t based on full duration of the interval
        const startSec = current.start * 3600;
        const endSec = (current.end + 1) * 3600;
        const duration = Math.max(1, endSec - startSec);
        const elapsed = Math.max(0, totalSeconds - startSec);
        t = Math.min(1, elapsed / duration);
      } else {
        // Fallback
        currPaletteName = "day";
        nextPaletteName = "day";
        t = 0;
      }
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

    // Apply the blended gradient to the currently visible sky element(s)
    try {
      // Prefer applying inline to the element selected by updateSkyImage
      const visibleSky =
        document.querySelector('.sky[style*="opacity: 1"]') ||
        document.querySelector(".sky.day");
      if (visibleSky) {
        // Build the gradient with roughly even stops
        const positions = [0, 30, 60, 85, 100];
        const parts = stops.map(
          (c, idx) =>
            `${c} ${
              positions[idx] ?? Math.round((idx + 1) * (100 / stops.length))
            }%`,
        );
        visibleSky.style.background = `linear-gradient(to bottom, ${parts.join(
          ", ",
        )})`;
      }
    } catch (err) {
      console.warn("⚠️ Failed to apply blended gradient to sky element:", err);
    }
  }

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
    if (initialSyncDone) return;
    initialSyncDone = true;
    console.debug("🔄 Performing initial sync with server data...");

    // Initialize narrative system with server time
    if (narrativeSystem && pendingVoyageStartTime) {
      narrativeSystem.startTime = pendingVoyageStartTime;
      console.debug("✅ Narrative system synchronized with server time");
    }

    // In dev mode, set our own narrative and skip timeline sync
    if (DEV_NORTH_ATLANTIC) {
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
      pendingVoyageState &&
      pendingVoyageState.elapsedSeconds &&
      narrativeSystem.startTime
    ) {
      const elapsed = pendingVoyageState.elapsedSeconds;
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
  if (pendingVoyageStartTime || pendingVoyageState) {
    performInitialSync();
  }

  const skyImageInterval = setInterval(updateSkyImage, 1000); // Update every second
  const infoBarInterval = setInterval(updateInfoBar, 1000); // Update every second so the clock visibly advances

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
      clouds.push({
        startX: canvas.width,
        y: r() * (canvas.height * 0), // Keep clouds near top of canvas
        speed: 0.1 + r() * 0.1, // pixels per frame at 60fps → convert to px/sec
        spawnElapsed: elapsed, // voyage-seconds when this cloud was created
        image: cloudImages[cloudType],
      });
    }

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
        const seed = ((voyageStartTime || 12345) ^ (slot * 4919)) | 0;
        const rng = createSeededRng(seed);
        // ~30% chance per 30-second window
        if (rng() < 0.3) {
          spawnCloud(null, rng, slot * CLOUD_SLOT_SEC);
        }
      }
      lastCloudSlot = currentSlot;
    }

    // Sub-second elapsed for smooth rendering (not floored like getElapsedSeconds)
    function getElapsedSmooth() {
      if (lastServerElapsedAt > 0) {
        return lastServerElapsed + (Date.now() - lastServerElapsedAt) / 1000;
      }
      if (voyageStartTime) {
        return (Date.now() - voyageStartTime) / 1000;
      }
      return 0;
    }

    function animate() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const elapsed = getElapsedSmooth();

      clouds.forEach((cloud, index) => {
        if (!cloud.image.complete) return; // Skip if image not loaded
        const scaledHeight = cloud.image.height;
        const scaledWidth = cloud.image.width;

        // Compute position from elapsed time — identical on all clients
        // speed is ~0.1-0.2 px/frame at 60fps = ~6-12 px/sec
        const age = elapsed - cloud.spawnElapsed;
        const x = cloud.startX - cloud.speed * 60 * age;

        ctx.save();
        const activeInterval = imageIntervals.find((interval) => {
          const now = getBSTTime();
          const h = now.getHours();
          return h >= interval.start && h <= interval.end;
        });
        const isDayInterval = activeInterval?.className === "day";
        ctx.globalAlpha = isDayInterval ? 1 : 0.92;
        ctx.filter = isDayInterval ? "brightness(1)" : "brightness(0.88)";
        ctx.drawImage(cloud.image, x, cloud.y, scaledWidth, scaledHeight);
        ctx.restore();

        if (x + scaledWidth < 0) {
          clouds.splice(index, 1);
        }
      });

      // Deterministic cloud spawning synced across clients
      checkCloudSlots();

      requestAnimationFrame(animate);
    }

    // Initial spawn to populate the sky using seeded positions
    const initCloudRng = createSeededRng((voyageStartTime || 12345) ^ 99991);
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
      // Seed = voyageStartTime XOR slot index → same for all clients
      const seed = ((voyageStartTime || 0) ^ (slot * 7919)) | 0;
      const rng = createSeededRng(seed);

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

      // Wait for voyageStartTime before spawning so seeds are correct
      const tryStart = () => {
        if (!voyageStartTime) {
          setTimeout(tryStart, 500);
          return;
        }
        this.catchUp();
        this.spawnTimer = setInterval(() => this.checkSpawns(), 1000);
        console.debug("🐦 Bird spawning synced to voyageStartTime");
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

      canvas.style.left = x + "px";
      canvas.style.top = y + "px";
      if (!goRight) canvas.style.transform = "scaleX(-1)";

      this.container.appendChild(canvas);

      this.birds.push({
        canvas,
        ctx,
        x,
        y,
        speed,
        goRight,
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
        b.canvas.style.left = b.x + "px";

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
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Debug rectangle removed; smoke should not be affected by canvas test markers

      smokeParticles.forEach((particle, index) => {
        if (!smokeImage.complete) return; // Skip if image not loaded

        // Update horizontal wind based on current ship speed
        let horizontalWind = 0;
        if (typeof window.currentSpeed === "number") {
          const speed = window.currentSpeed || 0;
          horizontalWind = -0.05 - speed * 0.04; // Original port-drift curve from historic build
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
      // Wait a moment for voyageStartTime to be received from server
      const waitForSpawn = setInterval(() => {
        if (!voyageStartTime) return; // Wait for server time

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
            } else {
              console.debug(
                `⚠️ Last room "${lastRoomName}" not found, proceeding with spawn logic`,
              );
              localStorage.removeItem("lastRoom"); // Clean up invalid data
            }
          }

          // Try to find player's cabin first, otherwise default to promenade
          const cabinRoom = findPlayerCabin();
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

  // Updated enterRoom function with dynamic location image handling
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

    // Add fade-out transition
    chatContainer.classList.add("fade-out");
    locationDisplay.classList.add("fade-out");

    // Play close door sound if leaving a room
    if (currentRoom.name) {
      closeDoorSound.currentTime = 0;
      closeDoorSound.play();
      socket.emit("leave-room", {
        room: currentRoom.name,
        character: characterData,
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
        cabin_a1: "A-1",
        cabin_a2: "A-2",
        cabin_a30: "A-30",
        cabin_a32: "A-32",
        cabin_a34: "A-34",
        cabin_a36: "A-36",
        cabin_b49: "B-49",
        cabin_b51: "B-51",
        cabin_b53: "B-53",
        cabin_b55: "B-55",
        cabin_b57: "B-57",
        cabin_b59: "B-59",
        cabin_b61: "B-61",
        cabin_b63: "B-63",
        cabin_b65: "B-65",
        cabin_b67: "B-67",
        cabin_b69: "B-69",
        cabin_b71: "B-71",
        cabin_b73: "B-73",
        cabin_b75: "B-75",
        cabin_b77: "B-77",
        cabin_b79: "B-79",
        cabin_b81: "B-81",
        cabin_b83: "B-83",
      };
      const roomNameLabel = document.getElementById("room-name-label");
      if (roomNameLabel) {
        const displayName = roomDisplayNames[currentRoom.name];
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
        character: characterData,
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

      if (roomImages[chatRoom]) {
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
      if (imageSrc) {
        drawLocationImage(imageSrc);
      } else {
        console.warn("⚠️ No image source available for room", room.name);
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
        showerBtn.innerHTML = "🚿";
        showerBtn.onclick = function () {
          // Add your shower logic here
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
        toiletBtn.innerHTML = "🚽";
        toiletBtn.onclick = function () {
          // Add your toilet logic here
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
        sleepBtn.innerHTML = "🛏️";
        sleepBtn.onclick = function () {
          // Add your sleep logic here
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

      // Add "Enter Britannic" button for First Class Gangway and Boarding Tower
      if (room.id === "first_class_gangway" || room.id === "boarding_tower") {
        const locationDisplay = document.querySelector(".location-display");
        const enterBritannicBtn = document.createElement("button");
        enterBritannicBtn.id = "enter-britannic-btn";
        enterBritannicBtn.className = "enter-britannic-btn";
        enterBritannicBtn.textContent = "Enter Britannic";
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
                ? "You board the RMS Britannic via the Boarding Tower..."
                : "You board the RMS Britannic via the First Class Gangway...";

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

      // Update displays and play open door sound
      chatContainer.style.display = "block";
      locationDisplay.style.display = "block";
      openDoorSound.currentTime = 0;
      openDoorSound.play();

      chatContainer.classList.remove("fade-out");
      locationDisplay.classList.remove("fade-out");
      chatContainer.classList.add("fade-in");
      locationDisplay.classList.add("fade-in");

      const systemMessage = {
        type: "system",
        message: `You have entered ${room.name}`,
        room: currentRoom.name,
        timestamp: Date.now(),
      };
      addChatMessage(systemMessage);

      // Update minigame visibility if applicable
      const minigameBtn = document.getElementById("gym-minigame-btn");
      if (minigameBtn) {
        minigameBtn.style.display = room.type === "gymnasium" ? "flex" : "none";
      } else {
        console.warn("⚠️ Gym minigame button not found");
      }

      // Removed pokerMinigameBtn reference since it's not in the HTML
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

      // Show eat/drink button in dining room
      const eatDrinkBtn = document.getElementById("eat-drink-btn");
      if (eatDrinkBtn) {
        if (
          room.id === "first_class_dining_room_d" ||
          room.id === "a_la_carte_restaurant"
        ) {
          eatDrinkBtn.style.display = "block";
        } else {
          eatDrinkBtn.style.display = "none";
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
    }, 500);

    // Remove fade-in class after animation completes
    setTimeout(() => {
      chatContainer.classList.remove("fade-in");
      locationDisplay.classList.remove("fade-in");
    }, 1000);
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
        messageDiv.style.color = "#ffcc00";
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

    // Clear chat history when switching modes to prevent flooding
    const chatMessages = document.getElementById("chat-messages");
    if (chatMessages) {
      chatMessages.innerHTML = "";
      console.debug("🧹 Cleared chat messages when switching chat modes");
    }

    // Don't repopulate with history to keep it fresh and non-flooded
    const globalChatToggle = document.getElementById("global-chat-toggle");
    globalChatToggle.textContent = "🌐";
    const systemMessage = {
      type: "system",
      message: `Switched to ${
        isGlobalChat ? "global" : getRoomNameById(currentRoom.name)
      } chat`,
      room: currentRoom.name, // room.id
      timestamp: Date.now(),
    };
    addChatMessage(systemMessage);

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
      message: `${data.character.forename} has entered the room`,
      room: currentRoom.name, // room.id
      timestamp: Date.now(),
    });
    console.debug("📝 Added user-joined system message.");
  });

  socket.on("user-left", (data) => {
    console.debug("📢 User left:", data);
    addChatMessage({
      type: "system",
      message: `${data.character.forename} has left the room`,
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
        messageDiv.style.color = "#ffcc00";
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
          alert(
            "✅ Report submitted successfully! Thank you for helping keep the game safe.",
          );
          reportModal.style.display = "none";
          reportForm.reset();
          console.info("✅ Report submitted successfully");
        } else {
          const failureMessage =
            result.details ||
            result.error ||
            "Failed to submit report. Please try again.";
          alert(`❌ ${failureMessage}`);
          console.error("❌ Report submission failed:", result.error);
        }
      } catch (error) {
        alert(
          "❌ Error submitting report. Please check your connection and try again.",
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

  function setMarkerCountAttr(el, roomId, roomName) {
    const cached = roomCountsCache.get(roomId) ?? 0;
    el.setAttribute("data-user-count", String(cached));
    el.setAttribute("title", `${roomName} - Users: ${cached}`);
    if (el.namespaceURI === "http://www.w3.org/2000/svg") {
      let titleEl = el.querySelector("title");
      if (!titleEl) {
        titleEl = document.createElementNS(
          "http://www.w3.org/2000/svg",
          "title",
        );
        el.appendChild(titleEl);
      }
      titleEl.textContent = `${roomName} - Users: ${cached}`;
    }
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
            tooltip.textContent = `${room.name} - Users: ${userCount}`;
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
            tooltip.textContent = `${docksideCafe.name} - Users: ${userCount}`;
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
            tooltip.textContent = `${berth44Forward.name} - Users: ${userCount}`;
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
            tooltip.textContent = `${firstClassGangway.name} - Users: ${userCount}`;
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
            tooltip.textContent = `${crewGangway.name} - Users: ${userCount}`;
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
            tooltip.textContent = `${thirdClassGangway.name} - Users: ${userCount}`;
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
            tooltip.textContent = `${berth44Aft.name} - Users: ${userCount}`;
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
            tooltip.textContent = `${coveredWalkway.name} - Users: ${userCount}`;
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
            tooltip.textContent = `${boardingTower.name} - Users: ${userCount}`;
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
  function showBritannicDeckplans() {
    // Reset popup size to default
    deckplansPopup.style.width = "";
    deckplansPopup.style.maxWidth = "";

    const deckplanDisplay = document.querySelector(".deckplan-display");
    if (deckplanDisplay) {
      deckplanDisplay.style.maxWidth = "1100px";
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

    // After SVG overlays are created, set title attribute for all room markers
    setTimeout(() => {
      document.querySelectorAll(".room-marker").forEach((link) => {
        const roomName = link.getAttribute("data-room-name");
        const userCount = link.getAttribute("data-user-count") || "0";
        if (roomName) {
          link.setAttribute("title", `${roomName} - Users: ${userCount}`);
        }
      });
    }, 0);
    console.debug("🗺️ Showing Britannic deckplans");
  }

  deckButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const deck = button.getAttribute("data-deck");
      console.debug(`🖱️ Deck button clicked: ${deck}`);
      currentDeckImage.src = `/images/decks/${deck}.jpg`;
      roomMarkers.innerHTML = "";
      const existingSvg = document.querySelector(".deck-svg-overlay");
      if (existingSvg) existingSvg.remove();

      if (deck === "a_deck") {
        const svgOverlay = document.createElement("div");
        svgOverlay.className = "deck-svg-overlay";
        svgOverlay.innerHTML = `
        <svg style="width:100%; position:absolute; top:0; left:0;" xmlns="http://www.w3.org/2000/svg" 
             xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 1929 441">
          <!-- First Class Lounge -->
          <a xlink:href="#" class="room-marker first_class_lounge" data-room-id="first_class_lounge_a">
            <g>
              <polygon class="image-mapper-shape" points="825 140 863 140 881 126 912 125 925 139 933 140 948 140 961 125 997 125 1010 140 1046 140 1048 346 1010 347 997 362 965 362 948 347 928 346 923 349 914 362 885 362 868 348 862 347 827 347 825 140"></polygon>
            </g>
          </a>
          <!-- Corridor -->
          <a xlink:href="#" class="room-marker corridor" data-room-id="corridor_a">
            <g>
              <rect class="image-mapper-shape" x="1052" y="283" width="273" height="22"></rect>
            </g>
          </a>
          <!-- Corridor -->
          <a xlink:href="#" class="room-marker corridor" data-room-id="corridor">
            <g>
              <polygon class="image-mapper-shape" points="1517,280,1807,281,1808,202,1516,205,1516,192,1870,193,1870,203,1817,204,1817,281,1869,281,1869,294,1518,295"></polygon>
            </g>
          </a>
          <!-- Reading & Writing Room -->
          <a xlink:href="#" class="room-marker reading_writing_room" data-room-id="reading_writing_room_a">
            <g>
              <polygon class="image-mapper-shape" points="1060,139 1071,139 1081,134 1089,131 1097,128 1107,128 1113,130 1129,138 1151,138 1152,205 1147,204 1148,280 1060,281 1061,139 1060,139 1062,139"></polygon>
            </g>
          </a>
          <!-- Grand Staircase (A-Deck) -->
          <a xlink:href="#" class="room-marker grand_staircase" data-room-id="grand_staircase_a">
            <g>
              <polygon class="image-mapper-shape" points="1329,139 1452,139 1453,174 1497,175 1497,191 1516,192 1516,293 1497,293 1497,310 1452,310 1452,344 1328,344 1329,139"></polygon>
            </g>
          </a>
          <!-- Aft Corridor -->
          <a xlink:href="#" class="room-marker corridor" data-room-id="aft_corridor_a">
            <g>
              <polygon class="image-mapper-shape" points="568,187 822,186 823,206 568,207 568,187"></polygon>
            </g>
          </a>
          <!-- Aft Grand Staircase -->
          <a xlink:href="#" class="room-marker grand_staircase" data-room-id="aft_grand_staircase_a">
            <g>
              <polygon class="image-mapper-shape" points="455,142 499,142 500,168 561,169 562,207 563,323 500,323 500,347 456,347 455,142"></polygon>
            </g>
          </a>
          <a xlink:href="#" class="room-marker smoking-room" data-room-id="first_class_smoking_room_a">
            <g>
              <polygon class="image-mapper-shape" points="289,142 449,141 449,206 324,206 325,349 290,348 290,363 217,364 216,348 182,347 180,144 214,143 215,129 288,128 288,141 290,141 289,142"></polygon>
            </g>
          </a>
          <a xlink:href="#" class="room-marker palm-court" data-room-id="verandah_palm_court_a">
            <g>
              <polygon class="image-mapper-shape" points="19,130 34,130 39,128 48,115 98,115 101,116 111,128 127,128 128,206 19,206 19,130"></polygon>
            </g>
          </a>
          <a xlink:href="#" class="room-marker promenade" data-room-id="first_class_starboard_enclosed_promenade_a">
            <g>
              <polygon class="image-mapper-shape" points="1053,305,1324,306,1323,347,1449,347,1449,360,1453,362,1793,360,1794,413,1060,421"></polygon>
            </g>
          </a>
          <a xlink:href="#" class="room-marker promenade" data-room-id="first_class_port_enclosed_promenade_a">
            <g>
              <polygon class="image-mapper-shape" points="1058,135,1068,135,1089,124,1101,123,1109,124,1129,133,1450,133,1450,121,1647,122,1800,122,1799,71,1637,68,1545,67,1263,66,1056,68"></polygon>
            </g>
          </a>
          <a xlink:href="#" class="room-marker promenade" data-room-id="first_class_port_promenade_a">
            <g>
              <polygon class="image-mapper-shape" points="17,246,5,245,6,71,169,71,445,68,1055,68,1055,133,1012,134,998,120,957,120,947,135,930,136,917,122,881,121,860,136,774,133,772,182,567,183,565,117,496,117,497,135,293,137,293,122,210,122,210,138,182,138,180,123,115,124,103,111,46,111,35,126,14,126,17,248"></polygon>
            </g>
          </a>
          <a xlink:href="#" class="room-marker promenade" data-room-id="first_class_starboard_promenade_a">
            <g>
              <polygon class="image-mapper-shape" points="6,249,13,249,16,368,32,370,47,381,103,382,116,369,182,370,183,355,210,355,211,369,295,370,295,354,496,354,498,369,570,370,569,326,772,323,773,351,863,351,882,367,916,367,929,354,946,353,961,367,998,368,1003,364,1011,352,1053,351,1053,306,1055,421,521,423,9,422,7,422"></polygon>
            </g>
          </a>
          <a xlink:href="#" class="room-marker corridor" data-room-id="first_a_corridor">
            <g>
              <polygon class="image-mapper-shape" points="1323,191,1187,191,1187,171,1181,171,1182,204,1324,204"></polygon>
            </g>
          </a>
<a xlink:href="#" class="room-marker cabin" data-room-id="cabin_a3">
    <g>
      <polygon class="image-mapper-shape" points="1826,294 1870,294 1870,355 1826,355 1827,294"></polygon>
    </g>
  </a>
  <!-- Cabin A2 -->
  <a xlink:href="#" class="room-marker cabin" data-room-id="cabin_a4">
    <g>
      <polygon class="image-mapper-shape" points="1827,127 1870,127 1870,189 1827,190 1826,127"></polygon>
    </g>
  </a>
  <!-- Cabin A3 -->
  <a xlink:href="#" class="room-marker cabin" data-room-id="cabin_a7">
    <g>
      <polygon class="image-mapper-shape" points="1762,295 1823,295 1823,324 1763,324 1762,324 1762,295"></polygon>
    </g>
  </a>
  <!-- Cabin A4 -->
  <a xlink:href="#" class="room-marker cabin" data-room-id="cabin_a9">
    <g>
      <polygon class="image-mapper-shape" points="1763,327 1822,327 1823,356 1763,356 1763,327"></polygon>
    </g>
  </a>
  <!-- Cabin A5 -->
  <a xlink:href="#" class="room-marker cabin" data-room-id="cabin_a6">
    <g>
      <polygon class="image-mapper-shape" points="1775,206 1804,206 1805,241 1775,241 1776,206"></polygon>
    </g>
  </a>
  <!-- Cabin A6 -->
  <a xlink:href="#" class="room-marker cabin" data-room-id="cabin_a5">
    <g>
      <polygon class="image-mapper-shape" points="1776,243 1804,244 1805,277 1775,278 1775,243"></polygon>
    </g>
  </a>
  <!-- Cabin A7 -->
  <a xlink:href="#" class="room-marker cabin" data-room-id="cabin_a10">
    <g>
      <polygon class="image-mapper-shape" points="1762,127 1824,127 1824,156 1762,156 1762,127"></polygon>
    </g>
  </a>
  <!-- Cabin A8 -->
  <a xlink:href="#" class="room-marker cabin" data-room-id="cabin_a8">
    <g>
      <polygon class="image-mapper-shape" points="1762,159 1822,159 1823,188 1762,189"></polygon>
    </g>
  </a>
  <!-- Cabin A9 -->
  <a xlink:href="#" class="room-marker cabin" data-room-id="cabin_a2">
    <g>
      <polygon class="image-mapper-shape" points="1820,206 1870,206 1871,241 1821,241 1821,206"></polygon>
    </g>
  </a>
  <!-- Cabin A10 -->
  <a xlink:href="#" class="room-marker cabin" data-room-id="cabin_a1">
    <g>
      <polygon class="image-mapper-shape" points="1820,244 1870,244 1870,278 1820,278 1820,244"></polygon>
    </g>
  </a>
  <!-- Cabin A11 -->
  <a xlink:href="#" class="room-marker cabin" data-room-id="cabin_a11">
    <g>
      <polygon class="image-mapper-shape" points="1688,295 1749,296 1750,324 1688,323"></polygon>
    </g>
  </a>
  <!-- Cabin A12 -->
  <a xlink:href="#" class="room-marker cabin" data-room-id="cabin_a12">
    <g>
      <polygon class="image-mapper-shape" points="1690,158 1749,158 1749,188 1690,189"></polygon>
    </g>
  </a>
  <!-- Cabin A14 -->
  <a xlink:href="#" class="room-marker cabin" data-room-id="cabin_a14">
    <g>
      <polygon class="image-mapper-shape" points="1689,155 1749,156 1749,127 1689,127"></polygon>
    </g>
  </a>
  <!-- Cabin A15 -->
  <a xlink:href="#" class="room-marker cabin" data-room-id="cabin_a15">
    <g>
      <polygon class="image-mapper-shape" points="1689,328 1749,328 1750,357 1688,356"></polygon>
    </g>
  </a>
  <!-- Cabin A16 -->
  <a xlink:href="#" class="room-marker cabin" data-room-id="cabin_a16">
    <g>
      <polygon class="image-mapper-shape" points="1626,158 1684,159 1684,189 1626,188"></polygon>
    </g>
  </a>
  <!-- Cabin A17 -->
  <a xlink:href="#" class="room-marker cabin" data-room-id="cabin_a17">
    <g>
      <polygon class="image-mapper-shape" points="1627,296 1684,296 1684,324 1626,324"></polygon>
    </g>
  </a>
  <!-- Cabin A18 -->
  <a xlink:href="#" class="room-marker cabin" data-room-id="cabin_a18">
    <g>
      <polygon class="image-mapper-shape" points="1626,127 1684,128 1684,156 1626,156"></polygon>
    </g>
  </a>
  <!-- Cabin A19 -->
  <a xlink:href="#" class="room-marker cabin" data-room-id="cabin_a19">
    <g>
      <polygon class="image-mapper-shape" points="1627,328 1684,327 1684,356 1627,356"></polygon>
    </g>
  </a>
  <!-- Cabin A20 -->
  <a xlink:href="#" class="room-marker cabin" data-room-id="cabin_a20">
    <g>
      <polygon class="image-mapper-shape" points="1557,159 1613,159 1613,189 1557,188"></polygon>
    </g>
  </a>
  <!-- Cabin A21 -->
  <a xlink:href="#" class="room-marker cabin" data-room-id="cabin_a21">
    <g>
      <polygon class="image-mapper-shape" points="1557,297 1612,297 1612,324 1558,324"></polygon>
    </g>
  </a>
  <!-- Cabin A22 -->
  <a xlink:href="#" class="room-marker cabin" data-room-id="cabin_a22">
    <g>
      <polygon class="image-mapper-shape" points="1611,155 1557,155 1556,127 1612,127"></polygon>
    </g>
  </a>
  <!-- Cabin A23 -->
  <a xlink:href="#" class="room-marker cabin" data-room-id="cabin_a23">
    <g>
      <polygon class="image-mapper-shape" points="1556,329 1612,328 1612,356 1556,356"></polygon>
    </g>
  </a>
  <!-- Cabin A30 -->
  <a xlink:href="#" class="room-marker cabin" data-room-id="cabin_a30">
    <g>
      <polygon class="image-mapper-shape" points="1289,189,1290,139,1322,139,1324,188"></polygon>
    </g>
  </a>
  <!-- Cabin A32 -->
  <a xlink:href="#" class="room-marker cabin" data-room-id="cabin_a32">
    <g>
      <polygon class="image-mapper-shape" points="1257,139,1285,139,1286,139,1287,188,1258,188"></polygon>
    </g>
  </a>
  <!-- Cabin A34 -->
  <a xlink:href="#" class="room-marker cabin" data-room-id="cabin_a34">
    <g>
      <polygon class="image-mapper-shape" points="1183,139,1210,139,1212,189,1190,189,1188,169,1183,168"></polygon>
    </g>
  </a>
  <!-- Cabin A36 -->
  <a xlink:href="#" class="room-marker cabin" data-room-id="cabin_a36">
    <g>
      <polygon class="image-mapper-shape" points="1158,138,1178,139,1179,179,1157,178"></polygon>
    </g>
  </a>
  <!-- 1st Class Forward Overlooking Promenade -->
  <a xlink:href="#" class="room-marker promenade" data-room-id="first_class_forward_overlooking_promenade_a">
    <g>
      <polygon class="image-mapper-shape" points="1800,72,1911,73,1913,408,1800,410,1800,363,1871,362,1876,359,1877,126,1876,123,1871,122,1801,122"></polygon>
    </g>
  </a>
  <!-- 2nd Class Staircase -->
  <a xlink:href="#" class="room-marker covered-walkway" data-room-id="second_class_staircase_a">
    <g>
      <polygon class="image-mapper-shape" points="86,210,176,209,176,284,87,285"></polygon>
    </g>
  </a>
</svg>
`;
        document.querySelector(".deckplan-display").appendChild(svgOverlay);

        document.querySelectorAll(".room-marker").forEach((link) => {
          const roomId = link.getAttribute("data-room-id");
          const room = deckRooms.a_deck.find((r) => r.id === roomId);
          if (room) {
            link.setAttribute("data-room-name", room.name);
            {
              const cached = roomCountsCache.get(
                link.getAttribute("data-room-id"),
              );
              link.setAttribute("data-user-count", String(cached ?? 0));
            }

            setMarkerCountAttr(link, roomId, room.name);

            link.addEventListener("click", (e) => {
              e.preventDefault();
              console.debug(`🔍 SVG room area clicked: ${roomId}`);
              enterRoom(room);
            });

            // Add tooltip functionality
            const tooltip = document.getElementById("room-tooltip");
            link.addEventListener("mouseenter", (e) => {
              const userCount = link.getAttribute("data-user-count") || "0";
              tooltip.textContent = `${room.name} - Users: ${userCount}`;
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
        });
        console.debug("🗺️ Added SVG overlay for A Deck with room markers");
      }

      if (deck === "d_deck") {
        const svgOverlay = document.createElement("div");
        svgOverlay.className = "deck-svg-overlay";
        svgOverlay.innerHTML = `
        <svg style="width:100%; position:absolute; top:0; left:0;" xmlns="http://www.w3.org/2000/svg" 
             xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 1000 124">
          <!-- First Class Reception Room -->
          <a xlink:href="#" class="room-marker reception-room" data-room-id="first_class_reception_d">
            <g>
              <polygon class="image-mapper-shape" points="582,4 675,5 676,105 583,106 582,4"></polygon>
            </g>
          </a>
          
          <!-- First Class Dining Room -->
          <a xlink:href="#" class="room-marker dining-room" data-room-id="first_class_dining_room_d">
            <g>
              <polygon class="image-mapper-shape" points="453,5 581,4 581,44 555,44 555,68 582,68 582,107 454,107 454,69 485,69 485,44 452,44 453,5"></polygon>
            </g>
          </a>
        </svg>
        `;
        document.querySelector(".deckplan-display").appendChild(svgOverlay);

        document.querySelectorAll(".room-marker").forEach((link) => {
          const roomId = link.getAttribute("data-room-id");
          const room = deckRooms.d_deck.find((r) => r.id === roomId);
          if (room) {
            link.setAttribute("data-room-name", room.name);
            {
              const cached = roomCountsCache.get(
                link.getAttribute("data-room-id"),
              );
              link.setAttribute("data-user-count", String(cached ?? 0));
            }

            setMarkerCountAttr(link, roomId, room.name);

            link.addEventListener("click", (e) => {
              e.preventDefault();
              console.debug(`🔍 SVG room area clicked: ${roomId}`);
              enterRoom(room);
            });

            // Add tooltip functionality
            const tooltip = document.getElementById("room-tooltip");
            link.addEventListener("mouseenter", (e) => {
              const userCount = link.getAttribute("data-user-count") || "0";
              tooltip.textContent = `${room.name} - Users: ${userCount}`;
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
        });
        console.debug("🗺️ Added SVG overlay for D Deck with room markers");
      }

      if (deck === "boat_deck") {
        const svgOverlay = document.createElement("div");
        svgOverlay.className = "deck-svg-overlay";
        svgOverlay.innerHTML = `
        <svg style="width:100%; position:absolute; top:0; left:0;" xmlns="http://www.w3.org/2000/svg" 
             xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 635 156">
          <!-- Grand Staircase -->
          <a xlink:href="#" class="room-marker grand_staircase" data-room-id="grand_staircase_bd">
            <g>
              <polygon class="image-mapper-shape" points="435,46 476,46 476,64 495,64 495,98 476,98 476,114 435,114"></polygon>
            </g>
          </a>
          <!-- Children's Playroom -->
          <a xlink:href="#" class="room-marker" data-room-id="childrens_playroom_bd">
            <g>
              <polygon class="image-mapper-shape" points="377,46 434,46 434,68 377,68"></polygon>
            </g>
          </a>
          <!-- Gymnasium -->
          <a xlink:href="#" class="room-marker gymnasium" data-room-id="gymnasium_bd">
            <g>
              <polygon class="image-mapper-shape" points="377,94 434,94 434,115 377,115"></polygon>
            </g>
          </a>
          <!-- Port Promenade -->
          <a xlink:href="#" class="room-marker promenade" data-room-id="port_promenade_bd">
            <g>
              <polygon class="image-mapper-shape" points="230,68,230,24,353,23,508,23,508,51,476,51,476,45,375,45,372,44,367,41,357,41,351,45,330,45,327,40,312,40,309,44,309,45,303,45,298,41,283,41,280,45,268,45,266,45,266,56,251,56,251,68"></polygon>
            </g>
          </a>
          <!-- Starboard Promenade -->
          <a xlink:href="#" class="room-marker promenade" data-room-id="starboard_promenade_bd">
            <g>
              <polygon class="image-mapper-shape" points="229,98,235,98,235,103,242,103,243,103,243,113,267,113,267,116,267,117,282,117,285,121,287,122,299,122,304,117,310,117,313,122,325,122,330,117,342,117,344,116,344,101,375,101,375,117,477,117,478,117,478,110,509,110,509,139,230,140"></polygon>
            </g>
          </a>
          <!-- Starboard Officers Promenade -->
          <a xlink:href="#" class="room-marker promenade crew-promenade" data-room-id="starboard_officers_promenade_bd">
            <g>
              <polygon class="image-mapper-shape" points="515,110,609,110,609,138,515,139"></polygon>
            </g>
          </a>
          <!-- Port Officers Promenade -->
          <a xlink:href="#" class="room-marker promenade crew-promenade" data-room-id="port_officers_promenade_bd">
            <g>
              <polygon class="image-mapper-shape" points="514,23,608,23,608,51,514,51"></polygon>
            </g>
          </a>
          <!-- Port Bridge Wing -->
          <a xlink:href="#" class="room-marker bridge_wing crew-promenade" data-room-id="port_bridge_wing_bd">
            <g>
              <polygon class="image-mapper-shape" points="596,53,610,53,610,21,616,21,617,21,617,33,620,41,626,50,629,56,629,62,608,62,608,67,596,67"></polygon>
            </g>
          </a>
          <!-- Starboard Bridge Wing -->
          <a xlink:href="#" class="room-marker bridge_wing crew-promenade" data-room-id="starboard_bridge_wing_bd">
            <g>
              <polygon class="image-mapper-shape" points="596,92,609,92,610,92,610,98,629,98,629,102,627,108,623,114,619,120,617,126,617,139,611,139,611,107,596,107"></polygon>
            </g>
          </a>
          <!-- Bridge -->
          <a xlink:href="#" class="room-marker bridge crew-promenade" data-room-id="bridge_bd">
            <g>
              <polygon class="image-mapper-shape" points="609,64,628,64,628,97,610,97"></polygon>
            </g>
          </a>
          <!-- Wheelhouse -->
          <a xlink:href="#" class="room-marker wheelhouse crew-promenade" data-room-id="wheelhouse_bd">
            <g>
              <polygon class="image-mapper-shape" points="592,69,608,69,608,91,592,91"></polygon>
            </g>
          </a>
          <!-- Starboard Engineer's Promenade -->
          <a xlink:href="#" class="room-marker promenade crew-promenade" data-room-id="starboard_engineers_promenade_bd">
            <g>
              <polygon class="image-mapper-shape" points="186,110,186,140,229,140,229,98,221,98,219,98,219,111,185,111"></polygon>
            </g>
          </a>
          <!-- Port Engineer's Promenade -->
          <a xlink:href="#" class="room-marker promenade crew-promenade" data-room-id="port_engineers_promenade_bd">
            <g>
              <polygon class="image-mapper-shape" points="186,24,228,24,228,80,219,80,219,53,186,53"></polygon>
            </g>
          </a>
          <!-- Starboard 2nd Class Promenade -->
          <a xlink:href="#" class="room-marker promenade second-class" data-room-id="starboard_2nd_class_promenade_bd">
            <g>
              <polygon class="image-mapper-shape" points="184,94,184,140,13,140,14,82,21,82,21,94,54,94,54,82,184,82"></polygon>
            </g>
          </a>
          <!-- Port 2nd Class Promenade -->
          <a xlink:href="#" class="room-marker promenade second-class" data-room-id="port_2nd_class_promenade_bd">
            <g>
              <polygon class="image-mapper-shape" points="183,79,183,24,14,24,14,80,21,80,21,69,54,69,54,80,183,80"></polygon>
            </g>
          </a>
          <!-- 2nd Class Staircase -->
          <a xlink:href="#" class="room-marker staircase second-class" data-room-id="2nd_class_staircase_bd">
            <g>
              <polygon class="image-mapper-shape" points="22,70,52,70,52,92,22,92"></polygon>
            </g>
          </a>
        </svg>
        `;
        document.querySelector(".deckplan-display").appendChild(svgOverlay);

        document.querySelectorAll(".room-marker").forEach((link) => {
          const roomId = link.getAttribute("data-room-id");
          const room = deckRooms.boat_deck.find((r) => r.id === roomId);
          if (room) {
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
              console.debug(`🔍 SVG room area clicked: ${roomId}`);
              enterRoom(room);
            });

            // Add tooltip functionality
            const tooltip = document.getElementById("room-tooltip");
            link.addEventListener("mouseenter", (e) => {
              const userCount = link.getAttribute("data-user-count") || "0";
              tooltip.textContent = `${room.name} - Users: ${userCount}`;
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
        });
        console.debug("🗺️ Added SVG overlay for Boat Deck with room markers");
      }

      if (deck === "b_deck") {
        const svgOverlay = document.createElement("div");
        svgOverlay.className = "deck-svg-overlay";
        svgOverlay.innerHTML = `
        <svg style="width:100%; position:absolute; top:0; left:0;" xmlns="http://www.w3.org/2000/svg" 
             xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 1342 142">
          <!-- Forecastle -->
          <a xlink:href="#" class="room-marker crew-promenade" data-room-id="forecastle_b">
            <g>
              <polygon class="image-mapper-shape" points="1074,24,1097,26,1121,29,1148,35,1172,42,1193,50,1222,65,1237,75,1232,79,1219,88,1201,98,1181,106,1164,112,1145,117,1129,120,1117,122,1103,124,1092,126,1084,126,1084,128,1083,126,1083,127,1075,127"></polygon>
            </g>
          </a>
          <!-- 1st Class B-Deck Forward Overlooking Promenade -->
          <a xlink:href="#" class="room-marker promenade" data-room-id="first_class_b_forward_overlooking_promenade">
            <g>
              <polygon class="image-mapper-shape" points="966,18,968,23,968,34,993,34,994,34,995,120,968,120,968,131,965,136,1007,135,1006,18"></polygon>
            </g>
          </a>
          <!-- 1st Class Port B-Deck Enclosed Promenade -->
          <a xlink:href="#" class="room-marker promenade" data-room-id="first_class_port_b_enclosed_promenade">
            <g>
              <polygon class="image-mapper-shape" points="794,17 888,17 965,18 966,24 967,34 836,34 836,40 794,40"></polygon>
            </g>
          </a>
          <!-- 1st Class Starboard B-Deck Enclosed Promenade -->
          <a xlink:href="#" class="room-marker promenade" data-room-id="first_class_starboard_b_enclosed_promenade">
            <g>
              <polygon class="image-mapper-shape" points="797,114 837,114 838,121 967,120 967,129 963,136 871,137 798,138"></polygon>
            </g>
          </a>
          <!-- Poop Deck -->
          <a xlink:href="#" class="room-marker poop-deck" data-room-id="poop_deck">
            <g>
              <polygon class="image-mapper-shape" points="204,101 205,100 205,135 184,133 143,127 117,120 102,113 93,100 90,92 90,74 94,62 104,52 118,45 146,39 170,35 204,30 204,62 192,62 192,60 146,61 145,78 153,78 153,87 146,87 146,104 192,104 192,101"></polygon>
            </g>
          </a>
          <!-- Grand Staircase -->
          <a xlink:href="#" class="room-marker grand-staircase" data-room-id="grand_staircase_b">
            <g>
              <polygon class="image-mapper-shape" points="794,42,836,42,836,53,852,53,852,58,869,58,869,96,853,96,853,101,837,101,837,113,795,113"></polygon>
            </g>
          </a>
          <!-- 3rd Class Smoke Room -->
          <a xlink:href="#" class="room-marker third-class-smoking-room" data-room-id="third_class_smoke_room_b">
            <g>
              <polygon class="image-mapper-shape" points="155,62,191,62,191,83,197,83,197,93,191,93,191,103,155,103"></polygon>
            </g>
          </a>
          <!-- 2nd Class Smoke Room -->
          <a xlink:href="#" class="room-marker second-class smoking-room" data-room-id="second_class_smoke_room_b">
            <g>
              <polygon class="image-mapper-shape" points="334,41,371,41,371,122,334,121,334,100,331,100,331,63,334,63"></polygon>
            </g>
          </a>
          <!-- 2nd Class Starboard Promenade -->
          <a xlink:href="#" class="room-marker second-class" data-room-id="second_class_starboard_promenade_b">
            <g>
              <polygon class="image-mapper-shape" points="395,118,395,140,331,139,242,137,243,82,266,82,266,94,282,94,282,95,329,95,329,99,329,100,317,100,316,123,372,123,372,118"></polygon>
            </g>
          </a>
          <!-- 2nd Class Port Promenade -->
          <a xlink:href="#" class="room-marker second-class" data-room-id="second_class_port_promenade_b">
            <g>
              <polygon class="image-mapper-shape" points="395,22,395,44,372,44,372,40,316,40,316,63,329,63,329,68,266,69,266,81,243,81,243,27,299,24,339,23"></polygon>
            </g>
          </a>
          <!-- B-Deck Aft Staircase -->
          <a xlink:href="#" class="room-marker first-class" data-room-id="b_deck_aft_staircase">
            <g>
              <polygon class="image-mapper-shape" points="498,60,532,60,532,100,512,100,512,105,498,105,498,102,495,102,495,98,498,98"></polygon>
            </g>
          </a>
          <!-- Restaurant Reception Room -->
          <a xlink:href="#" class="room-marker first-class" data-room-id="restaurant_reception_room">
            <g>
              <polygon class="image-mapper-shape" points="456,95,493,95,493,140,456,140"></polygon>
            </g>
          </a>
          <!-- À La Carte Restaurant -->
          <a xlink:href="#" class="room-marker first-class" data-room-id="a_la_carte_restaurant">
            <g>
              <polygon class="image-mapper-shape" points="397,22,454,21,454,140,397,140,397,95,405,95,405,66,397,66"></polygon>
            </g>
          </a>
          <!-- Cabin B-81 -->
          <a xlink:href="#" class="room-marker cabin first-class" data-room-id="cabin_b81">
            <g>
              <polygon class="image-mapper-shape" points="538,112,552,112,552,140,538,140"></polygon>
            </g>
          </a>
          <!-- Cabin B-83 -->
          <a xlink:href="#" class="room-marker cabin first-class" data-room-id="cabin_b83">
            <g>
              <polygon class="image-mapper-shape" points="537,99,548,99,548,111,538,111,537,111"></polygon>
            </g>
          </a>
          <!-- Cabin B-79 -->
          <a xlink:href="#" class="room-marker cabin first-class" data-room-id="cabin_b79">
            <g>
              <polygon class="image-mapper-shape" points="552,99,565,99,565,140,552,140"></polygon>
            </g>
          </a>
          <!-- Cabin B-77 -->
          <a xlink:href="#" class="room-marker cabin first-class" data-room-id="cabin_b77">
            <g>
              <polygon class="image-mapper-shape" points="566,99,576,99,576,111,566,111"></polygon>
            </g>
          </a>
          <!-- Cabin B-75 -->
          <a xlink:href="#" class="room-marker cabin first-class" data-room-id="cabin_b75">
            <g>
              <polygon class="image-mapper-shape" points="566,112,578,112,579,112,579,140,566,140"></polygon>
            </g>
          </a>
          <!-- Cabin B-73 -->
          <a xlink:href="#" class="room-marker cabin first-class" data-room-id="cabin_b73">
            <g>
              <polygon class="image-mapper-shape" points="579,98,592,98,592,140,579,140"></polygon>
            </g>
          </a>
          <!-- Cabin B-71 -->
          <a xlink:href="#" class="room-marker cabin first-class" data-room-id="cabin_b71">
            <g>
              <polygon class="image-mapper-shape" points="593,99,604,99,604,111,593,111"></polygon>
            </g>
          </a>
          <!-- Cabin B-69 -->
          <a xlink:href="#" class="room-marker cabin first-class" data-room-id="cabin_b69">
            <g>
              <polygon class="image-mapper-shape" points="592,112,606,112,606,140,592,140"></polygon>
            </g>
          </a>
          <!-- Cabin B-67 -->
          <a xlink:href="#" class="room-marker cabin first-class" data-room-id="cabin_b67">
            <g>
              <polygon class="image-mapper-shape" points="607,98,619,98,619,140,606,140"></polygon>
            </g>
          </a>
          <!-- Cabin B-63 -->
          <a xlink:href="#" class="room-marker cabin first-class" data-room-id="cabin_b63">
            <g>
              <polygon class="image-mapper-shape" points="620,99,630,99,630,111,620,111"></polygon>
            </g>
          </a>
          <!-- Cabin B-65 -->
          <a xlink:href="#" class="room-marker cabin first-class" data-room-id="cabin_b65">
            <g>
              <polygon class="image-mapper-shape" points="620,112,633,112,633,140,620,140"></polygon>
            </g>
          </a>
          <!-- Cabin B-61 -->
          <a xlink:href="#" class="room-marker cabin first-class" data-room-id="cabin_b61">
            <g>
              <polygon class="image-mapper-shape" points="634,99,646,99,646,140,634,140"></polygon>
            </g>
          </a>
          <!-- Cabin B-57 -->
          <a xlink:href="#" class="room-marker cabin first-class" data-room-id="cabin_b57">
            <g>
              <polygon class="image-mapper-shape" points="646,99,658,99,658,110,646,110"></polygon>
            </g>
          </a>
          <!-- Cabin B-59 -->
          <a xlink:href="#" class="room-marker cabin first-class" data-room-id="cabin_b59">
            <g>
              <polygon class="image-mapper-shape" points="646,111,660,111,661,140,646,140"></polygon>
            </g>
          </a>
          <!-- Cabin B-55 -->
          <a xlink:href="#" class="room-marker cabin first-class" data-room-id="cabin_b55">
            <g>
              <polygon class="image-mapper-shape" points="661,98,674,98,674,140,662,140"></polygon>
            </g>
          </a>
          <!-- Cabin B-53 -->
          <a xlink:href="#" class="room-marker cabin first-class" data-room-id="cabin_b53">
            <g>
              <polygon class="image-mapper-shape" points="675,99,685,99,685,110,675,110"></polygon>
            </g>
          </a>
          <!-- Cabin B-51 -->
          <a xlink:href="#" class="room-marker cabin first-class" data-room-id="cabin_b51">
            <g>
              <polygon class="image-mapper-shape" points="675,111,688,111,688,140,675,140"></polygon>
            </g>
          </a>
          <!-- Cabin B-49 -->
          <a xlink:href="#" class="room-marker cabin first-class" data-room-id="cabin_b49">
            <g>
              <polygon class="image-mapper-shape" points="689,98,704,98,704,139,689,139"></polygon>
            </g>
          </a>
        </svg>
        `;
        document.querySelector(".deckplan-display").appendChild(svgOverlay);

        const svgRoomIds = new Set();

        document.querySelectorAll(".room-marker").forEach((link) => {
          const roomId = link.getAttribute("data-room-id");
          const room = deckRooms.b_deck.find((r) => r.id === roomId);
          if (room) {
            link.setAttribute("data-room-name", room.name);
            {
              const cached = roomCountsCache.get(
                link.getAttribute("data-room-id"),
              );
              link.setAttribute("data-user-count", String(cached ?? 0));
            }
            svgRoomIds.add(roomId);

            setMarkerCountAttr(link, roomId, room.name);

            link.addEventListener("click", (e) => {
              e.preventDefault();
              console.debug(`🔍 SVG room area clicked: ${roomId}`);
              enterRoom(room);
            });

            // Add tooltip functionality
            const tooltip = document.getElementById("room-tooltip");
            link.addEventListener("mouseenter", (e) => {
              const userCount = link.getAttribute("data-user-count") || "0";
              tooltip.textContent = `${room.name} - Users: ${userCount}`;
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
        });
        emitRoomCountBatch(Array.from(svgRoomIds));
        console.debug("🗺️ Added SVG overlay for B Deck with room markers");
      }

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
              tooltip.textContent = `${room.name} - Users: ${userCount}`;
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

  // Tooltip hover functionality
  // No custom tooltip logic needed; use native title attribute

  function positionTooltip(e) {
    // No-op: custom tooltip removed; using native title attribute
  }

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

      // Update title attribute for regular room markers
      marker.title = `${roomName} - Users: ${count}`;

      // Update SVG title elements for SVG room markers
      if (marker.namespaceURI === "http://www.w3.org/2000/svg") {
        let titleEl = marker.querySelector("title");
        if (titleEl) {
          titleEl.textContent = `${roomName} - Users: ${count}`;
        }
      }

      // Update tooltip if it's currently being displayed for this room
      const tooltip = document.getElementById("room-tooltip");
      if (tooltip && tooltip.style.display === "block") {
        const currentTooltipText = tooltip.textContent;
        if (currentTooltipText.includes(roomName)) {
          tooltip.textContent = `${roomName} - Users: ${count}`;
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
    document.getElementById("people").textContent = `People Onboard: ${count}`;
  });

  // Add this inside your DOMContentLoaded event listener
  const rulesBtn = document.getElementById("rules-btn");
  const rulesPopup = document.getElementById("rules-popup");
  const closeRulesBtn = document.querySelector(".close-rules");

  rulesBtn.addEventListener("click", () => {
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

  // Updated refresh button logic to cycle through room images
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

      // Provide visual feedback on the button (optional, does not affect image)
      refreshBtn.classList.add("button-active");
      setTimeout(() => refreshBtn.classList.remove("button-active"), 300);

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

  const locationImageSystem = {
    preloadedImages: {},

    preloadRoomImages(roomName) {
      if (!roomImages[roomName]) return;

      const imageSet = roomImages[roomName].images;
      console.debug(`🖼️ Preloading ${imageSet.length} images for ${roomName}`);

      // Skip if already preloaded for this room
      if (this.preloadedImages[roomName]) return;

      // Evict oldest rooms if cache exceeds 10 rooms to bound memory
      const cachedRooms = Object.keys(this.preloadedImages);
      if (cachedRooms.length >= 10) {
        const oldest = cachedRooms[0];
        delete this.preloadedImages[oldest];
      }

      this.preloadedImages[roomName] = [];

      imageSet.forEach((imageName) => {
        const img = new Image();
        // Check if this is a Southampton location
        const isSouthamptonImage =
          deckRooms.southampton &&
          deckRooms.southampton.some((r) => r.location.chatRoom === roomName);

        if (isSouthamptonImage) {
          img.src = `/images/animations/locations/southampton/${imageName}`;
        } else {
          img.src = `/images/animations/locations/britannic/${imageName}`;
        }
        this.preloadedImages[roomName].push(img);
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
          const img = new Image();
          const vpath = `/images/animations/locations/${encodeURIComponent(
            variantFolder,
          )}/${vImage}`;
          const vpathPlain = `/images/animations/locations/${variantFolder}/${vImage}`;
          console.debug(
            `🖼️ Preloading variant path: ${vpath} (plain: ${vpathPlain})`,
          );
          img.src = vpath; // prefer encoded
          // Also push a plain variant in case server expects non-encoded path
          const imgPlain = new Image();
          imgPlain.src = vpathPlain;
          this.preloadedImages[roomName].push(imgPlain);
          this.preloadedImages[roomName].push(img);
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
    // Assuming nameElement is the DOM element displaying the character's name
    const nameElement = document.getElementById("character-name"); // Adjust ID as needed
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
        dobElement.textContent = birthDate.toLocaleDateString("en-US", {
          year: "numeric",
          month: "long",
          day: "numeric",
        });
      } else {
        dobElement.textContent = "Not specified";
      }

      // Populate bio
      bioElement.textContent = characterData.bio || "No bio available";

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
      dealDrawBtn.textContent = "New";
      if (vpHoldBtn) vpHoldBtn.style.opacity = "0.5";
      if (vpBetSelect) vpBetSelect.disabled = false;
      handRanking.textContent = "";
      handRanking.classList.remove("win");
      if (vpStatus) vpStatus.textContent = 'Click "New" to begin game';

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
          rank.style.color = this.hand[i].color;
          suit.style.color = this.hand[i].color;
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

  // "New" button — sends bet to server, waits for dealt hand
  dealDrawBtn.addEventListener("click", () => {
    const betAmount = parseFloat(vpBetSelect ? vpBetSelect.value : 0);
    if (betAmount > 0 && playerMoney < betAmount) {
      if (vpStatus) vpStatus.textContent = "Not enough money!";
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
    dealDrawBtn.textContent = "New";
    dealDrawBtn.disabled = false;
    if (vpHoldBtn) vpHoldBtn.style.opacity = "1";
    if (vpBetSelect) vpBetSelect.disabled = true;
    handRanking.textContent = "";
    handRanking.classList.remove("win");
    const betAmount = parseFloat(vpBetSelect ? vpBetSelect.value : 0);
    if (vpStatus)
      vpStatus.textContent =
        betAmount > 0
          ? `Bet: £${betAmount.toFixed(2)} — Select cards to hold, then click Hold`
          : "Select cards to hold, then click Hold";
  });

  socket.on("poker-error", ({ message }) => {
    if (vpStatus) vpStatus.textContent = message;
    dealDrawBtn.disabled = false;
  });

  // "Hold" button — sends held cards to server, waits for result
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

      if (isWin && bet > 0) {
        if (vpStatus)
          vpStatus.textContent = `${rank} — You win £${winnings.toFixed(2)}!`;
      } else if (bet > 0) {
        if (vpStatus)
          vpStatus.textContent = `${rank} — You lose £${bet.toFixed(2)}`;
      } else {
        if (vpStatus) vpStatus.textContent = isWin ? "You win!" : rank;
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

  // Eat/Drink button functionality
  // Eat/Drink button functionality (toggle menu)
  const eatDrinkBtn = document.getElementById("eat-drink-btn");
  if (eatDrinkBtn) {
    eatDrinkBtn.addEventListener("click", () => {
      const existingPopup = document.querySelector(".eat-drink-popup");
      if (existingPopup) {
        existingPopup.remove();
        eatDrinkBtn.textContent = "Eat & Drink";
      } else {
        showEatDrinkOptions();
        eatDrinkBtn.textContent = "Close Menu";
      }
    });
  }

  // Function to show eat/drink options
  function showEatDrinkOptions() {
    const popup = document.createElement("div");
    popup.className = "eat-drink-popup";

    popup.innerHTML = `
      <div class="edm-body">
        <div class="edm-sidebar">
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
          <img src="${item.localImage}" alt="${item.name}" onerror="this.src='${item.image}'" />
          <span class="edm-item-name">${item.name}</span>
        `;

        // Tooltip on hover
        card.addEventListener("mouseenter", (e) => {
          const desc = item.description.replace(/\n/g, "<br>");
          let statsHtml = "";
          if (item.hungry)
            statsHtml += `<span class="edm-stat edm-stat-hunger">🍖 ${item.hungry > 0 ? "+" : ""}${item.hungry}</span>`;
          if (item.thirsty)
            statsHtml += `<span class="edm-stat edm-stat-thirst">💧 ${item.thirsty > 0 ? "+" : ""}${item.thirsty}</span>`;
          if (item.drunk)
            statsHtml += `<span class="edm-stat edm-stat-drunk">🍺 ${item.drunk > 0 ? "+" : ""}${item.drunk}</span>`;
          if (item.warm)
            statsHtml += `<span class="edm-stat edm-stat-warm">🔥 ${item.warm > 0 ? "+" : ""}${item.warm}</span>`;
          if (item.price)
            statsHtml += `<span class="edm-stat edm-stat-price">💰 £${item.price}</span>`;

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

      socket.emit("purchase-item", { price: item.price });
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

    // Food category starts open, render food items by default
    const foodCat = popup.querySelector('[data-category="food"]');
    if (foodCat) foodCat.classList.add("open");
    renderItems("food", "all");

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

  // Function to handle eating specific food items
  function eatSpecific(itemName, hungerIncrease) {
    statusBars.hunger.value = Math.min(
      100,
      statusBars.hunger.value + hungerIncrease,
    );

    console.debug(`🍽️ Ate ${itemName}, hunger increased by ${hungerIncrease}`);

    // Update the hunger bar immediately
    const hungerBar = document.querySelector(".bar.hunger");
    if (hungerBar) {
      hungerBar.style.width = `${statusBars.hunger.value}%`;
      const hue = (statusBars.hunger.value / 100) * 120;
      hungerBar.style.setProperty("--hunger-hue", hue);
    }

    saveStatsToServer();
  }

  // Function to handle drinking specific beverages
  function drinkSpecific(itemName, thirstDecrease) {
    statusBars.thirst.value = Math.min(
      100,
      statusBars.thirst.value + thirstDecrease,
    );

    console.debug(
      `🥤 Drank ${itemName}, thirst decreased by ${thirstDecrease}`,
    );

    // Update the thirst bar immediately
    const thirstBar = document.querySelector(".bar.thirst");
    if (thirstBar) {
      thirstBar.style.width = `${statusBars.thirst.value}%`;
      const hue = (statusBars.thirst.value / 100) * 120;
      thirstBar.style.setProperty("--thirst-hue", hue);
    }

    saveStatsToServer();
  }

  // Function to handle eating
  function eat() {
    const hungerIncrease = 30 + Math.random() * 20; // Restore 30-50 hunger
    statusBars.hunger.value = Math.min(
      100,
      statusBars.hunger.value + hungerIncrease,
    );

    console.debug(
      `🍽️ Ate food, hunger increased by ${hungerIncrease.toFixed(1)}`,
    );

    // Update the hunger bar immediately
    const hungerBar = document.querySelector(".bar.hunger");
    if (hungerBar) {
      hungerBar.style.width = `${statusBars.hunger.value}%`;
      const hue = (statusBars.hunger.value / 100) * 120;
      hungerBar.style.setProperty("--hunger-hue", hue);
    }
  }

  // Function to handle drinking
  function drink() {
    const thirstDecrease = 35 + Math.random() * 25; // Restore 35-60 thirst
    statusBars.thirst.value = Math.min(
      100,
      statusBars.thirst.value + thirstDecrease,
    );

    console.debug(
      `🥤 Drank beverage, thirst decreased by ${thirstDecrease.toFixed(1)}`,
    );

    // Update the thirst bar immediately
    const thirstBar = document.querySelector(".bar.thirst");
    if (thirstBar) {
      thirstBar.style.width = `${statusBars.thirst.value}%`;
      const hue = (statusBars.thirst.value / 100) * 120;
      thirstBar.style.setProperty("--thirst-hue", hue);
    }
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
    return date.toLocaleDateString("en-US", {
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
    const bioText =
      player.bio || "No biography available for this passenger yet.";

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
          <div class="player-class">Passenger</div>
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
    const DEPARTURE_DELAY_MS = 720000; // 12 minutes pre-departure countdown

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
      if (elapsedSinceDepartureMs >= SOUTHAMPTON_WATER_END) {
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
      if (elapsedSinceDepartureMs >= NEEDLES_COMPLETE) {
        hideCoastalTerrain(reason);
      }
    };

    // Make land_middle scroll like waves
    if (landMiddle) {
      landMiddle.classList.add("scrolling");
    }

    // Timeline milestones (in milliseconds from departure start)
    const DEPARTURE_START = 0;
    const SOUTHAMPTON_WATER_END = 1200000; // 20 minutes - 6 knots
    const NEEDLES_PASS = 4650000; // 1h 17.5m - Isle of Wight passage - 12 knots
    const NEEDLES_COMPLETE = 5130000; // ~8 minutes after Needles start (8 min passage)
    const CHANNEL_COMPLETE = 18000000; // 5 hours - 19 knots cruising across English Channel
    const APPROACH_COMPLETE = 18900000; // 15 more minutes - 12 knots approaching harbor
    const BERTHING_COMPLETE = 19500000; // 10 more minutes - 6 knots → 0 (5h 25m total)
    const LAND_END_START = 4590000; // 1 minute (60s) before Isle of Wight passage

    // Speed zones based on timeline
    const acceleration = 0.012; // knots per second squared

    // Use server voyage time for synchronization
    const startTime = voyageStartTime || Date.now(); // Use server time if available
    const elapsedAtStart = voyageStartTime ? getElapsedSeconds() * 1000 : 0; // How much time has already passed
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

    // Removed onCherbourgResize logic as we now use fixed scene coordinates
    // which automatically scale with the viewport.

    if (elapsedAtStart > 0) {
      const elapsedSinceVoyageStart = elapsedAtStart / 1000;
      // Calculate elapsed time since DEPARTURE (not voyage start)
      // Departure happens at 720 seconds (12 minutes)
      const elapsedSinceDeparture = Math.max(0, elapsedSinceVoyageStart - TIMELINE_SECONDS.DEPARTURE_DELAY);

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
          if (currentSpeed > CHERBOURG_SHOW_KNOTS) {
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

    const interval = setInterval(() => {
      if (!departureStarted) {
        clearInterval(interval);
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
        voyageStartTime ||
        pendingVoyageStartTime ||
        latestVoyageState
      ) {
        // Fall back to local calculation when the server hasn't pushed speed yet.
        // This avoids a static ocean for late-joiners or transient disconnects.
        const anchor = voyageStartTime || pendingVoyageStartTime;
        const elapsedSeconds = anchor
          ? Math.floor((Date.now() - anchor) / 1000)
          : latestVoyageState?.elapsedSeconds || 0;
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
          if (currentSpeed <= CHERBOURG_SHOW_KNOTS) {
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
          else if (currentSpeed <= CHERBOURG_SHOW_KNOTS) {
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

      // Stop interval if elements are fully offscreen (optional)
      // if (departurePosition > window.innerWidth) clearInterval(interval);
    }, 16); // ~60fps, but works even when tab is inactive
  }

  // Start departure sequence synchronized with server time (7 minutes after voyage start)
  if (DEPARTURE_SEQUENCE_ENABLED) {
    // Check repeatedly if it's time to start departure
    const checkDepartureTime = setInterval(() => {
      if (!voyageStartTime) return; // Wait for server time

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
          console.debug("🚢 Starting departure at server-synced 12 minute mark");
          startDepartureSequence();
        }
      }
    }, 1000); // Check every second
  } else {
    console.debug("🚧 Departure sequence scheduling skipped (disabled)");
  }
});
