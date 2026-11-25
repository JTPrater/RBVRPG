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
const moderation = require("./lib/moderation");

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

// A connection is for a logged-in passenger only. Everything sent over one
// (every room's chat, who stands where) is for the people aboard, and a
// visitor without an account used to get all of it, unseen. The public
// passenger list reads /api/passengers instead.
// Which passenger: the one the tab names, of the characters logged in on its
// browser (sessionPlayers), every time it connects, so a dropped connection
// comes back as the same character; a tab that names none (an old page, a
// test client) gets the browser's latest login. A tab whose character is no
// longer logged in here is refused, and goes back to the start page.
io.use((socket, next) => {
  const session = socket.request.session;
  const players = sessionPlayers(session);
  const named = socket.handshake.auth && socket.handshake.auth.player;
  let playerId = null;
  if (typeof named === "string" && named) {
    if (players.includes(named)) playerId = named;
  } else if (players.length) {
    playerId = String(session.userId || players[players.length - 1]);
  }
  if (playerId) {
    socket.playerId = playerId;
    socket.browserKey = session.browserKey || null; // which browser (logInPlayer)
    return next();
  }
  const refused = new Error("not-logged-in");
  refused.data = { reason: "not-logged-in" };
  next(refused);
});

// The player's record, read as they connect and before any of their events
// are taken (lib/moderation.js): a banned player is turned away, and one
// locked in the padded room or hell is put there before they can ask for any
// other room. When the record cannot be read the connection is turned away
// too, to be tried again in a moment (game core/socket.js): let in unread, a
// locked-in player could walk out.
io.use(async (socket, next) => {
  const refuse = (reason, extra = {}) => {
    const error = new Error(reason);
    error.data = { reason, ...extra };
    next(error);
  };
  if (!mongoose.isValidObjectId(socket.playerId)) return refuse("not-logged-in");
  let user;
  try {
    user = await User.findById(socket.playerId)
      .select("email character chatColor isAdmin isOwner moderation")
      .lean();
  } catch (err) {
    console.error("Could not read a connecting player's record:", err.message);
    return refuse("try-again");
  }
  if (!user) return refuse("not-logged-in");
  const status = moderation.statusOf(user);
  if (status.ban) {
    return refuse("banned", { until: status.ban.until, why: status.ban.reason });
  }
  socket.mod = status;
  socket.userEmail = user.email;
  socket.character = user.character || null;
  socket.sessionUserId = user._id;
  socket.savedChatColor = user.chatColor;
  next();
});

// Global voyage start time (loaded from DB or set on first boot)
// Begin from Southampton (real-time progression)
let voyageStartTime = Date.now(); // temporary default, overwritten by DB in startServer()

// Where the voyage is played. "voyage": the timeline (Southampton, the Channel,
// Cherbourg, where it ends and the ship stays). "north-atlantic": the ship
// steams in the open North Atlantic the whole time, for every player, on the
// voyage's own clock (a test that runs for days). Kept in the database
// (serverstates "voyageStage") and read at start; RBV_VOYAGE_STAGE overrides it.
const VOYAGE_STAGES = ["voyage", "north-atlantic"];
let voyageStage = "voyage";

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

