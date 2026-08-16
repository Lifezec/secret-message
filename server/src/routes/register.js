const express = require('express');
const router = express.Router();
const db = require('../db');

router.post('/', (req, res) => {
  const { username, identityKey, signedPreKey, preKeySignature, oneTimePreKeys } = req.body;

  if (!username || !identityKey || !signedPreKey || !preKeySignature) {
    return res.status(400).json({ error: 'Missing required registration parameters' });
  }

  // Allow registration only if user doesn't exist
  if (db.userExists(username)) {
    return res.status(400).json({ error: 'Username already taken' });
  }

  db.registerUser(username, identityKey, signedPreKey, preKeySignature, oneTimePreKeys);
  console.log(`Registered user: ${username}`);
  
  res.json({ success: true, message: 'User registered successfully' });
});

module.exports = router;
