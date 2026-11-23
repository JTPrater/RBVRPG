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
const MongoStore = require("connect-mongo");
const mongoose = require("mongoose");
const rateLimit = require("express-rate-limit");
const cors = require("cors");
const fetch = require("node-fetch");
const cloudinary = require("cloudinary").v2;
const { CloudinaryStorage } = require("multer-storage-cloudinary");
const {
  TIMELINE_MS,
  getCurrentVoyageState: computeVoyageStateAt,
} = require("./lib/voyageState");
const { lookupMenuItem } = require("./lib/menuCatalog");
const { createSocketGameAuth } = require("./lib/socketGameAuth");

// Initialize Express and Server
const app = express();
const server = http.createServer(app);

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

// Global voyage start time (loaded from DB or set on first boot)
// Begin from Southampton (real-time progression)
let voyageStartTime = Date.now(); // temporary default, overwritten by DB in startServer()

// Narrative events for server-side synchronization (times are seconds)
const narrativeEvents = [
  { time: 0, text: "Final preparations are being made for departure." },
  {
    time: 720,
    text: "The ship's horn echoes across Southampton Water. The moorings are cast off, and Britannic slowly pulls away from the dock.",
  },
  {
    time: 930,
    text: "We depart Southampton Water and enter the Solent, increasing to cruising speed.",
  },
  {
    time: 2730,
    text: "The Solent stretches ahead as we make our way toward the open sea.",
  },
  {
    time: 4380,
    text: "The Isle of Wight coastline becomes visible on the starboard side.",
  },
  {
    time: 4980,
    text: "We are now passing the Nab Tower, a few miles east of us.",
  },
  {
    time: 5460,
    text: "The Isle of Wight fades astern as we enter the English Channel proper.",
  },
  {
    time: 6330,
    text: "The engines settle into their steady rhythm for the channel crossing.",
  },
  {
    time: 11130,
    text: "The English coast has disappeared from view. Only open water surrounds us now.",
  },
  {
    time: 14730,
    text: "We are now deep in the English Channel, making steady progress toward France.",
  },
  {
    time: 18330,
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
  }
}

// Periodically check for narrative events (every 5 seconds) and broadcast them
const narrativeInterval = setInterval(() => {
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
      serverNarrativeIndex += 1;
    }
  }
}, 5000);

// Broadcast voyage state on an interval so late joiners get synchronized reliably
const voyageStateInterval = setInterval(() => {
  try {
    const voyageState = getCurrentVoyageState();
    io.emit("voyage-state", voyageState);
    // Also periodically refresh start time so clients that reconnect quickly can resync
    io.emit("voyage-start-time", voyageStartTime);
    // Throttle logging to avoid noise in production; verbose logs are disabled by default
  } catch (err) {
    console.error("Failed to broadcast periodic voyage-state:", err.message);
  }
}, 3000); // every 3s keeps clients in sync without too much traffic

// Environment variable validation
function validateEnvironment() {
  const required = [
    "MONGO_URL",
    "SESSION_SECRET",
    "CLOUDINARY_CLOUD_NAME",
    "CLOUDINARY_API_KEY",
    "CLOUDINARY_API_SECRET",
  ];
  const missing = required.filter((key) => !process.env[key]);

  if (missing.length > 0) {
    console.error(
      "Missing required environment variables:",
      missing.join(", "),
    );
    console.error(
      "Please check your .env file and ensure all required variables are set.",
    );
    process.exit(1);
  }

  console.info("Environment variables validated");
}

// Cloudinary Configuration
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

console.info("Cloudinary configured");

// MongoDB Configuration
const initMongoDB = async () => {
  try {
    // Use Atlas connection string from environment variable
    const uri = process.env.MONGO_URL;

    await mongoose.connect(uri);
    console.info("MongoDB connected successfully");
  } catch (err) {
    console.error("MongoDB connection error:", err);
    process.exit(1);
  }
};

const User = require("./models/User");
const ServerState = require("./models/ServerState");
const { requireSessionUser } = createSocketGameAuth(User);

// Multer Configuration with Cloudinary
const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: "rbvrpg-avatars",
    allowed_formats: ["jpg", "jpeg", "png", "gif", "webp", "bmp", "avif"],
    transformation: [{ width: 200, height: 200, crop: "fill" }], // Resize to 200x200
    public_id: (req, file) =>
      `avatar-${Date.now()}-${Math.random().toString(36).substring(2, 15)}`,
  },
});

const upload = multer({
  storage,
  // 5MB avatar; text fields (names, bio) are small, so cap them well below multer's 1MB default
  limits: { fileSize: 5 * 1024 * 1024, fieldSize: 16 * 1024 },
  // Accept anything that is actually an image. We deliberately do NOT gate on the
  // browser-supplied Content-Type alone: browsers frequently send
  // "application/octet-stream" (or the legacy "image/x-png") for a perfectly valid
  // PNG/JPG — common on mobile and with drag-and-drop — which made good images fail
  // as "Invalid file type". Cloudinary re-checks the real bytes against
  // allowed_formats below and rejects anything that is not genuinely an image.
  fileFilter: (req, file, cb) => {
    const looksImage =
      /^image\//i.test(file.mimetype) ||
      /\.(jpe?g|png|gif|webp|bmp|avif)$/i.test(file.originalname || "");
    if (!looksImage) {
      cb(new Error("Invalid file type"), false);
      return;
    }
    cb(null, true);
  },
});

const REGISTRATION_FIELD_LIMITS = { forename: 40, surname: 40, bio: 2000 };

// Chat colours come from an <input type="color">, which always gives #rrggbb
const CHAT_COLOR_PATTERN = /^#[0-9a-f]{6}$/i;

function isChatColor(value) {
  return typeof value === "string" && CHAT_COLOR_PATTERN.test(value);
}

function getStartingMoneyForCabin(cabinType) {
  if (typeof cabinType !== "string") return 0;
  if (cabinType.startsWith("1st_")) return 1000;
  if (cabinType.startsWith("2nd_")) return 100;
  if (cabinType.startsWith("3rd_")) return 10;
  return 0;
}

