const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'database.json');

class Database {
  constructor() {
    this.data = {
      users: {}, // username -> { identityKey, signedPreKey, preKeySignature, oneTimePreKeys: [] }
      messageQueue: [] // array of { recipient, sender, ciphertext, type, timestamp }
    };
    this.init();
  }

  init() {
    try {
      if (fs.existsSync(DB_PATH)) {
        const fileContent = fs.readFileSync(DB_PATH, 'utf8');
        this.data = JSON.parse(fileContent);
      } else {
        this.save();
      }
    } catch (error) {
      console.error("Database initialization failed, using empty data:", error);
    }
  }

  save() {
    try {
      fs.writeFileSync(DB_PATH, JSON.stringify(this.data, null, 2), 'utf8');
    } catch (error) {
      console.error("Database save failed:", error);
    }
  }

  userExists(username) {
    return !!this.data.users[username];
  }

  registerUser(username, identityKey, signedPreKey, preKeySignature, oneTimePreKeys) {
    this.data.users[username] = {
      identityKey,
      signedPreKey,
      preKeySignature,
      oneTimePreKeys: oneTimePreKeys || []
    };
    this.save();
  }

  getPreKeyBundle(username) {
    const user = this.data.users[username];
    if (!user) return null;

    // Pop one oneTimePreKey
    let oneTimePreKey = null;
    if (user.oneTimePreKeys && user.oneTimePreKeys.length > 0) {
      oneTimePreKey = user.oneTimePreKeys.shift();
      this.save();
    }

    return {
      identityKey: user.identityKey,
      signedPreKey: user.signedPreKey,
      preKeySignature: user.preKeySignature,
      oneTimePreKey: oneTimePreKey
    };
  }

  addOneTimePreKeys(username, prekeys) {
    const user = this.data.users[username];
    if (user) {
      user.oneTimePreKeys = (user.oneTimePreKeys || []).concat(prekeys);
      this.save();
      return true;
    }
    return false;
  }

  queueMessage(recipient, sender, ciphertext, type, timestamp) {
    this.data.messageQueue.push({
      recipient,
      sender,
      ciphertext,
      type,
      timestamp
    });
    this.save();
  }

  getQueuedMessages(username) {
    const messages = this.data.messageQueue.filter(msg => msg.recipient === username);
    // Remove retrieved messages from queue
    this.data.messageQueue = this.data.messageQueue.filter(msg => msg.recipient !== username);
    this.save();
    return messages;
  }

  getAllUsers() {
    return Object.keys(this.data.users);
  }
}

module.exports = new Database();
