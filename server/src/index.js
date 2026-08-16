const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');
const path = require('path');
const db = require('./db');
const registerRouter = require('./routes/register');
const prekeysRouter = require('./routes/prekeys');
const { initWebSocket } = require('./ws/relay');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 4000;

// Middleware
app.use(cors());
app.use(express.json());

// Routes
app.use('/api/register', registerRouter);
app.use('/api/prekeys', prekeysRouter);

// File upload / download endpoints
const fs = require('fs');
app.post('/api/files/upload', express.raw({ type: 'application/octet-stream', limit: '50mb' }), (req, res) => {
  try {
    const fileId = Math.random().toString(36).substring(2) + Date.now().toString(36);
    const uploadsDir = path.join(__dirname, '..', 'uploads');
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir);
    }
    const filePath = path.join(uploadsDir, fileId);
    fs.writeFileSync(filePath, req.body);
    console.log(`Uploaded encrypted file: ${fileId}`);
    res.json({ fileId });
  } catch (err) {
    console.error("File upload failed:", err);
    res.status(500).json({ error: 'Upload failed' });
  }
});

app.get('/api/files/download/:id', (req, res) => {
  try {
    const fileId = req.params.id;
    const filePath = path.join(__dirname, '..', 'uploads', fileId);
    if (!fs.existsSync(filePath)) {
      return res.status(404).send('File not found');
    }
    res.sendFile(filePath);
  } catch (err) {
    console.error("File download failed:", err);
    res.status(500).send('Download failed');
  }
});

// Search endpoint to check if user exists
app.get('/api/users/exists/:username', (req, res) => {
  const { username } = req.params;
  const exists = db.userExists(username);
  res.json({ exists });
});

// Endpoint to list all registered users
app.get('/api/users/list', (req, res) => {
  try {
    const users = db.getAllUsers();
    res.json({ users });
  } catch (err) {
    console.error("List users failed:", err);
    res.status(500).json({ error: 'Failed to list users' });
  }
});

// Serve static client build files if they exist
const distPath = path.join(__dirname, '..', '..', 'client', 'dist');
if (fs.existsSync(distPath)) {
  console.log(`Serving static client files from: ${distPath}`);
  app.use(express.static(distPath));
  
  // SPA fallback
  app.get('(.*)', (req, res) => {
    res.sendFile(path.join(distPath, 'index.html'));
  });
} else {
  console.log("Client build directory not found. Static file serving disabled.");
  // Fallback root endpoint
  app.get('/', (req, res) => {
    res.json({ name: 'Secure Messenger Relay Server', status: 'online' });
  });
}

// Initialize WebSocket relay
initWebSocket(wss);

// Start Server
server.listen(PORT, '0.0.0.0', () => {
  console.log(`=========================================`);
  console.log(`Secure Messaging Server running on port ${PORT}`);
  console.log(`WebSocket Server initialized`);
  console.log(`=========================================`);
});
