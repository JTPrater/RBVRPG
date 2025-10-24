const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');

async function clearAllData() {
    try {
        // Wait for connection
        await mongoose.connect('mongodb://127.0.0.1:27017/britannic');
        console.log('✅ Connected to MongoDB');

        // Now clear the users collection
        const result = await mongoose.connection.db.collection('users').deleteMany({});
        console.log(`✅ Cleared ${result.deletedCount} users`);
    } catch (err) {
        console.error('❌ Error:', err);
    }
}

function clearUploads() {
    const uploadsDir = path.join(__dirname, 'public', 'uploads');
    fs.readdir(uploadsDir, (err, files) => {
        if (err) return console.error('❌ Error reading uploads:', err);
        
        files.forEach(file => {
            if (file !== '.gitkeep') {
                fs.unlink(path.join(uploadsDir, file), err => {
                    if (err) console.error(`❌ Error deleting ${file}:`, err);
                    else console.log(`✅ Deleted: ${file}`);
                });
            }
        });
    });
}

async function cleanup() {
    console.log('🧹 Starting cleanup...');
    await clearAllData();
    clearUploads();
    setTimeout(() => {
        mongoose.disconnect();
        console.log('✨ Done!');
    }, 1000);
}

cleanup().catch(console.error);