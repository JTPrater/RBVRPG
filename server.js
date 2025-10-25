// Imports
require("dotenv").config();
const express = require("express");
const http = require("http");
const socketIo = require("socket.io");
const multer = require("multer");
const path = require("path");
const fs = require("fs").promises;
const bodyParser = require("body-parser");
const bcrypt = require("bcrypt");
const session = require("express-session");
const mongoose = require("mongoose");
const rateLimit = require("express-rate-limit");
const cors = require("cors");
const cloudinary = require("cloudinary").v2;
const { CloudinaryStorage } = require("multer-storage-cloudinary");

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

// Global voyage start time (set when server starts)
const voyageStartTime = Date.now();

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

  console.log("✅ Environment variables validated");
}

// Cloudinary Configuration
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

console.log("✅ Cloudinary configured");

// MongoDB Configuration
const initMongoDB = async () => {
  try {
    // Use Atlas connection string from environment variable
    const uri = process.env.MONGO_URL;

    await mongoose.connect(uri);
    console.log("✅ MongoDB connected successfully");
  } catch (err) {
    console.error("❌ MongoDB connection error:", err);
    process.exit(1);
  }
};

// User Schema
const UserSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  character: {
    forename: { type: String, required: true },
    surname: { type: String, required: true },
    birthdate: { type: Date, required: true },
    cabin: { type: String, required: true },
    cabin_number: { type: String, required: true }, // Add this line
    bio: String,
    avatar: String,
  },
});

const User = mongoose.model("User", UserSchema);

// Multer Configuration with Cloudinary
const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: "rbvrpg-avatars",
    allowed_formats: ["jpg", "jpeg", "png", "gif"],
    transformation: [{ width: 200, height: 200, crop: "fill" }], // Resize to 200x200
    public_id: (req, file) =>
      `avatar-${Date.now()}-${Math.random().toString(36).substring(2, 15)}`,
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter: (req, file, cb) => {
    const allowedTypes = ["image/jpeg", "image/png", "image/gif"];
    if (!allowedTypes.includes(file.mimetype)) {
      cb(new Error("Invalid file type"), false);
      return;
    }
    cb(null, true);
  },
});

// Middleware Setup
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
app.use(
  session({
    secret: process.env.SESSION_SECRET || "change-this-in-production",
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false }, // Set to true if using HTTPS
  })
);

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: "Too many requests from this IP, please try again later.",
  standardHeaders: true,
  legacyHeaders: false,
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // limit each IP to 5 auth attempts per windowMs
  message: "Too many authentication attempts, please try again later.",
  standardHeaders: true,
  legacyHeaders: false,
});

app.use(limiter); // Apply general rate limiting to all routes

// Health check endpoint
app.get("/health", (req, res) => {
  res.status(200).json({
    status: "healthy",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    mongodb:
      mongoose.connection.readyState === 1 ? "connected" : "disconnected",
  });
});

