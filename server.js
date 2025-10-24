// Imports
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const bodyParser = require('body-parser');
const bcrypt = require('bcrypt');
const session = require('express-session');
const mongoose = require('mongoose');

// Initialize Express and Server
const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// MongoDB Configuration
const initMongoDB = async () => {
    try {
        await mongoose.connect('mongodb://127.0.0.1:27017/britannic', {
            useNewUrlParser: true,
            useUnifiedTopology: true,
            serverSelectionTimeoutMS: 5000,
            family: 4
        });
        console.log('✅ MongoDB connected successfully');
    } catch (err) {
        console.error('❌ MongoDB connection error:', err);
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
        bio: String,
        avatar: String
    }
});

const User = mongoose.model('User', UserSchema);

// Multer Configuration
const storage = multer.diskStorage({
    destination: './public/uploads/',
    filename: (req, file, cb) => {
        cb(null, `avatar-${Date.now()}${path.extname(file.originalname)}`);
    }
});

const upload = multer({ 
    storage,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
    fileFilter: (req, file, cb) => {
        const allowedTypes = ['image/jpeg', 'image/png', 'image/gif'];
        if (!allowedTypes.includes(file.mimetype)) {
            cb(new Error('Invalid file type'), false);
            return;
        }
        cb(null, true);
    }
});

// Middleware Setup
app.use(express.static(path.join(__dirname, 'public')));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(session({ 
    secret: 'secret-key', 
    resave: false, 
    saveUninitialized: true,
    cookie: { secure: false } // Set to true if using HTTPS
}));

// API Routes
app.post('/api/register', upload.single('avatar'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ 
                success: false, 
                error: 'No avatar file uploaded' 
            });
        }

        const existingUser = await User.findOne({ email: req.body.email });
        if (existingUser) {
            return res.status(400).json({ 
                success: false, 
                error: 'Email already registered' 
            });
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
                cabin: req.body.cabin,
                bio: req.body.bio
            }
        });

        await newUser.save();
        io.emit('new-passenger', newUser.character);
        res.json({ success: true, passenger: newUser.character });
    } catch (error) {
        console.error('Registration error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/check-credentials', async (req, res) => {
    try {
        const { email, password } = req.body;
        const user = await User.findOne({ email });
        
        if (!user || !(await bcrypt.compare(password, user.password))) {
            return res.json({ success: false });
        }

        req.session.userId = user._id;
        res.json({ 
            success: true, 
            character: {
                forename: user.character.forename,
                surname: user.character.surname,
                avatar: user.character.avatar // Add this line
            }
        });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/api/get-songs', async (req, res) => {
    try {
        const musicDir = path.join(__dirname, 'public/sounds/music');
        await fs.access(musicDir);
        
        const files = await fs.readdir(musicDir);
        const songs = files
            .filter(file => file.toLowerCase().endsWith('.mp3'))
            .map(file => `/sounds/music/${file}`);

        if (songs.length === 0) {
            return res.status(404).json({ error: 'No MP3 files found' });
        }

        res.json(songs);
    } catch (err) {
        console.error('Error reading music directory:', err);
        res.status(500).json({
            error: 'Failed to load music files',
            details: err.message
        });
    }
});

// Page Routes
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public/main/registration.html'));
});

app.get('/game', (req, res) => {
    res.sendFile(path.join(__dirname, 'public/game/game.html'));
});

app.get('/list', (req, res) => {
    res.sendFile(path.join(__dirname, 'public/main/list.html'));
});

// At the top of server.js, maintain a user-color mapping
const userChatColors = {};

// Initialize user count
let userCount = 0;

// Socket.IO Setup
io.on('connection', (socket) => {
    console.log('👤 Client connected:', socket.id);
    userCount++;
    
    // Emit the updated user count to all clients
    io.emit('update-user-count', userCount);
    
    // Assign a default color or retrieve from a database
    const defaultColor = '#ffffff'; // Default chat color
    userChatColors[socket.id] = defaultColor;

    // Send the assigned color to the connected client
    socket.emit('assign-chat-color', defaultColor);

    // Send existing passengers to new connections
    User.find({}, 'character')
        .then(users => {
            const passengers = users.map(user => user.character);
            console.log('Sending initial passengers:', passengers);
            socket.emit('initial-passengers', passengers);
        })
        .catch(err => {
            console.error('Error fetching passengers:', err);
        });

    let currentRoom = null;
    let currentCharacter = null;

    socket.on('join-room', (data) => {
        if (currentRoom) {
            socket.leave(currentRoom);
            // Notify others that the user has left
            socket.to(currentRoom).emit('user-left', { character: currentCharacter });
            console.log(`🔗 Socket left room: ${currentRoom}`);
        }
        currentRoom = data.room; // room.id
        currentCharacter = data.character;
        socket.join(currentRoom);
        console.log(`🔗 Socket joined room: ${currentRoom}`);
        // Notify others that a new user has joined
        socket.to(currentRoom).emit('user-joined', { character: currentCharacter });
    });

    socket.on('chat-message', (msg) => {
        const userColor = userChatColors[socket.id] || '#c0932b'; // Fallback color
        const messageData = {
            type: 'user',
            message: msg,
            userId: socket.id,
            color: userColor,
            timestamp: Date.now()
        };
        // Broadcast the message to all clients
        io.emit('chat-message', messageData);
    });

    // Listen for chat color changes from the client
    socket.on('change-chat-color', (newColor) => {
        userChatColors[socket.id] = newColor;
        // Broadcast the color change to all other clients
        socket.broadcast.emit('update-chat-color', {
            userId: socket.id,
            color: newColor
        });
    });

    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
        userCount--;
        
        // Emit the updated user count to all clients
        io.emit('update-user-count', userCount);

        if (currentRoom && currentCharacter) {
            // Notify others in the room that the user has left
            socket.to(currentRoom).emit('user-left', { character: currentCharacter });
            console.log(`👤 Client disconnected from room: ${currentRoom}`);
        }
        console.log('👤 Client disconnected');
        delete userChatColors[socket.id];
    });
});

// Initialize Server
const startServer = async () => {
    await initMongoDB();
    const PORT = process.env.PORT || 3000;
    server.listen(PORT, () => {
        console.log(`🚀 Server running on port ${PORT}`);
    });
};

// Error Handling
process.on('unhandledRejection', (err) => {
    console.error('Unhandled Promise Rejection:', err);
    process.exit(1);
});

startServer();