const db = require('../db');

// Map of username -> WebSocket connection
const activeConnections = new Map();

function initWebSocket(wss) {
  wss.on('connection', (ws) => {
    let authenticatedUser = null;

    console.log('New WebSocket connection established');

    ws.on('message', (messageStr) => {
      try {
        const data = JSON.parse(messageStr);

        switch (data.type) {
          case 'auth':
            handleAuth(ws, data);
            break;

          case 'message':
            handleMessage(ws, data);
            break;

          case 'heartbeat':
            ws.send(JSON.stringify({ type: 'heartbeat_ack' }));
            break;

          default:
            ws.send(JSON.stringify({ type: 'error', message: 'Unknown message type' }));
        }
      } catch (err) {
        console.error('Error handling WebSocket message:', err);
        ws.send(JSON.stringify({ type: 'error', message: 'Invalid JSON payload' }));
      }
    });

    ws.on('close', () => {
      if (authenticatedUser) {
        activeConnections.delete(authenticatedUser);
        console.log(`User offline: ${authenticatedUser}`);
      }
    });

    ws.on('error', (err) => {
      console.error(`WebSocket error for ${authenticatedUser || 'unauthenticated user'}:`, err);
    });

    function handleAuth(socket, payload) {
      const { username } = payload;
      if (!username || !db.userExists(username)) {
        socket.send(JSON.stringify({ type: 'auth_response', success: false, error: 'User does not exist or invalid username' }));
        socket.close();
        return;
      }

      authenticatedUser = username;
      activeConnections.set(username, socket);
      console.log(`User online: ${username}`);

      // Confirm authentication
      socket.send(JSON.stringify({ type: 'auth_response', success: true }));

      // Deliver queued offline messages
      const offlineMessages = db.getQueuedMessages(username);
      if (offlineMessages.length > 0) {
        console.log(`Delivering ${offlineMessages.length} offline messages to ${username}`);
        offlineMessages.forEach(msg => {
          socket.send(JSON.stringify({
            type: 'message',
            sender: msg.sender,
            ciphertext: msg.ciphertext,
            msgType: msg.type,
            timestamp: msg.timestamp
          }));
        });
      }
    }

    function handleMessage(socket, payload) {
      if (!authenticatedUser) {
        socket.send(JSON.stringify({ type: 'error', message: 'Unauthorized. Authenticate first.' }));
        return;
      }

      const { recipient, ciphertext, msgType, timestamp } = payload;
      if (!recipient || !ciphertext) {
        socket.send(JSON.stringify({ type: 'error', message: 'Missing recipient or ciphertext' }));
        return;
      }

      const sender = authenticatedUser;
      const recipientSocket = activeConnections.get(recipient);

      if (recipientSocket && recipientSocket.readyState === 1) { // 1 === OPEN
        // Recipient is online, send message immediately
        recipientSocket.send(JSON.stringify({
          type: 'message',
          sender,
          ciphertext,
          msgType: msgType || 'whisper',
          timestamp: timestamp || Date.now()
        }));
        
        // Acknowledge receipt to the sender
        socket.send(JSON.stringify({
          type: 'message_ack',
          recipient,
          timestamp: timestamp || Date.now(),
          status: 'delivered'
        }));
      } else {
        // Recipient is offline, queue the message
        db.queueMessage(recipient, sender, ciphertext, msgType || 'whisper', timestamp || Date.now());
        console.log(`Queued message from ${sender} to offline user ${recipient}`);
        
        // Acknowledge queueing to the sender
        socket.send(JSON.stringify({
          type: 'message_ack',
          recipient,
          timestamp: timestamp || Date.now(),
          status: 'queued'
        }));
      }
    }
  });
}

module.exports = { initWebSocket };