function runAvatarUpload(req, res) {
  return new Promise((resolve, reject) => {
    upload.single("avatar")(req, res, (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

function getAvatarUploadErrorMessage(error) {
  if (!error) return "Avatar upload failed";
  if (error instanceof multer.MulterError) {
    if (error.code === "LIMIT_FILE_SIZE") {
      return "Avatar image must be 5MB or smaller";
    }
    if (error.code === "LIMIT_FIELD_VALUE") {
      return "One of the fields is too long";
    }
    return error.message;
  }

  // Cloudinary rejects a non-image, or a format outside allowed_formats, with a
  // 400. In the avatar flow that always means the file was not a usable image.
  if (error.http_code === 400) {
    return "That image couldn't be used. Please upload a JPG, PNG, GIF, WebP, BMP, or AVIF image.";
  }

  if (/invalid file type/i.test(error.message)) {
    return "Please upload an image file (JPG, PNG, GIF, WebP, BMP, or AVIF).";
  }

  // Anything else (a database error, say) is not the visitor's business: its
  // text names collections and indexes
  return "Registration failed. Please try again.";
}

async function postJson(urlString, payload) {
  let parsedUrl;
  try {
    parsedUrl = new URL(String(urlString || "").trim());
  } catch {
    throw new Error("Invalid DISCORD_WEBHOOK_URL");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    const response = await fetch(parsedUrl.toString(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/plain, */*",
        "User-Agent": "RBVRPG/1.0",
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    const body = await response.text();
    return {
      ok: response.ok,
      status: response.status,
      body,
    };
  } finally {
    clearTimeout(timeout);
  }
}

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
  }),
);

// Headers every answer should carry (set by hand: nothing new to install
// hours before a test)
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  next();
});

// Not for the public: the room editor's backups of the deck data, and the
// editor's own page (it is served through /admin/room-editor, which checks
// the admin flag; the static copy skipped that check)
app.use((req, res, next) => {
  if (/\.bak$/i.test(req.path) || /^\/game\/tools\//i.test(req.path)) {
    return res.sendStatus(404);
  }
  next();
});

// The scripts, stylesheets and pages go out minified (lib/minifyAssets.js);
// RBV_PLAIN_ASSETS=1 sends them as written
const { buildAssets, assetMiddleware, pageSender } = require("./lib/minifyAssets");
const minifiedAssets = new Map();
const assetsReady =
  process.env.RBV_PLAIN_ASSETS === "1"
    ? Promise.resolve()
    : buildAssets(__dirname)
        .then(({ map, failed }) => {
          map.forEach((value, key) => minifiedAssets.set(key, value));
          console.info(`Minified ${map.size} scripts, stylesheets and pages`);
          if (failed.length) console.warn("Sent as written:", failed.join(", "));
        })
        .catch((error) => console.error("Minifying failed; files sent as written:", error.message));
const sendPage = pageSender(minifiedAssets, __dirname);

// Of lib/, the browser loads only these; the rest is the server's own code
const BROWSER_LIB = new Set(["/astro.js", "/voyageState.js", "/weather.js"]);
app.use("/lib", (req, res, next) =>
  BROWSER_LIB.has(req.path) ? next() : res.sendStatus(404),
);

app.use(assetMiddleware(minifiedAssets));
// no icon of its own yet: an empty answer, not an error in every console
app.get("/favicon.ico", (req, res) => res.status(204).end());
app.use(express.static(path.join(__dirname, "public")));
app.use("/lib", express.static(path.join(__dirname, "lib")));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Create session middleware with store
const sessionMiddleware = session({
  secret: process.env.SESSION_SECRET || "change-this-in-production",
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({
    mongoUrl: process.env.MONGO_URL,
    ttl: 24 * 60 * 60, // Sessions expire after 1 day (seconds)
  }),
  cookie: {
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 24 * 60 * 60 * 1000, // 1 day in milliseconds
  },
});

app.use(sessionMiddleware);

// A signed-in session gets a new id, so an id planted on someone before they
// log in is worth nothing afterwards
function regenerateSession(req) {
  return new Promise((resolve, reject) =>
    req.session.regenerate((error) => (error ? reject(error) : resolve())),
  );
}

// Log out: the session ends on the server and its cookie is cleared
app.post("/api/logout", (req, res) => {
  if (!req.session) return res.json({ success: true });
  req.session.destroy((error) => {
    res.clearCookie("connect.sid", {
      path: "/",
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
    });
    if (error) {
      console.error("Logout error:", error.message);
      return res.status(500).json({ success: false });
    }
    res.json({ success: true });
  });
});

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

app.get("/health", (req, res) => {
  const dbConnected = mongoose.connection.readyState === 1;
  const payload = {
    ok: dbConnected,
    uptime: Math.round(process.uptime()),
    database: dbConnected ? "connected" : "disconnected",
    timestamp: new Date().toISOString(),
  };

  res.status(dbConnected ? 200 : 503).json(payload);
});

// API Routes
app.post("/api/register", authLimiter, async (req, res) => {
  try {
    await runAvatarUpload(req, res);

    console.info(
      `Registration attempt from IP: ${req.ip}, Email: ${req.body.email}`,
    );

    if (!req.file) {
      console.warn(
        `Registration failed: No avatar file uploaded for ${req.body.email}`,
      );
      return res
        .status(400)
        .json({ success: false, error: "No avatar file uploaded" });
    }

    if (
      typeof req.body.email !== "string" ||
      req.body.email.length > 320 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(req.body.email)
    ) {
      return res
        .status(400)
        .json({ success: false, error: "Please enter a valid email address" });
    }
    if (
      typeof req.body.password !== "string" ||
      req.body.password.length < 6 ||
      req.body.password.length > 72
    ) {
      return res.status(400).json({
        success: false,
        error: "Password must be 6 to 72 characters",
      });
    }

    // Names end up in every chat message (and /me expands to them), so keep them short
    const tooLong = Object.entries(REGISTRATION_FIELD_LIMITS).find(
      ([field, max]) =>
        typeof req.body[field] === "string" && req.body[field].length > max,
    );
    if (tooLong) {
      const [field, max] = tooLong;
      console.warn(`Registration failed: ${field} longer than ${max}`);
      return res.status(400).json({
        success: false,
        error: `${field[0].toUpperCase()}${field.slice(1)} must be ${max} characters or fewer`,
      });
    }

    const existingUser = await User.findOne({ email: req.body.email });
    if (existingUser) {
      console.warn(
        `Registration failed: Email already registered: ${req.body.email}`,
      );
      return res
        .status(400)
        .json({ success: false, error: "Email already registered" });
    }

    const cabinType = req.body.cabin;
    const cabinNumber = req.body.cabin_number;

    // Own keys only: "constructor" / "name" are properties of every object and
    // passed the old check
    if (
      typeof cabinType !== "string" ||
      typeof cabinNumber !== "string" ||
      !Object.prototype.hasOwnProperty.call(cabins, cabinType) ||
      !Object.prototype.hasOwnProperty.call(cabins[cabinType], cabinNumber)
    ) {
      console.warn(
        `Registration failed: Invalid cabin selected: ${cabinType} - ${cabinNumber}`,
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
        `Registration failed: Cabin fully booked: ${cabinType} - ${cabinNumber}`,
      );
      return res
        .status(400)
        .json({ success: false, error: "Selected cabin is fully booked" });
    }

    const hashedPassword = await bcrypt.hash(req.body.password, 10);

    const startingMoney = getStartingMoneyForCabin(cabinType);

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
      stats: {
        money: startingMoney,
        moneyVersion: 1,
      },
    });

    await newUser.save();
    await regenerateSession(req);
    req.session.userId = newUser._id;
    await new Promise((resolve, reject) => {
      req.session.save((sessionError) => {
        if (sessionError) {
          reject(sessionError);
          return;
        }
        resolve();
      });
    });

    cabins[cabinType][cabinNumber].occupied += 1; // Update occupancy
    io.emit("new-passenger", newUser.character);
    console.info(
      `New user registered: ${req.body.email}, Cabin: ${cabinNumber}`,
    );
    res.json({
      success: true,
      passenger: newUser.character,
      email: newUser.email,
    });
  } catch (error) {
    console.error("Registration error:", error);

    const statusCode =
      error instanceof multer.MulterError || error.http_code === 400
        ? 400
        : 500;

    res.status(statusCode).json({
      success: false,
      error: getAvatarUploadErrorMessage(error),
    });
  }
});

app.post("/api/check-credentials", authLimiter, async (req, res) => {
  try {
    const { email, password } = req.body || {};
    // Strings only. An object here ({"$regex": "^a"}) is a Mongo query
    // operator: it would match someone else's account and turn the login
    // into a password guess against every account at once.
    if (
      typeof email !== "string" ||
      typeof password !== "string" ||
      !email ||
      !password ||
      email.length > 320 ||
      password.length > 1024
    ) {
      return res.json({ success: false });
    }
    const user = await User.findOne({ email });

    if (!user || !(await bcrypt.compare(password, user.password))) {
      console.warn("Login failed");
      return res.json({ success: false });
    }

    await regenerateSession(req);
    req.session.userId = user._id;
    console.info(`User logged in: ${user._id}`);
    res.json({
      success: true,
      character: user.character, // Return the full character object
    });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({ success: false, error: "Login failed. Please try again." });
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
      `[ADMIN] Temporary password generated for ${email} (not logged)`,
    );

    // (Optional) Here you could send an email with nodemailer — omitted for brevity.

    res.json({
      success: true,
      message: "Temporary password generated and saved",
    });
  } catch (error) {
    console.error("Admin reset-password error:", error);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// Admin-only: reset the voyage to restart the clock from now
app.post("/api/admin/reset-voyage", authLimiter, async (req, res) => {
  try {
    const sessionUserId = req.session?.userId;
    if (!sessionUserId) {
      return res.status(401).json({ success: false, error: "Unauthorized" });
    }
    const admin = await User.findById(sessionUserId);
    if (!admin?.isAdmin) {
      return res.status(403).json({ success: false, error: "Forbidden" });
    }

    voyageStartTime = Date.now();
    await ServerState.findOneAndUpdate(
      { key: "voyageStartTime" },
      { value: voyageStartTime },
      { upsert: true },
    );

    // Re-sync narrative
    serverNarrativeIndex = 0;

    // Broadcast new voyage time to all connected clients
    io.emit("voyage-start-time", voyageStartTime);
    io.emit("voyage-state", getCurrentVoyageState());

    console.info(
      `Voyage reset by admin at ${new Date(voyageStartTime).toISOString()}`,
    );
    res.json({ success: true, voyageStartTime });
  } catch (error) {
    console.error("Admin reset-voyage error:", error);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// ── Deck room editor: save deckRooms.js from the admin tool ──────────────
// Regenerates public/game/data/deckRooms.js from a validated payload. Values
// are written via JSON.stringify over a whitelisted schema, so nothing the
// client sends can become executable code in the generated module.
const DECK_ROOMS_PATH = path.join(
  __dirname,
  "public/game/data/deckRooms.js",
);
const ROOM_CLASSES = ["first", "second", "third", "crew"];

function sanitizeRoom(r) {
  if (!r || typeof r !== "object") return null;
  const id = String(r.id || "").trim();
  const name = String(r.name || "").trim();
  if (!id || !name) return null;
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(id)) return null;
  const out = { id, name: name.slice(0, 120) };
  out.class = ROOM_CLASSES.includes(r.class) ? r.class : "first";
  if (r.type) out.type = String(r.type).trim().slice(0, 60);
  if (r.coordinates != null) {
    const coords = String(r.coordinates).trim();
    // only numbers, spaces, commas, dots, minus — never code
    if (coords && /^[-0-9.,\s]+$/.test(coords))
      out.coordinates = coords.replace(/\s+/g, " ").slice(0, 8000);
  }
  if (typeof r.x === "number" && isFinite(r.x)) out.x = r.x;
  if (typeof r.y === "number" && isFinite(r.y)) out.y = r.y;
  if (r.isSVG) out.isSVG = true;
  const loc = r.location && typeof r.location === "object" ? r.location : {};
  const location = {};
  if (Array.isArray(loc.images))
    location.images = loc.images
      .filter((s) => typeof s === "string")
      .map((s) => s.slice(0, 200))
      .slice(0, 40);
  else if (loc.image) location.image = String(loc.image).slice(0, 200);
  else location.image = "placeholder.jpg";
  location.chatRoom = String(loc.chatRoom || id).slice(0, 100);
  out.location = location;
  return out;
}

function buildDeckRoomsFile(deckRooms, deckViewBoxes, roomClassColors) {
  const cleanRooms = {};
  for (const [deck, rooms] of Object.entries(deckRooms)) {
    if (!/^[a-z0-9_]{1,40}$/.test(deck) || !Array.isArray(rooms)) continue;
    cleanRooms[deck] = rooms.map(sanitizeRoom).filter(Boolean);
  }
  const cleanVB = {};
  for (const [deck, vb] of Object.entries(deckViewBoxes || {}))
    if (
      /^[a-z0-9_]{1,40}$/.test(deck) &&
      typeof vb === "string" &&
      /^[-0-9.\s]+$/.test(vb)
    )
      cleanVB[deck] = vb.trim();
  const cleanColors = {};
  for (const c of ROOM_CLASSES) {
    const v = roomClassColors && roomClassColors[c];
    cleanColors[c] =
      typeof v === "string" && /^#[0-9a-fA-F]{3,8}$/.test(v) ? v : "#4195f7";
  }
  return `(function (RBV) {
  // Deck room data. Each room: id, name, class (first|second|third|crew),
  // type (semantic tag), coordinates (SVG polygon "x,y x,y ..." in the deck
  // image's pixel space = deckViewBoxes[deck]), optional x/y marker, and
  // location (image + chatRoom). Ship-deck overlays are built from this by
  // game.js. Generated by the room editor (/admin/room-editor) — hand edits
  // are fine but will be overwritten on the next editor save.
  const roomClassColors = ${JSON.stringify(cleanColors, null, 2)};

  const deckViewBoxes = ${JSON.stringify(cleanVB, null, 2)};

  const deckRooms = ${JSON.stringify(cleanRooms, null, 2)};

  RBV.data = RBV.data || {};
  RBV.data.deckRooms = deckRooms;
  RBV.data.deckViewBoxes = deckViewBoxes;
  RBV.data.roomClassColors = roomClassColors;
  window.deckRooms = deckRooms;
  window.deckViewBoxes = deckViewBoxes;
  window.roomClassColors = roomClassColors;
  console.debug("✅ Defined deckRooms:", deckRooms);
})(window.RBV);
`;
}

app.get("/admin/room-editor", async (req, res) => {
  if (!req.session?.userId) return res.redirect("/");
  try {
    const admin = await User.findById(req.session.userId);
    if (!admin?.isAdmin) return res.status(403).send("Forbidden");
  } catch (e) {
    return res.status(500).send("Server error");
  }
  res.sendFile(path.join(__dirname, "public/game/tools/room-editor.html"));
});

app.post("/api/admin/save-rooms", authLimiter, async (req, res) => {
  try {
    if (!req.session?.userId)
      return res.status(401).json({ success: false, error: "Unauthorized" });
    const admin = await User.findById(req.session.userId);
    if (!admin?.isAdmin)
      return res.status(403).json({ success: false, error: "Forbidden" });

    const { deckRooms, deckViewBoxes, roomClassColors } = req.body || {};
    if (!deckRooms || typeof deckRooms !== "object")
      return res
        .status(400)
        .json({ success: false, error: "Missing deckRooms" });

    const fileText = buildDeckRoomsFile(
      deckRooms,
      deckViewBoxes,
      roomClassColors,
    );
    // sanity: the regenerated file must parse and expose the decks
    const probe = { RBV: {}, console: { debug() {} } };
    try {
      new Function("window", "console", fileText)(probe, probe.console);
      if (!probe.deckRooms || typeof probe.deckRooms !== "object")
        throw new Error("no deckRooms");
    } catch (e) {
      return res
        .status(400)
        .json({ success: false, error: "Generated file invalid: " + e.message });
    }

    // timestamped backup, then write
    try {
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      await fs.copyFile(
        DECK_ROOMS_PATH,
        DECK_ROOMS_PATH + "." + stamp + ".bak",
      );
    } catch (e) {
      /* first save or no prior file — non-fatal */
    }
    await fs.writeFile(DECK_ROOMS_PATH, fileText, "utf8");

    const total = Object.values(probe.deckRooms).reduce(
      (n, a) => n + (Array.isArray(a) ? a.length : 0),
      0,
    );
    console.info(`deckRooms.js saved by admin — ${total} rooms`);
    res.json({ success: true, rooms: total });
  } catch (error) {
    console.error("save-rooms error:", error);
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
      console.warn("No MP3 files found in music directory");
      return res.status(404).json({ error: "No MP3 files found" });
    }

    console.info(`Retrieved ${songs.length} songs from music directory`);
    res.json(songs);
  } catch (err) {
    console.error("Error reading music directory:", err);
    res.status(500).json({
      error: "Failed to load music files",
      details: err.message,
    });
  }
});

// Report endpoint with Discord webhook
const reportLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 6, // a player's reports, not a firehose into the moderators' channel
  message: { success: false, error: "Too many reports. Please wait a while." },
  standardHeaders: true,
  legacyHeaders: false,
});
app.post("/api/report", reportLimiter, async (req, res) => {
  try {
    if (!req.session || !req.session.userId) {
      return res
        .status(401)
        .json({ success: false, error: "Please log in to send a report" });
    }
    const body = req.body || {};
    const asText = (v, max) =>
      typeof v === "string" ? v.slice(0, max) : "";
    const type = asText(body.type, 60);
    const description = asText(body.description, 2000);
    const reportedUser = asText(body.reportedUser, 120);
    const reporterName = asText(body.reporterName, 120);
    const room = asText(body.room, 120);

    if (!description || !type) {
      return res
        .status(400)
        .json({ success: false, error: "Missing required fields" });
    }

    const webhookUrl = String(process.env.DISCORD_WEBHOOK_URL || "").trim();
    if (!webhookUrl) {
      console.warn("Report endpoint called without DISCORD_WEBHOOK_URL set");
      return res.status(503).json({
        success: false,
        error: "Reporting is not configured on this deployment",
      });
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
    const webhookResponse = await postJson(webhookUrl, webhookPayload);

    const webhookBody = String(webhookResponse.body || "");
    const isCloudflareRateLimit =
      webhookResponse.status === 1015 ||
      webhookBody.includes("Error code 1015");

    if (!webhookResponse.ok) {
      console.error(
        "Discord webhook failed:",
        webhookResponse.status,
        webhookBody,
      );
      return res.status(500).json({
        success: false,
        error: "Failed to send report",
        details: isCloudflareRateLimit
          ? "Discord is rate-limiting webhook requests from the server right now. Wait a minute and try again."
          : "The report could not be delivered. Please try again later.",
      });
    }

    console.info(
      `Report sent to Discord: ${type} by ${
        reporterName || "Anonymous"
      } from ${room || "Unknown Room"}`,
    );
    res.json({ success: true, message: "Report submitted successfully" });
  } catch (error) {
    console.error("Report error:", error);
    res.status(500).json({
      success: false,
      error: "Internal server error",
    });
  }
});

// Page Routes
app.get("/", (req, res) => {
  sendPage(res, "public/main/registration.html");
});

app.get("/game", (req, res) => {

  // Check if user is logged in
  if (!req.session.userId) {
    console.warn(
      `Game access denied: No session userId, redirecting to login`,
    );
    return res.redirect("/");
  }
  console.info(
    `Game access granted: User ${req.session.userId} accessing game`,
  );
  sendPage(res, "public/game/game.html");
});

app.get("/list", (req, res) => {
  sendPage(res, "public/main/list.html");
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
      `Auto-added ${
        newlyAdded.length
      } room(s) to allowedRooms: ${newlyAdded.join(", ")}`,
    );
  }
} catch (err) {
  console.error(
    "Failed to auto-extend allowedRooms from game.js:",
    err.message,
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
      -MAX_MESSAGES_PER_ROOM,
    );
  }
}

// Engine order telegraph (bridge/wheelhouse roleplay prop): last order
// signaled per room, kept only in memory so a late joiner sees the current
// needle position (mirrors roomMessageHistory above).
const TELEGRAPH_LABELS = {
  STOP: "STOP",
  STAND_BY: "STAND BY",
  DEAD_SLOW_AHEAD: "DEAD SLOW AHEAD",
  SLOW_AHEAD: "SLOW AHEAD",
  HALF_AHEAD: "HALF AHEAD",
  FULL_AHEAD: "FULL AHEAD",
  FULL_ASTERN: "FULL ASTERN",
  HALF_ASTERN: "HALF ASTERN",
  SLOW_ASTERN: "SLOW ASTERN",
  DEAD_SLOW_ASTERN: "DEAD SLOW ASTERN",
};
const telegraphState = {};

// ── Who is in which room ─────────────────────────────────────────────────────
// Kept per player (their account), not per connection. A phone that drops and
// reconnects comes back as a new socket while the old one lingers until its
// ping times out (over a minute), and a second tab is another socket of the
// same player: counting sockets listed such players twice and told the room
// "has entered" / "has left" on every reconnection. A dropped connection gets
// PRESENCE_GRACE_MS to come back before the room hears "has left".
const PRESENCE_GRACE_MS = Number(process.env.RBV_PRESENCE_GRACE_MS) || 20 * 1000;
// roomId -> Map(playerKey -> { sockets: Set<socketId>, character, leaveTimer })
const roomPresence = new Map();

function presenceKey(socket) {
  return socket.sessionUserId
    ? `user:${socket.sessionUserId}`
    : `socket:${socket.id}`;
}

function roomHeadcount(roomId) {
  return roomPresence.get(roomId)?.size || 0;
}

function roomPlayerList(roomId) {
  const members = roomPresence.get(roomId);
  if (!members) return [];
  return Array.from(members.values()).map(({ sockets, character }) => {
    const c = character || {};
    return {
      id: sockets.values().next().value || null,
      name: `${c.forename || ""} ${c.surname || ""}`.trim(),
      avatar: c.avatar,
      birthdate: c.birthdate,
      bio: c.bio,
      // Provide both cabin type and cabin number to client
      cabin: c.cabin,
      cabin_number: c.cabin_number,
    };
  });
}

// Everyone in the room gets the room's passenger list again
function emitRoomPlayers(roomId) {
  io.to(roomId).emit("room-players", {
    roomId,
    players: roomPlayerList(roomId),
  });
}

// The room's head count, to every client (the deck plan shows them all)
function emitRoomCount(roomId) {
  io.emit("room-count", {
    roomId: roomId,
    count: roomHeadcount(roomId),
  });
}

// Puts the socket's player in the room. True when they were not there before
// (and have not merely come back within the grace period).
function presenceEnter(socket, roomId, character) {
  let members = roomPresence.get(roomId);
  if (!members) {
    members = new Map();
    roomPresence.set(roomId, members);
  }
  const key = presenceKey(socket);
  const entry = members.get(key);
  if (entry) {
    entry.sockets.add(socket.id);
    entry.character = character;
    if (entry.leaveTimer) {
      clearTimeout(entry.leaveTimer);
      entry.leaveTimer = null;
    }
    return false;
  }
  members.set(key, {
    sockets: new Set([socket.id]),
    character,
    leaveTimer: null,
  });
  return true;
}

// Takes the socket out of the room. When it was the player's last connection
// there, the room hears "has left": at once, or for a dropped connection after
// the grace period, unless the player is back in the room by then.
function presenceExit(socket, roomId, { grace = false } = {}) {
  const members = roomPresence.get(roomId);
  const key = presenceKey(socket);
  const entry = members && members.get(key);
  if (!entry || !entry.sockets.delete(socket.id) || entry.sockets.size) return;
  const announce = () => {
    entry.leaveTimer = null;
    if (members.get(key) !== entry || entry.sockets.size) return;
    members.delete(key);
    if (!members.size) roomPresence.delete(roomId);
    io.to(roomId).emit("user-left", {
      character: entry.character,
      socketId: socket.id,
      roomId,
    });
    emitRoomCount(roomId);
    emitRoomPlayers(roomId);
  };
  if (entry.leaveTimer) clearTimeout(entry.leaveTimer);
  entry.leaveTimer = null;
  if (grace) {
    entry.leaveTimer = setTimeout(announce, PRESENCE_GRACE_MS);
  } else {
    announce();
  }
}

function getCurrentVoyageState() {
  return computeVoyageStateAt(voyageStartTime);
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
      "character.cabin character.cabin_number",
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

    console.info("Synchronized cabin occupancy from DB");
  } catch (err) {
    console.error("Failed to sync cabin occupancy from DB:", err.message);
  }
}

