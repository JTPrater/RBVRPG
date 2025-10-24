// public/game/game.js

// Global initializations at top
const socket = io();
let currentRoom = { name: null };
let isGlobalChat = false;
const chatHistory = {
    global: [],
    rooms: {}
};

// Initialize the open_map audio
const openMapSound = new Audio('../sounds/open_map.mp3');
openMapSound.preload = 'auto';

// Room Definitions
const deckRooms = {
    boat_deck: [
        { 
            id: "gs_bd", // grand_staircase_boat_deck
            name: "Grand Staircase",
            x: 69,
            y: 33,
            type: "grand-staircase",
            location: {
                image: "Grand Staircase.jpg",
                chatRoom: "grand_staircase_bd"
            }
        },
        {
            id: "gym_bd", // gymnasium_boat_deck
            name: "1st Class Gymnasium",
            x: 60,
            y: 60,
            type: "gymnasium",
            location: {
                image: "1st Class Gymnasium.jpg",
                chatRoom: "gymnasium_bd"
            }
        }
    ]
};

// Music Player definition
const musicPlayer = {
    songs: [],
    currentSongIndex: 0,
    audio: new Audio(),
    isPlaying: false,
    
    init() {
        try {
            fetch('/api/get-songs')
                .then(response => {
                    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
                    return response.json();
                })
                .then(songs => {
                    if (Array.isArray(songs)) {
                        this.songs = songs;
                        if (this.songs.length > 0) {
                            this.currentSongIndex = Math.floor(Math.random() * this.songs.length);
                            this.loadCurrentSong();
                        }
                    }
                })
                .catch(error => {
                    console.error('Error loading songs:', error);
                    document.getElementById('current-song').textContent = 'Error loading music';
                });

            this.audio.addEventListener('ended', () => this.playNext());
            
            // Initialize controls
            document.getElementById('play-pause').addEventListener('click', () => this.togglePlay());
            document.getElementById('next-track').addEventListener('click', () => this.playNext());
            document.getElementById('prev-track').addEventListener('click', () => this.playPrev());
            document.getElementById('mute-toggle').addEventListener('click', () => this.toggleMute());
            document.getElementById('volume-slider').addEventListener('input', (e) => this.setVolume(e.target.value));
        } catch (error) {
            console.error('Failed to initialize music player:', error);
        }
    },

    loadCurrentSong() {
        this.audio.src = this.songs[this.currentSongIndex];
        this.updateNowPlaying();
        if (this.isPlaying) this.audio.play();
    },

    togglePlay() {
        if (this.audio.paused) {
            this.audio.play();
            this.isPlaying = true;
        } else {
            this.audio.pause();
            this.isPlaying = false;
        }
        this.updatePlayButton();
    },

    playNext() {
        this.currentSongIndex = (this.currentSongIndex + 1) % this.songs.length;
        this.loadCurrentSong();
    },

    playPrev() {
        this.currentSongIndex = (this.currentSongIndex - 1 + this.songs.length) % this.songs.length;
        this.loadCurrentSong();
    },

    toggleMute() {
        this.audio.muted = !this.audio.muted;
        document.getElementById('mute-toggle').textContent = this.audio.muted ? '🔇' : '🔊';
    },

    setVolume(value) {
        this.audio.volume = value / 100;
    },

    updateNowPlaying() {
        const songName = this.songs[this.currentSongIndex].split('/').pop().replace('.mp3', '');
        document.getElementById('current-song').textContent = `Now Playing: ${songName}`;
    },

    updatePlayButton() {
        document.getElementById('play-pause').textContent = this.isPlaying ? '⏸' : '⏯';
    }
};

