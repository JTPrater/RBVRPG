// Imports
require("dotenv").config();
const express = require("express");
const http = require("http");
const socketIo = require("socket.io");
const multer = require("multer");
const path = require("path");
const fs = require("fs").promises;
// Synchronous fs used for initial startup parsing of client assets
const fsSync = require("fs");
const bodyParser = require("body-parser");
const bcrypt = require("bcrypt");
const crypto = require("crypto");
const session = require("express-session");
const mongoose = require("mongoose");
const rateLimit = require("express-rate-limit");
const cors = require("cors");
const cloudinary = require("cloudinary").v2;
const { CloudinaryStorage } = require("multer-storage-cloudinary");

// Initialize Express and Server
const app = express();
const server = http.createServer(app);

// Timeline constants (milliseconds from departure)
const TIMELINE_MS = {
  DEPARTURE_DELAY: 7 * 60 * 1000, // 7 minutes between prep and actual departure
  SOUTHAMPTON_WATER_END: 20 * 60 * 1000, // 20 minutes - 6 knots
  NEEDLES_PASS: 4_650_000, // 1h 17.5m - Isle of Wight passage start
  NEEDLES_COMPLETE: 5_130_000, // ~8 minutes after Needles start
  CHANNEL_COMPLETE: 5 * 60 * 60 * 1000, // 5 hours - English Channel complete
  APPROACH_COMPLETE: 18_900_000, // 15 minutes of Cherbourg approach (12 knots)
  BERTHING_COMPLETE: 19_500_000, // 10 minutes harbor entry to stop
};

const CHERBOURG_DECEL_RATE =
  19 / ((TIMELINE_MS.BERTHING_COMPLETE - TIMELINE_MS.CHANNEL_COMPLETE) / 1000); // knots per second needed to reach 0 by berthing

// Socket.IO configuration for production
const io = socketIo(server, {
  cors: {
    origin: process.env.ALLOWED_ORIGINS
      ? process.env.ALLOWED_ORIGINS.split(",")
      : ["http://localhost:3000", "http://127.0.0.1:3000"],
    methods: ["GET", "POST"],
    credentials: true,
  },
  // Add production optimizations
  pingTimeout: 60000,
  pingInterval: 25000,
  transports: ["websocket", "polling"],
});

// Share session middleware with Socket.IO
io.use((socket, next) => {
  sessionMiddleware(socket.request, socket.request.res || {}, next);
});

// Global voyage start time (set when server starts)
// Begin from Southampton (real-time progression)
const voyageStartTime = Date.now(); // Start at Southampton (12:00 PM)
console.debug("⏰ Voyage start time initialized at Southampton (BST 12:00).");

// Narrative events for server-side synchronization (times are seconds)
const narrativeEvents = [
  { time: 0, text: "Final preparations are being made for departure..." },
  {
    time: 420,
    text: "The ship's horn echoes across Southampton Water. The moorings are cast off, and Britannic slowly pulls away from the dock.",
  },
  {
    time: 630,
    text: "We depart Southampton Water and enter the Solent, increasing to cruising speed.",
  },
  {
    time: 2430,
    text: "The Solent stretches ahead as we make our way toward the open sea.",
  },
  {
    time: 4080,
    text: "The Isle of Wight coastline becomes visible on the starboard side.",
  },
  {
    time: 4680,
    text: "We are now passing the Nab Tower, a few miles East of us.",
  },
  {
    time: 5160,
    text: "The Isle of Wight fades astern as we enter the English Channel proper.",
  },
  {
    time: 6030,
    text: "The engines settle into their steady rhythm for the channel crossing.",
  },
  {
    time: 10830,
    text: "The English coast has disappeared from view. Only open water surrounds us now.",
  },
  {
    time: 14430,
    text: "We are now deep in the English Channel, making steady progress toward France.",
  },
  {
    time: 18030,
    text: "The French coast appears on the horizon as we approach Cherbourg.",
  },
];

let serverNarrativeIndex = 0;

// Initialize serverNarrativeIndex based on current elapsed time
{
  const elapsedSeconds = Math.floor((Date.now() - voyageStartTime) / 1000);
  let idx = 0;
  for (let i = 0; i < narrativeEvents.length; i++) {
    if (elapsedSeconds >= narrativeEvents[i].time) idx = i + 1;
    else break;
  }
  serverNarrativeIndex = idx;
  if (serverNarrativeIndex > 0) {
    console.debug(
      `🔁 Server narrative synced to index ${serverNarrativeIndex}`
    );
  }
}

// Periodically check for narrative events (every 5 seconds) and broadcast them
setInterval(() => {
  const elapsedSeconds = Math.floor((Date.now() - voyageStartTime) / 1000);
  if (serverNarrativeIndex < narrativeEvents.length) {
    const next = narrativeEvents[serverNarrativeIndex];
    if (elapsedSeconds >= next.time) {
      // Broadcast narrative event to all clients
      io.emit("narrative-event", {
        index: serverNarrativeIndex,
        text: next.text,
        time: next.time,
      });
      console.debug(`📢 Broadcast narrative event: ${next.text}`);
      serverNarrativeIndex += 1;
    }
  }
}, 5000);

// Broadcast voyage state on an interval so late joiners get synchronized reliably
setInterval(() => {
  try {
    const voyageState = getCurrentVoyageState();
    io.emit("voyage-state", voyageState);
    // Also periodically refresh start time so clients that reconnect quickly can resync
    io.emit("voyage-start-time", voyageStartTime);
    // Throttle logging to avoid noise in production; verbose logs are disabled by default
  } catch (err) {
    console.error("❌ Failed to broadcast periodic voyage-state:", err.message);
  }
}, 3000); // every 3s keeps clients in sync without too much traffic

// Environment variable validation
function validateEnvironment() {
  const required = [
    "MONGO_URL",
    "DISCORD_WEBHOOK_URL",
    "SESSION_SECRET",
    "CLOUDINARY_CLOUD_NAME",
    "CLOUDINARY_API_KEY",
    "CLOUDINARY_API_SECRET",
  ];
  const missing = required.filter((key) => !process.env[key]);

  if (missing.length > 0) {
    console.error(
      "❌ Missing required environment variables:",
      missing.join(", ")
    );
    console.error(
      "Please check your .env file and ensure all required variables are set."
    );
    process.exit(1);
  }

  console.info("✅ Environment variables validated");
}