app.get("/api/get_available_cabins", (req, res) => {
  const cabinType = req.query.cabin_type;

  if (!cabinType) {
    console.error("No cabin type provided in request");
    return res.status(400).json({ error: "Cabin type is required" });
  }

  if (!cabins[cabinType]) {
    console.error(`Invalid cabin type requested: ${cabinType}`);
    return res.status(400).json({
      error: "Invalid cabin type",
      availableTypes: Object.keys(cabins),
    });
  }

  const cabinEntries = Object.entries(cabins[cabinType]);

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
    `Returning ${
      availableCabins.length
    } available cabins: ${availableCabins.join(", ")}`,
  );
  res.json(availableCabins);
});

async function populateSocketUserEmail(socket, includeCharacter = false) {
  if (!socket.userEmail && socket.request?.session?.userId) {
    const selection = includeCharacter ? "email character" : "email";
    const sessionUser = await User.findById(
      socket.request.session.userId,
    ).select(selection);

    if (sessionUser) {
      socket.userEmail = sessionUser.email;
      if (includeCharacter && !socket.character && sessionUser.character) {
        socket.character = sessionUser.character;
      }
    }
  }

  return socket.userEmail || null;
}

async function handleLoadStats(socket) {
  try {
    const targetEmail = await populateSocketUserEmail(socket, true);
    if (!targetEmail) {
      console.error("No user email available for stats loading");
      return;
    }

    const user = await User.findOne({ email: targetEmail });
    if (!user || !user.stats) {
      socket.emit("stats-loaded", {
        hunger: 100,
        thirst: 100,
        energy: 100,
        hygiene: 100,
        bladder: 100,
        intoxication: 0,
        money: 0,
      });
      return;
    }

    const now = Date.now();
    const timeDiffSeconds = (now - user.stats.lastUpdated) / 1000;

    const hungerDecay = Math.min(100, timeDiffSeconds * 0.005);
    const thirstDecay = Math.min(100, timeDiffSeconds * 0.007);
    const energyDecay = Math.min(100, timeDiffSeconds * 0.003);
    const hygieneDecay = Math.min(100, timeDiffSeconds * 0.002);
    const bladderDecay = Math.min(100, timeDiffSeconds * 0.006);
    const intoxicationDecay = Math.max(0, timeDiffSeconds * 0.01);

    const currentMoneyVersion = user.stats.moneyVersion || 0;
    if (currentMoneyVersion < 1) {
      const cabinValue = user.character?.cabin;
      const startingMoney = getStartingMoneyForCabin(cabinValue);
      console.info(
        `Money migration for ${targetEmail}: cabin="${cabinValue}", startingMoney=${startingMoney}, oldMoney=${user.stats.money}`,
      );
      await User.updateOne(
        { _id: user._id },
        {
          $set: {
            "stats.money": startingMoney,
            "stats.moneyVersion": 1,
          },
        },
      );
      user.stats.money = startingMoney;
      user.stats.moneyVersion = 1;
    }

    const currentStats = {
      hunger: Math.max(0, user.stats.hunger - hungerDecay),
      thirst: Math.max(0, user.stats.thirst - thirstDecay),
      energy: Math.max(0, user.stats.energy - energyDecay),
      hygiene: Math.max(0, user.stats.hygiene - hygieneDecay),
      bladder: Math.max(0, user.stats.bladder - bladderDecay),
      intoxication: Math.max(0, user.stats.intoxication - intoxicationDecay),
      money: user.stats.money || 0,
    };

    console.info(
      `Loaded stats for ${targetEmail}: money=${currentStats.money}`,
    );
    socket.emit("stats-loaded", currentStats);
  } catch (error) {
    console.error(`Error loading stats: ${error.message}`);
  }
}

