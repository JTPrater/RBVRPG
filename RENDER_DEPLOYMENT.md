# RBVRPG Deployment Guide

## Render Deployment

### Prerequisites

- Render account
- MongoDB Atlas database
- Discord webhook URL (optional, for reporting)

### Environment Variables (Set in Render Dashboard)

Required:

```
MONGO_URL=mongodb+srv://your-connection-string
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/your-webhook-url
SESSION_SECRET=your-secure-random-session-secret
ADMIN_EMAIL=your-admin-email@example.com
ADMIN_ONLY_MODE=true
ALLOWED_ORIGINS=https://your-render-app.onrender.com
```

Optional:

```
PORT=10000 (Render sets this automatically)
```

### Deployment Steps

1. **Connect Repository**

   - Connect your GitHub repository to Render
   - Select "Web Service"

2. **Configure Build Settings**

   - **Runtime**: Node
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`

3. **Set Environment Variables**

   - Add all required environment variables in Render dashboard

4. **Deploy**
   - Render will automatically build and deploy your app
   - Health check endpoint: `https://your-app.onrender.com/health`

### Admin Setup

After deployment:

1. Register your admin account at `https://your-app.onrender.com`
2. Run the admin setup locally or create a temporary endpoint to grant admin privileges
3. Set `ADMIN_ONLY_MODE=false` when ready to open gameplay to all users

### Features Working on Render

✅ WebSocket connections (Socket.IO)
✅ File uploads (multer)
✅ Static file serving
✅ Database connections (MongoDB Atlas)
✅ Session management
✅ Rate limiting
✅ CORS configuration
✅ Health checks

### Troubleshooting

- **WebSocket Issues**: Check that `ALLOWED_ORIGINS` includes your Render domain
- **Database Connection**: Ensure MongoDB Atlas allows connections from Render's IP ranges (0.0.0.0/0)
- **File Uploads**: Render's file system is ephemeral - uploaded files may be lost on redeploy
- **Session Issues**: Ensure `SESSION_SECRET` is set and secure