// Cloudinary Configuration
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

console.info("✅ Cloudinary configured");

// MongoDB Configuration
const initMongoDB = async () => {
  try {
    // Use Atlas connection string from environment variable
    const uri = process.env.MONGO_URL;

    await mongoose.connect(uri);
    console.info("✅ MongoDB connected successfully");
  } catch (err) {
    console.error("❌ MongoDB connection error:", err);
    process.exit(1);
  }
};

// Prefer the shared User model so admin flags, helpers, and migrations stay consistent
const User = require("./models/User");
// If you're testing locally and don't yet have the model file available, fall back
// to an inline schema (but production should use ./models/User.js)
if (!User) {
  const FallbackSchema = new mongoose.Schema({
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    character: {
      forename: { type: String, required: true },
      surname: { type: String, required: true },
      birthdate: { type: Date, required: true },
      cabin: { type: String, required: true },
      cabin_number: { type: String, required: true },
      bio: String,
      avatar: String,
    },
    isAdmin: { type: Boolean, default: false },
  });

  module.exports = mongoose.model("User", FallbackSchema);
}

// Multer Configuration with Cloudinary
const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: "rbvrpg-avatars",
    allowed_formats: ["jpg", "jpeg", "png", "gif", "webp"],
    transformation: [{ width: 200, height: 200, crop: "fill" }], // Resize to 200x200
    public_id: (req, file) =>
      `avatar-${Date.now()}-${Math.random().toString(36).substring(2, 15)}`,
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter: (req, file, cb) => {
    const allowedTypes = ["image/jpeg", "image/png", "image/gif", "image/webp"];
    if (!allowedTypes.includes(file.mimetype)) {
      cb(new Error("Invalid file type"), false);
      return;
    }
    cb(null, true);
  },
});

// Middleware Setup
// Trust proxy - required for Render and other reverse proxies
app.set("trust proxy", 1);

// Disable caching for ALL files to ensure users get latest updates
app.use((req, res, next) => {
  res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  next();
});

