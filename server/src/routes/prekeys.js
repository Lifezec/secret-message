const express = require('express');
const router = express.Router();
const db = require('../db');

// Get prekey bundle for a target user
router.get('/bundle/:username', (req, res) => {
  const { username } = req.params;

  const bundle = db.getPreKeyBundle(username);
  if (!bundle) {
    return res.status(404).json({ error: 'User not found' });
  }

  res.json(bundle);
});

// Upload additional one-time prekeys
router.post('/add-otps', (req, res) => {
  const { username, oneTimePreKeys } = req.body;

  if (!username || !Array.isArray(oneTimePreKeys)) {
    return res.status(400).json({ error: 'Invalid parameters' });
  }

  const success = db.addOneTimePreKeys(username, oneTimePreKeys);
  if (!success) {
    return res.status(404).json({ error: 'User not found' });
  }

  res.json({ success: true, message: 'One-time prekeys uploaded successfully' });
});

module.exports = router;
