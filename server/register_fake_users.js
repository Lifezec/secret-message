const { webcrypto } = require('crypto');
const http = require('http');

async function registerFakeUser(username) {
  // Generate ECDH identity keypair
  const identityKeyPair = await webcrypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveKey', 'deriveBits']
  );
  
  // Generate signed prekey
  const signedPreKeyPair = await webcrypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveKey', 'deriveBits']
  );

  const identityPublicJWK = await webcrypto.subtle.exportKey('jwk', identityKeyPair.publicKey);
  const signedPrePublicJWK = await webcrypto.subtle.exportKey('jwk', signedPreKeyPair.publicKey);

  // Generate a mock prekey signature
  const signature = 'mock_signature_' + Math.random().toString(36).substring(2);

  // Generate 5 one-time prekeys
  const oneTimePreKeys = [];
  for (let i = 0; i < 5; i++) {
    const opk = await webcrypto.subtle.generateKey(
      { name: 'ECDH', namedCurve: 'P-256' },
      true,
      ['deriveKey', 'deriveBits']
    );
    const opkJWK = await webcrypto.subtle.exportKey('jwk', opk.publicKey);
    oneTimePreKeys.push(opkJWK);
  }

  // Send API request to running server
  const payload = JSON.stringify({
    username,
    identityKey: identityPublicJWK,
    signedPreKey: signedPrePublicJWK,
    preKeySignature: signature,
    oneTimePreKeys
  });

  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: 'localhost',
      port: 4000,
      path: '/api/register',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': payload.length
      }
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        if (res.statusCode === 200) {
          console.log(`Successfully registered fake user via API: ${username}`);
          resolve();
        } else {
          console.log(`Failed to register ${username}: ${data}`);
          resolve(); // Resolve anyway to continue loop
        }
      });
    });

    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

async function main() {
  const fakeUsers = ['john_doe', 'developer_r6v2', 'admin', 'moderator'];
  for (const user of fakeUsers) {
    await registerFakeUser(user);
  }
}

main().catch(console.error);