// CORS configuration
app.use(
  cors({
    origin: process.env.ALLOWED_ORIGINS
      ? process.env.ALLOWED_ORIGINS.split(",")
      : ["http://localhost:3000", "http://127.0.0.1:3000"],
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

app.use(express.static(path.join(__dirname, "public")));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Create session middleware with store
const sessionMiddleware = session({
  secret: process.env.SESSION_SECRET || "change-this-in-production",
  resave: false,
  saveUninitialized: true,
  cookie: { secure: false }, // Set to true if using HTTPS
});

app.use(sessionMiddleware);

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000, // limit each IP to 1000 requests per windowMs (increased for production load)
  message: "Too many requests from this IP, please try again later.",
  standardHeaders: true,
  legacyHeaders: false,
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20, // limit each IP to 20 auth attempts per windowMs
  message: "Too many authentication attempts, please try again later.",
  standardHeaders: true,
  legacyHeaders: false,
});

app.use(limiter); // Apply general rate limiting to all routes

// API Routes
app.post(
  "/api/register",
  authLimiter,
  upload.single("avatar"),
  async (req, res) => {
    try {
      console.info(
        `📝 Registration attempt from IP: ${req.ip}, Email: ${req.body.email}`
      );

      if (!req.file) {
        console.warn(
          `❌ Registration failed: No avatar file uploaded for ${req.body.email}`
        );
        return res
          .status(400)
          .json({ success: false, error: "No avatar file uploaded" });
      }

      const existingUser = await User.findOne({ email: req.body.email });
      if (existingUser) {
        console.warn(
          `❌ Registration failed: Email already registered: ${req.body.email}`
        );
        return res
          .status(400)
          .json({ success: false, error: "Email already registered" });
      }

      const cabinType = req.body.cabin;
      const cabinNumber = req.body.cabin_number;

      console.debug(`🏠 Checking cabin: ${cabinType} - ${cabinNumber}`);

      if (!cabins[cabinType] || !cabins[cabinType][cabinNumber]) {
        console.warn(
          `❌ Registration failed: Invalid cabin selected: ${cabinType} - ${cabinNumber}`
        );
        return res
          .status(400)
          .json({ success: false, error: "Invalid cabin selected" });
      }

      if (
        cabins[cabinType][cabinNumber].occupied >=
        cabins[cabinType][cabinNumber].capacity
      ) {
        console.warn(
          `❌ Registration failed: Cabin fully booked: ${cabinType} - ${cabinNumber}`
        );
        return res
          .status(400)
          .json({ success: false, error: "Selected cabin is fully booked" });
      }

      const hashedPassword = await bcrypt.hash(req.body.password, 10);
      const newUser = new User({
        email: req.body.email,
        password: hashedPassword,
        character: {
          avatar: req.file.path, // Cloudinary URL
          forename: req.body.forename,
          surname: req.body.surname,
          birthdate: req.body.birthdate,
          cabin: cabinType,
          cabin_number: cabinNumber,
          bio: req.body.bio,
        },
      });

      await newUser.save();
      cabins[cabinType][cabinNumber].occupied += 1; // Update occupancy
      io.emit("new-passenger", newUser.character);
      console.info(
        `✅ New user registered: ${req.body.email}, Cabin: ${cabinNumber}`
      );
      res.json({ success: true, passenger: newUser.character });
    } catch (error) {
      console.error("❌ Registration error:", error);
      res.status(500).json({ success: false, error: error.message });
    }
  }
);

app.post("/api/check-credentials", authLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });

    if (!user || !(await bcrypt.compare(password, user.password))) {
      console.warn(`❌ Login failed for email: ${email}`);
      return res.json({ success: false });
    }

    req.session.userId = user._id;
    console.info(`✅ User logged in: ${email}`);
    res.json({
      success: true,
      character: user.character, // Return the full character object
    });
  } catch (error) {
    console.error("❌ Login error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Admin-only: reset a user's password to a server-generated temporary password.
// This endpoint does NOT reveal existing plaintext passwords (they are hashed),
// but it does allow an admin to reset a user's password and log the temporary
// password to the server console for administrative purposes (only recommended
// if you understand the security risk of server logs).
app.post("/api/admin/reset-password", authLimiter, async (req, res) => {
  try {
    // Ensure requester is authenticated
    const requesterId = req.session.userId;
    if (!requesterId) return res.status(403).json({ error: "Not authorized" });

    const requester = await User.findById(requesterId);
    if (!requester || !requester.isAdmin) {
      return res.status(403).json({ error: "Admin privileges required" });
    }

    const { email } = req.body;
    if (!email) return res.status(400).json({ error: "Email is required" });

    const user = await User.findOne({ email });
    if (!user) return res.status(404).json({ error: "User not found" });

    // Generate a secure temporary password
    const tempPass = crypto
      .randomBytes(10)
      .toString("base64")
      .replace(/[^a-zA-Z0-9]/g, "")
      .slice(0, 12);

    // Hash and save the temporary password
    const hashed = await bcrypt.hash(tempPass, 10);
    user.password = hashed;
    await user.save();

    // Log to server console for the admin to copy and communicate securely.
    // NOTE: This is sensitive — logs can be read by others. Prefer emailing a
    // reset link or sending the temporary password via an admin-only channel.
    // Log that a temp password was generated, but do not print the plaintext password to logs
    console.info(
      `🔐 [ADMIN] Temporary password generated for ${email} (not logged)`
    );

    // (Optional) Here you could send an email with nodemailer — omitted for brevity.

    res.json({
      success: true,
      message: "Temporary password generated and saved",
    });
  } catch (error) {
    console.error("❌ Admin reset-password error:", error);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

app.get("/api/get-songs", async (req, res) => {
  try {
    const musicDir = path.join(__dirname, "public/sounds/music");
    await fs.access(musicDir);

    const files = await fs.readdir(musicDir);
    const songs = files
      .filter((file) => file.toLowerCase().endsWith(".mp3"))
      .map((file) => `/sounds/music/${file}`);

    if (songs.length === 0) {
      console.warn("❌ No MP3 files found in music directory");
      return res.status(404).json({ error: "No MP3 files found" });
    }

    console.info(`✅ Retrieved ${songs.length} songs from music directory`);
    res.json(songs);
  } catch (err) {
    console.error("❌ Error reading music directory:", err);
    res.status(500).json({
      error: "Failed to load music files",
      details: err.message,
    });
  }
});

// Report endpoint with Discord webhook
app.post("/api/report", async (req, res) => {
  try {
    const { type, description, reportedUser, reporterName, room } = req.body;

    if (!description || !type) {
      return res
        .status(400)
        .json({ success: false, error: "Missing required fields" });
    }

    // Prepare Discord webhook payload
    const webhookPayload = {
      embeds: [
        {
          title: "🚨 New Player Report",
          color: 0xff0000, // Red color
          fields: [
            {
              name: "Report Type",
              value: type,
              inline: true,
            },
            {
              name: "Reporter",
              value: reporterName || "Anonymous",
              inline: true,
            },
            {
              name: "Location",
              value: room || "Unknown Room",
              inline: true,
            },
            {
              name: "Time",
              value: new Date().toLocaleString(),
              inline: false,
            },
            {
              name: "Description",
              value: description.substring(0, 1024), // Discord embed limit
              inline: false,
            },
          ],
          timestamp: new Date().toISOString(),
        },
      ],
    };

    // Add reported user if provided
    if (reportedUser) {
      webhookPayload.embeds[0].fields.splice(3, 0, {
        name: "Reported User",
        value: reportedUser,
        inline: false,
      });
    }

    // Send to Discord webhook
    const webhookResponse = await fetch(process.env.DISCORD_WEBHOOK_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(webhookPayload),
    });

    if (!webhookResponse.ok) {
      console.error("❌ Discord webhook failed:", webhookResponse.status);
      return res
        .status(500)
        .json({ success: false, error: "Failed to send report" });
    }

    console.info(
      `✅ Report sent to Discord: ${type} by ${
        reporterName || "Anonymous"
      } from ${room || "Unknown Room"}`
    );
    res.json({ success: true, message: "Report submitted successfully" });
  } catch (error) {
    console.error("❌ Report error:", error);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// Page Routes
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public/main/registration.html"));
});

app.get("/game", (req, res) => {
  console.debug(
    `🎮 Game access attempt - Session userId: ${req.session.userId}`
  );

  // Check if user is logged in
  if (!req.session.userId) {
    console.warn(
      `🚫 Game access denied: No session userId, redirecting to login`
    );
    return res.redirect("/");
  }
  console.info(
    `✅ Game access granted: User ${req.session.userId} accessing game`
  );
  res.sendFile(path.join(__dirname, "public/game/game.html"));
});

app.get("/list", (req, res) => {
  res.sendFile(path.join(__dirname, "public/main/list.html"));
});

// At the top of server.js, maintain a user-color mapping
const userChatColors = {};

// Initialize user counts
let userCount = 0;
let gameClientCount = 0;

// Store user character data
const users = {};

const allowedRooms = [
  "grand_staircase_bd",
  "gymnasium_bd",
  "port_promenade_bd",
  "starboard_promenade_bd",
  "port_officers_promenade_bd",
  "childrens_playroom_bd",
  "starboard_officers_promenade_bd",
  "port_bridge_wing_bd",
  "starboard_bridge_wing_bd",
  "bridge_bd",
  "wheelhouse_bd",
  "starboard_engineers_promenade_bd",
  "port_engineers_promenade_bd",
  "starboard_2nd_class_promenade_bd",
  "port_2nd_class_promenade_bd",
  "2nd_class_staircase_bd",
  "forecastle_b",
  "first_class_lounge_a",
  "corridor_a",
  "corridor",
  "first_class_starboard_enclosed_promenade_a",
  "first_class_port_enclosed_promenade_a",
  "first_class_port_promenade_a",
  "first_class_starboard_promenade_a",
  "first_a_corridor",
  "reading_writing_room_a",
  "grand_staircase_a",
  "aft_corridor_a",
  "aft_grand_staircase_a",
  "first_class_smoking_room_a",
  "verandah_palm_court_a",
  "cabin_a1",
  "cabin_a2",
  "cabin_a3",
  "cabin_a4",
  "cabin_a5",
  "cabin_a6",
  "cabin_a7",
  "cabin_a8",
  "cabin_a9",
  "cabin_a10",
  "cabin_a11",
  "cabin_a12",
  "cabin_a14",
  "cabin_a15",
  "cabin_a16",
  "cabin_a17",
  "cabin_a18",
  "cabin_a19",
  "cabin_a20",
  "cabin_a21",
  "cabin_a22",
  "cabin_a23",
  "cabin_a30",
  "cabin_a32",
  "cabin_a34",
  "cabin_a36",
  "first_class_forward_overlooking_promenade_a",
  "second_class_staircase_a",
  "first_class_reception_d",
  "first_class_dining_room_d",
  // Southampton locations
  "berth_44_walkaway",
  "dockside_cafe",
  "berth_44_forward",
  "first_class_gangway",
  "crew_gangway",
  "third_class_gangway",
  "berth_44_aft",
  "covered_walkway",
  "boarding_tower",
];

// Auto-add any room ids found in the game client that are not already allowed.
// This avoids accidentally leaving new rooms unlisted and simplifies maintenance.
try {
  const gameJsPath = path.join(__dirname, "public", "game", "game.js");
  const gameJsContents = fsSync.readFileSync(gameJsPath, "utf8");
  const idRegex = /id:\s*"([a-z0-9_\-]+)"/gi;
  let match;
  const parsedIds = new Set();
  while ((match = idRegex.exec(gameJsContents)) !== null) {
    parsedIds.add(match[1]);
  }

  const newlyAdded = [];
  parsedIds.forEach((rid) => {
    if (!allowedRooms.includes(rid)) {
      allowedRooms.push(rid);
      newlyAdded.push(rid);
    }
  });
  if (newlyAdded.length) {
    console.info(
      `✅ Auto-added ${
        newlyAdded.length
      } room(s) to allowedRooms: ${newlyAdded.join(", ")}`
    );
  }
} catch (err) {
  console.error(
    "❌ Failed to auto-extend allowedRooms from game.js:",
    err.message
  );
}

// At the top of server.js, add a room message history storage
const roomMessageHistory = {};
const MAX_MESSAGES_PER_ROOM = 50;

// Helper function to add message to room history
function addMessageToRoomHistory(room, message) {
  if (!roomMessageHistory[room]) {
    roomMessageHistory[room] = [];
  }

  roomMessageHistory[room].push(message);

  // Keep only the most recent messages
  if (roomMessageHistory[room].length > MAX_MESSAGES_PER_ROOM) {
    roomMessageHistory[room] = roomMessageHistory[room].slice(
      -MAX_MESSAGES_PER_ROOM
    );
  }
}

// Add this function at the top level of server.js
function emitRoomCount(roomId) {
  const roomSize = io.sockets.adapter.rooms.get(roomId)?.size || 0;
  console.debug(`📊 Room ${roomId} has ${roomSize} user(s)`);
  // Emit to all connected clients, not just room members
  io.emit("room-count", {
    roomId: roomId,
    count: roomSize,
  });
}

// Function to get current voyage state
function getCurrentVoyageState() {
  const elapsedSeconds = Math.floor((Date.now() - voyageStartTime) / 1000);

  let location = "Southampton";
  let speed = "0 knots";
  let speedValue = 0; // Actual current speed
  let targetSpeed = 0; // Target speed for smooth acceleration

  const {
    DEPARTURE_DELAY,
    SOUTHAMPTON_WATER_END,
    NEEDLES_COMPLETE,
    CHANNEL_COMPLETE,
    APPROACH_COMPLETE,
    BERTHING_COMPLETE,
  } = TIMELINE_MS;

  // Acceleration rate: 0.012 knots per second squared (matches client)
  const ACCELERATION = 0.012;

  // Departure happens DEPARTURE_DELAY milliseconds into the voyage
  const elapsedSinceDeparture = Math.max(
    0,
    elapsedSeconds - DEPARTURE_DELAY / 1000
  );

  if (elapsedSeconds < DEPARTURE_DELAY / 1000) {
    // Before departure
    location = "Southampton";
    speed = "0 knots";
    speedValue = 0;
    targetSpeed = 0;
  } else if (elapsedSinceDeparture * 1000 < SOUTHAMPTON_WATER_END) {
    // Southampton Water - accelerating to 6 knots
    location = "Southampton Water";
    targetSpeed = 6;

    // Calculate current speed based on acceleration from 0 to 6 knots
    // Time to reach 6 knots: 6 / 0.012 = 500 seconds
    const timeToReach6Knots = 6 / ACCELERATION;
    if (elapsedSinceDeparture < timeToReach6Knots) {
      speedValue = Math.min(6, elapsedSinceDeparture * ACCELERATION);
    } else {
      speedValue = 6;
    }
    speed = `${speedValue.toFixed(1)} knots`;
  } else if (elapsedSinceDeparture * 1000 < NEEDLES_COMPLETE) {
    // The Solent - accelerating from 6 to 12 knots
    location = "The Solent";
    targetSpeed = 12;

    // Calculate time elapsed since entering The Solent
    const elapsedInSolent =
      elapsedSinceDeparture - SOUTHAMPTON_WATER_END / 1000;

    // Time to accelerate from 6 to 12 knots: (12 - 6) / 0.012 = 500 seconds
    const timeToReach12Knots = (12 - 6) / ACCELERATION;

    if (elapsedInSolent < timeToReach12Knots) {
      // Still accelerating from 6 to 12
      speedValue = Math.min(12, 6 + elapsedInSolent * ACCELERATION);
    } else {
      // Reached 12 knots
      speedValue = 12;
    }
    speed = `${speedValue.toFixed(1)} knots`;
  } else if (elapsedSinceDeparture * 1000 < CHANNEL_COMPLETE) {
    // English Channel - accelerating from 12 to 19 knots, then cruising
    location = "English Channel";
    targetSpeed = 19;

    // Calculate time elapsed since entering English Channel
    const elapsedInChannel = elapsedSinceDeparture - NEEDLES_COMPLETE / 1000;

    // Time to accelerate from 12 to 19 knots: (19 - 12) / 0.012 = 583.33 seconds
    const timeToReach19Knots = (19 - 12) / ACCELERATION;

    if (elapsedInChannel < timeToReach19Knots) {
      // Still accelerating from 12 to 19
      speedValue = Math.min(19, 12 + elapsedInChannel * ACCELERATION);
    } else {
      // Reached 19 knots, cruising
      speedValue = 19;
    }
    speed = `${speedValue.toFixed(1)} knots`;
  } else if (elapsedSinceDeparture * 1000 < BERTHING_COMPLETE) {
    // Continuous Cherbourg deceleration from 19 knots down to 0 by berthing
    const elapsedSinceChannelEntry = Math.max(
      0,
      elapsedSinceDeparture - CHANNEL_COMPLETE / 1000
    );
    const drop = elapsedSinceChannelEntry * CHERBOURG_DECEL_RATE;
    speedValue = Math.max(0, 19 - drop);
    targetSpeed = Math.max(0, speedValue - CHERBOURG_DECEL_RATE);

    if (speedValue > 6) {
      location = "Approaching Cherbourg";
    } else if (speedValue > 0) {
      location = "Cherbourg Harbor";
    } else {
      location = "Cherbourg";
    }

    speed = `${speedValue.toFixed(1)} knots`;
  } else {
    // Berthed - full stop
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
  };
}

// Add cabin data
const cabins = {
  "1st_class_cabins": {
    A1: { capacity: 2, occupied: 0 },
    A2: { capacity: 2, occupied: 0 },
    A3: { capacity: 3, occupied: 0 },
    A4: { capacity: 3, occupied: 0 },
    A5: { capacity: 1, occupied: 0 },
    A6: { capacity: 1, occupied: 0 },
    A7: { capacity: 1, occupied: 0 },
    A8: { capacity: 1, occupied: 0 },
    A9: { capacity: 1, occupied: 0 },
    A10: { capacity: 1, occupied: 0 },
    A11: { capacity: 1, occupied: 0 },
    A12: { capacity: 1, occupied: 0 },
    A14: { capacity: 1, occupied: 0 },
    A15: { capacity: 1, occupied: 0 },
    A16: { capacity: 1, occupied: 0 },
    A17: { capacity: 1, occupied: 0 },
    A18: { capacity: 1, occupied: 0 },
    A19: { capacity: 1, occupied: 0 },
    A20: { capacity: 1, occupied: 0 },
    A21: { capacity: 1, occupied: 0 },
    A22: { capacity: 1, occupied: 0 },
    A23: { capacity: 1, occupied: 0 },
    A30: { capacity: 2, occupied: 0 },
    A32: { capacity: 2, occupied: 0 },
    A34: { capacity: 2, occupied: 0 },
    A36: { capacity: 1, occupied: 0 },
    // B-Deck first class cabins (added by assistant)
    B49: { capacity: 2, occupied: 0 },
    B51: { capacity: 2, occupied: 0 },
    B53: { capacity: 1, occupied: 0 },
    B55: { capacity: 2, occupied: 0 },
    B57: { capacity: 1, occupied: 0 },
    B59: { capacity: 2, occupied: 0 },
    B61: { capacity: 2, occupied: 0 },
    B63: { capacity: 1, occupied: 0 },
    B65: { capacity: 2, occupied: 0 },
    B67: { capacity: 2, occupied: 0 },
    B69: { capacity: 2, occupied: 0 },
    B71: { capacity: 1, occupied: 0 },
    B73: { capacity: 2, occupied: 0 },
    B75: { capacity: 2, occupied: 0 },
    B77: { capacity: 1, occupied: 0 },
    B79: { capacity: 2, occupied: 0 },
    B81: { capacity: 2, occupied: 0 },
    B83: { capacity: 1, occupied: 0 },
  },
  "2nd_class_cabins": {},
  "3rd_class_cabins": {},
  crew_berths: {},
};

// Synchronize cabin occupancy from the database at startup
async function syncCabinOccupancyFromDB() {
  try {
    // Reset current occupancy counts to zero
    for (const type of Object.keys(cabins)) {
      Object.keys(cabins[type]).forEach((num) => {
        cabins[type][num].occupied = 0;
      });
    }

    // Count existing registered users per cabin
    const users = await User.find(
      {},
      "character.cabin character.cabin_number"
    ).lean();
    for (const u of users) {
      const cabinType = u?.character?.cabin;
      const cabinNumber = u?.character?.cabin_number;
      if (
        cabinType &&
        cabinNumber &&
        cabins[cabinType] &&
        cabins[cabinType][cabinNumber]
      ) {
        cabins[cabinType][cabinNumber].occupied += 1;
      }
    }

    console.info("✅ Synchronized cabin occupancy from DB");
  } catch (err) {
    console.error("❌ Failed to sync cabin occupancy from DB:", err.message);
  }
}

app.get("/api/get_available_cabins", (req, res) => {
  const cabinType = req.query.cabin_type;
  console.debug(`📋 Cabin request received for type: ${cabinType}`);

  if (!cabinType) {
    console.error("❌ No cabin type provided in request");
    return res.status(400).json({ error: "Cabin type is required" });
  }

  if (!cabins[cabinType]) {
    console.error(`❌ Invalid cabin type requested: ${cabinType}`);
    console.debug(`Available cabin types: ${Object.keys(cabins).join(", ")}`);
    return res.status(400).json({
      error: "Invalid cabin type",
      availableTypes: Object.keys(cabins),
    });
  }

  const cabinEntries = Object.entries(cabins[cabinType]);
  console.debug(`📊 Found ${cabinEntries.length} cabins in ${cabinType}`);

  // Return detailed cabin availability so the client can show capacities
  const availableCabins = cabinEntries
    .filter(([_, cabin]) => cabin.occupied < cabin.capacity)
    .map(([cabinNumber, cabin]) => ({
      number: cabinNumber,
      capacity: cabin.capacity,
      occupied: cabin.occupied,
      available: cabin.capacity - cabin.occupied,
    }));

  console.info(
    `✅ Returning ${
      availableCabins.length
    } available cabins: ${availableCabins.join(", ")}`
  );
  res.json(availableCabins);
});

// Stats API endpoints
app.get("/api/get-stats", async (req, res) => {
  try {
    const userEmail = req.query.email;
    if (!userEmail) {
      return res.status(400).json({ error: "Email is required" });
    }

    const user = await User.findOne({ email: userEmail });
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    // Calculate time-based stat decay since last update
    const now = Date.now();
    const timeDiff = (now - user.stats.lastUpdated) / 1000; // seconds
    const decayIntervals = Math.floor(timeDiff);

    let updatedStats = { ...user.stats };

    // Apply decay for each interval
    for (let i = 0; i < decayIntervals; i++) {
      // Hunger decreases by 0.005 per second (more realistic timing)
      updatedStats.hunger = Math.max(0, updatedStats.hunger - 0.005);
      // Thirst decreases by 0.007 per second
      updatedStats.thirst = Math.max(0, updatedStats.thirst - 0.007);
      // Energy decreases by 0.003 per second
      updatedStats.energy = Math.max(0, updatedStats.energy - 0.003);
      // Hygiene decreases by 0.002 per second
      updatedStats.hygiene = Math.max(0, updatedStats.hygiene - 0.002);
      // Bladder decreases by 0.006 per second
      updatedStats.bladder = Math.max(0, updatedStats.bladder - 0.006);
      // Intoxication decreases by 0.01 per second (if above 0)
      if (updatedStats.intoxication > 0) {
        updatedStats.intoxication = Math.max(
          0,
          updatedStats.intoxication - 0.01
        );
      }
    }

    // Update lastUpdated timestamp
    updatedStats.lastUpdated = now;

    // Save updated stats to database
    user.stats = updatedStats;
    await user.save();

    console.debug(`📊 Loaded and updated stats for ${userEmail}`);
    res.json(updatedStats);
  } catch (error) {
    console.error("❌ Error loading stats:", error);
    res.status(500).json({ error: "Failed to load stats" });
  }
});

app.post("/api/save-stats", async (req, res) => {
  try {
    const { email, stats } = req.body;
    if (!email || !stats) {
      return res.status(400).json({ error: "Email and stats are required" });
    }

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    // Update stats with current timestamp
    user.stats = {
      ...stats,
      lastUpdated: Date.now(),
    };

    await user.save();
    console.debug(`💾 Saved stats for ${email}`);
    res.json({ success: true });
  } catch (error) {
    console.error("❌ Error saving stats:", error);
    res.status(500).json({ error: "Failed to save stats" });
  }
});

// Socket.IO Setup
io.on("connection", async (socket) => {
  console.debug(`🔌 New connection: ${socket.id}`);
  userCount++;
  io.emit("global-user-count", userCount); // Global site-wide count
  console.info(`👥 User count increased: ${userCount}`);

  socket.isGameClient = false;

  // Send voyage start time to client for synchronization
  socket.emit("voyage-start-time", voyageStartTime);
  console.debug(
    `⏰ Sent voyage start time to ${socket.id}: ${voyageStartTime}`
  );

  // Send current voyage state for immediate sync
  const currentVoyageState = getCurrentVoyageState();
  socket.emit("voyage-state", currentVoyageState);
  console.debug(
    `🚢 Sent current voyage state to ${socket.id}:`,
    currentVoyageState
  );

  // Identify authenticated user by server session (safer than trusting client handshake)
  const sessionUserId = socket.request?.session?.userId;
  let assignedColor = "#c0932b"; // default chat color

  if (sessionUserId) {
    try {
      const dbUser = await User.findById(sessionUserId).select(
        "email chatColor"
      );
      if (dbUser) {
        socket.userEmail = dbUser.email;
        if (dbUser.chatColor) {
          assignedColor = dbUser.chatColor;
          console.debug(
            `🎨 Loaded saved chat color for ${socket.userEmail}: ${assignedColor}`
          );
        }
      } else {
        console.debug(`🎨 Session user ${sessionUserId} not found in DB`);
      }
    } catch (err) {
      console.error(
        `❌ Error loading chat color for userId ${sessionUserId}:`,
        err.message
      );
    }
  } else {
    // No authenticated session — fall back to any email provided in handshake, but do not persist
    const handshakeEmail = socket.handshake.auth?.email;
    socket.userEmail = handshakeEmail || null;
    if (handshakeEmail) {
      try {
        const tmpUser = await User.findOne({ email: handshakeEmail }).select(
          "chatColor"
        );
        if (tmpUser && tmpUser.chatColor) {
          assignedColor = tmpUser.chatColor;
          console.debug(
            `🎨 Loaded saved chat color for ${handshakeEmail}: ${assignedColor}`
          );
        }
      } catch (err) {
        console.error(
          `❌ Error loading chat color for handshake email ${handshakeEmail}:`,
          err.message
        );
      }
    } else {
      console.debug(
        `🎨 Anonymous user connected, using default color: ${assignedColor}`
      );
    }
  }

  userChatColors[socket.id] = assignedColor;
  console.debug(`🎨 Assigned color to ${socket.id}: ${assignedColor}`);

  // Send the assigned color to the connected client
  socket.emit("assign-chat-color", assignedColor);
  socket.emit("game-user-count", gameClientCount);
  console.debug(`📩 Sent assigned chat color to ${socket.id}`);

  // Send existing passengers to ALL new connections (public feature)
  User.find({}, "character")
    .then((users) => {
      const passengers = users.map((user) => user.character);
      console.debug("🗂️ Sending initial passengers:", passengers);
      socket.emit("initial-passengers", passengers);
      // If there is a last narrative event, tell this client where server is currently
      if (
        serverNarrativeIndex > 0 &&
        narrativeEvents[serverNarrativeIndex - 1]
      ) {
        const idx = serverNarrativeIndex - 1;
        socket.emit("narrative-current", {
          index: idx,
          text: narrativeEvents[idx].text,
          time: narrativeEvents[idx].time,
        });
        console.debug(`📣 Sent current narrative index ${idx} to ${socket.id}`);
      }
    })
    .catch((err) => {
      console.error("❌ Error fetching passengers:", err);
    });

  // Initialize per-socket variables
  let currentRoom = null;
  let currentCharacter = null;

  // Handle 'join-room' event
  socket.on("join-room", async (data) => {
    const { room, character } = data;

    if (!socket.isGameClient) {
      socket.isGameClient = true;
      gameClientCount++;
      io.emit("game-user-count", gameClientCount);
      console.info(`🎮 Game client count increased: ${gameClientCount}`);
    }
    if (allowedRooms.includes(room)) {
      socket.join(room);
      socket.character = character; // Store character data on socket
      socket
        .to(room)
        .emit("user-joined", { character, socketId: socket.id, roomId: room });
      emitRoomCount(room);

      // Send recent message history for this room
      const roomHistory = roomMessageHistory[room] || [];
      if (roomHistory.length > 0) {
        socket.emit("room-message-history", { room, messages: roomHistory });
        console.debug(
          `📚 Sent ${roomHistory.length} messages from history for room: ${room}`
        );
      }

      console.info(`✅ User joined room: ${room}`);
    }
  });

  // Handle 'chat-message' event (corrected)
  socket.on("chat-message", (data = {}) => {
    const roomId = data.room;
    const text = typeof data.message === "string" ? data.message.trim() : "";

    if (!roomId || !allowedRooms.includes(roomId)) {
      console.warn(`⚠️ Message sent to invalid or missing room: ${roomId}`);
      return;
    }

    if (!text) {
      console.warn("⚠️ Ignoring empty chat message payload");
      return;
    }

    const activeCharacter = socket.character || {};
    const safeCharacter = {
      forename: activeCharacter.forename || "Passenger",
      surname: activeCharacter.surname || "",
    };

    const cabinRef =
      activeCharacter.cabin_number ||
      activeCharacter.cabin ||
      activeCharacter.cabinNumber ||
      null;

    // Strip /me prefix if present for action messages
    const processedMessage = text.startsWith("/me ") ? text.substring(4) : text;

    const outboundMessage = {
      room: roomId,
      message: processedMessage,
      timestamp: Date.now(),
      type: "user",
      userId: socket.id,
      color: userChatColors[socket.id] || data.color || "#c0932b",
      character: safeCharacter,
      cabin: cabinRef,
      isAction: text.startsWith("/me "),
    };

    addMessageToRoomHistory(roomId, outboundMessage);
    io.emit("chat-message", outboundMessage);
    console.debug(
      `📤 Broadcasted message from ${socket.id} to all clients from room: ${roomId}`
    );
  });

  // Handle 'change-chat-color' event
  socket.on("change-chat-color", async (color) => {
    try {
      // Prefer server-side session for authentication — do not accept client-supplied email
      const sessionUserId = socket.request?.session?.userId;
      if (!sessionUserId) {
        console.warn("⚠️ Unauthenticated attempt to change chat color");
        return;
      }

      const user = await User.findById(sessionUserId);
      if (!user) {
        console.warn(`⚠️ No user found for session ${sessionUserId}`);
        return;
      }

      user.chatColor = color;
      await user.save();
      console.debug(`🎨 Updated chat color for ${user.email}: ${color}`);

      // Update in-memory color for this socket
      userChatColors[socket.id] = color;

      // Broadcast color change to all clients (send both socket id and the user's id)
      io.emit("update-chat-color", {
        socketId: socket.id,
        userId: user._id,
        color,
      });
      console.debug(`📤 Broadcasted color change for ${socket.id}`);
    } catch (error) {
      console.error(`❌ Error updating chat color: ${error.message}`);
    }
  });

  // Handle 'leave-room' event
  socket.on("leave-room", (data) => {
    const { room, character } = data;
    if (allowedRooms.includes(room)) {
      socket.leave(room);
      socket
        .to(room)
        .emit("user-left", { character, socketId: socket.id, roomId: room });
      emitRoomCount(room);
    }
  });

  socket.on("request-room-users", (roomId) => {
    if (allowedRooms.includes(roomId)) {
      const roomSockets = io.sockets.adapter.rooms.get(roomId);
      if (roomSockets) {
        const userList = Array.from(roomSockets).map((socketId) => {
          const userSocket = io.sockets.sockets.get(socketId);
          return { socketId, character: userSocket.character };
        });
        socket.emit("room-users", { roomId, users: userList });
        console.debug(`📤 Sent user list for ${roomId} to ${socket.id}`);
      } else {
        socket.emit("room-users", { roomId, users: [] });
        console.debug(`📤 Sent empty user list for ${roomId} to ${socket.id}`);
      }
    }
  });

  socket.on("request-all-room-counts", () => {
    allowedRooms.forEach((roomId) => {
      emitRoomCount(roomId);
    });
    console.debug(`📊 Sent room counts for all rooms to ${socket.id}`);
  });

  socket.on("request-room-count", (roomId) => {
    if (allowedRooms.includes(roomId)) {
      emitRoomCount(roomId);
      console.debug(`📊 Sent room count for ${roomId} to ${socket.id}`);
    }
  });

  socket.on("request-room-counts", (payload) => {
    const roomIds = Array.isArray(payload)
      ? payload
      : Array.isArray(payload?.rooms)
      ? payload.rooms
      : [];

    if (!roomIds.length) {
      return;
    }

    roomIds
      .filter((roomId) => allowedRooms.includes(roomId))
      .forEach((roomId) => {
        emitRoomCount(roomId);
      });

    console.debug(
      `📊 Sent batched room counts for ${roomIds.length} room(s) to ${socket.id}`
    );
  });

  socket.on("request-room-players", (roomId) => {
    if (allowedRooms.includes(roomId)) {
      const roomSockets = io.sockets.adapter.rooms.get(roomId);
      if (roomSockets) {
        const players = Array.from(roomSockets)
          .map((socketId) => {
            const userSocket = io.sockets.sockets.get(socketId);
            return userSocket
              ? {
                  id: socketId,
                  name: `${userSocket.character.forename} ${userSocket.character.surname}`,
                  avatar: userSocket.character.avatar,
                  // Provide both cabin type and cabin number to client
                  cabin: userSocket.character.cabin,
                  cabin_number: userSocket.character.cabin_number,
                }
              : null;
          })
          .filter(Boolean);

        socket.emit("room-players", { roomId, players });
        console.debug(`👥 Sent player list for ${roomId} to ${socket.id}`);
      }
    }
  });

  socket.on("load-stats", async () => {
    try {
      if (!socket.userEmail && socket.request?.session?.userId) {
        const sessionUser = await User.findById(
          socket.request.session.userId
        ).select("email stats");
        if (sessionUser) {
          socket.userEmail = sessionUser.email;
          if (!socket.character && sessionUser.character) {
            socket.character = sessionUser.character;
          }
        }
      }

      const targetEmail = socket.userEmail;
      if (!targetEmail) {
        console.error("❌ No user email available for stats loading");
        return;
      }

      const user = await User.findOne({ email: targetEmail });
      if (!user || !user.stats) {
        console.debug(
          `📊 No stats found for user ${targetEmail}, sending defaults`
        );
        socket.emit("stats-loaded", {
          hunger: 100,
          thirst: 100,
          energy: 100,
          hygiene: 100,
          bladder: 100,
          intoxication: 0,
        });
        return;
      }

      // Calculate time-based decay since last update
      const now = Date.now();
      const timeDiffSeconds = (now - user.stats.lastUpdated) / 1000;

      // Apply decay rates
      const hungerDecay = Math.min(100, timeDiffSeconds * 0.005); // 0.005 per second
      const thirstDecay = Math.min(100, timeDiffSeconds * 0.007); // 0.007 per second
      const energyDecay = Math.min(100, timeDiffSeconds * 0.003); // 0.003 per second
      const hygieneDecay = Math.min(100, timeDiffSeconds * 0.002); // 0.002 per second
      const bladderDecay = Math.min(100, timeDiffSeconds * 0.006); // 0.006 per second
      const intoxicationDecay = Math.max(0, timeDiffSeconds * 0.01); // 0.01 per second (only decreases)

      const currentStats = {
        hunger: Math.max(0, user.stats.hunger - hungerDecay),
        thirst: Math.max(0, user.stats.thirst - thirstDecay),
        energy: Math.max(0, user.stats.energy - energyDecay),
        hygiene: Math.max(0, user.stats.hygiene - hygieneDecay),
        bladder: Math.max(0, user.stats.bladder - bladderDecay),
        intoxication: Math.max(0, user.stats.intoxication - intoxicationDecay),
      };

      console.debug(`📊 Loaded stats for ${targetEmail}:`, currentStats);
      socket.emit("stats-loaded", currentStats);
    } catch (error) {
      console.error(`❌ Error loading stats: ${error.message}`);
    }
  });

  socket.on("save-stats", async (statsData) => {
    try {
      if (!socket.userEmail && socket.request?.session?.userId) {
        const sessionUser = await User.findById(
          socket.request.session.userId
        ).select("email");
        if (sessionUser) {
          socket.userEmail = sessionUser.email;
        }
      }

      if (!socket.userEmail) {
        console.error("❌ No user email available for stats saving");
        return;
      }

      await User.findOneAndUpdate(
        { email: socket.userEmail },
        {
          stats: {
            hunger: statsData.hunger,
            thirst: statsData.thirst,
            energy: statsData.energy,
            hygiene: statsData.hygiene,
            bladder: statsData.bladder,
            intoxication: statsData.intoxication,
            lastUpdated: Date.now(),
          },
        },
        { upsert: true }
      );

      console.info(`💾 Saved stats for ${socket.userEmail}:`, statsData);
    } catch (error) {
      console.error(`❌ Error saving stats: ${error.message}`);
    }
  });

  socket.on("disconnect", () => {
    console.info(`👤 User disconnected: ${socket.id}`);
    try {
      console.debug("👤 User disconnected:", socket.id);
      userCount--; // Keep this decrement
      console.info(`👥 User count decremented: ${userCount}`);

      // Emit the updated user count to all clients
      io.emit("global-user-count", userCount); // Use this event consistently
      console.debug(
        "📣 Emitted updated user count to all clients after disconnect"
      );

      if (socket.isGameClient) {
        gameClientCount = Math.max(0, gameClientCount - 1);
        io.emit("game-user-count", gameClientCount);
        console.info(`🎮 Game client count decremented: ${gameClientCount}`);
      }

      if (currentRoom && currentCharacter) {
        // Notify others in the room that the user has left
        socket.to(currentRoom).emit("user-left", {
          character: currentCharacter,
          socketId: socket.id,
          roomId: currentRoom,
        });
        console.info(`🔒 ${socket.id} disconnected from room: ${currentRoom}`);

        // Emit the updated room count to all clients in the room
        const roomSizeAfterDisconnect =
          io.sockets.adapter.rooms.get(currentRoom)?.size || 0;
        io.to(currentRoom).emit("room-count", {
          roomId: currentRoom,
          count: roomSizeAfterDisconnect,
        });
        console.debug(
          `📊 Emitted updated room count for ${currentRoom}: ${roomSizeAfterDisconnect}`
        );
      }

      // Remove the user's character data
      if (users[socket.id]) {
        delete users[socket.id];
        console.debug(`🗑️ Removed character data for ${socket.id}`);
      }

      console.info("👤 Client disconnected");
      delete userChatColors[socket.id];
      console.debug(`🗑️ Deleted chat color for ${socket.id}`);
    } catch (error) {
      console.error(`❌ Error during disconnect: ${error.message}`);
    }
  });
});

// Initialize Server
const startServer = async () => {
  console.info("🚀 Initializing server...");
  validateEnvironment();
  console.info("🚀 Initializing MongoDB...");
  await initMongoDB();
  console.info("🔁 Syncing cabin occupancy from DB...");
  await syncCabinOccupancyFromDB();
  const PORT = process.env.PORT || 3000;
  server.listen(PORT, () => {
    console.info(`🚀 Server running on port ${PORT}`);
  });
};

// Error Handling
process.on("unhandledRejection", (err) => {
  console.error("❌ Unhandled Promise Rejection:", err);
  process.exit(1);
});

startServer();

function sendMessage() {
  const message = chatInput.value.trim();
  const userId = socket.id;
  const userColor = characterData.color || "#c0932b";

  if (message && currentRoom.name && characterData) {
    const messageData = {
      room: currentRoom.name, // Ensure this is the room's unique identifier
      message: message,
      character: characterData,
      timestamp: Date.now(),
      type: "user",
      userId: userId,
      color: userColor,
    };

    console.debug("✉️ Sending message:", messageData);
    socket.emit("chat-message", messageData);
    chatInput.value = "";

    // Append the message locally
    addChatMessage(messageData);
  } else {
    console.warn("⚠️ Cannot send message. Missing data:", {
      message,
      currentRoom,
      characterData,
    });
  }
}