// The voyage's state every 3 s (the client's sky, clock and weather follow it),
// with the voyage's start in the same message rather than a second one
function voyageStateMessage() {
  return { ...getCurrentVoyageState(), startTime: voyageStartTime };
}
const voyageStateInterval = setInterval(() => {
  try {
    io.emit("voyage-state", voyageStateMessage());
  } catch (err) {
    console.error("Failed to broadcast periodic voyage-state:", err.message);
  }
}, 3000);

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
const ModerationLog = require("./models/ModerationLog");
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
    // an SVG is a document that can carry script: never an avatar (Cloudinary
    // refuses it too, by allowed_formats; this says so before the upload)
    const svg =
      /svg/i.test(file.mimetype || "") || /\.svgz?$/i.test(file.originalname || "");
    if (!looksImage || svg) {
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

// Disable caching for ALL files to ensure users get latest updates. Pictures
// and sounds are kept by the browser but checked with the server each time
// (no-cache: an unchanged file is a 304 answer of a few bytes, a changed one
// comes at once): with no-store a room's pictures, megabytes, were downloaded
// again on every visit.
const MEDIA_PATH = /^\/(images|sounds)\//;
app.use((req, res, next) => {
  if (MEDIA_PATH.test(req.path)) {
    res.setHeader("Cache-Control", "no-cache");
  } else {
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
  }
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
  // What a page may run: the site's own scripts and DOMPurify's CDN, never a
  // script or handler written into a page (so a slip that lets a player's
  // text into the markup cannot run anything); no plugins, no <base> tricks,
  // no framing by other sites. The admin room editor keeps inline scripts of
  // its own and is left out.
  if (!req.path.startsWith("/admin/")) {
    res.setHeader(
      "Content-Security-Policy",
      "script-src 'self' https://cdnjs.cloudflare.com; object-src 'none'; base-uri 'self'; frame-ancestors 'self'",
    );
  }
  next();
});

// An address as the file server reads it: decoded, its doubled slashes and
// "." and ".." steps resolved. A check on the address as sent can be stepped
// round ("/game/%74ools/...", "/js/../game/tools/..." reach the same file).
// null: it does not decode (and no file is served for it).
function servedPath(req) {
  let p;
  try {
    p = decodeURIComponent(req.path);
  } catch (e) {
    return null;
  }
  return path.posix.normalize(p.replace(/\/{2,}/g, "/"));
}

// Not for the public: the room editor's backups of the deck data, and the
// editor's own page (it is served through /admin/room-editor, which checks
// the owner; the static copy skipped that check). The moderation panel's
// files are kept by the gate below (MOD_FILES).
app.use((req, res, next) => {
  const p = servedPath(req);
  if (p && (/\.bak$/i.test(p) || /^\/game\/tools\//i.test(p))) {
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

// The moderation panel's own files (its page, script, stylesheet and words)
// go to moderators only, never stored on the way (sendPage: no-store). To
// anyone else they are not there at all: not found, like any address that
// does not exist (the panel's address too: /moderation, below). Checked here,
// ahead of the site's public files, with the browser's login read for these
// addresses alone.
const MOD_FILES = new Map([
  ["/moderation-panel/moderation.html", "public/moderation-panel/moderation.html"],
  ["/moderation-panel/moderation.js", "public/moderation-panel/moderation.js"],
  ["/moderation-panel/moderation.css", "public/moderation-panel/moderation.css"],
  ["/js/i18n/ru-mod.js", "public/js/i18n/ru-mod.js"],
  ["/js/i18n/es-mod.js", "public/js/i18n/es-mod.js"],
]);
const MOD_ONLY = /^\/(moderation-panel\/|js\/i18n\/[a-z]+-mod\.js$)/i;
app.use((req, res, next) => {
  const p = servedPath(req);
  if (!p || !MOD_ONLY.test(p)) return next();
  sessionMiddleware(req, res, async () => {
    try {
      const file = MOD_FILES.get(p);
      if (file && (await moderatorOf(req))) return sendPage(res, file);
    } catch (error) {
      console.error("Could not check a moderation file's reader:", error.message);
    }
    res.sendStatus(404);
  });
});

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

// One browser may have several characters logged in, a tab each (a player
// with a second character, in a second tab). Its session lists them, and each
// tab names its own as it connects. The browser's one cookie used to decide
// alone: after a second login, a tab still showing the first character
// talked, spent and was counted as the second the moment its connection
// dropped or the page reloaded, and logging one out logged out all.
const MAX_PLAYERS_PER_BROWSER = 6;
function sessionPlayers(session) {
  if (!session) return [];
  const list = Array.isArray(session.players) ? session.players.map(String) : [];
  if (session.userId && !list.includes(String(session.userId))) {
    list.push(String(session.userId));
  }
  return list;
}
// Logs a user in on this browser, under a new session id as before; the newest
// is the session's userId (what a tab that names no character gets). Of the
// characters already logged in here, those another tab is playing right now
// stay logged in; the rest are logged out, as every earlier login was before:
// someone who closed their tab without logging out, on a shared computer,
// is not left logged in for the next person. A browser is known by a key kept
// in its session from one login to the next (sockets carry it, see io.use).
async function logInPlayer(req, userId) {
  const id = String(userId);
  const browserKey =
    (req.session && req.session.browserKey) || crypto.randomBytes(16).toString("hex");
  const playing = playedOnBrowser(browserKey);
  const kept = sessionPlayers(req.session).filter((p) => p !== id && playing.has(p));
  await regenerateSession(req);
  req.session.browserKey = browserKey;
  req.session.userId = id;
  req.session.players = [...kept, id].slice(-MAX_PLAYERS_PER_BROWSER);
}
// The characters a browser's tabs are playing right now (their connections)
function playedOnBrowser(browserKey) {
  const playing = new Set();
  if (!browserKey) return playing;
  for (const s of io.of("/").sockets.values()) {
    if (s.browserKey === browserKey && s.playerId) playing.add(s.playerId);
  }
  return playing;
}

// Log out. A tab names its character: only that one is logged out, and the
// other characters' tabs on this browser carry on (with the newest login, which
// a tab may be on its way to). A character no tab plays any more is logged out
// with it, as at a login. When none is left (or no character is named), the
// session ends on the server and its cookie is cleared.
app.post("/api/logout", (req, res) => {
  if (!req.session) return res.json({ success: true });
  const named = req.body && typeof req.body.player === "string" ? req.body.player : "";
  let rest = [];
  if (named) {
    const playing = playedOnBrowser(req.session.browserKey);
    const newest = String(req.session.userId || "");
    rest = sessionPlayers(req.session).filter(
      (p) => p !== named && (p === newest || playing.has(p)),
    );
  }
  if (rest.length) {
    req.session.players = rest;
    if (!rest.includes(String(req.session.userId))) {
      req.session.userId = rest[rest.length - 1];
    }
    return req.session.save((error) => {
      if (error) {
        console.error("Logout error:", error.message);
        return res.status(500).json({ success: false });
      }
      res.json({ success: true });
    });
  }
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

// Rate limiting. The pages read JSON, so a limit answers in JSON too (a plain
// text answer made the login button do nothing at all), saying how long to wait.
function limitReached(what) {
  return (req, res, next, options) => {
    const resetAt = req.rateLimit && req.rateLimit.resetTime;
    const waitMs = resetAt ? new Date(resetAt).getTime() - Date.now() : options.windowMs;
    const minutes = Math.max(1, Math.ceil(waitMs / 60000));
    res.status(options.statusCode).json({
      success: false,
      error: `Too many ${what}. Please wait ${minutes} minute${minutes === 1 ? "" : "s"} and try again.`,
      retryAfterMinutes: minutes,
    });
  };
}

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000, // limit each IP to 1000 requests per windowMs (increased for production load)
  handler: limitReached("requests"),
  standardHeaders: true,
  legacyHeaders: false,
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20, // limit each IP to 20 auth attempts per windowMs
  handler: limitReached("attempts"),
  standardHeaders: true,
  legacyHeaders: false,
});

// Logging in: only a wrong password counts. Players behind one address (a
// school, an office, a family) all count against the same limit, and with
// every login counted, twenty of them locked the rest out for 15 minutes.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  skipSuccessfulRequests: true,
  requestWasSuccessful: (req, res) => res.locals.loginSucceeded === true,
  handler: limitReached("login attempts"),
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
    await logInPlayer(req, newUser._id);
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
    passengerListCache = null; // the list page shows the new passenger
    console.info(
      `New user registered: ${req.body.email}, Cabin: ${cabinNumber}`,
    );
    res.json({
      success: true,
      passenger: newUser.character,
      playerId: String(newUser._id), // the tab's own character, among the browser's
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

app.post("/api/check-credentials", loginLimiter, async (req, res) => {
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

    // A banned passenger is told so, and until when (the right password: not
    // counted against the address's login limit)
    const ban = moderation.statusOf(user).ban;
    if (ban) {
      res.locals.loginSucceeded = true;
      return res.status(403).json({
        success: false,
        banned: true,
        until: ban.until,
        reason: ban.reason,
      });
    }

    await logInPlayer(req, user._id);
    console.info(`User logged in: ${user._id}`);
    res.locals.loginSucceeded = true; // not counted against the login limit
    res.json({
      success: true,
      character: user.character, // Return the full character object
      playerId: String(user._id), // the tab's own character, among the browser's
    });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({ success: false, error: "Login failed. Please try again." });
  }
});

// A new password for a passenger who has lost theirs: easy to read out, and
// shown once, to the owner who asked for it (never logged)
const TEMP_PASSWORD_LETTERS = "abcdefghjkmnpqrstuvwxyz23456789";
function temporaryPassword() {
  return Array.from(
    crypto.randomBytes(10),
    (b) => TEMP_PASSWORD_LETTERS[b % TEMP_PASSWORD_LETTERS.length],
  ).join("");
}

// The ship's owner's own tools (the room editor, the voyage's clock, a
// passenger's new password): for the owner only, now that the owner makes
// admins from the moderation panel, and an admin is there to moderate. The
// moderation panel gives a new password too (/api/mod/action).
app.post("/api/admin/reset-password", authLimiter, async (req, res) => {
  try {
    // Ensure requester is authenticated
    const requesterId = req.session.userId;
    if (!requesterId) return res.status(403).json({ error: "Not authorized" });

    const requester = await User.findById(requesterId);
    if (!requester || !requester.isOwner) {
      return res.status(403).json({ error: "Owner only" });
    }

    const { email } = req.body;
    if (typeof email !== "string" || !email) {
      return res.status(400).json({ error: "Email is required" });
    }

    const user = await User.findOne({ email });
    if (!user) return res.status(404).json({ error: "User not found" });

    // It used to be saved and never shown to anyone, which only locked the
    // passenger out: now the owner is told it, to pass on
    const tempPass = temporaryPassword();
    user.password = await bcrypt.hash(tempPass, 10);
    await user.save();
    console.info(`[OWNER] New password given to ${user._id} (not logged)`);

    res.json({ success: true, temporaryPassword: tempPass });
  } catch (error) {
    console.error("Admin reset-password error:", error);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// Owner-only: reset the voyage to restart the clock from now
app.post("/api/admin/reset-voyage", authLimiter, async (req, res) => {
  try {
    const sessionUserId = req.session?.userId;
    if (!sessionUserId) {
      return res.status(401).json({ success: false, error: "Unauthorized" });
    }
    const admin = await User.findById(sessionUserId);
    if (!admin?.isOwner) {
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
    if (!admin?.isOwner) return res.status(403).send("Forbidden");
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
    if (!admin?.isOwner)
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
    addDeckPlanRooms(); // a new room can be entered at once
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
    // a banned passenger's login can outlive the ban's start in their
    // browser: it sends nothing to the moderators' channel
    const reporter = mongoose.isValidObjectId(req.session.userId)
      ? await User.findById(req.session.userId).select("moderation").lean()
      : null;
    if (!reporter) {
      return res
        .status(401)
        .json({ success: false, error: "Please log in to send a report" });
    }
    if (moderation.statusOf(reporter).ban) {
      return res
        .status(403)
        .json({ success: false, error: "This passenger has been banned." });
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
// The front address is the home page: Climb Aboard (log in) and Register
// Now. The game sends a player with no session here, so it has to be the
// page that can log them in (it used to be the registration form).
app.get("/", (req, res) => {
  sendPage(res, "public/main/main.html");
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

// ── The moderation panel (/moderation; lib/moderation.js has the rules) ─────
const modLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 900, // the panel looks again every 15 s, and each action is one more
  handler: limitReached("requests"),
  standardHeaders: true,
  legacyHeaders: false,
});

// The moderator at this browser: of the characters logged in on it, the one
// standing highest (the owner before an admin), or null if none is either.
// An admin who is banned or locked in moderates nobody (a ban leaves their
// login in the browser's cookie for up to a day).
async function moderatorOf(req) {
  const ids = sessionPlayers(req.session).filter((id) => mongoose.isValidObjectId(id));
  if (!ids.length) return null;
  const users = await User.find({ _id: { $in: ids } })
    .select("isAdmin isOwner character moderation")
    .lean();
  let best = null;
  for (const user of users) {
    const standing = moderation.statusOf(user);
    if (standing.ban || standing.confinement) continue;
    const role = moderation.roleOf(user);
    if (role && (!best || (role === "owner" && best.role !== "owner"))) {
      best = { user, role };
    }
  }
  return best;
}

async function requireModerator(req, res, next) {
  try {
    const found = await moderatorOf(req);
    if (!found) {
      return res.status(403).json({ ok: false, error: "Only moderators can do that." });
    }
    req.moderator = found;
    next();
  } catch (error) {
    next(error);
  }
}

// The panel's page, for moderators; anyone else finds no such page (the
// same "not found" as any address that does not exist)
app.get("/moderation", async (req, res, next) => {
  try {
    if (!(await moderatorOf(req))) return next();
    res.setHeader("X-Robots-Tag", "noindex");
    sendPage(res, "public/moderation-panel/moderation.html");
  } catch (error) {
    next(error);
  }
});

// Who is aboard, and where (the room of a connection that stands in one)
function playersAboard() {
  const aboard = new Map();
  for (const s of io.of("/").sockets.values()) {
    if (!s.playerId) continue;
    const seen = aboard.get(s.playerId);
    if (!seen || (!seen.room && s.rbvRoom)) aboard.set(s.playerId, { room: s.rbvRoom || null });
  }
  return aboard;
}

const MOD_FIELDS = "email isAdmin isOwner character moderation";

app.get("/api/mod/players", modLimiter, requireModerator, async (req, res, next) => {
  try {
    const users = await User.find({}).select(MOD_FIELDS).lean();
    const aboard = playersAboard();
    const viewerRole = req.moderator.role;
    const now = Date.now();
    const players = users
      .filter((u) => u.character && u.character.forename)
      .map((u) =>
        moderation.summary(u, { online: aboard.get(String(u._id)) || null, viewerRole, now }),
      );
    res.json({
      ok: true,
      me: {
        id: String(req.moderator.user._id),
        name: moderation.nameOf(req.moderator.user),
        role: viewerRole,
      },
      players,
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/mod/log", modLimiter, requireModerator, async (req, res, next) => {
  try {
    const filter = {};
    const player = req.query.player;
    if (typeof player === "string" && mongoose.isValidObjectId(player)) {
      filter["target.id"] = player;
    }
    const entries = await ModerationLog.find(filter).sort({ at: -1 }).limit(200).lean();
    res.json({
      ok: true,
      entries: entries.map((e) => ({
        at: e.at,
        action: e.action,
        actor: (e.actor && e.actor.name) || "",
        actorRole: (e.actor && e.actor.role) || "",
        target: (e.target && e.target.name) || "",
        targetId: e.target && e.target.id ? String(e.target.id) : "",
        reason: e.reason || "",
        until: e.until || null,
        place: e.place || "",
      })),
    });
  } catch (error) {
    next(error);
  }
});

// One moderator's action on one passenger: checked (lib/moderation.js
// refusal, and again by the database in the update itself), written to the
// passenger's record and to the log, and carried to the passenger's open
// pages at once (applyStatus: a ban ends them; the padded room and hell take
// them in)
app.post("/api/mod/action", modLimiter, requireModerator, async (req, res, next) => {
  try {
    // JSON only: a form posted from another site can send no such thing
    if (!req.is("application/json")) {
      return res.status(415).json({ ok: false, error: "Bad request" });
    }
    const asked = moderation.cleanRequest(req.body);
    if (asked.error) return res.status(400).json({ ok: false, error: asked.error });
    const { action, player, reason, minutes } = asked;
    const actor = req.moderator.user;
    const role = req.moderator.role;

    const target = await User.findById(player).select(MOD_FIELDS).lean();
    const refused = moderation.refusal(actor, target, action);
    if (refused) {
      return res.status(target ? 403 : 404).json({ ok: false, error: refused });
    }

    let newPassword = null;
    let update;
    if (action === "reset-password") {
      newPassword = temporaryPassword();
      update = { $set: { password: await bcrypt.hash(newPassword, 10) } };
    } else {
      update = moderation.updateFor(action, { actor, reason, minutes });
    }
    const done = await User.updateOne(moderation.guardFilter(actor, action, target._id), update);
    if (!done.matchedCount) {
      return res.status(409).json({
        ok: false,
        error: "Another moderator has just changed this passenger. Look again.",
      });
    }

    const fresh = await User.findById(target._id).select(MOD_FIELDS).lean();
    const status = moderation.statusOf(fresh);
    await ModerationLog.create({
      action,
      actor: { id: actor._id, name: moderation.nameOf(actor), role },
      target: { id: fresh._id, name: moderation.nameOf(fresh) },
      reason,
      until:
        (action === "mute" && status.mute && status.mute.until) ||
        (action === "ban" && status.ban && status.ban.until) ||
        null,
      place: action === "padded" ? "padded_room" : action === "hell" ? "hell" : "",
    });
    console.info(
      `Moderation: ${moderation.nameOf(actor)} (${role}) ${action} ${moderation.nameOf(fresh)} (${fresh._id})`,
    );

    for (const s of socketsOfPlayer(fresh._id)) {
      applyStatus(s, status, moderation.EVENT_OF[action]);
    }
    // off the other rooms' lists at once, connected or not
    if (status.ban) dropLingering(fresh._id, null);
    else if (status.confinement) dropLingering(fresh._id, status.confinement.place);

    res.json({
      ok: true,
      player: moderation.summary(fresh, {
        online: playersAboard().get(String(fresh._id)) || null,
        viewerRole: role,
      }),
      ...(newPassword ? { newPassword } : {}),
    });
  } catch (error) {
    next(error);
  }
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

// And every room of the deck plans (public/game/data/deckRooms.js, written by
// the room editor). Rooms added there never reached the list above, so the
// B- and C-deck rooms took every join and chat line without a word: players
// could walk in, but nobody could talk there.
const allowedRoomSet = new Set(allowedRooms);
function deckPlanRoomIds() {
  const probe = { RBV: {}, console: { debug() {} } };
  new Function("window", "console", fsSync.readFileSync(DECK_ROOMS_PATH, "utf8"))(
    probe,
    probe.console,
  );
  const ids = new Set();
  for (const rooms of Object.values(probe.deckRooms || {})) {
    if (!Array.isArray(rooms)) continue;
    for (const r of rooms) {
      if (!r) continue;
      if (typeof r.id === "string" && r.id) ids.add(r.id);
      const chatRoom = r.location && r.location.chatRoom;
      if (typeof chatRoom === "string" && chatRoom) ids.add(chatRoom);
    }
  }
  return ids;
}
function addDeckPlanRooms() {
  try {
    const added = [];
    for (const id of deckPlanRoomIds()) {
      if (allowedRoomSet.has(id)) continue;
      allowedRoomSet.add(id);
      allowedRooms.push(id);
      added.push(id);
    }
    if (added.length) {
      console.info(`Rooms from the deck plans: ${added.length} added (${added.join(", ")})`);
    }
  } catch (err) {
    console.error("Could not read the rooms of the deck plans:", err.message);
  }
}
addDeckPlanRooms();
const isAllowedRoom = (room) => typeof room === "string" && allowedRoomSet.has(room);

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

// Head counts go to every player (the deck plan shows them all), gathered into
// one message: a burst of comings and goings is one message, not one per room
const pendingRoomCounts = new Set();
let roomCountTimer = null;
function emitRoomCount(roomId) {
  pendingRoomCounts.add(roomId);
  if (roomCountTimer) return;
  roomCountTimer = setTimeout(() => {
    roomCountTimer = null;
    const counts = {};
    for (const id of pendingRoomCounts) counts[id] = roomHeadcount(id);
    pendingRoomCounts.clear();
    io.emit("room-counts", counts);
  }, 250);
}

// The counts a player asks for (the deck plan, as it opens): to that player
// only, in one message. They used to go to everyone, a message per room, so
// each player opening the plans sent every other player a hundred messages.
function sendRoomCounts(socket, roomIds) {
  const counts = {};
  for (const id of roomIds.slice(0, 500)) {
    if (isAllowedRoom(id)) counts[id] = roomHeadcount(id);
  }
  socket.emit("room-counts", counts);
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

// Puts a connection in a room: out of the one it stood in, into this one. The
// room is told of a real arrival only (not a second tab, a reconnection within
// the grace period, or the same connection again).
function placeSocket(socket, room) {
  const from = socket.rbvRoom;
  if (from && from !== room) {
    socket.leave(from);
    presenceExit(socket, from);
  }
  socket.join(room);
  socket.rbvRoom = room;
  const character = socket.character;
  if (presenceEnter(socket, room, character)) {
    socket.to(room).emit("user-joined", { character, socketId: socket.id, roomId: room });
    emitRoomCount(room);
    emitRoomPlayers(room);
  } else {
    socket.emit("room-players", { roomId: room, players: roomPlayerList(room) });
  }
}

// ── Moderation (lib/moderation.js) ───────────────────────────────────────────
// The padded room and hell are rooms like any other to the chat and the
// passenger lists, though on no deck plan
for (const place of Object.keys(moderation.PLACES)) {
  if (!allowedRoomSet.has(place)) {
    allowedRoomSet.add(place);
    allowedRooms.push(place);
  }
}

// A locked-in connection put in its room (the padded room or hell) and its
// page told so: event "confined" (a moderator has just locked them in),
// "locked" (their page asked for another room), or none (as they connect,
// after the status has gone)
function sendToPlace(socket, place, event) {
  if (socket.rbvRoom !== place) placeSocket(socket, place);
  dropLingering(socket.sessionUserId, place);
  if (!moderation.PLACES[place].poker) socket.pokerGame = null;
  if (event) {
    socket.emit("moderation-status", { ...moderation.forPlayer(socket.mod), event });
  }
}

// A player locked in (or banned) stands nowhere else: a room still counting
// them from a dropped connection (its grace period, presenceExit) hears they
// have left now, not when the grace runs out. A room where another tab of
// theirs stands is left alone: that tab is moved on its own (applyStatus).
// keepRoom: the room they are locked in (null for a ban).
function dropLingering(userId, keepRoom) {
  if (!userId) return;
  const key = `user:${userId}`;
  for (const [roomId, members] of roomPresence) {
    if (roomId === keepRoom) continue;
    const entry = members.get(key);
    if (!entry || entry.sockets.size) continue;
    if (entry.leaveTimer) clearTimeout(entry.leaveTimer);
    members.delete(key);
    if (!members.size) roomPresence.delete(roomId);
    io.to(roomId).emit("user-left", { character: entry.character, socketId: null, roomId });
    emitRoomCount(roomId);
    emitRoomPlayers(roomId);
  }
}

// Cards are dealt anywhere a player may be, except where a locked-in
// player's room has none (hell)
function cardsAllowed(socket) {
  const confinement = socket.mod && socket.mod.confinement;
  return !confinement || moderation.PLACES[confinement.place].poker;
}

// A connection's standing changed (a moderator acted, or it was found
// changed): a ban ends the connection; otherwise the connection keeps the new
// standing, a locked-in player is put in their room, and the page is told.
// `event`: what happened, as the page words it (moderation.EVENT_OF); worked
// out from the change when not given.
function applyStatus(socket, status, event) {
  if (status.ban) {
    socket.emit("moderation-banned", { until: status.ban.until, reason: status.ban.reason });
    socket.disconnect(true);
    return;
  }
  const before = socket.mod;
  socket.mod = status;
  const told = event || moderation.eventBetween(before, status);
  const place = status.confinement && status.confinement.place;
  if (place) {
    sendToPlace(socket, place, told || null);
  } else if (told) {
    socket.emit("moderation-status", { ...moderation.forPlayer(status), event: told });
  }
}

// The connections of one player (a tab each)
function socketsOfPlayer(userId) {
  const id = String(userId);
  const list = [];
  for (const s of io.of("/").sockets.values()) {
    if (s.playerId === id) list.push(s);
  }
  return list;
}

// The record read again for a connection just let in: a moderator's action
// taken while it was being let in did not reach it. If it cannot be read,
// the connection is let go (its page connects again, and is checked again as
// it does): kept on a standing that may be out of date, a player locked in
// or muted in that moment could have walked out, or talked.
async function refreshModeration(socket) {
  try {
    const user = await User.findById(socket.playerId)
      .select("isAdmin isOwner moderation")
      .lean();
    if (!socket.connected) return;
    if (!user) {
      socket.disconnect(true);
      return;
    }
    applyStatus(socket, moderation.statusOf(user));
  } catch (err) {
    console.error("Could not read a player's record again:", err.message);
    socket.disconnect(true);
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

// The passenger list page (public, as it always was): what its cards and the
// passenger's own page show, and nothing else from the account. Built at most
// every 30 s rather than for every visitor.
let passengerListCache = null; // { at, body }
app.get("/api/passengers", async (req, res) => {
  try {
    if (!passengerListCache || Date.now() - passengerListCache.at > 30 * 1000) {
      const users = await User.find({}, "character").lean();
      const list = users
        .map((u) => u.character)
        .filter((c) => c && c.forename)
        .map((c) => ({
          forename: c.forename,
          surname: c.surname,
          avatar: c.avatar,
          birthdate: c.birthdate,
          cabin: c.cabin,
          cabin_number: c.cabin_number,
          bio: c.bio,
        }));
      passengerListCache = { at: Date.now(), body: JSON.stringify(list) };
    }
    res.type("application/json").send(passengerListCache.body);
  } catch (error) {
    console.error("Passenger list error:", error.message);
    res.status(500).json({ error: "Could not load the passenger list" });
  }
});

// The voyage's stage (see voyageStage), for the game page before its scripts
// start: a script, since the page's security policy runs no inline ones
app.get("/api/stage.js", (req, res) => {
  res.set("Cache-Control", "no-store");
  res
    .type("application/javascript")
    .send(`window.RBV_VOYAGE_STAGE = ${JSON.stringify(voyageStage)};`);
});

// The logged-in player's own character. A tab keeps it in sessionStorage,
// which a new tab or a bookmark does not have: the game page then asks here,
// and gets the browser's latest login (or the one named by ?player=, if it is
// logged in on this browser), with its id for the tab to name from then on.
app.get("/api/me", async (req, res) => {
  const named = typeof req.query.player === "string" ? req.query.player : "";
  const players = sessionPlayers(req.session);
  const id = named
    ? players.includes(named) ? named : null
    : req.session && req.session.userId ? String(req.session.userId) : null;
  if (!id) return res.status(401).json({ success: false });
  try {
    const user = await User.findById(id).select("character").lean();
    if (!user || !user.character) return res.status(401).json({ success: false });
    res.json({ success: true, character: user.character, playerId: id });
  } catch (error) {
    console.error("/api/me error:", error.message);
    res.status(500).json({ success: false });
  }
});

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

// How fast each need falls, a second (the game's own rates: modules/stats.js),
// and drink wears off
const NEED_DECAY_PER_SECOND = {
  hunger: 0.005,
  thirst: 0.007,
  energy: 0.003,
  hygiene: 0.002,
  bladder: 0.006,
};
const INTOXICATION_FALL_PER_SECOND = 0.01;

async function populateSocketUserEmail(socket, includeCharacter = false) {
  if (!socket.userEmail && socket.playerId) {
    const selection = includeCharacter ? "email character" : "email";
    const sessionUser = await User.findById(socket.playerId).select(selection);

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

    const decay = (key) => Math.min(100, timeDiffSeconds * NEED_DECAY_PER_SECOND[key]);
    const hungerDecay = decay("hunger");
    const thirstDecay = decay("thirst");
    const energyDecay = decay("energy");
    const hygieneDecay = decay("hygiene");
    const bladderDecay = decay("bladder");
    const intoxicationDecay = Math.max(0, timeDiffSeconds * INTOXICATION_FALL_PER_SECOND);

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
    const values = {
      hunger: need(data.hunger),
      thirst: need(data.thirst),
      energy: need(data.energy),
      hygiene: need(data.hygiene),
      bladder: need(data.bladder),
      intoxication: need(data.intoxication),
    };

    // In hell nothing eases a need, and there is nothing to drink: whatever a
    // page sends (one altered in the browser's own tools could send them all
    // full), none goes above what it has fallen to since it was last kept
    const confinement = socket.mod && socket.mod.confinement;
    if (confinement && confinement.place === "hell") {
      const user = await User.findOne({ email: targetEmail }).select("stats").lean();
      const kept = (user && user.stats) || {};
      const since = kept.lastUpdated ? new Date(kept.lastUpdated).getTime() : Date.now();
      const seconds = Math.max(0, (Date.now() - since) / 1000);
      const rates = { ...NEED_DECAY_PER_SECOND, intoxication: INTOXICATION_FALL_PER_SECOND };
      for (const [key, rate] of Object.entries(rates)) {
        const fallen = Math.max(0, (Number(kept[key]) || 0) - seconds * rate);
        values[key] = Math.min(values[key], fallen);
      }
    }

    await User.findOneAndUpdate(
      { email: targetEmail },
      {
        $set: {
          "stats.hunger": values.hunger,
          "stats.thirst": values.thirst,
          "stats.energy": values.energy,
          "stats.hygiene": values.hygiene,
          "stats.bladder": values.bladder,
          "stats.intoxication": values.intoxication,
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
      guardSocketHandler(event, async (...args) => {
        if (event !== "disconnect") {
          const now = Date.now();
          if (now - floodWindow > 1000) {
            floodWindow = now;
            floodCount = 0;
          }
          if (++floodCount > 40) return undefined;
          // Nothing the connection asks is done before its record has been
          // read again (refreshModeration, below): a lock-in, ban or mute
          // given while it was being let in holds from its first event
          await socket.modReady;
          if (!socket.connected) return undefined;
        }
        return handler(...args);
      }),
    );
  userCount++;
  io.emit("global-user-count", userCount); // Global site-wide count
  console.info(`User count increased: ${userCount}`);

  socket.isGameClient = false;

  // The voyage's start and state, for an immediate sync
  socket.emit("voyage-start-time", voyageStartTime);
  socket.emit("voyage-state", voyageStateMessage());

  // Who this is: their record was read as they connected (io.use above), so
  // it is here before any of their events, a reconnecting page's "join-room"
  // included
  const assignedColor = isChatColor(socket.savedChatColor)
    ? socket.savedChatColor
    : "#c0932b";
  userChatColors[socket.id] = assignedColor;
  handleLoadStats(socket);
  socket.emit("assign-chat-color", assignedColor);
  socket.emit("game-user-count", gameClientCount);

  // The room this connection stands in (set by "join-room", and by the
  // moderators: sendToPlace)
  socket.rbvRoom = null;

  // Their standing with the moderators, for their page; a player locked in
  // stands in their room from the first moment (whatever their page asks)
  socket.emit("moderation-status", moderation.forPlayer(socket.mod));
  if (socket.mod && socket.mod.confinement) {
    sendToPlace(socket, socket.mod.confinement.place);
  }
  // A moderator's action taken while this connection was being let in (after
  // its record was read, before it was among the connections they reach):
  // the record read again, and every event waits for it (onEvent)
  socket.modReady = refreshModeration(socket);

  // Where the story stands (the whole passenger list is no longer sent: the
  // game never used it, and the list page reads /api/passengers)
  if (serverNarrativeIndex > 0 && narrativeEvents[serverNarrativeIndex - 1]) {
    const idx = serverNarrativeIndex - 1;
    socket.emit("narrative-current", {
      index: idx,
      text: narrativeEvents[idx].text,
      time: narrativeEvents[idx].time,
    });
  }

  // The page asks again once its moderation module is listening (an answer
  // sent as it connected can come before that)
  onEvent("request-moderation-status", () => {
    socket.emit("moderation-status", moderation.forPlayer(socket.mod));
  });

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
    if (isAllowedRoom(room)) {
      // Locked in by a moderator: their own room and no other, whatever the
      // page asks (it is told again where they are, and shows it)
      const confinement = socket.mod && socket.mod.confinement;
      if (confinement && room !== confinement.place) {
        console.warn(`Locked-in player asked for ${room}: kept in ${confinement.place}`);
        sendToPlace(socket, confinement.place, "locked");
        return;
      }
      // The padded room and hell take only those locked in there, and the
      // moderators who visit them
      if (!confinement && moderation.isPlace(room) && !(socket.mod && socket.mod.role)) {
        return;
      }

      placeSocket(socket, room);

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
  // Answered (when the client asks for an answer): { ok: true } once the line
  // has gone out, or { ok: false, reason } so the sender is told it did not
  onEvent("chat-message", async (data, ack) => {
    const reply = typeof ack === "function" ? ack : () => {};
    if (!data || typeof data !== "object") return reply({ ok: false, reason: "invalid" });
    const auth = await requireSessionUser(socket);
    if (!auth.ok) {
      socket.emit("auth-error", { message: auth.error });
      return reply({ ok: false, reason: "auth" });
    }

    const roomId = data.room;
    const text = typeof data.message === "string" ? data.message.trim() : "";

    if (!isAllowedRoom(roomId)) {
      console.warn("Message sent to invalid or missing room");
      return reply({ ok: false, reason: "room" });
    }

    // Muted by a moderator: nothing goes out until the time is up
    const mute = moderation.muteNow(socket.mod);
    if (mute) return reply({ ok: false, reason: "muted", until: mute.until });
    // Locked in: lines are said in their own room only; and none is said in
    // the padded room or hell by anyone else but a moderator standing there
    const confinement = socket.mod && socket.mod.confinement;
    if (confinement && roomId !== confinement.place) {
      return reply({ ok: false, reason: "room" });
    }
    if (
      !confinement &&
      moderation.isPlace(roomId) &&
      !(socket.mod && socket.mod.role && socket.rbvRoom === roomId)
    ) {
      return reply({ ok: false, reason: "room" });
    }

    // Every line goes to every player: no more than 6 in 8 seconds from one
    const chatNow = Date.now();
    socket.chatTimes = (socket.chatTimes || []).filter(
      (t) => chatNow - t < 8000,
    );
    if (socket.chatTimes.length >= 6) return reply({ ok: false, reason: "too-fast" });
    socket.chatTimes.push(chatNow);

    if (!text) {
      console.warn("Ignoring empty chat message payload");
      return reply({ ok: false, reason: "empty" });
    }

    if (text.length > 500) {
      console.warn(`Chat message too long from ${socket.id}`);
      return reply({ ok: false, reason: "too-long" });
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
      return reply({ ok: false, reason: "too-long" });
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
    // to every passenger (the chat's "global" view shows every room); only
    // logged-in connections exist, so nobody outside the game reads it
    io.emit("chat-message", outboundMessage);
    reply({ ok: true });
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
    if (typeof room !== "string" || !room || !isAllowedRoom(room)) {
      console.warn("Telegraph order sent to invalid or missing room");
      return;
    }
    // Only from the room one stands in, and not faster than a hand can ring it;
    // never by a player locked in (there is no telegraph in a cell), nor by a
    // muted one (each ring puts a line with their name in everyone's chat)
    if (room !== socket.rbvRoom) return;
    if (socket.mod && socket.mod.confinement) return;
    if (moderation.muteNow(socket.mod)) return;
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
      // The connection's own character (see io.use), never one the client names here
      const sessionUserId = socket.playerId;
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
    if (isAllowedRoom(room)) {
      // A player locked in does not leave their room (not even for none)
      const confinement = socket.mod && socket.mod.confinement;
      if (confinement && room === confinement.place) return;
      socket.leave(room);
      presenceExit(socket, room);
      if (socket.rbvRoom === room) {
        socket.rbvRoom = null;
      }
    }
  });

  onEvent("request-room-users", (roomId) => {
    if (isAllowedRoom(roomId)) {
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
    sendRoomCounts(socket, allowedRooms);
  });

  onEvent("request-room-count", (roomId) => {
    sendRoomCounts(socket, [roomId]);
  });

  onEvent("request-room-counts", (payload) => {
    const roomIds = Array.isArray(payload)
      ? payload
      : Array.isArray(payload?.rooms)
        ? payload.rooms
        : [];
    if (roomIds.length) sendRoomCounts(socket, roomIds);
  });

  // Always answered, an empty room included, so the asker never keeps an old list
  onEvent("request-room-players", (roomId) => {
    if (isAllowedRoom(roomId)) {
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
      // no cards where a locked-in player's room has none (hell)
      if (!cardsAllowed(socket)) {
        socket.emit("poker-error", { message: "There are no cards here." });
        return;
      }
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
      if (!cardsAllowed(socket)) return; // dealt before they were sent to hell
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

      // A player locked in is served their room's fare and nothing else
      // (the padded room: rice and water; hell: nothing)
      const confinement = socket.mod && socket.mod.confinement;
      if (
        confinement &&
        !moderation.PLACES[confinement.place].menu.includes(menuItem.name)
      ) {
        socket.emit("purchase-result", {
          success: false,
          message: "That is not served here.",
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

      if (socket.rbvRoom) {
        // The room hears "has left" only if the player does not come back
        // within the grace period (a phone dropping its connection, a reload)
        presenceExit(socket, socket.rbvRoom, { grace: true });
        console.info(`${socket.id} disconnected from room: ${socket.rbvRoom}`);
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

  const savedStage = await ServerState.findOne({ key: "voyageStage" });
  const stage = process.env.RBV_VOYAGE_STAGE || (savedStage && savedStage.value);
  if (VOYAGE_STAGES.includes(stage)) voyageStage = stage;
  console.info(`Voyage stage: ${voyageStage}`);

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