async function handleSaveStats(socket, statsData) {
  try {
    const targetEmail = await populateSocketUserEmail(socket);
    if (!targetEmail) {
      console.error("No user email available for stats saving");
      return;
    }

    // The client sends these; whatever it sends, a need is a number from 0
    // to 100 (and no account is made up for an email that has none)
    const data = statsData && typeof statsData === "object" ? statsData : {};
    const need = (v) => Math.min(100, Math.max(0, Number(v) || 0));
    await User.findOneAndUpdate(
      { email: targetEmail },
      {
        $set: {
          "stats.hunger": need(data.hunger),
          "stats.thirst": need(data.thirst),
          "stats.energy": need(data.energy),
          "stats.hygiene": need(data.hygiene),
          "stats.bladder": need(data.bladder),
          "stats.intoxication": need(data.intoxication),
          "stats.lastUpdated": Date.now(),
        },
      },
    );
  } catch (error) {
    console.error(`Error saving stats: ${error.message}`);
  }
}

// A bad payload or a failing handler must never take the server down. Every socket
// handler runs through this guard, which logs what it throws or rejects with instead
// of letting it reach the unhandledRejection handler (which exits the process).
function guardSocketHandler(event, handler) {
  return (...args) => {
    try {
      const result = handler(...args);
      if (result && typeof result.catch === "function") {
        result.catch((err) =>
          console.error(`❌ Error in socket "${event}" handler:`, err),
        );
      }
      return result;
    } catch (err) {
      console.error(`Error in socket "${event}" handler:`, err);
    }
  };
}