// Single DOMContentLoaded event listener
document.addEventListener('DOMContentLoaded', function() {
    // Initialize music player
    musicPlayer.init();
    
    // Initialize chat elements
    const chatInput = document.getElementById('chat-input');
    const sendButton = document.getElementById('send-message');
    const chatContainer = document.getElementById('chat-container');
    const deckplansPopup = document.getElementById('deckplans-popup');

    // Get character data from sessionStorage
    const characterData = JSON.parse(sessionStorage.getItem('character'));
    if (characterData) {
        console.log(`Logged in as: ${characterData.forename} ${characterData.surname}`);
        
        // Update character display
        const avatarElement = document.getElementById('character-avatar');
        const nameElement = document.getElementById('character-name');
        
        // Make sure we're getting the full avatar path
        if (characterData.avatar) {
            console.log('Setting avatar source:', characterData.avatar);
            avatarElement.src = characterData.avatar;
            avatarElement.onerror = () => {
                console.error('Failed to load avatar image:', characterData.avatar);
            };
        } else {
            console.warn('No avatar found in character data');
        }
        
        nameElement.textContent = `${characterData.forename} ${characterData.surname}`;
    } else {
        console.log('No character data found');
    }

    // Add event listeners for chat functionality
    sendButton.addEventListener('click', sendMessage);
    chatInput.addEventListener('keypress', function(e) {
        if (e.key === 'Enter') {
            sendMessage();
        }
    });

    const skyImages = document.querySelectorAll('.sky');
    const imageIntervals = [
        { start: 0, end: 4, className: 'night' },
        { start: 5, end: 6, className: 'ms-0' },
        { start: 7, end: 7, className: 'ms-1' },
        { start: 8, end: 8, className: 'ms-2' },
        { start: 9, end: 9, className: 'ms-3' },
        { start: 10, end: 16, className: 'day' },
        { start: 17, end: 17, className: 'ms-3' },
        { start: 18, end: 18, className: 'ms-2' },
        { start: 19, end: 19, className: 'ms-1' },
        { start: 20, end: 21, className: 'ms-0' },
        { start: 22, end: 23, className: 'night' }
    ];

    function getBSTTime() {
        const now = new Date();
        const fixed = new Date(now);
        fixed.setHours(12, 0, 0); // Set to 12:00:00 PM
        return fixed;
    }

    function updateSkyImage() {
        const bstTime = getBSTTime();
        const hours = bstTime.getHours();

        skyImages.forEach(img => img.style.opacity = 0); // Hide all images

        const interval = imageIntervals.find(interval => hours >= interval.start && hours <= interval.end);
        if (interval) {
            const image = document.querySelector(`.${interval.className}`);
            if (image) {
                image.style.opacity = 1; // Show the appropriate image
            }
        }
    }

    function updateInfoBar() {
        const bstTime = getBSTTime();
        const location = "Southampton";
        const speed = "0 knots";
        const people = "0"; // Update this with the actual number of registered characters
        const date = `${bstTime.getDate()} of ${bstTime.toLocaleString('default', { month: 'long' })}, ${bstTime.getHours()}:${bstTime.getMinutes().toString().padStart(2, '0')}`;

        document.getElementById('location').textContent = `Location: ${location}`;
        document.getElementById('speed').textContent = `Speed: ${speed}`;
        document.getElementById('people').textContent = `People Onboard: ${people}`;
        document.getElementById('date').textContent = `Date: ${date}`;
    }

    updateSkyImage(); // Initial update
    updateInfoBar(); // Initial update
    setInterval(updateSkyImage, 60000); // Update every minute
    setInterval(updateInfoBar, 60000); // Update every minute

    function initClouds() {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        canvas.width = 1920;
        canvas.height = 540;
        
        const cloudContainer = document.querySelector('.cloud-container');
        cloudContainer.appendChild(canvas);
        
        const clouds = [];
        const cloudImages = {
            day: new Image(),
            ms: new Image(),
            night: new Image()
        };
        
        cloudImages.day.src = '../images/animations/clouds/day.png';
        cloudImages.ms.src = '../images/animations/clouds/ms.png';
        cloudImages.night.src = '../images/animations/clouds/night.png';
        
        function spawnCloud() {
            const hours = getBSTTime().getHours();
            let cloudType;
            
            if (hours >= 10 && hours <= 16) cloudType = 'day';
            else if (hours >= 5 && hours <= 9 || hours >= 17 && hours <= 21) cloudType = 'ms';
            else cloudType = 'night';
            
            clouds.push({
                x: canvas.width, // Start from right edge
                y: Math.random() * (canvas.height * 0), // Keep clouds higher in sky
                speed: 0.1 + Math.random() * 0.1,
                image: cloudImages[cloudType]
            });
        }
        
        function animate() {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            
            clouds.forEach((cloud, index) => {
                const scale = 0.8;
                const scaledHeight = cloud.image.height * scale;
                const scaledWidth = cloud.image.width * scale;
                
                ctx.drawImage(
                    cloud.image, 
                    cloud.x, 
                    cloud.y, 
                    scaledWidth,
                    scaledHeight
                );
                
                cloud.x -= cloud.speed;
                
                if (cloud.x + scaledWidth < 0) {
                    clouds.splice(index, 1);
                }
            });
            
            if (Math.random() < 0.0001) spawnCloud();
            requestAnimationFrame(animate);
        }
        
        animate();
    }
    
    // Initialize clouds
    initClouds();

    function initSmoke(canvasId) {
        const canvas = document.getElementById(canvasId);
        const ctx = canvas.getContext('2d');
        const smokeImage = new Image();
        smokeImage.src = '../images/animations/smoke/day.png';

        const smokeParticles = [];
        const spawnPoints = [
            canvas.width / 2 - 5,
            canvas.width / 2 - 2,
            canvas.width / 2,
            canvas.width / 2 + 2,
            canvas.width / 2 + 5
        ];

        const sizeIncreaseRate = 0.2;
        const maxSize = 40;
        let lastTime = 0;

        function spawnSmoke() {
            const spawnX = spawnPoints[Math.floor(Math.random() * spawnPoints.length)];
            smokeParticles.push({
                x: spawnX,
                y: canvas.height,
                speed: 0.3,
                opacity: 0.15 + Math.random() * 0.5,
                size: 15,
                drift: (Math.random() - 0.05) * 0.05
            });
        }

        function animateSmoke(currentTime) {
            if (!lastTime) lastTime = currentTime;
            const deltaTime = (currentTime - lastTime) / 16.67; // normalize to 60fps
            lastTime = currentTime;

            ctx.clearRect(0, 0, canvas.width, canvas.height);

            smokeParticles.forEach((particle, index) => {
                ctx.globalAlpha = particle.opacity;
                ctx.drawImage(smokeImage, particle.x - particle.size / 2, particle.y, particle.size, particle.size);
                
                // Apply delta time to movements
                particle.y -= particle.speed * deltaTime;
                particle.x += particle.drift * deltaTime;
                particle.size += sizeIncreaseRate * deltaTime;

                if (particle.size > maxSize) {
                    particle.size = maxSize;
                }

                if (particle.y + particle.size < 0) {
                    smokeParticles.splice(index, 1);
                }
            });

            requestAnimationFrame(animateSmoke);
        }

        smokeImage.onload = function() {
            requestAnimationFrame(animateSmoke);
            // Use setInterval for consistent particle spawning
            setInterval(spawnSmoke, 100);
        };
    }
    
    // Initialize smoke canvases
    initSmoke('smokeCanvas1');
    initSmoke('smokeCanvas2');
    initSmoke('smokeCanvas3');

    // Loading screen logic
    const loadingScreen = document.getElementById('loading-screen');
    const progressBar = document.querySelector('.progress');
    const startButton = document.getElementById('start-button');
    const gameContainer = document.querySelector('.game-container');
    const whistleSound = new Audio('../sounds/whistle.mp3');

    let progress = 0;
    const loadingInterval = setInterval(() => {
        progress += 10;
        progressBar.style.width = `${progress}%`;

        if (progress >= 100) {
            clearInterval(loadingInterval);
            startButton.style.display = 'block';
        }
    }, 500);

    startButton.addEventListener('click', () => {
        whistleSound.play();
        loadingScreen.style.transition = 'opacity 1s ease';
        loadingScreen.style.opacity = '0';
        setTimeout(() => {
            loadingScreen.style.display = 'none';
            gameContainer.style.display = 'flex';
            // Start music
            if (musicPlayer.songs.length > 0) {
                musicPlayer.isPlaying = true;
                musicPlayer.loadCurrentSong();
                musicPlayer.updatePlayButton();
            }
            // Join Grand Staircase chat
            enterRoom("Grand Staircase");
        }, 1000);
    });
    
    function enterRoom(roomName) {
        const characterData = JSON.parse(sessionStorage.getItem('character'));
        if (!characterData) {
            console.error('No character data found');
            return;
        }
    
        const chatContainer = document.getElementById('chat-container');
        const locationDisplay = document.querySelector('.location-display');
    
        chatContainer.classList.add('fade-out');
        locationDisplay.classList.add('fade-out');
    
        setTimeout(() => {
            if (currentRoom.name) {
                socket.emit('leave-room', { 
                    room: currentRoom.name,
                    character: characterData
                });
            }
    
            // Find room by name to get ID
            const room = deckRooms.boat_deck.find(r => r.name === roomName);
            if (room) {
                currentRoom.name = room.id; // Use room.id instead of roomName
                socket.emit('join-room', { 
                    room: currentRoom.name,
                    character: characterData 
                });
            } else {
                console.error(`Room "${roomName}" not found in deckRooms.`);
                return;
            }
    
            // Initialize room chat history if it doesn't exist using room.id
            if (!chatHistory.rooms[room.id]) { // Changed from roomName to room.id
                chatHistory.rooms[room.id] = [];
            }
    
            // Update location image using room.location.image
            document.querySelector('.location-image').src = `../images/animations/locations/britannic/${room.location.image}`;
            chatContainer.style.display = 'block';
            locationDisplay.style.display = 'block';
    
            // Remove fade-out and add fade-in
            chatContainer.classList.remove('fade-out');
            locationDisplay.classList.remove('fade-out');
            chatContainer.classList.add('fade-in');
            locationDisplay.classList.add('fade-in');
    
            // Add system message to both room and global chat using room.id
            const systemMessage = {
                type: 'system',
                message: `You have entered ${room.name}`,
                room: room.id, // Use room.id instead of roomName
                timestamp: Date.now()
            };
    
            chatHistory.rooms[room.id].push(systemMessage); // Changed from roomName to room.id
            chatHistory.global.push(systemMessage);
    
            // Update chat display
            updateChatDisplay();
        }, 500); // Wait for fade out to complete
    
        setTimeout(() => {
            chatContainer.classList.remove('fade-in');
            locationDisplay.classList.remove('fade-in');
        }, 1000);
    }
    
// When sending a message
function sendMessage() {
    const message = chatInput.value.trim();
    const characterData = JSON.parse(sessionStorage.getItem('character'));
    
    if (message && currentRoom.name && characterData) {
        const messageData = {
            room: currentRoom.name, // room.id
            message,
            character: characterData,
            timestamp: Date.now()
        };
        
        console.log('Sending message:', messageData);
        socket.emit('chat-message', messageData);
        chatInput.value = '';
        // Removed: Directly adding to chat history and updating display
    }
}
    
    // Add function to update chat display
    function updateChatDisplay() {
        const chatMessages = document.getElementById('chat-messages');
        chatMessages.innerHTML = '';
        
        // Show either global or room-specific messages
        const messages = isGlobalChat ? 
            chatHistory.global : 
            chatHistory.rooms[currentRoom.name] || [];
        
        messages.forEach(data => {
            const messageDiv = document.createElement('div');
            messageDiv.className = `chat-message ${data.type || 'user'}`;
            
            if (data.type === 'system') {
                messageDiv.textContent = data.message;
            } else {
                const fullName = `${data.character.forename} ${data.character.surname}`;
                // In global chat, show room name prefix
                if (isGlobalChat) {
                    messageDiv.textContent = `[${data.room}] ${fullName}: ${data.message}`;
                } else {
                    messageDiv.textContent = `${fullName}: ${data.message}`;
                }
            }
            
            chatMessages.appendChild(messageDiv);
        });
    }
    
// Add a toggle for global chat
function toggleGlobalChat() {
    isGlobalChat = !isGlobalChat;
    updateChatDisplay();
    const systemMessage = {
        type: 'system',
        message: `Switched to ${isGlobalChat ? 'global' : currentRoom.name} chat`, // currentRoom.name is room.id
        room: currentRoom.name, // room.id
        timestamp: Date.now()
    };
    addChatMessage(systemMessage);
}
    
    // Add HTML button for global chat toggle
    document.addEventListener('DOMContentLoaded', function() {
        // Add global chat toggle button
        const chatContainer = document.getElementById('chat-container');
        const toggleButton = document.createElement('button');
        toggleButton.id = 'toggle-global-chat';
        toggleButton.textContent = 'Toggle Global Chat';
        toggleButton.style.position = 'absolute';
        toggleButton.style.top = '5px';
        toggleButton.style.right = '5px';
        toggleButton.addEventListener('click', toggleGlobalChat);
        chatContainer.appendChild(toggleButton);
    });
    
// Socket event listeners
socket.on('chat-message', (data) => {
    console.log('📥 Received message:', data);
    if (!chatHistory.rooms[data.room]) {
        chatHistory.rooms[data.room] = [];
    }
    chatHistory.rooms[data.room].push(data);
    chatHistory.global.push(data);

    // Update display if we're in the relevant room or global chat
    if (isGlobalChat || currentRoom.name === data.room) {
        updateChatDisplay();
    }
});

socket.on('user-joined', (data) => {
    console.log('📢 User joined:', data);
    addChatMessage({
        type: 'system',
        message: `${data.character.forename} has entered the room`,
        room: currentRoom.name, // room.id
        timestamp: Date.now()
    });
});

socket.on('user-left', (data) => {
    console.log('📢 User left:', data);
    addChatMessage({
        type: 'system',
        message: `${data.character.forename} has left the room`,
        room: currentRoom.name, // room.id
        timestamp: Date.now()
    });
});
    
    function addChatMessage(data) {
        console.log('Adding message to chat:', data);
        const messageDiv = document.createElement('div');
        messageDiv.className = `chat-message ${data.type || 'user'}`;

        // Assign a data attribute for the user ID if applicable
        if (data.type !== 'system') {
            messageDiv.setAttribute('data-user-id', data.userId); // Ensure data.userId is sent from the server
        }

        if (data.type === 'system') {
            messageDiv.textContent = data.message;
        } else {
            // Combine forename and surname
            const fullName = `${data.character.forename} ${data.character.surname}`;
            // In global chat, show room name prefix
            if (isGlobalChat) {
                messageDiv.textContent = `[${data.room}] ${fullName}: ${data.message}`;
            } else {
                messageDiv.textContent = `${fullName}: ${data.message}`;
            }

            // Apply user's chat color
            const userColor = data.color || '#c0932b'; // Fallback color
            messageDiv.style.color = userColor;
        }

        const chatMessages = document.getElementById('chat-messages');
        if (!chatMessages) {
            console.error('Chat messages container not found');
            return;
        }

        chatMessages.appendChild(messageDiv);
        chatMessages.scrollTop = chatMessages.scrollHeight; 

        // Log for debugging
        console.log('Message added:', data);
    }

    // Show settings popup when settings button is clicked
    document.querySelector('.panel1-buttons button:first-child').addEventListener('click', () => {
        document.getElementById('settings-popup').style.display = 'block';
    });
    
    // Close settings popup when close button is clicked
    document.querySelector('.close-settings').addEventListener('click', () => {
        document.getElementById('settings-popup').style.display = 'none';
    });

    // Add Deckplans button functionality
    const deckplansBtn = document.getElementById('deckplans-btn');
    const closeDeckplansBtn = document.querySelector('.close-deckplans');

    deckplansBtn.addEventListener('click', () => {
        deckplansPopup.style.display = 'block';
        openMapSound.currentTime = 0; // Reset to start
        openMapSound.play();
    });

    closeDeckplansBtn.addEventListener('click', () => {
        deckplansPopup.style.display = 'none';
    });

    closeDeckplansBtn.addEventListener('click', () => {
        openMapSound.pause();
    });

    window.addEventListener('click', (event) => {
        if (event.target === deckplansPopup) {
            deckplansPopup.style.display = 'none';
        }
    });

    // Deck plan functionality
    const deckButtons = document.querySelectorAll('.deck-btn');
    const currentDeckImage = document.getElementById('current-deck');
    const roomMarkers = document.getElementById('room-markers');

    deckButtons.forEach(button => {
        button.addEventListener('click', () => {
            const deck = button.getAttribute('data-deck');
            // Load the corresponding deck plan image
            currentDeckImage.src = `../images/decks/${deck}.jpg`;
            
            // Clear existing room markers
            roomMarkers.innerHTML = '';
            
            // Add room markers if they exist for this deck
            if (deckRooms[deck]) {
                deckRooms[deck].forEach(room => {
                    const marker = document.createElement('div');
                    marker.className = `room-marker ${room.type}`;
                    marker.style.left = `${room.x}%`;
                    marker.style.top = `${room.y}%`;
                    marker.addEventListener('click', () => enterRoom(room.name));
                    roomMarkers.appendChild(marker);
                });
            }
        });
    });

    // Trigger click on Boat Deck button to show initial deck plan
    document.querySelector('[data-deck="boat_deck"]').click();

    const chatColorPicker = document.getElementById('chat-color-picker');

    // Listen for color changes
    chatColorPicker.addEventListener('input', (e) => {
        const selectedColor = e.target.value;
        // Emit the color change to the server
        socket.emit('change-chat-color', selectedColor);
        // Update local CSS variable for immediate feedback
        document.documentElement.style.setProperty('--user-chat-color', selectedColor);
    });

    // Listen for initial color assignment from the server
    socket.on('assign-chat-color', (color) => {
        document.documentElement.style.setProperty('--user-chat-color', color);
        chatColorPicker.value = color;
    });

    // Listen for other users' color changes
    socket.on('update-chat-color', ({ userId, color }) => {
        // Assuming you have a way to associate userId with their messages
        // This implementation may vary based on your existing codebase
        const userMessages = document.querySelectorAll(`.chat-message[data-user-id="${userId}"]`);
        userMessages.forEach(msg => {
            msg.style.color = color;
        });
    });
});