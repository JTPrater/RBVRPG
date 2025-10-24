const socket = io();
let currentRoom = { name: null, id: null };
const chatHistory = {
  rooms: {},
};
console.log("✅ Initialized socket connection and global variables.");

// Global voyage start time (will be set by server)
let voyageStartTime = null;

// Listen for voyage start time from server
socket.on("voyage-start-time", (serverStartTime) => {
  voyageStartTime = serverStartTime;
  console.log(
    `⏰ Received voyage start time from server: ${new Date(
      voyageStartTime
    ).toISOString()}`
  );

  // Initialize narrative system now that we have the start time
  if (narrativeSystem) {
    narrativeSystem.startTime = voyageStartTime;
    console.log("✅ Narrative system synchronized with server time");
  }
});

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
      time: 420, // 7 minutes - Departure begins
      text: "The ship's horn echoes across Southampton Water. The moorings are cast off, and Britannic slowly pulls away from the dock.",
    },
    {
      time: 630, // 10 minutes 30 seconds - Southampton Water end
      text: "We depart Southampton Water and enter the Solent, increasing to cruising speed.",
    },
    {
      time: 2430, // 40 minutes 30 seconds
      text: "The Solent stretches ahead as we make our way toward the open sea.",
    },
    {
      time: 4080, // 1h 8m - Isle of Wight visible
      text: "The Isle of Wight coastline becomes visible on the starboard side.",
    },
    {
      time: 4680, // 1h 18m - Needles Pass
      text: "We are now passing the Nab Tower, a few miles East of us.",
    },
    {
      time: 5160, // 1h 26m - Needles Complete
      text: "The Isle of Wight fades astern as we enter the English Channel proper.",
    },
    {
      time: 6030, // 1h 40m 30s
      text: "The engines settle into their steady rhythm for the channel crossing.",
    },
    {
      time: 10830, // 3h 30s
      text: "The English coast has disappeared from view. Only open water surrounds us now.",
    },
    {
      time: 14430, // 4h 30s - Mid-channel
      text: "We are now deep in the English Channel, making steady progress toward France.",
    },
    {
      time: 18030, // 5h 30s - French coast visible
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
    // startTime will be set by server via socket event
    // Don't set it here anymore
    this.updateNarrative();
    this.updateWeather();

    // Update narrative every 5 seconds
    setInterval(() => this.updateNarrative(), 5000);
    // Update weather every 2 minutes
    setInterval(() => this.updateWeather(), 120000);

    console.log("✅ Narrative system initialized (waiting for server time)");
  },

  updateNarrative() {
    if (!this.startTime) return;

    const elapsed = Math.floor((Date.now() - this.startTime) / 1000);
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
        console.log(`📖 Narrative event: ${nextEvent.text}`);
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
      console.log(`🌤️ Weather updated: ${randomWeather}`);
    }, 300);
  },
};

function setScale() {
  const baseWidth = 1920;
  const baseHeight = 1080;
  const scale = window.innerWidth / baseWidth;
  document.documentElement.style.setProperty("--scale", scale);

  // Detect fullscreen more accurately
  const heightRatio = window.innerHeight / baseHeight;
  const isFullscreen = heightRatio >= 0.98;

  // Apply a small fixed adjustment in browser mode only
  let britannicBottom = 64;
  let waterBottom = 13.8;

  if (!isFullscreen) {
    britannicBottom = 64; // Just 1% higher in browser mode
    waterBottom = 14.3; // Just 0.5% higher for water
  }

  document.documentElement.style.setProperty(
    "--britannic-bottom",
    `${britannicBottom}%`
  );
  document.documentElement.style.setProperty(
    "--water-bottom",
    `${waterBottom}%`
  );
}

window.addEventListener("resize", setScale);
setScale(); // Initial call to set the scale

// Initialize the open_map audio
const openMapSound = new Audio("/sounds/open_map.mp3");
openMapSound.preload = "auto";

console.log("✅ Initialized open_map audio.");

// Initialize door sound effects
const openDoorSound = new Audio("/sounds/open_door.mp3");
const closeDoorSound = new Audio("/sounds/close_door.mp3");
openDoorSound.preload = "auto";
closeDoorSound.preload = "auto";

const interiorSound = new Audio("/sounds/ship_interior.mp3");
interiorSound.loop = true; // Loop the ambient sound
interiorSound.volume = 0.5; // Set volume (adjustable as needed)

const deckRooms = {
  boat_deck: [
    {
      id: "grand_staircase_bd",
      name: "Grand Staircase",
      type: "grand-staircase",
      isSVG: true,
      location: {
        image: "Grand Staircase.jpg",
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
        image: "1st Class Gymnasium.jpg",
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
        image: "first class port promenade.webp", // Using same image
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
        image: "Childrens Playroom.jpg", // Ensure this image exists in your assets
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
        image: "Port Officer's Promenade.jpg", // Ensure this exists
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
        image: "Starboard Officer's Promenade.jpg", // Ensure this image exists
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
        image: "Port Bridge Wing.jpg", // First image
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
        image: "Starboard Bridge Wing.jpg", // First image
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
        image: "Bridge.jpg", // First image
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
        image: "wheelhouse1.jpg", // First image
        chatRoom: "wheelhouse_bd",
      },
    },
    {
      id: "starboard_engineers_promenade_bd",
      name: "Starboard Engineer's Promenade",
      type: "promenade",
      isSVG: true,
      location: {
        image: "starb engineers prom1.jpg", // First image
        chatRoom: "starboard_engineers_promenade_bd",
      },
    },
    {
      id: "port_engineers_promenade_bd",
      name: "Port Engineer's Promenade",
      type: "promenade",
      isSVG: true,
      location: {
        image: "port engineers prom1.jpg", // First image
        chatRoom: "port_engineers_promenade_bd",
      },
    },
    {
      id: "starboard_2nd_class_promenade_bd",
      name: "Starboard 2nd Class Promenade",
      type: "promenade",
      isSVG: true,
      location: {
        image: "starb 2nd class prom1.jpg", // First image
        chatRoom: "starboard_2nd_class_promenade_bd",
      },
    },
    {
      id: "port_2nd_class_promenade_bd",
      name: "Port 2nd Class Promenade",
      type: "promenade",
      isSVG: true,
      location: {
        image: "port 2nd class prom1.jpg", // First image
        chatRoom: "port_2nd_class_promenade_bd",
      },
    },
    {
      id: "2nd_class_staircase_bd",
      name: "2nd Class Staircase",
      type: "staircase",
      isSVG: true,
      location: {
        image: "2nd class staircasebd1.jpg", // First image
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
        image: "forecastle1.jpg",
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
          "1C B overlook prom1.jpg",
          "1C B overlook prom2.jpg",
          "1C B overlook prom3.jpg",
          "1C B overlook prom4.jpg",
          "1C B overlook prom5.jpg",
          "1C B overlook prom6.jpg",
        ],
        chatRoom: "first_class_b_forward_overlooking_promenade",
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
        image: "Corridor.jpg", // Adjust image name as needed
        chatRoom: "corridor_a",
      },
    },
    {
      id: "corridor",
      name: "Corridor",
      type: "corridor",
      isSVG: true,
      location: {
        image: "a corridor1.jpg",
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
    image: "Grand Staircase A Deck.jpg",
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
    image: "Aft Grand Staircase.jpg", // Fallback image
    chatRoom: "aft_grand_staircase_a",
  },
});

deckRooms.a_deck.push({
  id: "first_class_smoking_room_a",
  name: "First Class Smoking Room",
  type: "smoking-room",
  isSVG: true,
  location: {
    image: "First Class Smoking Room.jpg", // Fallback image
    chatRoom: "first_class_smoking_room_a",
  },
});

deckRooms.a_deck.push({
  id: "first_class_starboard_enclosed_promenade_a",
  name: "1st Class Starboard Enclosed Promenade",
  type: "promenade",
  isSVG: true,
  location: {
    image: "1st starb A enclosed prom1.jpg",
    chatRoom: "first_class_starboard_enclosed_promenade_a",
  },
});

deckRooms.a_deck.push({
  id: "first_class_port_enclosed_promenade_a",
  name: "1st Class Port Enclosed Promenade",
  type: "promenade",
  isSVG: true,
  location: {
    image: "1st port A enclosed prom1.jpg",
    chatRoom: "first_class_port_enclosed_promenade_a",
  },
});

deckRooms.a_deck.push({
  id: "first_class_port_promenade_a",
  name: "1st Class Port Promenade",
  type: "promenade",
  isSVG: true,
  location: {
    image: "1st A port promenade1.jpg",
    chatRoom: "first_class_port_promenade_a",
  },
});

deckRooms.a_deck.push({
  id: "first_class_starboard_promenade_a",
  name: "1st Class Starboard Promenade",
  type: "promenade",
  isSVG: true,
  location: {
    image: "1st A starb promenade1.jpg",
    chatRoom: "first_class_starboard_promenade_a",
  },
});