// Socket.IO Setup
io.on("connection", async (socket) => {
  // A flood guard: past 40 events in one second a socket is ignored until
  // the second is over (a chat or telegraph flood is relayed to every player
  // and costs a database read each time).
  let floodWindow = 0;
  let floodCount = 0;
  const onEvent = (event, handler) =>
    socket.on(
      event,
      guardSocketHandler(event, (...args) => {
        if (event !== "disconnect") {
          const now = Date.now();
          if (now - floodWindow > 1000) {
            floodWindow = now;
            floodCount = 0;
          }
          if (++floodCount > 40) return undefined;
        }
        return handler(...args);
      }),
    );
  userCount++;
  io.emit("global-user-count", userCount); // Global site-wide count
  console.info(`User count increased: ${userCount}`);

  socket.isGameClient = false;

  // Send voyage start time to client for synchronization
  socket.emit("voyage-start-time", voyageStartTime);

  // Send current voyage state for immediate sync
  const currentVoyageState = getCurrentVoyageState();
  socket.emit("voyage-state", currentVoyageState);

  // Who this is, from the session. Looked up alongside the handlers below
  // rather than before them: until a handler is in place its events are lost,
  // and a reconnecting client sends "join-room" the moment it connects (it was
  // dropped, and the player stood in no room). Handlers that need the player
  // load them themselves (requireSessionUser).
  userChatColors[socket.id] = "#c0932b";
  (async () => {
    let assignedColor = "#c0932b";
    const sessionUserId = socket.request?.session?.userId;

    if (sessionUserId) {
      try {
        const dbUser = await User.findById(sessionUserId).select(
          "email chatColor character",
        );
        if (dbUser) {
          socket.userEmail = dbUser.email;
          socket.character = dbUser.character || null;
          socket.sessionUserId = dbUser._id;
          if (isChatColor(dbUser.chatColor)) {
            assignedColor = dbUser.chatColor;
          }
        }
      } catch (err) {
        console.error(
          `Error loading session user ${sessionUserId}:`,
          err.message,
        );
      }
    }
    if (!socket.connected) return; // gone while we looked

    userChatColors[socket.id] = assignedColor;

    if (socket.sessionUserId) {
      handleLoadStats(socket);
    }

    // Send the assigned color to the connected client
    socket.emit("assign-chat-color", assignedColor);
  })();
  socket.emit("game-user-count", gameClientCount);

  // Send existing passengers to ALL new connections (public feature)
  User.find({}, "character")
    .then((users) => {
      const passengers = users.map((user) => user.character);
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
      }
    })
    .catch((err) => {
      console.error("Error fetching passengers:", err);
    });

  // Initialize per-socket variables
  let currentRoom = null;

  onEvent("load-stats", async () => {
    const auth = await requireSessionUser(socket);
    if (!auth.ok) {
      socket.emit("auth-error", { message: auth.error });
      return;
    }
    handleLoadStats(socket);
  });

  onEvent("save-stats", async (statsData) => {
    const auth = await requireSessionUser(socket);
    if (!auth.ok) {
      socket.emit("auth-error", { message: auth.error });
      return;
    }
    handleSaveStats(socket, statsData);
  });

  // Handle 'join-room' event
  onEvent("join-room", async (data) => {
    const auth = await requireSessionUser(socket);
    if (!auth.ok) {
      socket.emit("auth-error", { message: auth.error });
      return;
    }

    const { room } = data || {};
    const character = socket.character;

    if (!room || !character) {
      console.warn(`join-room missing room or server character for ${socket.id}`);
      return;
    }

    if (!socket.isGameClient) {
      socket.isGameClient = true;
      gameClientCount++;
      io.emit("game-user-count", gameClientCount);
      console.info(`Game client count increased: ${gameClientCount}`);
    }
    if (allowedRooms.includes(room)) {
      // Leave old room if switching rooms
      if (currentRoom && currentRoom !== room) {
        socket.leave(currentRoom);
        presenceExit(socket, currentRoom);
      }

      socket.join(room);
      socket.character = character; // Store character data on socket
      currentRoom = room;
      // Only a real arrival is announced: not a second tab, a reconnection
      // within the grace period, or the same socket joining again
      if (presenceEnter(socket, room, character)) {
        socket
          .to(room)
          .emit("user-joined", { character, socketId: socket.id, roomId: room });
        emitRoomCount(room);
        emitRoomPlayers(room);
      } else {
        socket.emit("room-players", {
          roomId: room,
          players: roomPlayerList(room),
        });
      }

      // Send recent message history for this room
      const roomHistory = roomMessageHistory[room] || [];
      if (roomHistory.length > 0) {
        socket.emit("room-message-history", { room, messages: roomHistory });
      }

      // Send the current engine order telegraph position, if this room has
      // one set (bridge/wheelhouse only) — so a late joiner sees the same
      // needle position everyone else does instead of it resetting to STOP
      if (telegraphState[room]) {
        socket.emit("telegraph-update", {
          room,
          position: telegraphState[room],
          initial: true, // late-join sync: place the lever, don't ring it
        });
      }

      console.info(`User joined room: ${room}`);
    }
  });

  // Handle 'chat-message' event (corrected)
  onEvent("chat-message", async (data) => {
    if (!data || typeof data !== "object") return;
    const auth = await requireSessionUser(socket);
    if (!auth.ok) {
      socket.emit("auth-error", { message: auth.error });
      return;
    }

    const roomId = data.room;
    const text = typeof data.message === "string" ? data.message.trim() : "";

    if (
      typeof roomId !== "string" ||
      !roomId ||
      !allowedRooms.includes(roomId)
    ) {
      console.warn("Message sent to invalid or missing room");
      return;
    }

    // Every line goes to every player: no more than 6 in 8 seconds from one
    const chatNow = Date.now();
    socket.chatTimes = (socket.chatTimes || []).filter(
      (t) => chatNow - t < 8000,
    );
    if (socket.chatTimes.length >= 6) return;
    socket.chatTimes.push(chatNow);

    if (!text) {
      console.warn("Ignoring empty chat message payload");
      return;
    }

    if (text.length > 500) {
      console.warn(`Chat message too long from ${socket.id}`);
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

    // Handle /me: build the display name for inline substitution
    const meName =
      [safeCharacter.forename, safeCharacter.surname]
        .filter(Boolean)
        .join(" ") || "Passenger";
    const startsWithMe = text.startsWith("/me ");
    let processedMessage;
    if (startsWithMe) {
      // Strip leading /me, then also replace any further inline /me
      processedMessage = text.substring(4).replaceAll("/me", meName);
    } else {
      // Replace all inline /me with the player's name
      processedMessage = text.replaceAll("/me", meName);
    }

    // /me expands to the player's name, so cap the result as well as the typed text
    if (processedMessage.length > 1000) {
      console.warn(`Chat message too long after /me expansion from ${socket.id}`);
      return;
    }

    const outboundMessage = {
      room: roomId,
      message: processedMessage,
      timestamp: Date.now(),
      type: "user",
      userId: socket.id,
      color: userChatColors[socket.id] || "#c0932b",
      character: safeCharacter,
      cabin: cabinRef,
      isAction: startsWithMe || text.includes("/me"),
      inlineMe: !startsWithMe && text.includes("/me"),
    };

    addMessageToRoomHistory(roomId, outboundMessage);
    io.emit("chat-message", outboundMessage);
  });

  // Handle 'telegraph-set' event: bridge/wheelhouse engine order telegraph.
  // Roleplay only — this never touches the ship's actual speed/timeline,
  // it just records which order is currently signaled for that room and
  // relays it to everyone present, plus a chat narration line.
  onEvent("telegraph-set", async (data) => {
    if (!data || typeof data !== "object") return;
    const auth = await requireSessionUser(socket);
    if (!auth.ok) {
      socket.emit("auth-error", { message: auth.error });
      return;
    }

    const { room, position } = data;
    if (typeof room !== "string" || !room || !allowedRooms.includes(room)) {
      console.warn("Telegraph order sent to invalid or missing room");
      return;
    }
    // Only from the room one stands in, and not faster than a hand can ring it
    if (room !== currentRoom) return;
    const telegNow = Date.now();
    if (telegNow - (socket.lastTelegraph || 0) < 400) return;
    socket.lastTelegraph = telegNow;
    if (!Object.prototype.hasOwnProperty.call(TELEGRAPH_LABELS, position)) {
      console.warn(`Unknown telegraph position: ${position}`);
      return;
    }

    telegraphState[room] = position;
    io.to(room).emit("telegraph-update", { room, position });

    const activeCharacter = socket.character || {};
    const orderedBy =
      [activeCharacter.forename, activeCharacter.surname]
        .filter(Boolean)
        .join(" ") || "A crew member";
    const systemMessage = {
      type: "system",
      message: `Engine order telegraph rung to ${TELEGRAPH_LABELS[position]} by ${orderedBy}.`,
      room,
      timestamp: Date.now(),
    };
    addMessageToRoomHistory(room, systemMessage);
    io.emit("chat-message", systemMessage);
  });

  // Handle 'change-chat-color' event
  onEvent("change-chat-color", async (color) => {
    try {
      if (!isChatColor(color)) {
        console.warn(`Ignoring invalid chat color from ${socket.id}`);
        return;
      }
      // Prefer server-side session for authentication — do not accept client-supplied email
      const sessionUserId = socket.request?.session?.userId;
      if (!sessionUserId) {
        console.warn("Unauthenticated attempt to change chat color");
        return;
      }

      const user = await User.findById(sessionUserId);
      if (!user) {
        console.warn(`No user found for session ${sessionUserId}`);
        return;
      }

      user.chatColor = color;
      await user.save();

      // Update in-memory color for this socket
      userChatColors[socket.id] = color;

      // Broadcast color change to all clients (send both socket id and the user's id)
      io.emit("update-chat-color", {
        socketId: socket.id,
        userId: user._id,
        color,
      });
    } catch (error) {
      console.error(`Error updating chat color: ${error.message}`);
    }
  });

  // Handle 'leave-room' event
  onEvent("leave-room", async (data) => {
    const auth = await requireSessionUser(socket);
    if (!auth.ok) {
      return;
    }

    const { room } = data || {};
    if (allowedRooms.includes(room)) {
      socket.leave(room);
      presenceExit(socket, room);
      if (currentRoom === room) {
        currentRoom = null;
      }
    }
  });

  onEvent("request-room-users", (roomId) => {
    if (allowedRooms.includes(roomId)) {
      const members = roomPresence.get(roomId);
      const users = members
        ? Array.from(members.values()).map(({ sockets, character }) => ({
            socketId: sockets.values().next().value || null,
            character,
          }))
        : [];
      socket.emit("room-users", { roomId, users });
    }
  });

  onEvent("request-all-room-counts", () => {
    allowedRooms.forEach((roomId) => {
      emitRoomCount(roomId);
    });
  });

  onEvent("request-room-count", (roomId) => {
    if (allowedRooms.includes(roomId)) {
      emitRoomCount(roomId);
    }
  });

  onEvent("request-room-counts", (payload) => {
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

  });

  // Always answered, an empty room included, so the asker never keeps an old list
  onEvent("request-room-players", (roomId) => {
    if (allowedRooms.includes(roomId)) {
      socket.emit("room-players", { roomId, players: roomPlayerList(roomId) });
    }
  });

  // ─── Server-authoritative poker ───────────────────────────────────────────
  const POKER_RANKS = [
    "2",
    "3",
    "4",
    "5",
    "6",
    "7",
    "8",
    "9",
    "10",
    "J",
    "Q",
    "K",
    "A",
  ];
  const POKER_SUITS = ["hearts", "diamonds", "clubs", "spades"];
  const SUIT_SYMBOLS = {
    hearts: "♥",
    diamonds: "♦",
    clubs: "♣",
    spades: "♠",
  };
  const POKER_PAYOUTS = {
    "Jacks or Better": 1,
    "Two Pair": 2,
    "Three of a Kind": 4,
    Straight: 6,
    Flush: 8,
    "Full House": 12,
    "Four of a Kind": 25,
    "Straight Flush": 50,
    "Royal Flush": 500,
  };
  const VALID_BETS = [0, 1, 5, 10, 25];

  function createShuffledDeck() {
    const deck = [];
    for (const suit of POKER_SUITS) {
      for (const rank of POKER_RANKS) {
        deck.push({
          rank,
          suit,
          symbol: SUIT_SYMBOLS[suit],
          color: suit === "hearts" || suit === "diamonds" ? "red" : "black",
        });
      }
    }
    // Fisher-Yates shuffle
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    return deck;
  }

  function evaluatePokerHand(hand) {
    const sortedHand = [...hand].sort(
      (a, b) => POKER_RANKS.indexOf(a.rank) - POKER_RANKS.indexOf(b.rank),
    );
    const isFlush = hand.every((c) => c.suit === hand[0].suit);
    let isStraight = false;
    if (sortedHand.length === 5) {
      const ri = sortedHand.map((c) => POKER_RANKS.indexOf(c.rank));
      isStraight = ri.every((v, i, a) => i === 0 || v === a[i - 1] + 1);
      if (
        !isStraight &&
        ri[4] === 12 &&
        ri[0] === 0 &&
        ri[1] === 1 &&
        ri[2] === 2 &&
        ri[3] === 3
      )
        isStraight = true;
    }
    const rc = {};
    for (const c of hand) rc[c.rank] = (rc[c.rank] || 0) + 1;
    const counts = Object.values(rc);

    if (isFlush && isStraight && sortedHand[0].rank === "10")
      return "Royal Flush";
    if (isFlush && isStraight) return "Straight Flush";
    if (counts.includes(4)) return "Four of a Kind";
    if (counts.includes(3) && counts.includes(2)) return "Full House";
    if (isFlush) return "Flush";
    if (isStraight) return "Straight";
    if (counts.includes(3)) return "Three of a Kind";
    if (counts.filter((c) => c === 2).length === 2) return "Two Pair";
    if (
      Object.keys(rc).find(
        (r) => rc[r] === 2 && ["J", "Q", "K", "A"].includes(r),
      )
    )
      return "Jacks or Better";
    if (counts.includes(2)) return "Pair";
    return "High Card";
  }

  // poker-deal: client sends { bet }
  onEvent("poker-deal", async (payload) => {
    try {
      const { bet } = payload || {};
      const auth = await requireSessionUser(socket);
      if (!auth.ok) return;
      const betAmount = Number(bet) || 0;
      if (!VALID_BETS.includes(betAmount)) return;

      // The bet leaves the account only if the money is there, checked and
      // taken in ONE update (a read followed by a separate write let twenty
      // deals sent together all pass and run the balance below zero).
      let balance;
      if (betAmount > 0) {
        const paid = await User.findOneAndUpdate(
          { email: socket.userEmail, "stats.money": { $gte: betAmount } },
          { $inc: { "stats.money": -betAmount } },
          { new: true },
        );
        if (!paid) {
          socket.emit("poker-error", { message: "Not enough money!" });
          return;
        }
        balance = paid.stats.money;
      } else {
        const user = await User.findOne({ email: socket.userEmail });
        if (!user) return;
        balance = user.stats.money;
      }

      const deck = createShuffledDeck();
      const hand = deck.splice(0, 5);

      // Store game state on the socket (not accessible to client)
      socket.pokerGame = { deck, hand, bet: betAmount };

      socket.emit("poker-dealt", {
        hand,
        money: balance,
      });
    } catch (error) {
      console.error(`Poker deal error: ${error.message}`);
    }
  });

  // poker-hold: client sends { held: [bool, bool, bool, bool, bool] }
  onEvent("poker-hold", async (payload) => {
    try {
      const { held } = payload || {};
      const auth = await requireSessionUser(socket);
      if (!auth.ok) return;
      if (!Array.isArray(held) || held.length !== 5) return;

      // Claim the hand BEFORE the first database call. It used to be cleared
      // only after them, so thirty "poker-hold" events sent together all found
      // the hand still there and each was paid.
      const game = socket.pokerGame;
      if (!game) return;
      socket.pokerGame = null;
      // Draw replacements from the stored deck
      for (let i = 0; i < 5; i++) {
        if (!held[i]) {
          game.hand[i] = game.deck.pop();
        }
      }

      const rank = evaluatePokerHand(game.hand);
      const multiplier = POKER_PAYOUTS[rank] || 0;
      let winnings = 0;

      if (multiplier > 0 && game.bet > 0) {
        winnings = game.bet * multiplier;
        await User.findOneAndUpdate(
          { email: socket.userEmail },
          { $inc: { "stats.money": winnings } },
        );
      }

      const updatedUser = await User.findOne({ email: socket.userEmail });

      socket.emit("poker-result", {
        hand: game.hand,
        rank,
        multiplier,
        winnings,
        bet: game.bet,
        money: updatedUser.stats.money,
      });
    } catch (error) {
      console.error(`Poker hold error: ${error.message}`);
    }
  });

  // ─── Server-authoritative purchases (price from menu catalog, not client) ─
  onEvent("purchase-item", async (payload = {}) => {
    try {
      const auth = await requireSessionUser(socket);
      if (!auth.ok) {
        socket.emit("purchase-result", {
          success: false,
          message: auth.error,
        });
        return;
      }

      const menuItem = lookupMenuItem({
        itemKey: payload.itemKey,
        topCategory: payload.topCategory,
        subCategory: payload.subCategory,
        name: payload.name,
      });

      if (!menuItem) {
        socket.emit("purchase-result", {
          success: false,
          message: "Unknown menu item",
        });
        return;
      }

      const cost = Number(menuItem.price) || 0;
      if (cost <= 0) {
        socket.emit("purchase-result", { success: true, money: null });
        return;
      }

      // Checked and taken in one update (see poker-deal)
      const paid = await User.findOneAndUpdate(
        { email: socket.userEmail, "stats.money": { $gte: cost } },
        { $inc: { "stats.money": -cost } },
        { new: true },
      );
      if (!paid) {
        socket.emit("purchase-result", {
          success: false,
          message: "Not enough money!",
        });
        return;
      }

      socket.emit("purchase-result", {
        success: true,
        money: paid.stats.money,
        itemKey: typeof payload.itemKey === "string" ? payload.itemKey : null,
      });
    } catch (error) {
      console.error(`Purchase error: ${error.message}`);
      socket.emit("purchase-result", {
        success: false,
        message: "Purchase failed",
      });
    }
  });

  onEvent("disconnect", () => {
    console.info(`User disconnected: ${socket.id}`);
    try {
      userCount--; // Keep this decrement
      console.info(`User count decremented: ${userCount}`);

      // Emit the updated user count to all clients
      io.emit("global-user-count", userCount); // Use this event consistently

      if (socket.isGameClient) {
        gameClientCount = Math.max(0, gameClientCount - 1);
        io.emit("game-user-count", gameClientCount);
        console.info(`Game client count decremented: ${gameClientCount}`);
      }

      if (currentRoom) {
        // The room hears "has left" only if the player does not come back
        // within the grace period (a phone dropping its connection, a reload)
        presenceExit(socket, currentRoom, { grace: true });
        console.info(`${socket.id} disconnected from room: ${currentRoom}`);
      }

      // Remove the user's character data
      if (users[socket.id]) {
        delete users[socket.id];
      }

      console.info("Client disconnected");
    } catch (error) {
      console.error(`Error during disconnect: ${error.message}`);
    } finally {
      // Always clean up socket-keyed maps, even if an error occurred above
      delete users[socket.id];
      delete userChatColors[socket.id];
    }
  });
});