// API Routes
app.post(
  "/api/register",
  authLimiter,
  upload.single("avatar"),
  async (req, res) => {
    try {
      if (!req.file) {
        return res
          .status(400)
          .json({ success: false, error: "No avatar file uploaded" });
      }

      const existingUser = await User.findOne({ email: req.body.email });
      if (existingUser) {
        return res
          .status(400)
          .json({ success: false, error: "Email already registered" });
      }

      const cabinType = req.body.cabin;
      const cabinNumber = req.body.cabin_number;
      if (!cabins[cabinType] || !cabins[cabinType][cabinNumber]) {
        return res
          .status(400)
          .json({ success: false, error: "Invalid cabin selected" });
      }
      if (
        cabins[cabinType][cabinNumber].occupied >=
        cabins[cabinType][cabinNumber].capacity
      ) {
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
      console.log(
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
      console.log(`❌ Login failed for email: ${email}`);
      return res.json({ success: false });
    }

    req.session.userId = user._id;
    console.log(`✅ User logged in: ${email}`);
    res.json({
      success: true,
      character: user.character, // Return the full character object
    });
  } catch (error) {
    console.error("❌ Login error:", error);
    res.status(500).json({ success: false, error: error.message });
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
      console.log("❌ No MP3 files found in music directory");
      return res.status(404).json({ error: "No MP3 files found" });
    }

    console.log(`✅ Retrieved ${songs.length} songs from music directory`);
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

    console.log(
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

// At the top of server.js, add a room tracking object
const roomCounts = {};
allowedRooms.forEach((room) => (roomCounts[room] = 0));

// Add this function at the top level of server.js
function emitRoomCount(roomId) {
  const roomSize = io.sockets.adapter.rooms.get(roomId)?.size || 0;
  roomCounts[roomId] = roomSize;
  console.log(`📊 Room ${roomId} has ${roomSize} user(s)`);
  // Emit to all connected clients, not just room members
  io.emit("room-count", {
    roomId: roomId,
    count: roomSize,
  });
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
  },
  "2nd_class_cabins": {},
  "3rd_class_cabins": {},
  "crew_berths": {},
};

app.get("/api/get_available_cabins", (req, res) => {
  const cabinType = req.query.cabin_type;
  if (!cabins[cabinType]) {
    return res.status(400).json({ error: "Invalid cabin type" });
  }
  const availableCabins = Object.entries(cabins[cabinType])
    .filter(([_, cabin]) => cabin.occupied < cabin.capacity)
    .map(([cabinNumber]) => cabinNumber);
  res.json(availableCabins);
});

// Socket.IO Setup
io.on("connection", (socket) => {
  console.log(`🔌 New connection: ${socket.id}`);
  userCount++;
  io.emit("global-user-count", userCount); // Global site-wide count
  console.log(`👥 User count increased: ${userCount}`);

  socket.isGameClient = false;

  // Send voyage start time to client for synchronization
  socket.emit("voyage-start-time", voyageStartTime);
  console.log(`⏰ Sent voyage start time to ${socket.id}: ${voyageStartTime}`);

  // Assign a default color or retrieve from a database
  const defaultColor = "#ffffff"; // Default chat color
  userChatColors[socket.id] = defaultColor;
  console.log(`🎨 Assigned default color to ${socket.id}: ${defaultColor}`);

  // Send the assigned color to the connected client
  socket.emit("assign-chat-color", defaultColor);
  socket.emit("game-user-count", gameClientCount);
  console.log(`📩 Sent assigned chat color to ${socket.id}`);

  // Send existing passengers to new connections
  User.find({}, "character")
    .then((users) => {
      const passengers = users.map((user) => user.character);
      console.log("🗂️ Sending initial passengers:", passengers);
      socket.emit("initial-passengers", passengers);
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

    // Check admin-only mode
    const adminOnlyMode = process.env.ADMIN_ONLY_MODE === "true";
    if (adminOnlyMode) {
      // Get user from session to check admin status
      const sessionId = socket.handshake.sessionID;
      const sessionStore = app.get("sessionStore") || session.store;

      // For simplicity, we'll check if the user's email matches the admin email
      // In a production app, you'd want to store user ID in session and look up properly
      const adminEmail = process.env.ADMIN_EMAIL;
      if (!adminEmail) {
        console.error("❌ ADMIN_EMAIL not set in environment variables");
        socket.emit("join-error", { message: "Server configuration error" });
        return;
      }

      // Check if this user is the admin by comparing email
      // This is a simplified approach - in production you'd store user ID in session
      try {
        const user = await User.findOne({ email: adminEmail });
        if (!user || !user.isAdmin) {
          console.log(`🚫 Non-admin user attempted to join game room: ${room}`);
          socket.emit("join-error", {
            message:
              "Game access is currently restricted to administrators only. Registration is open but gameplay is limited.",
          });
          return;
        }
      } catch (error) {
        console.error("❌ Error checking admin status:", error);
        socket.emit("join-error", {
          message: "Server error during authentication",
        });
        return;
      }
    }

    if (!socket.isGameClient) {
      socket.isGameClient = true;
      gameClientCount++;
      io.emit("game-user-count", gameClientCount);
      console.log(`🎮 Game client count increased: ${gameClientCount}`);
    }
    if (allowedRooms.includes(room)) {
      socket.join(room);
      socket.character = character; // Store character data on socket
      socket
        .to(room)
        .emit("user-joined", { character, socketId: socket.id, roomId: room });
      emitRoomCount(room);
      console.log(`✅ Admin user joined room: ${room}`);
    }
  });

  // Handle 'chat-message' event (corrected)
  socket.on("chat-message", (data) => {
    if (data.character && data.character.forename && data.character.surname) {
      // Validate room
      if (!allowedRooms.includes(data.room)) {
        console.warn(`⚠️ Message sent to invalid room: ${data.room}`);
        return;
      }

      // Broadcast the message to all clients globally
      io.emit("chat-message", data);
      console.log(
        `📤 Broadcasted message from ${socket.id} to all clients from room: ${data.room}`
      );
    } else {
      console.warn("⚠️ Received chat message without character data:", data);
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
        console.log(`📤 Sent user list for ${roomId} to ${socket.id}`);
      } else {
        socket.emit("room-users", { roomId, users: [] });
        console.log(`📤 Sent empty user list for ${roomId} to ${socket.id}`);
      }
    }
  });

  socket.on("request-all-room-counts", () => {
    allowedRooms.forEach((roomId) => {
      emitRoomCount(roomId);
    });
    console.log(`📊 Sent room counts for all rooms to ${socket.id}`);
  });

  socket.on("request-room-count", (roomId) => {
    if (allowedRooms.includes(roomId)) {
      emitRoomCount(roomId);
      console.log(`📊 Sent room count for ${roomId} to ${socket.id}`);
    }
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
                  cabin: userSocket.character.cabin,
                }
              : null;
          })
          .filter(Boolean);

        socket.emit("room-players", { roomId, players });
        console.log(`👥 Sent player list for ${roomId} to ${socket.id}`);
      }
    }
  });
  socket.on("disconnect", () => {
    console.log(`👤 User disconnected: ${socket.id}`);
    try {
      console.log("👤 User disconnected:", socket.id);
      userCount--; // Keep this decrement
      console.log(`👥 User count decremented: ${userCount}`);

      // Emit the updated user count to all clients
      io.emit("global-user-count", userCount); // Use this event consistently
      console.log(
        "📣 Emitted updated user count to all clients after disconnect"
      );

      if (socket.isGameClient) {
        gameClientCount = Math.max(0, gameClientCount - 1);
        io.emit("game-user-count", gameClientCount);
        console.log(`🎮 Game client count decremented: ${gameClientCount}`);
      }

      if (currentRoom && currentCharacter) {
        // Notify others in the room that the user has left
        socket.to(currentRoom).emit("user-left", {
          character: currentCharacter,
          socketId: socket.id,
          roomId: currentRoom,
        });
        console.log(`🔒 ${socket.id} disconnected from room: ${currentRoom}`);

        // Emit the updated room count to all clients in the room
        const roomSizeAfterDisconnect =
          io.sockets.adapter.rooms.get(currentRoom)?.size || 0;
        io.to(currentRoom).emit("room-count", {
          roomId: currentRoom,
          count: roomSizeAfterDisconnect,
        });
        console.log(
          `📊 Emitted updated room count for ${currentRoom}: ${roomSizeAfterDisconnect}`
        );
      }

      // Remove the user's character data
      if (users[socket.id]) {
        delete users[socket.id];
        console.log(`🗑️ Removed character data for ${socket.id}`);
      }

      console.log("👤 Client disconnected");
      delete userChatColors[socket.id];
      console.log(`🗑️ Deleted chat color for ${socket.id}`);
    } catch (error) {
      console.error(`❌ Error during disconnect: ${error.message}`);
    }
  });
});

// Initialize Server
const startServer = async () => {
  console.log("🚀 Initializing server...");
  validateEnvironment();
  console.log("🚀 Initializing MongoDB...");
  await initMongoDB();
  const PORT = process.env.PORT || 3000;
  server.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
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

    console.log("✉️ Sending message:", messageData);
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