deckRooms.a_deck.push({
  id: "first_a_corridor",
  name: "1st A Corridor",
  type: "corridor",
  isSVG: true,
  location: {
    image: "1st A corridor1.jpg",
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
      image: "Cabin A1.jpg",
      chatRoom: "cabin_a1",
    },
  },
  {
    id: "cabin_a2",
    name: "Cabin A2",
    type: "cabin",
    isSVG: true,
    location: {
      image: "Cabin A2.jpg",
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
      image: "A30.jpg",
      chatRoom: "cabin_a30",
    },
  },
  {
    id: "cabin_a32",
    name: "Cabin A32",
    type: "cabin",
    isSVG: true,
    location: {
      image: "A32.jpg",
      chatRoom: "cabin_a32",
    },
  },
  {
    id: "cabin_a34",
    name: "Cabin A34",
    type: "cabin",
    isSVG: true,
    location: {
      image: "A34.jpg",
      chatRoom: "cabin_a34",
    },
  },
  {
    id: "cabin_a36",
    name: "Cabin A36",
    type: "cabin",
    isSVG: true,
    location: {
      image: "A36.jpg",
      chatRoom: "cabin_a36",
    },
  },
  {
    id: "first_class_forward_overlooking_promenade_a",
    name: "1st Class Forward Overlooking Promenade",
    type: "promenade",
    isSVG: true,
    location: {
      image: "1C overlook prom1.jpg",
      chatRoom: "first_class_forward_overlooking_promenade_a",
    },
  },
  {
    id: "second_class_staircase_a",
    name: "2nd Class Staircase",
    type: "staircase",
    isSVG: true,
    location: {
      image: "2nd class staircase1.jpg",
      chatRoom: "second_class_staircase_a",
    },
  }
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

console.log("✅ Defined deckRooms:", deckRooms);

// Define room images for rooms with multiple variants
const roomImages = {
  grand_staircase_bd: {
    images: [
      "Grand Staircase.jpg",
      "Grand Staircase2.jpg",
      "Grand Staircase3.jpg",
      "Grand Staircase4.jpg",
    ],
    currentIndex: 0,
  },
  childrens_playroom_bd: {
    images: [
      "Childrens Playroom.jpg",
      "Childrens Playroom2.jpg",
      "Childrens Playroom3.jpg",
    ],
    currentIndex: 0,
  },
  port_officers_promenade_bd: {
    images: [
      "Port Officer's Promenade.jpg",
      "Port Officer's Promenade2.jpg",
      "Port Officer's Promenade3.jpg",
      // Add more image filenames here as needed
    ],
    currentIndex: 0,
  },
  starboard_officers_promenade_bd: {
    images: [
      "Starboard Officer's Promenade.jpg",
      "Starboard Officer's Promenade2.jpg",
      "Starboard Officer's Promenade3.jpg",
      // Add more image filenames here as needed
    ],
    currentIndex: 0,
  },
  port_bridge_wing_bd: {
    images: [
      "Port Bridge Wing.jpg",
      "Port Bridge Wing2.jpg",
      "Port Bridge Wing3.jpg",
      "Port Bridge Wing4.jpg",
      "Port Bridge Wing5.jpg",
    ],
    currentIndex: 0,
  },
  starboard_bridge_wing_bd: {
    images: [
      "Starboard Bridge Wing.jpg",
      "Starboard Bridge Wing2.jpg",
      "Starboard Bridge Wing3.jpg",
      "Starboard Bridge Wing4.jpg",
      "Starboard Bridge Wing5.jpg",
    ],
    currentIndex: 0,
  },
  bridge_bd: {
    images: [
      "Bridge.jpg",
      "Bridge2.jpg",
      "Bridge3.jpg",
      "Bridge4.jpg",
      "Bridge5.jpg",
      "Bridge6.jpg",
    ],
    currentIndex: 0,
  },
  first_class_lounge_a: {
    images: [
      "First Class Lounge.jpg",
      "First Class Lounge2.jpg",
      "First Class Lounge3.jpg",
      "First Class Lounge4.jpg",
      "First Class Lounge5.jpg",
      "First Class Lounge6.jpg",
      "First Class Lounge7.jpg",
      "First Class Lounge8.jpg",
      "First Class Lounge9.jpg",
      "First Class Lounge10.jpg",
      "First Class Lounge11.jpg",
      "First Class Lounge12.jpg",
    ],
    currentIndex: 0,
  },
  corridor_a: {
    images: ["Corridor.jpg", "Corridor2.jpg", "Corridor3.jpg", "Corridor4.jpg"],
    currentIndex: 0,
  },
  corridor: {
    images: [
      "a corridor1.jpg",
      "a corridor2.jpg",
      "a corridor3.jpg",
      "a corridor4.jpg",
    ],
    currentIndex: 0,
  },
  grand_staircase_a: {
    images: [
      "Grand Staircase A Deck.jpg",
      "Grand Staircase A Deck2.jpg",
      "Grand Staircase A Deck3.jpg",
      "Grand Staircase A Deck4.jpg",
      "Grand Staircase A Deck5.jpg",
      "Grand Staircase A Deck6.jpg",
    ],
    currentIndex: 0,
  },
  aft_grand_staircase_a: {
    images: [
      "Aft Grand Staircase.jpg",
      "Aft Grand Staircase2.jpg",
      "Aft Grand Staircase3.jpg",
      "Aft Grand Staircase4.jpg",
    ],
    currentIndex: 0,
  },
  first_class_smoking_room_a: {
    images: [
      "First Class Smoking Room.jpg",
      "First Class Smoking Room2.jpg",
      "First Class Smoking Room3.jpg",
      "First Class Smoking Room4.jpg",
      "First Class Smoking Room5.jpg",
      "First Class Smoking Room6.jpg",
      "First Class Smoking Room7.jpg",
      "First Class Smoking Room8.jpg",
      "First Class Smoking Room9.jpg",
    ],
    currentIndex: 0,
  },
};
roomImages.verandah_palm_court_a = {
  images: [
    "Palm Court.jpg",
    "Palm Court2.jpg",
    "Palm Court3.jpg",
    // Add more images as needed, e.g., "Palm Court4.jpg"
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
  ],
  currentIndex: 0,
};

roomImages.first_class_dining_room_d = {
  images: [
    "First Class Dining1.jpg",
    "First Class Dining2.jpg",
    "First Class Dining3.jpg",
    "First Class Dining4.jpg",
    "First Class Dining5.jpg",
    "First Class Dining6.jpg",
    "First Class Dining7.jpg",
    "First Class Dining8.jpg",
    "First Class Dining9.jpg",
    "First Class Dining10.jpg",
    "First Class Dining11.jpg",
    "First Class Dining12.jpg",
    "First Class Dining13.jpg",
    "First Class Dining14.jpg",
    "First Class Dining15.jpg",
    "First Class Dining16.jpg",
    "First Class Dining17.jpg",
    "First Class Dining18.jpg",
    "First Class Dining19.jpg",
    "First Class Dining20.jpg",
    "First Class Dining21.jpg",
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
    "1st starb A enclosed prom1.jpg",
    "1st starb A enclosed prom2.jpg",
    "1st starb A enclosed prom3.jpg",
    "1st starb A enclosed prom4.jpg",
    "1st starb A enclosed prom5.jpg",
  ],
  currentIndex: 0,
};

roomImages.first_class_port_enclosed_promenade_a = {
  images: [
    "1st port A enclosed prom1.jpg",
    "1st port A enclosed prom2.jpg",
    "1st port A enclosed prom3.jpg",
    "1st port A enclosed prom4.jpg",
    "1st port A enclosed prom5.jpg",
  ],
  currentIndex: 0,
};

roomImages.first_class_port_promenade_a = {
  images: [
    "1st A port promenade1.jpg",
    "1st A port promenade2.jpg",
    "1st A port promenade3.jpg",
    "1st A port promenade4.jpg",
    "1st A port promenade5.jpg",
    "1st A port promenade6.jpg",
    "1st A port promenade7.jpg",
    "1st A port promenade8.jpg",
    "1st A port promenade9.jpg",
    "1st A port promenade10.jpg",
  ],
  currentIndex: 0,
};

roomImages.first_class_starboard_promenade_a = {
  images: [
    "1st A starb promenade1.jpg",
    "1st A starb promenade2.jpg",
    "1st A starb promenade3.jpg",
    "1st A starb promenade4.jpg",
    "1st A starb promenade5.jpg",
    "1st A starb promenade6.jpg",
    "1st A starb promenade7.jpg",
    "1st A starb promenade8.jpg",
    "1st A starb promenade9.jpg",
    "1st A starb promenade10.jpg",
  ],
  currentIndex: 0,
};

roomImages.first_a_corridor = {
  images: ["1st A corridor1.jpg", "1st A corridor2.jpg", "1st A corridor3.jpg"],
  currentIndex: 0,
};

roomImages.first_class_forward_overlooking_promenade_a = {
  images: [
    "1C overlook prom1.jpg",
    "1C overlook prom2.jpg",
    "1C overlook prom3.jpg",
    "1C overlook prom4.jpg",
    "1C overlook prom5.jpg",
    "1C overlook prom6.jpg",
  ],
  currentIndex: 0,
};

roomImages.second_class_staircase_a = {
  images: [
    "2nd class staircase1.jpg",
    "2nd class staircase2.jpg",
    "2nd class staircase3.jpg",
  ],
  currentIndex: 0,
};

roomImages.wheelhouse_bd = {
  images: [
    "wheelhouse1.jpg",
    "wheelhouse2.jpg",
    "wheelhouse3.jpg",
    "wheelhouse4.jpg",
    "wheelhouse5.jpg",
  ],
  currentIndex: 0,
};

roomImages.starboard_engineers_promenade_bd = {
  images: [
    "starb engineers prom1.jpg",
    "starb engineers prom2.jpg",
    "starb engineers prom3.jpg",
    "starb engineers prom4.jpg",
    "starb engineers prom5.jpg",
  ],
  currentIndex: 0,
};

roomImages.port_engineers_promenade_bd = {
  images: [
    "port engineers prom1.jpg",
    "port engineers prom2.jpg",
    "port engineers prom3.jpg",
  ],
  currentIndex: 0,
};

roomImages.starboard_2nd_class_promenade_bd = {
  images: [
    "starb 2nd class prom1.jpg",
    "starb 2nd class prom2.jpg",
    "starb 2nd class prom3.jpg",
    "starb 2nd class prom4.jpg",
  ],
  currentIndex: 0,
};

roomImages.port_2nd_class_promenade_bd = {
  images: [
    "port 2nd class prom1.jpg",
    "port 2nd class prom2.jpg",
    "port 2nd class prom3.jpg",
    "port 2nd class prom4.jpg",
  ],
  currentIndex: 0,
};

roomImages["2nd_class_staircase_bd"] = {
  images: [
    "2nd class staircasebd1.jpg",
    "2nd class staircasebd2.jpg",
    "2nd class staircasebd3.jpg",
    "2nd class staircasebd4.jpg",
  ],
  currentIndex: 0,
};

roomImages.forecastle_b = {
  images: [
    "forecastle1.jpg",
    "forecastle2.jpg",
    "forecastle3.jpg",
    "forecastle4.jpg",
  ],
  currentIndex: 0,
};

console.log("✅ Defined roomImages:", roomImages);

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
    console.log("🔧 Initializing music player...");
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
            console.log(`✅ Loaded ${songs.length} songs.`);

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
                Math.random() * this.songs.length
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
        console.log("🔁 Current song ended. Playing next.");
        this.playNext();
        songSelect.value = this.currentSongIndex;
      });

      // Initialize controls
      document.getElementById("play-pause").addEventListener("click", () => {
        console.log("🎮 Play/Pause button clicked.");
        this.togglePlay();
      });
      document.getElementById("next-track").addEventListener("click", () => {
        console.log("➡️ Next track button clicked.");
        this.playNext();
      });
      document.getElementById("prev-track").addEventListener("click", () => {
        console.log("⬅️ Previous track button clicked.");
        this.playPrev();
      });
      document.getElementById("mute-toggle").addEventListener("click", () => {
        console.log("🔇 Mute toggle button clicked.");
        this.toggleMute();
      });
      document
        .getElementById("volume-slider")
        .addEventListener("input", (e) => {
          console.log(`🔊 Volume set to: ${e.target.value}`);
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
    console.log(
      `🎵 Loading song index ${this.currentSongIndex}: ${
        this.songs[this.currentSongIndex]
      }`
    );
    this.audio.src = this.songs[this.currentSongIndex];
    this.updateNowPlaying();
    if (this.isPlaying) {
      this.audio
        .play()
        .then(() => {
          console.log("▶️ Playing current song.");
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
          console.log("▶️ Music playing.");
        })
        .catch((error) => {
          console.error("❌ Error playing music:", error);
        });
    } else {
      this.audio.pause();
      this.isPlaying = false;
      console.log("⏸ Music paused.");
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
    console.log(
      `🔄 Playing previous song. New index: ${this.currentSongIndex}`
    );
    this.loadCurrentSong();
  },

  toggleMute() {
    this.audio.muted = !this.audio.muted;
    console.log(`🔇 Mute state changed to: ${this.audio.muted}`);
    document.getElementById("mute-toggle").textContent = this.audio.muted
      ? "🔇"
      : "🔊";
  },

  setVolume(value) {
    this.audio.volume = value / 100;
    console.log(`🔊 Volume set to: ${this.audio.volume}`);
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
    document.getElementById(
      "current-song"
    ).textContent = `Now Playing: ${songName}`;
    console.log(`🆕 Now Playing updated to: ${songName}`);
  },

  updatePlayButton() {
    document.getElementById("play-pause").textContent = this.isPlaying
      ? "⏸"
      : "⏯";
    console.log(`🎮 Play button updated to: ${this.isPlaying ? "⏸" : "⏯"}`);
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
};

console.log("✅ Defined musicPlayer object.");

const statusBars = {
  hunger: { value: 100, rate: 0.05 }, // Decreased from 0.1 to 0.05
  thirst: { value: 100, rate: 0.07 }, // Decreased from 0.15 to 0.07
  energy: { value: 100, rate: 0.03 }, // Decreased from 0.08 to 0.03
  hygiene: { value: 100, rate: 0.02 }, // Decreased from 0.05 to 0.02
  bladder: { value: 100, rate: 0.06 }, // Decreased from 0.12 to 0.06
  intoxication: { value: 0, rate: 0.1 }, // Kept same since it only changes with alcohol
};
function updateStatusBars() {
  Object.entries(statusBars).forEach(([key, status]) => {
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
  });
}

// Update status bars every minute
setInterval(updateStatusBars, 1000);

// Single DOMContentLoaded event listener
document.addEventListener("DOMContentLoaded", function () {
  console.log("📄 DOMContentLoaded event triggered.");

  // Initialize music player
  musicPlayer.init();

  // Initialize narrative system
  narrativeSystem.init();

  // Initialize chat elements
  const chatInput = document.getElementById("chat-input");
  const sendButton = document.getElementById("send-message");
  const chatContainer = document.getElementById("chat-container");
  const deckplansPopup = document.getElementById("deckplans-popup");

  console.log("✅ Initialized chat elements.");

  // Get character data from sessionStorage
  const characterData = JSON.parse(sessionStorage.getItem("character"));
  if (characterData) {
    console.log(
      `🔑 Retrieved character data: ${characterData.forename} ${characterData.surname}`
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

    classElement.textContent = className;
    cabinElement.textContent = `(${cabinNumber})`; // e.g., "A3"

    // Make cabin clickable
    cabinElement.addEventListener("click", (e) => {
      e.preventDefault();
      const cabinId = `cabin_${cabinNumber.toLowerCase()}`; // e.g., "cabin_a3"
      const cabinRoom = deckRooms.a_deck.find((r) => r.id === cabinId);
      if (cabinRoom) {
        enterRoom(cabinRoom);
        console.log(`🚪 Navigated to ${cabinRoom.name}`);
      } else {
        console.log(`❌ Cabin ${cabinNumber} not found in deckRooms.`);
      }
    });
  } else {
    console.log("⚠️ No character data found.");
  }

  // Helper function to find player's cabin room
  function findPlayerCabin() {
    const characterData = JSON.parse(sessionStorage.getItem("character"));
    if (!characterData || !characterData.cabin_number) return null;
    
    const cabinNumber = characterData.cabin_number;
    const cabinId = `cabin_${cabinNumber.toLowerCase()}`;
    
    // Try to find cabin in a_deck
    const cabinRoom = deckRooms.a_deck?.find((r) => r.id === cabinId);
    if (cabinRoom) {
      console.log(`🏠 Found player's cabin: ${cabinRoom.name}`);
      return cabinRoom;
    }
    
    console.log(`⚠️ Could not find cabin ${cabinNumber}`);
    return null;
  }

  // Add event listeners for chat functionality
  sendButton.addEventListener("click", sendMessage);
  chatInput.addEventListener("keypress", function (e) {
    if (e.key === "Enter") {
      console.log("↩️ Enter key pressed in chat input.");
      sendMessage();
    }
  });

  console.log("✅ Added event listeners for chat functionality.");

  const skyImages = document.querySelectorAll(".sky");
  const imageIntervals = [
    { start: 0, end: 4, className: "night" },
    { start: 5, end: 6, className: "ms-0" },
    { start: 7, end: 7, className: "ms-1" },
    { start: 8, end: 8, className: "ms-2" },
    { start: 9, end: 9, className: "ms-3" },
    { start: 10, end: 16, className: "day" },
    { start: 17, end: 17, className: "ms-3" },
    { start: 18, end: 18, className: "ms-2" },
    { start: 19, end: 19, className: "ms-1" },
    { start: 20, end: 21, className: "ms-0" },
    { start: 22, end: 23, className: "night" },
  ];

  function getBSTTime() {
    // Use server voyage time for synchronization
    if (!voyageStartTime) {
      // Fallback if server time not yet received
      const now = new Date();
      const fixed = new Date(now);
      fixed.setHours(12, 0, 0); // Set to 12:00:00 PM
      return fixed;
    }

    // Calculate elapsed time since voyage started
    const elapsedMs = Date.now() - voyageStartTime;
    const elapsedMinutes = Math.floor(elapsedMs / 60000);

    // Start at 12:00 PM (noon) and add elapsed time
    const voyageTime = new Date();
    voyageTime.setHours(12, 0, 0, 0); // Start at noon
    voyageTime.setMinutes(voyageTime.getMinutes() + elapsedMinutes);

    return voyageTime;
  }

  function updateSkyImage() {
    const bstTime = getBSTTime();
    const hours = bstTime.getHours();
    console.log(`🌤️ Updating sky image based on BST hour: ${hours}`);

    skyImages.forEach((img) => (img.style.opacity = 0)); // Hide all images

    const interval = imageIntervals.find(
      (interval) => hours >= interval.start && hours <= interval.end
    );
    if (interval) {
      const image = document.querySelector(`.${interval.className}`);
      if (image) {
        image.style.opacity = 1; // Show the appropriate image
        console.log(`🌅 Displaying sky image: ${interval.className}`);
      }
    }
  }

  function updateInfoBar() {
    const bstTime = getBSTTime();

    // Calculate voyage progress
    let location = "Southampton";
    let speed = "0 knots";

    if (voyageStartTime) {
      const elapsedSeconds = Math.floor((Date.now() - voyageStartTime) / 1000);

      // Update location and speed based on voyage progress
      if (elapsedSeconds < 420) {
        // First 7 minutes
        location = "Southampton";
        speed = "0 knots";
      } else if (elapsedSeconds < 630) {
        // 7-10.5 minutes - departing
        location = "Southampton Water";
        speed = "5 knots";
      } else if (elapsedSeconds < 4080) {
        // Up to 1h 8m
        location = "The Solent";
        speed = "18 knots";
      } else if (elapsedSeconds < 5160) {
        // Up to 1h 26m
        location = "Near Isle of Wight";
        speed = "18 knots";
      } else {
        // After 1h 26m
        location = "English Channel";
        speed = "21 knots";
      }
    }

    const date = `${bstTime.getDate()} of ${bstTime.toLocaleString("default", {
      month: "long",
    })}, ${bstTime.getHours()}:${bstTime
      .getMinutes()
      .toString()
      .padStart(2, "0")}`;

    document.getElementById("location").textContent = `Location: ${location}`;
    document.getElementById("speed").textContent = `Speed: ${speed}`;
    document.getElementById("date").textContent = `Date: ${date}`;

    console.log("🗓️ Updated info bar:", { location, speed, date });
  }

  updateSkyImage(); // Initial update
  updateInfoBar(); // Initial update
  setInterval(updateSkyImage, 60000); // Update every minute
  setInterval(updateInfoBar, 60000); // Update every minute

  console.log("✅ Initialized sky image and info bar updates.");

  function initClouds() {
    const canvas = document.createElement("canvas");
    const cloudContainer = document.querySelector(".cloud-container");
    cloudContainer.appendChild(canvas);
    const ctx = canvas.getContext("2d");

    function resizeCanvas() {
      const scale = parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue("--scale")
      );
      const dpr = window.devicePixelRatio || 1;
      canvas.width = 1920 * scale * dpr;
      canvas.height = 540 * scale * dpr;
      canvas.style.width = `${1920 * scale}px`;
      canvas.style.height = `${540 * scale}px`;
      ctx.scale(dpr, dpr);
    }

    resizeCanvas();
    window.addEventListener("resize", resizeCanvas);

    const clouds = [];
    const cloudImages = {
      day: new Image(),
      ms: new Image(),
      night: new Image(),
    };

    cloudImages.day.src = "/images/animations/clouds/day.png";
    cloudImages.ms.src = "/images/animations/clouds/ms.png";
    cloudImages.night.src = "/images/animations/clouds/night.png";

    cloudImages.day.onload = () =>
      console.log("✅ Loaded cloud image: day.png");
    cloudImages.ms.onload = () => console.log("✅ Loaded cloud image: ms.png");
    cloudImages.night.onload = () =>
      console.log("✅ Loaded cloud image: night.png");

    function spawnCloud() {
      const hours = getBSTTime().getHours();
      let cloudType;

      if (hours >= 10 && hours <= 16) cloudType = "day";
      else if ((hours >= 5 && hours <= 9) || (hours >= 17 && hours <= 21))
        cloudType = "ms";
      else cloudType = "night";

      clouds.push({
        x: canvas.width, // Start from right edge
        y: Math.random() * (canvas.height * 0), // Adjusted to spread clouds higher in the sky
        speed: 0.02 + Math.random() * 0.03, // Reduced base speed for slower, more gentle cloud movement
        image: cloudImages[cloudType],
      });
    }

    function animate() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      clouds.forEach((cloud, index) => {
        if (!cloud.image.complete) return; // Skip if image not loaded
        const scale = 1;
        const scaledHeight = cloud.image.height * scale;
        const scaledWidth = cloud.image.width * scale;

        ctx.drawImage(cloud.image, cloud.x, cloud.y, scaledWidth, scaledHeight);

        cloud.x -= cloud.speed;

        if (cloud.x + scaledWidth < 0) {
          clouds.splice(index, 1);
        }
      });

      // Continuously spawn clouds at a controlled rate
      if (clouds.length < 5 && Math.random() < 0.05) {
        // Adjusted for steady generation
        spawnCloud();
      }

      requestAnimationFrame(animate);
    }

    // Initial spawn to populate the sky
    for (let i = 0; i < 3; i++) {
      spawnCloud();
      clouds[i].x = Math.random() * canvas.width; // Spread initial clouds across the canvas
    }

    animate();
    console.log("🔄 Started clouds animation loop.");
  }

  // Initialize clouds
  initClouds();

  function initSmoke() {
    const canvas = document.createElement("canvas");
    const smokeContainer = document.querySelector(".smoke-container");
    smokeContainer.appendChild(canvas);
    const ctx = canvas.getContext("2d");

    function resizeCanvas() {
      const dpr = window.devicePixelRatio || 1;
      // Size canvas to match the smoke container (50vw)
      const containerWidth = window.innerWidth * 0.5; // 50vw
      const containerHeight = containerWidth; // Square aspect ratio to match CSS height: 50vw

      canvas.width = containerWidth * dpr;
      canvas.height = containerHeight * dpr;
      canvas.style.width = `${containerWidth}px`;
      canvas.style.height = `${containerHeight}px`;
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

    smokeImage.onload = () => console.log("✅ Loaded smoke image: day.png");

    // Define the positions of the three funnels as simple percentages since container is now positioned like ship
    function getFunnelPositions() {
      const containerWidth = window.innerWidth * 0.5; // 50vw display size
      const containerHeight = containerWidth; // square container

      return [
        { x: containerWidth * 0.7, y: containerHeight * 0.81 }, // First funnel (forward/bow) - moved down
        { x: containerWidth * 0.572, y: containerHeight * 0.81 }, // Second funnel (middle) - moved down
        { x: containerWidth * 0.455, y: containerHeight * 0.81 }, // Third funnel (aft/stern) - moved down
      ];
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

      // Use global currentSpeed if available (from departure sequence)
      let horizontalWind = 0;
      if (typeof window.currentSpeed === "number") {
        // Gentler wind: Map speed (0-7) to wind (0 to -0.35), negative for leftward
        horizontalWind = -0.05 - (window.currentSpeed || 0) * 0.04;
      }

      // Create multiple particles per funnel for density
      funnelPositions.forEach((funnel, funnelIndex) => {
        for (let i = 0; i < 1; i++) {
          // Only 1 particle per funnel to keep columns distinct
          const offsetX = (Math.random() - 0.5) * 15; // Much tighter horizontal spread (±7.5px)
          const offsetY = Math.random() * 5; // Minimal vertical variance

          const initialScale = 0.8 + Math.random() * 0.3;
          smokeParticles.push({
            x: funnel.x + offsetX,
            y: funnel.y + offsetY,
            vx: (Math.random() - 0.5) * 0.01, // Start nearly vertical
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

      // Debug: draw a red rectangle to test canvas visibility
      ctx.fillStyle = "red";
      ctx.fillRect(10, 10, 50, 50);

      smokeParticles.forEach((particle, index) => {
        if (!smokeImage.complete) return; // Skip if image not loaded

        // Update horizontal wind based on current ship speed
        let horizontalWind = 0;
        if (typeof window.currentSpeed === "number") {
          horizontalWind = -0.05 - (window.currentSpeed || 0) * 0.04;
        }
        // As the particle ages, blend from initial vertical to horizontal wind
        const bendProgress = Math.min(
          particle.life / (particle.maxLife * 0.6),
          1
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
            0.5 * (1 - ageRatio) * (1 - (ageRatio - 0.7) * 2.5)
          );
        }

        // Minimal wind drift to keep columns straight
        particle.vx += (Math.random() - 0.5) * 0.0005; // Extremely minimal wind
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
          scaledHeight
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

    console.log("🔄 Started smoke animation loop.");
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
    console.log(`📈 Loading progress: ${progress}%`);

    if (progress >= 100) {
      clearInterval(loadingInterval);
      startButton.style.display = "block";
      console.log("✅ Loading complete. Start button displayed.");
    }
  }, 500);

  startButton.addEventListener("click", () => {
    console.log("🚀 Start button clicked.");
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
          console.log(`🎵 Set current song to: ${desiredSongName}`);
        } else {
          console.warn("⚠️ Desired song not found in the playlist.");
        }

        musicPlayer.isPlaying = true;
        musicPlayer.loadCurrentSong();
        musicPlayer.updatePlayButton();
        console.log("🎶 Music started.");
      }
      
      // Smart spawn logic based on voyage progress
      // Wait a moment for voyageStartTime to be received from server
      const waitForSpawn = setInterval(() => {
        if (!voyageStartTime) return; // Wait for server time
        
        clearInterval(waitForSpawn);
        const elapsedSeconds = Math.floor((Date.now() - voyageStartTime) / 1000);
        
        // If ship has already departed (past 7 minutes), spawn on ship
        if (elapsedSeconds >= 420) {
          console.log(`🚢 Voyage already departed (${Math.floor(elapsedSeconds / 60)} min elapsed) - spawning on ship`);
          
          // Try to find player's cabin first, otherwise default to promenade
          const cabinRoom = findPlayerCabin();
          const defaultShipRoom = (deckRooms.boat || deckRooms.bd || deckRooms["boat_deck"])?.find?.(
            (r) => r.id === "port_promenade_bd"
          ) || deckRooms?.a?.find?.((r) => r.id === "port_promenade_bd");
          
          const spawnRoom = cabinRoom || defaultShipRoom;
          if (spawnRoom) {
            enterRoom(spawnRoom);
          } else {
            console.error("❌ Could not find ship spawn location");
          }
        } else {
          // Ship hasn't departed yet - spawn at Southampton docks
          console.log(`⚓ Voyage not yet departed (${elapsedSeconds}s elapsed) - spawning at Southampton`);
          localStorage.removeItem("lastRoom");
          
          const initialRoom = deckRooms.southampton.find(
            (r) => r.name === "Berth 44 Forward Docks"
          );
          if (initialRoom) {
            enterRoom(initialRoom);
          } else {
            console.error("❌ Initial room not found, defaulting to Berth 44 Forward Docks");
            const defaultRoom = deckRooms.southampton.find(
              (r) => r.name === "Berth 44 Forward Docks"
            );
            if (defaultRoom) enterRoom(defaultRoom);
          }
        }
        console.log("🔑 Attempted to enter initial room.");
      }, 100); // Check every 100ms until server time arrives
    }, 1000);
  });

  // Updated enterRoom function with dynamic location image handling
  function enterRoom(room) {
    console.log("🔄 enterRoom called with:", room.name);

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
      console.log(`🔑 Set new room: ${currentRoom.name}`);
      console.log(
        `🏨 Entered room with currentRoom.name set to: ${currentRoom.name}`
      );
      console.log(
        `🖼️ Available room images:`,
        roomImages[currentRoom.name]
          ? roomImages[currentRoom.name].images.length
          : "none"
      );

      // Initialize room chat history and join via socket
      if (!chatHistory.rooms[currentRoom.name]) {
        chatHistory.rooms[currentRoom.name] = [];
      }
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

      if (roomImages[chatRoom]) {
        const roomData = roomImages[chatRoom];
        const imageToShow = roomData.images[roomData.currentIndex];
        // Check if this is a Southampton location
        if (isSouthamptonRoom(room)) {
          imageSrc = `/images/animations/locations/southampton/${imageToShow}`;
        } else {
          imageSrc = `/images/animations/locations/britannic/${imageToShow}`;
        }
      } else {
        // Check if this is a Southampton location
        if (isSouthamptonRoom(room)) {
          imageSrc = `/images/animations/locations/southampton/${room.location.image}`;
        } else {
          imageSrc = `/images/animations/locations/britannic/${room.location.image}`;
        }
      }
      const locationImage = document.querySelector(".location-image");
      locationImage.src = imageSrc;

      // Remove any existing cabin action buttons
      const prevCabinActions = document.getElementById("cabin-action-buttons");
      if (prevCabinActions) prevCabinActions.remove();

      // Add shower, toilet, and sleep buttons for Cabin A1 and A2
      if (room.id === "cabin_a1" || room.id === "cabin_a2") {
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
        };

        actionDiv.appendChild(showerBtn);
        actionDiv.appendChild(toiletBtn);
        actionDiv.appendChild(sleepBtn);
        locationDisplay.appendChild(actionDiv);
      }

      // Remove any existing Enter Britannic button
      const prevEnterBritannicBtn = document.getElementById(
        "enter-britannic-btn"
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
            (r) => r.id === "first_class_reception_d"
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
        }
      }

      // Show eat/drink button in dining room
      const eatDrinkBtn = document.getElementById("eat-drink-btn");
      if (eatDrinkBtn) {
        if (room.id === "first_class_dining_room_d") {
          eatDrinkBtn.style.display = "block";
        } else {
          eatDrinkBtn.style.display = "none";
        }
      }

      localStorage.setItem("lastRoom", room.name);
      console.log(`💾 Saved last room to localStorage: ${room.name}`);

      const interiorTypes = [
        "grand-staircase",
        "gymnasium",
        "playroom",
        "bridge",
      ];

      if (interiorTypes.includes(room.type)) {
        if (interiorSound.paused) {
          interiorSound
            .play()
            .catch((error) =>
              console.error("Error playing interior sound:", error)
            );
        }
      } else {
        interiorSound.pause();
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
        message: message,
        character: characterData,
        timestamp: Date.now(),
        type: "user",
        userId: userId,
        color: currentColor, // Include the current color
      };

      console.log("✉️ Sending message:", messageData);
      socket.emit("chat-message", messageData);
      chatInput.value = "";

      addChatMessage(messageData);
    }
  }

  function updateChatDisplay() {
    console.log("🔄 Updating chat display for room:", currentRoom.name);
    const chatMessages = document.getElementById("chat-messages");
    chatMessages.innerHTML = "";

    // Get messages only for current room
    const roomMessages = chatHistory.rooms[currentRoom.name] || [];
    console.log(
      `📦 Found ${roomMessages.length} messages for room ${currentRoom.name}`
    );

    roomMessages.forEach((data) => {
      // Double check the room match
      if (data.room === currentRoom.name) {
        const messageDiv = document.createElement("div");
        messageDiv.className = `chat-message ${data.type || "user"}`;
        messageDiv.setAttribute("data-user-id", data.userId);

        if (data.type === "system") {
          messageDiv.textContent = data.message;
          messageDiv.style.color = "#ffcc00";
        } else {
          const fullName =
            `${data.character.forename} ${data.character.surname}`.trim();
          messageDiv.textContent = `${fullName}: ${data.message}`;
          messageDiv.style.color = data.color || "#c0932b";
        }

        chatMessages.appendChild(messageDiv);
      }
    });

    chatMessages.scrollTop = chatMessages.scrollHeight;
    console.log(`✅ Updated chat display with ${roomMessages.length} messages`);
  }

  // Add a toggle for global chat
  function toggleGlobalChat() {
    isGlobalChat = !isGlobalChat;
    console.log(`🔄 Toggled global chat. Now isGlobalChat: ${isGlobalChat}`);
    updateChatDisplay();
    const systemMessage = {
      type: "system",
      message: `Switched to ${
        isGlobalChat ? "global" : getRoomNameById(currentRoom.name)
      } chat`,
      room: currentRoom.name, // room.id
      timestamp: Date.now(),
    };
    addChatMessage(systemMessage);
  }

  // Helper function to get room name by ID
  function getRoomNameById(roomId) {
    for (const deck in deckRooms) {
      const room = deckRooms[deck].find((r) => r.id === roomId);
      if (room) return room.name;
    }
    return "Unknown";
  }

  // Socket event listeners
  socket.on("chat-message", (data) => {
    try {
      if (data.character && data.character.forename && data.character.surname) {
        // Ensure the message is for the current room
        if (data.room === currentRoom.name) {
          addChatMessage(data);
          console.log(
            `✉️ Message from ${data.character.forename}: ${data.message}`
          );
        } else {
          console.log(
            `📭 Message from ${data.character.forename} ignored, not in the same room.`
          );
        }
      } else {
        console.warn("⚠️ Received chat message without character data:", data);
      }
    } catch (error) {
      console.error(`❌ Error handling incoming message: ${error.message}`);
    }
  });

  socket.on("user-joined", (data) => {
    console.log("📢 User joined:", data);
    addChatMessage({
      type: "system",
      message: `${data.character.forename} has entered the room`,
      room: currentRoom.name, // room.id
      timestamp: Date.now(),
    });
    console.log("📝 Added user-joined system message.");
  });

  socket.on("user-left", (data) => {
    console.log("📢 User left:", data);
    addChatMessage({
      type: "system",
      message: `${data.character.forename} has left the room`,
      room: currentRoom.name, // room.id
      timestamp: Date.now(),
    });
    console.log("📝 Added user-left system message.");
  });

  // Function to add a chat message
  function addChatMessage(data) {
    console.log("📝 Adding chat message:", data);

    // Only proceed if message is for current room
    if (data.room !== currentRoom.name) {
      console.log(
        `📭 Ignoring message for room ${data.room} (we're in ${currentRoom.name})`
      );
      return;
    }

    // Store message in room history
    if (!chatHistory.rooms[data.room]) {
      chatHistory.rooms[data.room] = [];
    }
    chatHistory.rooms[data.room].push(data);

    // Create message element
    const messageDiv = document.createElement("div");
    messageDiv.className = `chat-message ${data.type || "user"}`;
    messageDiv.setAttribute("data-user-id", data.userId);

    if (data.type === "system") {
      messageDiv.textContent = data.message;
      messageDiv.style.color = "#ffcc00";
    } else {
      const fullName = `${data.character.forename} ${data.character.surname}`;
      messageDiv.textContent = `${fullName}: ${data.message}`;
      messageDiv.style.color = data.color || "#c0932b";
    }

    // Add to chat display
    const chatMessages = document.getElementById("chat-messages");
    chatMessages.appendChild(messageDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }

  // Add color picker event listener
  document
    .getElementById("chat-color-picker")
    .addEventListener("input", (e) => {
      const selectedColor = e.target.value;
      console.log(`🎨 Chat color changed to: ${selectedColor}`);

      // Update existing messages from this user
      const myMessages = document.querySelectorAll(
        `.chat-message[data-user-id="${socket.id}"]`
      );
      myMessages.forEach((msg) => {
        if (!msg.classList.contains("system")) {
          msg.style.color = selectedColor;
        }
      });

      // Send color to server
      socket.emit("change-chat-color", selectedColor);
    });

  // Show settings popup when settings button is clicked
  document
    .querySelector(".panel1-buttons button:first-child")
    .addEventListener("click", () => {
      document.getElementById("settings-popup").style.display = "block";
    });

  // Close settings popup when close button is clicked
  document.querySelector(".close-settings").addEventListener("click", () => {
    document.getElementById("settings-popup").style.display = "none";
  });

  // Add Deckplans button functionality
  const deckplansBtn = document.getElementById("deckplans-btn");
  const closeDeckplansBtn = document.querySelector(".close-deckplans");

  deckplansBtn.addEventListener("click", () => {
    deckplansPopup.style.display = "block";
    openMapSound.currentTime = 0; // Reset to start
    openMapSound.play();

    // Show appropriate deckplan based on player location
    if (isPlayerInSouthampton()) {
      showSouthamptonDeckplan();
    } else {
      showBritannicDeckplans();
    }

    console.log("🗺️ Deckplans popup opened and sound played.");
  });

  closeDeckplansBtn.addEventListener("click", () => {
    deckplansPopup.style.display = "none";
  });

  closeDeckplansBtn.addEventListener("click", () => {
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

  // Helper function to check if player is in Southampton
  // Helper function to check if player is in Southampton
  function isPlayerInSouthampton() {
    return (
      deckRooms.southampton &&
      deckRooms.southampton.some(
        (r) => r.location.chatRoom === currentRoom.name
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
      ".southampton-category-buttons"
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
      deckButtonsContainer.nextSibling
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

    console.log("🗺️ Showing Southampton deckplan");
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
        (r) => r.id === "berth_44_walkaway"
      );
      if (room) {
        const link = document.querySelector(
          '.room-marker[data-room-id="berth_44_walkaway"]'
        );
        if (link) {
          link.setAttribute("data-room-name", room.name);
          link.setAttribute("data-user-count", "0");
          link.setAttribute("title", `${room.name} - Users: 0`);

          link.addEventListener("click", (e) => {
            e.preventDefault();
            console.log(`🔍 Southampton room area clicked: berth_44_walkaway`);
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
        (r) => r.id === "dockside_cafe"
      );
      if (docksideCafe) {
        const link = document.querySelector(
          '.room-marker[data-room-id="dockside_cafe"]'
        );
        if (link) {
          link.setAttribute("data-room-name", docksideCafe.name);
          link.setAttribute("data-user-count", "0");
          link.setAttribute("title", `${docksideCafe.name} - Users: 0`);

          link.addEventListener("click", (e) => {
            e.preventDefault();
            console.log(`🔍 Berth 44 Ground room area clicked: dockside_cafe`);
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
        (r) => r.id === "berth_44_forward"
      );
      if (berth44Forward) {
        const link = document.querySelector(
          '.room-marker[data-room-id="berth_44_forward"]'
        );
        if (link) {
          link.setAttribute("data-room-name", berth44Forward.name);
          link.setAttribute("data-user-count", "0");
          link.setAttribute("title", `${berth44Forward.name} - Users: 0`);

          link.addEventListener("click", (e) => {
            e.preventDefault();
            console.log(
              `🔍 Berth 44 Ground room area clicked: berth_44_forward`
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
        (r) => r.id === "first_class_gangway"
      );
      if (firstClassGangway) {
        const link = document.querySelector(
          '.room-marker[data-room-id="first_class_gangway"]'
        );
        if (link) {
          link.setAttribute("data-room-name", firstClassGangway.name);
          link.setAttribute("data-user-count", "0");
          link.setAttribute("title", `${firstClassGangway.name} - Users: 0`);

          link.addEventListener("click", (e) => {
            e.preventDefault();
            console.log(
              `🔍 Berth 44 Ground room area clicked: first_class_gangway`
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
        (r) => r.id === "crew_gangway"
      );
      if (crewGangway) {
        const link = document.querySelector(
          '.room-marker[data-room-id="crew_gangway"]'
        );
        if (link) {
          link.setAttribute("data-room-name", crewGangway.name);
          link.setAttribute("data-user-count", "0");
          link.setAttribute("title", `${crewGangway.name} - Users: 0`);

          link.addEventListener("click", (e) => {
            e.preventDefault();
            console.log(`🔍 Berth 44 Ground room area clicked: crew_gangway`);
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
        (r) => r.id === "third_class_gangway"
      );
      if (thirdClassGangway) {
        const link = document.querySelector(
          '.room-marker[data-room-id="third_class_gangway"]'
        );
        if (link) {
          link.setAttribute("data-room-name", thirdClassGangway.name);
          link.setAttribute("data-user-count", "0");
          link.setAttribute("title", `${thirdClassGangway.name} - Users: 0`);

          link.addEventListener("click", (e) => {
            e.preventDefault();
            console.log(
              `🔍 Berth 44 Ground room area clicked: third_class_gangway`
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
        (r) => r.id === "berth_44_aft"
      );
      if (berth44Aft) {
        const link = document.querySelector(
          '.room-marker[data-room-id="berth_44_aft"]'
        );
        if (link) {
          link.setAttribute("data-room-name", berth44Aft.name);
          link.setAttribute("data-user-count", "0");
          link.setAttribute("title", `${berth44Aft.name} - Users: 0`);

          link.addEventListener("click", (e) => {
            e.preventDefault();
            console.log(`🔍 Berth 44 Ground room area clicked: berth_44_aft`);
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
        (r) => r.id === "covered_walkway"
      );
      if (coveredWalkway) {
        const link = document.querySelector(
          '.room-marker[data-room-id="covered_walkway"]'
        );
        if (link) {
          link.setAttribute("data-room-name", coveredWalkway.name);
          link.setAttribute("data-user-count", "0");
          link.setAttribute("title", `${coveredWalkway.name} - Users: 0`);

          link.addEventListener("click", (e) => {
            e.preventDefault();
            console.log(
              `🔍 Berth 44 2nd Floor room area clicked: covered_walkway`
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
        (r) => r.id === "boarding_tower"
      );
      if (boardingTower) {
        const link = document.querySelector(
          '.room-marker[data-room-id="boarding_tower"]'
        );
        if (link) {
          link.setAttribute("data-room-name", boardingTower.name);
          link.setAttribute("data-user-count", "0");
          link.setAttribute("title", `${boardingTower.name} - Users: 0`);

          link.addEventListener("click", (e) => {
            e.preventDefault();
            console.log(
              `🔍 Berth 44 2nd Floor room area clicked: boarding_tower`
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

    console.log(`🗺️ Showing Southampton category: ${category}`);

    // Request updated room counts from server for all rooms
    socket.emit("request-all-room-counts");
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
      ".southampton-category-buttons"
    );
    if (existingSouthamptonButtons) {
      existingSouthamptonButtons.remove();
    }

    // Show all Britannic deck buttons
    deckButtons.forEach((button) => {
      button.style.display = "inline-block";
    });

    // Default to boat deck
    document.querySelector('[data-deck="boat_deck"]').click();

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
    console.log("🗺️ Showing Britannic deckplans");
  }

  deckButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const deck = button.getAttribute("data-deck");
      console.log(`🖱️ Deck button clicked: ${deck}`);
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
            link.setAttribute("data-user-count", "0");

            if (link.namespaceURI === "http://www.w3.org/2000/svg") {
              let titleEl = link.querySelector("title");
              if (!titleEl) {
                titleEl = document.createElementNS(
                  "http://www.w3.org/2000/svg",
                  "title"
                );
                link.insertBefore(titleEl, link.firstChild);
              }
              titleEl.textContent = `${room.name} - Users: 0`;
            } else {
              link.title = `${room.name} - Users: 0`;
            }

            link.addEventListener("click", (e) => {
              e.preventDefault();
              console.log(`🔍 SVG room area clicked: ${roomId}`);
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
        console.log("🗺️ Added SVG overlay for A Deck with room markers");
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
            link.setAttribute("data-user-count", "0");

            if (link.namespaceURI === "http://www.w3.org/2000/svg") {
              let titleEl = link.querySelector("title");
              if (!titleEl) {
                titleEl = document.createElementNS(
                  "http://www.w3.org/2000/svg",
                  "title"
                );
                link.insertBefore(titleEl, link.firstChild);
              }
              titleEl.textContent = `${room.name} - Users: 0`;
            } else {
              link.title = `${room.name} - Users: 0`;
            }

            link.addEventListener("click", (e) => {
              e.preventDefault();
              console.log(`🔍 SVG room area clicked: ${roomId}`);
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
        console.log("🗺️ Added SVG overlay for D Deck with room markers");
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
            link.setAttribute("data-user-count", "0");

            if (link.namespaceURI === "http://www.w3.org/2000/svg") {
              let titleEl = link.querySelector("title");
              if (!titleEl) {
                titleEl = document.createElementNS(
                  "http://www.w3.org/2000/svg",
                  "title"
                );
                link.insertBefore(titleEl, link.firstChild);
              }
              titleEl.textContent = `${room.name} - Users: 0`;
            } else {
              link.title = `${room.name} - Users: 0`;
            }

            link.addEventListener("click", (e) => {
              e.preventDefault();
              console.log(`🔍 SVG room area clicked: ${roomId}`);
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
        console.log("🗺️ Added SVG overlay for Boat Deck with room markers");
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
        </svg>
        `;
        document.querySelector(".deckplan-display").appendChild(svgOverlay);

        document.querySelectorAll(".room-marker").forEach((link) => {
          const roomId = link.getAttribute("data-room-id");
          const room = deckRooms.b_deck.find((r) => r.id === roomId);
          if (room) {
            link.setAttribute("data-room-name", room.name);
            link.setAttribute("data-user-count", "0");

            // Request current room count for this room
            socket.emit("request-room-count", roomId);

            if (link.namespaceURI === "http://www.w3.org/2000/svg") {
              let titleEl = link.querySelector("title");
              if (!titleEl) {
                titleEl = document.createElementNS(
                  "http://www.w3.org/2000/svg",
                  "title"
                );
                link.insertBefore(titleEl, link.firstChild);
              }
              titleEl.textContent = `${room.name} - Users: 0`;
            } else {
              link.title = `${room.name} - Users: 0`;
            }

            link.addEventListener("click", (e) => {
              e.preventDefault();
              console.log(`🔍 SVG room area clicked: ${roomId}`);
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
        console.log("🗺️ Added SVG overlay for B Deck with room markers");
      }

      if (deckRooms[deck]) {
        console.log(`✅ Found ${deckRooms[deck].length} rooms for ${deck}`);
        deckRooms[deck].forEach((room) => {
          if (room.isSVG) {
            console.log(`ℹ️ Room ${room.name} is SVG, skipping marker`);
          } else if (room.x !== undefined && room.y !== undefined) {
            console.log(
              `📍 Creating marker for ${room.name} at ${room.x}%, ${room.y}%`
            );
            const marker = document.createElement("div");
            marker.className = `room-marker ${room.type} ${room.id}`;
            marker.style.left = `${room.x}%`;
            marker.style.top = `${room.y}%`;
            marker.setAttribute("data-room-id", room.location.chatRoom);
            marker.setAttribute("data-room-name", room.name);
            marker.setAttribute("data-user-count", "0");

            // Request current room count for this room
            socket.emit("request-room-count", room.location.chatRoom);

            marker.title = `${room.name} - Users: 0`;

            marker.addEventListener("click", () => {
              console.log(`🔍 Room marker clicked: ${room.name}`);
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
            console.log(`📍 Added room marker for: ${room.name}`);
          } else {
            console.log(
              `🚫 Skipped adding marker for ${room.name} (no coordinates)`
            );
          }
        });
      } else {
        console.log(`❌ No rooms found for deck: ${deck}`);
      }
    });
  });

  // Note: Deck plan initialization is now handled dynamically in deckplans button click
  console.log("🗺️ Initialized deck plans functionality.");

  // Tooltip hover functionality
  // No custom tooltip logic needed; use native title attribute

  function positionTooltip(e) {
    // No-op: custom tooltip removed; using native title attribute
  }

  // Update room count from server
  socket.on("room-count", ({ roomId, count }) => {
    const markers = document.querySelectorAll(
      `.room-marker[data-room-id="${roomId}"]`
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

  // Listen for color changes
  chatColorPicker.addEventListener("input", (e) => {
    const selectedColor = e.target.value;
    console.log(`🎨 Chat color changed to: ${selectedColor}`);
    // Emit the color change to the server
    socket.emit("change-chat-color", selectedColor);
    // Update local CSS variable for immediate feedback
    document.documentElement.style.setProperty(
      "--user-chat-color",
      selectedColor
    );
  });

  // Listen for initial color assignment from the server
  socket.on("assign-chat-color", (color) => {
    console.log(`🎨 Assigned chat color from server: ${color}`);
    document.documentElement.style.setProperty("--user-chat-color", color);
    chatColorPicker.value = color;
  });

  // Listen for other users' color changes
  socket.on("update-chat-color", ({ userId, color }) => {
    console.log(`🎨 User ${userId} changed chat color to: ${color}`);
    // Assuming you have a way to associate userId with their messages
    // This implementation may vary based on your existing codebase
    const userMessages = document.querySelectorAll(
      `.chat-message[data-user-id="${userId}"]`
    );
    userMessages.forEach((msg) => {
      msg.style.color = color;
      console.log(`🔄 Updated color for message from user ${userId}.`);
    });
  });

  // Listen for color changes from color picker
  chatColorPicker.addEventListener("input", (e) => {
    const selectedColor = e.target.value;
    console.log(`🎨 Chat color changed to: ${selectedColor}`);
    socket.emit("change-chat-color", selectedColor);
  });

  // Listen for color updates from server
  socket.on("update-chat-color", ({ userId, color }) => {
    console.log(`🎨 User ${userId} changed chat color to: ${color}`);
    // Update all messages from this user
    const userMessages = document.querySelectorAll(
      `.chat-message[data-user-id="${userId}"]`
    );
    userMessages.forEach((msg) => {
      msg.style.color = color;
    });
  });

  socket.on("game-user-count", (count) => {
    console.log("🎮 Received game-user-count:", count);
    document.getElementById("people").textContent = `People Onboard: ${count}`;
  });

  // Add this inside your DOMContentLoaded event listener
  const rulesBtn = document.getElementById("rules-btn");
  const rulesPopup = document.getElementById("rules-popup");
  const closeRulesBtn = document.querySelector(".close-rules");

  rulesBtn.addEventListener("click", () => {
    rulesPopup.style.display = "block";
    console.log("📋 Rules popup opened");
  });

  closeRulesBtn.addEventListener("click", () => {
    rulesPopup.style.display = "none";
    console.log("📋 Rules popup closed");
  });

  // Close rules popup when clicking outside
  window.addEventListener("click", (event) => {
    if (event.target === rulesPopup) {
      rulesPopup.style.display = "none";
      console.log("📋 Rules popup closed by clicking outside");
    }
  });

  // Updated refresh button logic to cycle through room images
  const refreshBtn = document.getElementById("refresh-location-btn");

  if (refreshBtn) {
    refreshBtn.addEventListener("click", () => {
      // Log the action for debugging
      console.log(
        `🔄 Refresh button clicked, currentRoom.name: ${currentRoom.name}`
      );

      // Check if there's a current room and images available
      if (!currentRoom.name || !roomImages[currentRoom.name]) {
        console.log("⚠️ Cannot refresh: No images available for this room");
        return;
      }

      const roomData = roomImages[currentRoom.name];
      const imgElement = document.querySelector(".location-image");

      // Ensure the image element exists
      if (!imgElement) {
        console.error("❌ Image element not found");
        return;
      }

      // Provide visual feedback on the button (optional, does not affect image)
      refreshBtn.classList.add("button-active");
      setTimeout(() => refreshBtn.classList.remove("button-active"), 300);

      // Calculate the next image index
      roomData.currentIndex =
        (roomData.currentIndex + 1) % roomData.images.length;
      const newImage = roomData.images[roomData.currentIndex];

      // Check if this is a Southampton location
      const isSouthamptonRoom =
        deckRooms.southampton &&
        deckRooms.southampton.some(
          (r) => r.location.chatRoom === currentRoom.name
        );

      const newImagePath = isSouthamptonRoom
        ? `/images/animations/locations/southampton/${newImage}`
        : `/images/animations/locations/britannic/${newImage}`;

      // Set the new image source directly (no transitions)
      imgElement.src = newImagePath;

      imgElement.onload = () => {
        imgElement.onerror = null;
        console.log(`✅ Loaded ${newImagePath}`);
      };
      imgElement.onerror = () => {
        console.error(`❌ Failed to load ${newImagePath}`);
      };

      // Log the successful update
      console.log(
        `🖼️ Updated ${currentRoom.name} image to: ${newImage} (${
          roomData.currentIndex + 1
        }/${roomData.images.length})`
      );
    });
  }

  const locationImageSystem = {
    preloadedImages: {},

    preloadRoomImages(roomName) {
      if (!roomImages[roomName]) return;

      const imageSet = roomImages[roomName].images;
      console.log(`🖼️ Preloading ${imageSet.length} images for ${roomName}`);

      if (!this.preloadedImages[roomName]) {
        this.preloadedImages[roomName] = [];
      }

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
    },

    cycleImage(roomName) {
      if (!roomImages[roomName]) return false;
      const roomData = roomImages[roomName];
      const imgElement = document.querySelector(".location-image");
      if (!imgElement) return false;

      // Calculate next index and update immediately
      roomData.currentIndex =
        (roomData.currentIndex + 1) % roomData.images.length;
      const newImage = roomData.images[roomData.currentIndex];

      console.log(
        `🔄 Cycling room image to: ${newImage} (${roomData.currentIndex + 1}/${
          roomData.images.length
        })`
      );

      // Set new image source right away
      // Check if this is a Southampton location
      const isSouthamptonImage =
        deckRooms.southampton &&
        deckRooms.southampton.some((r) => r.location.chatRoom === roomName);

      if (isSouthamptonImage) {
        imgElement.src = `/images/animations/locations/southampton/${newImage}`;
      } else {
        imgElement.src = `/images/animations/locations/britannic/${newImage}`;
      }

      // Create a system message for the change
      addChatMessage({
        type: "system",
        message: `The view has changed slightly...`,
        room: roomName,
        timestamp: Date.now(),
      });

      // Handle any image load errors
      imgElement.onerror = () => {
        console.error(`❌ Failed to load image: ${newImage}`);
        addChatMessage({
          type: "system",
          message: `There was a problem changing the view.`,
          room: roomName,
          timestamp: Date.now(),
        });
        imgElement.onerror = null;
      };

      imgElement.onload = () => {
        imgElement.onerror = null;
      };

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
  const handRanking = document.querySelector(".hand-ranking");
  const cards = document.querySelectorAll(".card");

  // Poker game state
  const videoPoker = {
    deck: [],
    hand: [],
    held: [false, false, false, false, false],
    isDraw: false,

    // Suit symbols
    suits: {
      hearts: "♥",
      diamonds: "♦",
      clubs: "♣",
      spades: "♠",
    },

    // Card ranks
    ranks: ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"],

    // Initialize the game
    init() {
      this.createDeck();
      this.shuffle();
      dealDrawBtn.textContent = "Deal";
      this.isDraw = false;
      this.held = [false, false, false, false, false];
      handRanking.textContent = "";

      // Hide all hold indicators and reset card display
      document.querySelectorAll(".hold").forEach((hold) => {
        hold.style.display = "none";
      });
      document.querySelectorAll(".card .rank, .card .suit").forEach((el) => {
        el.textContent = "";
      });
      document.querySelectorAll(".card").forEach((card) => {
        card.style.background = "white";
        card.classList.remove("held");
      });
    },

    // Create a fresh deck of cards
    createDeck() {
      this.deck = [];
      for (const suit of Object.keys(this.suits)) {
        for (const rank of this.ranks) {
          this.deck.push({
            rank: rank,
            suit: suit,
            symbol: this.suits[suit],
            color: suit === "hearts" || suit === "diamonds" ? "red" : "black",
          });
        }
      }
    },

    // Shuffle the deck
    shuffle() {
      for (let i = this.deck.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [this.deck[i], this.deck[j]] = [this.deck[j], this.deck[i]];
      }
    },

    // Deal 5 cards from the deck
    deal() {
      if (!this.isDraw) {
        this.hand = [];
        for (let i = 0; i < 5; i++) {
          this.hand[i] = this.deck.pop();
        }
      } else {
        for (let i = 0; i < 5; i++) {
          if (!this.held[i]) {
            this.hand[i] = this.deck.pop();
          }
        }
      }
    },

    // Evaluate the hand and return the rank
    evaluateHand() {
      const sortedHand = [...this.hand].sort((a, b) => {
        return this.ranks.indexOf(a.rank) - this.ranks.indexOf(b.rank);
      });

      const isFlush = this.hand.every(
        (card) => card.suit === this.hand[0].suit
      );

      let isStraight = false;
      if (sortedHand.length === 5) {
        const rankIndices = sortedHand.map((card) =>
          this.ranks.indexOf(card.rank)
        );
        isStraight = rankIndices.every((val, i, arr) => {
          return i === 0 || val === arr[i - 1] + 1;
        });

        // Special case: A-2-3-4-5 straight
        if (
          !isStraight &&
          rankIndices[4] === 12 &&
          rankIndices[0] === 0 &&
          rankIndices[1] === 1 &&
          rankIndices[2] === 2 &&
          rankIndices[3] === 3
        ) {
          isStraight = true;
        }
      }

      const rankCounts = {};
      for (const card of this.hand) {
        rankCounts[card.rank] = (rankCounts[card.rank] || 0) + 1;
      }

      const counts = Object.values(rankCounts);

      // Winning hands
      if (isFlush && isStraight && sortedHand[0].rank === "10") {
        return "Royal Flush";
      }
      if (isFlush && isStraight) {
        return "Straight Flush";
      }
      if (counts.includes(4)) {
        return "Four of a Kind";
      }
      if (counts.includes(3) && counts.includes(2)) {
        return "Full House";
      }
      if (isFlush) {
        return "Flush";
      }
      if (isStraight) {
        return "Straight";
      }
      if (counts.includes(3)) {
        return "Three of a Kind";
      }
      if (counts.filter((count) => count === 2).length === 2) {
        return "Two Pair";
      }
      if (
        Object.keys(rankCounts).find(
          (rank) =>
            rankCounts[rank] === 2 && ["J", "Q", "K", "A"].includes(rank)
        )
      ) {
        return "Jacks or Better";
      }
      if (counts.includes(2)) {
        return "Pair";
      }
      return "High Card";
    },

    // Update the visual display of the cards
    updateCardDisplay() {
      for (let i = 0; i < 5; i++) {
        const card = document.querySelector(`.card[data-index="${i}"]`);
        const rank = card.querySelector(".rank");
        const suit = card.querySelector(".suit");

        if (this.hand[i]) {
          rank.textContent = this.hand[i].rank;
          suit.textContent = this.hand[i].symbol;
          rank.style.color = this.hand[i].color;
          suit.style.color = this.hand[i].color;
          if (!this.isDraw || !this.held[i]) {
            card.classList.add("dealing");
            setTimeout(() => card.classList.remove("dealing"), 500);
          }
          card.classList.toggle("held", this.held[i]);
        } else {
          rank.textContent = "";
          suit.textContent = "";
          card.classList.remove("held");
        }
      }
    },

    // Toggle hold status for a card
    toggleHold(index) {
      if (!this.isDraw) return; // Can only hold during draw phase
      this.held[index] = !this.held[index];
      const holdDisplay = document.querySelector(
        `.card[data-index="${index}"] .hold`
      );
      holdDisplay.style.display = this.held[index] ? "block" : "none";
    },
  };

  // Initialize video poker button event
  if (videoPokerBtn) {
    videoPokerBtn.addEventListener("click", () => {
      videoPokerPopup.style.display = "block";
      videoPoker.init();
    });
  }

  // Close poker popup when close button is clicked
  if (closeVideoPokerBtn) {
    closeVideoPokerBtn.addEventListener("click", () => {
      videoPokerPopup.style.display = "none";
    });
  }

  // Deal/Draw button click event
  dealDrawBtn.addEventListener("click", () => {
    if (!videoPoker.isDraw) {
      // First click: Deal
      videoPoker.createDeck();
      videoPoker.shuffle();
      videoPoker.deal();
      videoPoker.updateCardDisplay();
      dealDrawBtn.textContent = "Draw";
      videoPoker.isDraw = true;
    } else {
      // Second click: Draw
      videoPoker.deal();
      videoPoker.updateCardDisplay();
      dealDrawBtn.textContent = "Deal";
      videoPoker.isDraw = false;

      // Hide hold indicators and reset held status
      document.querySelectorAll(".hold").forEach((hold) => {
        hold.style.display = "none";
      });
      videoPoker.held = [false, false, false, false, false];

      // Show hand ranking with win feedback
      const rank = videoPoker.evaluateHand();
      handRanking.textContent = rank;
      const winningHands = [
        "Royal Flush",
        "Straight Flush",
        "Four of a Kind",
        "Full House",
        "Flush",
        "Straight",
        "Three of a Kind",
        "Two Pair",
        "Jacks or Better",
      ];
      handRanking.classList.toggle("win", winningHands.includes(rank));
    }
  });

  // Card click event for selecting holds
  cards.forEach((card) => {
    card.addEventListener("click", () => {
      const index = parseInt(card.getAttribute("data-index"));
      videoPoker.toggleHold(index);
    });
  });

  // Update the enterRoom function to show the video poker button in the right rooms
  const originalEnterRoom = enterRoom;
  enterRoom = function (room) {
    originalEnterRoom(room);

    // Show video poker button only in specific rooms
    const videoPokerBtn = document.getElementById("video-poker-btn");
    if (videoPokerBtn) {
      if (
        room.id === "first_class_lounge_a" ||
        room.id === "first_class_smoking_room_a"
      ) {
        videoPokerBtn.style.display = "block";
      } else {
        videoPokerBtn.style.display = "none";
      }
    }
  };

  const gamesToggleBtn = document.getElementById("games-toggle-btn");
  const gamesSidePanel = document.getElementById("games-side-panel");
  const closeGamesPanel = document.querySelector(".close-games-panel");

  if (gamesToggleBtn && gamesSidePanel && closeGamesPanel) {
    // Toggle side panel on button click
    gamesToggleBtn.addEventListener("click", () => {
      gamesSidePanel.classList.toggle("open");
      console.log("🎮 Games panel toggled");
    });

    // Close side panel with close button
    closeGamesPanel.addEventListener("click", () => {
      gamesSidePanel.classList.remove("open");
      console.log("🎮 Games panel closed");
    });

    // Close side panel when clicking outside
    window.addEventListener("click", (event) => {
      if (
        !gamesSidePanel.contains(event.target) &&
        event.target !== gamesToggleBtn &&
        event.target !== roomPlayersBtn &&
        !(roomPlayersPopup && roomPlayersPopup.contains(event.target))
      ) {
        gamesSidePanel.classList.remove("open");
        console.log("🎮 Games panel closed by clicking outside");
      }
    });

    // Video Poker icon functionality
    const videoPokerIcon = document.getElementById("video-poker-icon");
    if (videoPokerIcon) {
      videoPokerIcon.addEventListener("click", () => {
        document.getElementById("video-poker-popup").style.display = "block";
        videoPoker.init();
        gamesSidePanel.classList.remove("open"); // Close panel after selection
        console.log("🎰 Video Poker launched from side panel");
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
    // Create a sophisticated dining menu popup that matches the reference image
    const popup = document.createElement("div");
    popup.className = "eat-drink-popup";

    popup.innerHTML = `
      <!-- Left Sidebar with Categories -->
      <div class="eat-drink-sidebar">
        <div class="category-btn active" data-category="food">
          ▶ FOOD
        </div>

        <div class="category-btn" data-category="beverages">
          ■ BEVERAGES
        </div>

        <div class="subcategory-container">
          <div class="subcategory-btn active" data-subcategory="appetizers">
            Appetizers
          </div>
          <div class="subcategory-btn" data-subcategory="mains">
            Main Courses
          </div>
          <div class="subcategory-btn" data-subcategory="desserts">
            Desserts
          </div>
        </div>
      </div>

      <!-- Right Content Area with Grid -->
      <div class="eat-drink-content">
        <div id="items-grid" class="items-grid">
          <!-- Food Items Grid -->
          <div class="food-grid" data-category="food" data-subcategory="appetizers">
            <div class="menu-item" data-type="food" data-hunger="15" title="Oysters Rockefeller">🦪</div>
            <div class="menu-item" data-type="food" data-hunger="12" title="Caviar & Crackers">�</div>
            <div class="menu-item" data-type="food" data-hunger="18" title="Shrimp Cocktail">🍤</div>
            <div class="menu-item" data-type="food" data-hunger="16" title="Pâté de Foie Gras">�</div>
            <div class="menu-item" data-type="food" data-hunger="14" title="Consommé">🍲</div>
            <div class="menu-item" data-type="food" data-hunger="20" title="Smoked Salmon">🐟</div>
          </div>

          <div class="food-grid" data-category="food" data-subcategory="mains">
            <div class="menu-item" data-type="food" data-hunger="35" title="Roast Beef Wellington">🥩</div>
            <div class="menu-item" data-type="food" data-hunger="40" title="Poached Salmon">🐟</div>
            <div class="menu-item" data-type="food" data-hunger="38" title="Roasted Duck">🦆</div>
            <div class="menu-item" data-type="food" data-hunger="32" title="Lamb Chops">🍖</div>
            <div class="menu-item" data-type="food" data-hunger="36" title="Filet Mignon">🥩</div>
            <div class="menu-item" data-type="food" data-hunger="34" title="Chicken à la King">🍗</div>
            <div class="menu-item" data-type="food" data-hunger="42" title="Lobster Thermidor">🦞</div>
            <div class="menu-item" data-type="food" data-hunger="30" title="Veal Cutlet">🥩</div>
          </div>

          <div class="food-grid" data-category="food" data-subcategory="desserts">
            <div class="menu-item" data-type="food" data-hunger="20" title="Charlotte Russe">🍰</div>
            <div class="menu-item" data-type="food" data-hunger="18" title="Peaches in Chartreuse Jelly">🧁</div>
            <div class="menu-item" data-type="food" data-hunger="22" title="Ice Cream">🍨</div>
            <div class="menu-item" data-type="food" data-hunger="16" title="Crème Brûlée">🍮</div>
            <div class="menu-item" data-type="food" data-hunger="24" title="Chocolate Soufflé">🍫</div>
            <div class="menu-item" data-type="food" data-hunger="19" title="Fruit Tart">🥧</div>
          </div>

          <!-- Beverages Grid (hidden by default) -->
          <div class="beverages-grid" data-category="beverages">
            <div class="menu-item" data-type="drink" data-thirst="25" title="Coffee">☕</div>
            <div class="menu-item" data-type="drink" data-thirst="20" title="Earl Grey Tea">🫖</div>
            <div class="menu-item" data-type="drink" data-thirst="30" title="Bordeaux Wine">🍷</div>
            <div class="menu-item" data-type="drink" data-thirst="15" title="Mineral Water">🥤</div>
            <div class="menu-item" data-type="drink" data-thirst="35" title="Fine Whiskey">🥃</div>
            <div class="menu-item" data-type="drink" data-thirst="28" title="Champagne">🍾</div>
            <div class="menu-item" data-type="drink" data-thirst="22" title="Hot Chocolate">☕</div>
            <div class="menu-item" data-type="drink" data-thirst="18" title="Lemonade">🍋</div>
            <div class="menu-item" data-type="drink" data-thirst="32" title="Port Wine">🍷</div>
            <div class="menu-item" data-type="drink" data-thirst="26" title="Sherry">�</div>
          </div>
        </div>
      </div>
    `;

    // Remove any existing popup
    const existingPopup = document.querySelector(".eat-drink-popup");
    if (existingPopup) {
      existingPopup.remove();
    }

    // Add popup to location display
    const locationDisplay = document.querySelector(".location-display");
    locationDisplay.appendChild(popup);

    // Initialize default state - show appetizers
    const defaultFoodGrid = popup.querySelector(
      '.food-grid[data-subcategory="appetizers"]'
    );
    if (defaultFoodGrid) {
      defaultFoodGrid.classList.add("active");
    }

    // Handle category switching
    const categoryBtns = popup.querySelectorAll(".category-btn");
    const subcategoryBtns = popup.querySelectorAll(".subcategory-btn");
    const foodGrids = popup.querySelectorAll(".food-grid");
    const beveragesGrid = popup.querySelector(".beverages-grid");

    categoryBtns.forEach((btn) => {
      btn.addEventListener("click", () => {
        // Remove active state from all category buttons
        categoryBtns.forEach((b) => b.classList.remove("active"));
        // Set active state
        btn.classList.add("active");

        const category = btn.getAttribute("data-category");

        if (category === "food") {
          // Show food grids and subcategories
          foodGrids.forEach((grid) => grid.classList.remove("active"));
          beveragesGrid.classList.remove("active");
          subcategoryBtns.forEach((sub) => (sub.style.display = "block"));

          // Show first subcategory by default
          const activeSubcat = popup.querySelector(".subcategory-btn.active");
          if (activeSubcat) {
            const subcategory = activeSubcat.getAttribute("data-subcategory");
            const targetGrid = popup.querySelector(
              `[data-subcategory="${subcategory}"]`
            );
            if (targetGrid) targetGrid.classList.add("active");
          }
        } else if (category === "beverages") {
          // Show beverages grid and hide subcategories
          foodGrids.forEach((grid) => grid.classList.remove("active"));
          beveragesGrid.classList.add("active");
          subcategoryBtns.forEach((sub) => (sub.style.display = "none"));
        }
      });
    });

    // Handle subcategory switching
    subcategoryBtns.forEach((btn) => {
      btn.addEventListener("click", () => {
        // Remove active state from all subcategory buttons
        subcategoryBtns.forEach((b) => b.classList.remove("active"));
        // Set active state
        btn.classList.add("active");

        const subcategory = btn.getAttribute("data-subcategory");

        // Hide all food grids
        foodGrids.forEach((grid) => grid.classList.remove("active"));

        // Show selected subcategory grid
        const targetGrid = popup.querySelector(
          `[data-subcategory="${subcategory}"]`
        );
        if (targetGrid) {
          targetGrid.classList.add("active");
        }
      });
    });

    // Add event listeners for menu items
    const menuItems = popup.querySelectorAll(".menu-item");
    menuItems.forEach((item) => {
      item.addEventListener("mouseenter", () => {
        item.style.transform = "scale(1.1) translateY(-2px)";
        item.style.boxShadow =
          "0 4px 8px rgba(0,0,0,0.3), inset 0 1px 3px rgba(255,255,255,0.4)";
        item.style.borderColor = "#B8860B";
      });

      item.addEventListener("mouseleave", () => {
        item.style.transform = "scale(1) translateY(0)";
        item.style.boxShadow =
          "0 2px 4px rgba(0,0,0,0.2), inset 0 1px 2px rgba(255,255,255,0.3)";
        item.style.borderColor = "#8B7355";
      });

      item.addEventListener("click", () => {
        const type = item.getAttribute("data-type");
        const hungerValue = parseInt(item.getAttribute("data-hunger")) || 0;
        const thirstValue = parseInt(item.getAttribute("data-thirst")) || 0;
        const itemName = item.getAttribute("title");

        if (type === "food") {
          eatSpecific(itemName, hungerValue);
        } else if (type === "drink") {
          drinkSpecific(itemName, thirstValue);
        }

        popup.remove();
      });
    });

    // No close button event needed

    // Auto-close popup after 30 seconds
    setTimeout(() => {
      if (popup.parentNode) {
        popup.remove();
        // Reset Eat & Drink button label if menu auto-closes
        const eatDrinkBtn = document.getElementById("eat-drink-btn");
        if (eatDrinkBtn) eatDrinkBtn.textContent = "Eat & Drink";
      }
    }, 30000);
  }

  // Function to handle eating specific food items
  function eatSpecific(itemName, hungerIncrease) {
    statusBars.hunger.value = Math.min(
      100,
      statusBars.hunger.value + hungerIncrease
    );

    console.log(`🍽️ Ate ${itemName}, hunger increased by ${hungerIncrease}`);

    // Add chat message with specific item
    addChatMessage({
      type: "system",
      message: `You savor the exquisite ${itemName} in the elegant dining saloon. The fine cuisine satisfies your hunger beautifully.`,
      room: currentRoom.name,
      timestamp: Date.now(),
    });

    // Update the hunger bar immediately
    const hungerBar = document.querySelector(".bar.hunger");
    if (hungerBar) {
      hungerBar.style.width = `${statusBars.hunger.value}%`;
      const hue = (statusBars.hunger.value / 100) * 120;
      hungerBar.style.setProperty("--hunger-hue", hue);
    }
  }

  // Function to handle drinking specific beverages
  function drinkSpecific(itemName, thirstDecrease) {
    statusBars.thirst.value = Math.min(
      100,
      statusBars.thirst.value + thirstDecrease
    );

    console.log(`🥤 Drank ${itemName}, thirst decreased by ${thirstDecrease}`);

    // Add chat message with specific beverage
    addChatMessage({
      type: "system",
      message: `You enjoy a refined ${itemName} served in the finest crystal. The elegant beverage perfectly quenches your thirst.`,
      room: currentRoom.name,
      timestamp: Date.now(),
    });

    // Update the thirst bar immediately
    const thirstBar = document.querySelector(".bar.thirst");
    if (thirstBar) {
      thirstBar.style.width = `${statusBars.thirst.value}%`;
      const hue = (statusBars.thirst.value / 100) * 120;
      thirstBar.style.setProperty("--thirst-hue", hue);
    }
  }

  // Function to handle eating
  function eat() {
    const hungerIncrease = 30 + Math.random() * 20; // Restore 30-50 hunger
    statusBars.hunger.value = Math.min(
      100,
      statusBars.hunger.value + hungerIncrease
    );

    console.log(
      `🍽️ Ate food, hunger increased by ${hungerIncrease.toFixed(1)}`
    );

    // Add chat message
    addChatMessage({
      type: "system",
      message:
        "You enjoy a delicious meal in the elegant dining room. Your hunger is satisfied.",
      room: currentRoom.name,
      timestamp: Date.now(),
    });

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
      statusBars.thirst.value + thirstDecrease
    );

    console.log(
      `🥤 Drank beverage, thirst decreased by ${thirstDecrease.toFixed(1)}`
    );

    // Add chat message
    addChatMessage({
      type: "system",
      message:
        "You sip a refreshing beverage, quenching your thirst perfectly.",
      room: currentRoom.name,
      timestamp: Date.now(),
    });

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
  const locationDisplay = document.querySelector(".location-display");

  if (
    locationDisplay &&
    roomPlayersPopup &&
    roomPlayersPopup.parentElement !== locationDisplay
  ) {
    locationDisplay.appendChild(roomPlayersPopup);
  }
  const closeRoomPlayersBtn = document.querySelector(".close-room-players");

  // Function to request room players from server
  function requestRoomPlayers() {
    if (!socket || !currentRoom.name) {
      console.error(
        "❌ Cannot request room players: socket or room not available"
      );
      return;
    }

    console.log(`👥 Requesting players for room: ${currentRoom.name}`);
    socket.emit("request-room-players", currentRoom.name);
  }

  // Function to display room players in popup
  function displayRoomPlayers(players) {
    const playersList = document.getElementById("players-list");
    if (!playersList) {
      console.error("❌ Room players list element not found");
      return;
    }

    // Clear existing content
    playersList.innerHTML = "";

    if (!players || players.length === 0) {
      playersList.innerHTML =
        "<div class='no-players'>No other players in this room</div>";
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

      playerDiv.innerHTML = `
        <div class="player-avatar">
          <img src="${player.avatar || "/images/default-avatar.png"}" alt="${
        player.name
      }" />
        </div>
        <div class="player-info">
          <div class="player-name">${player.name}${
        isCurrentPlayer ? " (You)" : ""
      }</div>
          <div class="player-class">Passenger</div>
          <div class="player-cabin">${player.cabin || "No cabin assigned"}</div>
        </div>
      `;

      // Add click handler for player interaction (future feature)
      if (!isCurrentPlayer) {
        playerDiv.style.cursor = "pointer";
        playerDiv.addEventListener("click", () => {
          // Future: Open player profile or interaction menu
          console.log(`👤 Clicked on player: ${player.name}`);
        });
      }

      playersList.appendChild(playerDiv);
    });

    console.log(`👥 Displayed ${players.length} players in room`);
  }

  // Event listeners for room players button
  if (roomPlayersBtn) {
    roomPlayersBtn.addEventListener(
      "click",
      (event) => {
        event.stopPropagation(); // Prevent event bubbling to games panel handler
        event.preventDefault(); // Prevent any default behavior
        requestRoomPlayers();
        roomPlayersPopup.classList.add("open");
        console.log("👥 Room players popup opened");
      },
      true
    ); // Use capture phase to run before games panel handler
  }

  // Close room players popup
  if (closeRoomPlayersBtn) {
    closeRoomPlayersBtn.addEventListener("click", () => {
      roomPlayersPopup.classList.remove("open");
      console.log("👥 Room players popup closed");
    });
  }

  // Close player info popup
  const closePlayerInfoBtn = document.querySelector(".close-player-info");
  if (closePlayerInfoBtn) {
    closePlayerInfoBtn.addEventListener("click", () => {
      const playerInfoPopup = document.getElementById("player-info");
      if (playerInfoPopup) {
        playerInfoPopup.style.display = "none";
        console.log("👤 Player info popup closed");
      }
    });
  }

  // Close room players popup when clicking outside
  window.addEventListener("click", (event) => {
    if (
      roomPlayersPopup &&
      roomPlayersPopup.classList.contains("open") &&
      !roomPlayersPopup.contains(event.target) &&
      event.target !== roomPlayersBtn
    ) {
      roomPlayersPopup.classList.remove("open");
      console.log("👥 Room players popup closed by clicking outside");
    }
  });

  // Socket listener for room players response
  if (socket) {
    socket.on("room-players", (data) => {
      console.log("👥 Received room players data:", data);
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
      console.log("🚧 Departure sequence disabled for testing");
      return;
    }
    if (departureStarted) return;
    departureStarted = true;

    console.log("🚢 Starting departure sequence...");

    // Only teleport if player is in Southampton
    let shouldTeleport = false;
    if (typeof isPlayerInSouthampton === "function") {
      shouldTeleport = isPlayerInSouthampton();
    } else if (window.currentRoom && deckRooms && deckRooms.southampton) {
      // currentRoom.name stores chatRoom; compare to Southampton rooms' chatRoom
      shouldTeleport = deckRooms.southampton.some(
        (r) => r.location && r.location.chatRoom === currentRoom.name
      );
    }
    console.log("🧭 Teleport check:", { shouldTeleport, currentRoom });
    if (shouldTeleport) {
      // Prefer using enterRoom with a real room object
      const target =
        (deckRooms.boat || deckRooms.bd || deckRooms["boat_deck"])?.find?.(
          (r) => r.id === "port_promenade_bd"
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
    console.log("📯 Playing ship whistle...");

    // Start "Leaving Port" music midway through whistle (assuming whistle is ~3 seconds)
    setTimeout(() => {
      const primarySrc = "/sounds/music (not in game)/Leaving Port.mp3";
      const fallbackSrc =
        "/sounds/music/[TITANIC] - Leaving Port (Complete Score _ Film Version) - RadioKidCharlemagne (youtube).mp3";

      const leavingPortMusic = new Audio(primarySrc);
      leavingPortMusic.volume = 0.5;
      const tryFallback = () => {
        console.warn("⚠️ Primary Leaving Port track failed, trying fallback.");
        leavingPortMusic.src = fallbackSrc;
        leavingPortMusic.play().then(() => {
          console.log("🎵 Playing Leaving Port music (fallback)...");
        });
      };
      leavingPortMusic.addEventListener("error", tryFallback, { once: true });
      leavingPortMusic
        .play()
        .then(() => console.log("🎵 Playing Leaving Port music..."))
        .catch((e) => {
          console.warn("⚠️ Error playing primary Leaving Port:", e);
          tryFallback();
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
    const landMiddle = document.querySelector(".land-middle");
    const landEnd = document.querySelector(".land-end");
    const yacht1 = document.querySelector(".yacht-1-container");
    const yacht2 = document.querySelector(".yacht-2-container");
    const yacht3 = document.querySelector(".yacht-3-container");

    if (!southamptonCity || !dock) {
      console.warn("⚠️ Southampton elements not found for departure");
      return;
    }

    // Make waves visible
    if (waves) {
      waves.classList.add("departing");
    }

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

    // TESTING: Normal gameplay - start from beginning
    const SKIP_AHEAD_TIME = 0; // Start from departure

    let targetSpeed = 6; // Target 6 knots for Southampton Water
    let currentSpeed = 0; // Start from standstill and accelerate
    let departurePosition = 0; // Start from beginning
    let wavesPosition = 0; // Waves start from beginning
    let waterPosition = 0; // Water start from beginning
    let swaterPosition = 0; // SWater start from beginning
    let landMiddlePosition = 0; // Land_middle starts from beginning
    let landEndPosition = 0;
    let isleOfWightPosition = 0;
    const startTime = Date.now() - SKIP_AHEAD_TIME; // Offset start time to simulate elapsed time
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
          (yacht) => yacht && !activeYachts.find((a) => a.element === yacht)
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
          console.log("⛵ A yacht appears in the distance...");
        }
      }
    };

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
    setTimeout(() => {
      scheduleNextYacht();
    }, Math.max(0, SOUTHAMPTON_WATER_END - SKIP_AHEAD_TIME));

    const interval = setInterval(() => {
      if (!departureStarted) {
        clearInterval(interval);
        yachtTimers.forEach((timer) => clearTimeout(timer));
        return;
      }
      const now = Date.now();
      const delta = (now - lastTimestamp) / 1000; // seconds
      const elapsedTime = now - startTime; // milliseconds since departure
      lastTimestamp = now;

      // Determine target speed based on journey phase
      if (elapsedTime < SOUTHAMPTON_WATER_END) {
        targetSpeed = 6; // Southampton Water - 6 knots
      } else if (elapsedTime < CHANNEL_COMPLETE) {
        targetSpeed = 12; // Solent and early Channel - 12 knots
        // Transition to 19 knots after passing Needles
        if (elapsedTime > NEEDLES_COMPLETE) {
          targetSpeed = 19; // Open Channel cruising speed
        }
      } else if (elapsedTime < APPROACH_COMPLETE) {
        targetSpeed = 12; // Approach to Cherbourg - 12 knots
      } else if (elapsedTime < BERTHING_COMPLETE) {
        targetSpeed = 6; // Harbor entry - 6 knots
      } else {
        targetSpeed = 0; // Berthed - full stop
      }

      // Smoothly adjust speed toward target
      if (currentSpeed < targetSpeed) {
        currentSpeed = Math.min(
          currentSpeed + acceleration * delta,
          targetSpeed
        );
      } else if (currentSpeed > targetSpeed) {
        currentSpeed = Math.max(
          currentSpeed - acceleration * delta,
          targetSpeed
        );
      }

      window.currentSpeed = currentSpeed;
      departurePosition += currentSpeed * delta;
      wavesPosition += currentSpeed * delta;
      waterPosition += currentSpeed * delta;
      swaterPosition += currentSpeed * delta;

      // Always update land_middle position (it will keep scrolling)
      landMiddlePosition += currentSpeed * delta; // Update speed display in info bar
      const speedElement = document.getElementById("speed");
      if (speedElement) {
        speedElement.textContent = `Speed: ${currentSpeed.toFixed(1)} knots`;
      }

      // Update location display in info bar based on elapsed time
      const locationElement = document.getElementById("location");
      if (locationElement) {
        let currentLocation = "Southampton Water";

        if (elapsedTime < SOUTHAMPTON_WATER_END) {
          currentLocation = "Southampton Water";
        } else if (elapsedTime < NEEDLES_PASS) {
          currentLocation = "The Solent";
        } else if (elapsedTime < NEEDLES_COMPLETE) {
          currentLocation = "Isle of Wight";
        } else if (elapsedTime < CHANNEL_COMPLETE) {
          currentLocation = "English Channel";
        } else if (elapsedTime < APPROACH_COMPLETE) {
          currentLocation = "Approaching Cherbourg";
        } else {
          currentLocation = "Cherbourg Harbor";
        }

        locationElement.textContent = `Location: ${currentLocation}`;
      }

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
            1
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
          console.log("🏝️ Passing Isle of Wight (The Needles)...");
          isleOfWightPassing = true;
        }

        // Calculate how far through the 8-minute passage we are
        const passageElapsed = elapsedTime - NEEDLES_PASS;
        const passageDuration = NEEDLES_COMPLETE - NEEDLES_PASS; // 8 minutes = 480,000ms
        const passageProgress = passageElapsed / passageDuration;

        // Move Isle of Wight from right to left over 8 minutes
        // Start from right edge (off-screen) and move to left edge (off-screen)
        const viewportWidth = window.innerWidth;
        // Start at viewportWidth (off-screen right) and end at -viewportWidth (off-screen left)
        // This makes it cross the entire screen from right to left
        isleOfWightPosition =
          viewportWidth - viewportWidth * 2 * passageProgress;

        if (isleOfWight) {
          isleOfWight.style.transform = `translateX(${isleOfWightPosition}px)`;
          isleOfWight.style.opacity = "1";
        }
      } else if (elapsedTime >= NEEDLES_COMPLETE && !isleOfWightCompleted) {
        console.log("✅ Isle of Wight passage complete");
        isleOfWightCompleted = true;
        if (isleOfWight) {
          isleOfWight.style.opacity = "0"; // Fade out after passing
        }
      }

      // Yacht scrolling logic - move yachts at ship speed from right to left
      for (let i = activeYachts.length - 1; i >= 0; i--) {
        const yacht = activeYachts[i];

        // Move yacht at ship's speed (like everything else)
        yacht.position -= currentSpeed * delta;

        if (yacht.position < -window.innerWidth) {
          // Yacht has crossed the screen, remove it
          yacht.element.classList.remove("visible");
          yacht.element.style.opacity = "0";
          activeYachts.splice(i, 1);
          console.log("⛵ Yacht has passed out of view");
        } else {
          // Update yacht position
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

      const elapsedSeconds = Math.floor((Date.now() - voyageStartTime) / 1000);
      
      // If we're past departure time but haven't started yet
      if (elapsedSeconds >= 420) {
        clearInterval(checkDepartureTime);
        
        // Check if departure already happened (player joined late or refreshed)
        if (elapsedSeconds > 425) { // 5 second grace period after departure
          console.log(`🚢 Departure already occurred (${Math.floor(elapsedSeconds / 60)} min elapsed) - skipping sequence`);
          departureStarted = true; // Mark as started to prevent re-triggering
          // Start animation at current state without playing sounds/music/teleport
          animateDeparture();
        } else {
          // Normal departure - play full sequence
          console.log("🚢 Starting departure at server-synced 7 minute mark");
          startDepartureSequence();
        }
      }
    }, 1000); // Check every second
  } else {
    console.log("🚧 Departure sequence scheduling skipped (disabled)");
  }
});