// Initialize Server
const startServer = async () => {
  console.info("Initializing server...");
  validateEnvironment();
  console.info("Initializing MongoDB...");
  await initMongoDB();

  // Load or initialize persistent voyage start time
  const savedState = await ServerState.findOne({ key: "voyageStartTime" });
  if (savedState) {
    voyageStartTime = savedState.value;
    console.info(
      `Voyage start time loaded from DB: ${new Date(voyageStartTime).toISOString()}`,
    );
  } else {
    voyageStartTime = Date.now();
    await ServerState.create({
      key: "voyageStartTime",
      value: voyageStartTime,
    });
    console.info(
      `Voyage start time initialized and saved to DB: ${new Date(voyageStartTime).toISOString()}`,
    );
  }

  // Re-sync narrative index to match persisted elapsed time
  const elapsedSeconds = Math.floor((Date.now() - voyageStartTime) / 1000);
  let idx = 0;
  for (let i = 0; i < narrativeEvents.length; i++) {
    if (elapsedSeconds >= narrativeEvents[i].time) idx = i + 1;
    else break;
  }
  serverNarrativeIndex = idx;
  console.info(
    `Narrative synced to index ${serverNarrativeIndex} (${elapsedSeconds}s elapsed)`,
  );

  console.info("Syncing cabin occupancy from DB...");
  await syncCabinOccupancyFromDB();
  const PORT = process.env.PORT || 3000;
  await assetsReady; // players get the minified files from the first request
  server.listen(PORT, () => {
    console.info(`Server running on port ${PORT}`);
  });
};

