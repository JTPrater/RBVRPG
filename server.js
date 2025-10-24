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

// Initialize Express and Server
const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Global voyage start time (set when server starts)
const voyageStartTime = Date.now();

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

// Multer Configuration
const storage = multer.diskStorage({
  destination: "./public/uploads/",
  filename: (req, file, cb) => {
    cb(null, `avatar-${Date.now()}${path.extname(file.originalname)}`);
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

app.use(express.static(path.join(__dirname, "public")));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(
  session({
    secret: "secret-key",
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false }, // Set to true if using HTTPS
  })
);

// API Routes
app.post("/api/register", upload.single("avatar"), async (req, res) => {
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
        avatar: `/uploads/${req.file.filename}`,
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
});

app.post("/api/check-credentials", async (req, res) => {
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
    A3: { capacity: 3, occupied: 0 },
    A1: { capacity: 2, occupied: 0 },
    A2: { capacity: 2, occupied: 0 },
    A4: { capacity: 3, occupied: 0 },
  },
  "1st_men": {
    A9: { capacity: 1, occupied: 0 },
    A7: { capacity: 1, occupied: 0 },
    A5: { capacity: 1, occupied: 0 },
    A6: { capacity: 1, occupied: 0 },
    A8: { capacity: 1, occupied: 0 },
    A10: { capacity: 1, occupied: 0 },
  },
  // Placeholder for other types (extend as needed)
  "1st_women": {},
  "2nd_class_cabins": {},
  "2nd_men": {},
  "2nd_women": {},
  "3rd_class_cabins": {},
  "3rd_men": {},
  "3rd_women": {},
  crew_berths: {},
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
  socket.on("join-room", (data) => {
    const { room, character } = data;
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

      // Broadcast the message to all clients in the specified room except the sender
      socket.to(data.room).emit("chat-message", data);
      console.log(
        `📤 Broadcasted message from ${socket.id} to room: ${data.room}`
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