// A malformed request body, or anything a route lets slip: a plain answer,
// never a stack trace (Express prints one unless NODE_ENV is "production")
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  const code = Number(err && (err.status || err.statusCode)) || 500;
  const status = code >= 400 && code < 500 ? code : 500;
  if (status === 500) console.error("Unhandled route error:", err);
  res
    .status(status)
    .json({ success: false, error: status === 500 ? "Server error" : "Bad request" });
});

// Error Handling
process.on("unhandledRejection", (err) => {
  // Cloudinary sometimes throws "Invalid image file" outside the multer callback chain.
  // Swallow it gracefully — the route handler already sent a 400 to the client.
  if (err && err.http_code === 400 && /invalid image/i.test(err.message)) {
    console.warn(
      "Cloudinary rejected an image upload (invalid image file) — handled gracefully.",
    );
    return;
  }
  console.error("Unhandled Promise Rejection:", err);
  process.exit(1);
});

// Graceful shutdown: clear intervals and close connections
function gracefulShutdown() {
  console.info("Shutting down gracefully...");
  clearInterval(narrativeInterval);
  clearInterval(voyageStateInterval);
  server.close(() => {
    mongoose.disconnect().then(() => process.exit(0));
  });
  // Force exit after 10 seconds if cleanup hangs
  setTimeout(() => process.exit(1), 10000);
}
process.on("SIGTERM", gracefulShutdown);
process.on("SIGINT", gracefulShutdown);

startServer();
