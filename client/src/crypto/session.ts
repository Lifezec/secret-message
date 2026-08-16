import { sha256 } from '@noble/hashes/sha2.js';
import { 
  deriveDHBits, 
  importPublicKeyJWK, 
  exportPublicKeyJWK
} from './identity';

// Convert hex string to Uint8Array
function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

// Convert Uint8Array to hex string
function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

// Simple KDF using SHA-256
function kdf(inputBytes: Uint8Array, salt: string): Uint8Array {
  const saltBytes = new TextEncoder().encode(salt);
  const combined = new Uint8Array(inputBytes.length + saltBytes.length);
  combined.set(inputBytes);
  combined.set(saltBytes, inputBytes.length);
  return sha256(combined);
}

// Symmetric ratchet step: derives next chain key and a message key
export function ratchetChainKey(chainKeyHex: string): { nextChainKey: string; messageKey: string } {
  const chainKeyBytes = hexToBytes(chainKeyHex);
  const messageKeyBytes = kdf(chainKeyBytes, 'message-key-constant');
  const nextChainKeyBytes = kdf(chainKeyBytes, 'chain-key-constant');
  
  return {
    nextChainKey: bytesToHex(nextChainKeyBytes),
    messageKey: bytesToHex(messageKeyBytes)
  };
}

export interface SessionState {
  rootKey: string;
  sendingChainKey: string;
  receivingChainKey: string;
  remoteIdentityPubJWK: any;
  messageIndex: number;
}

// ALICE: Initiate session using Bob's prekey bundle
export async function initiateSession(
  aliceIdentityKeyPair: CryptoKeyPair,
  bobBundle: {
    identityKey: any; // JWK
    signedPreKey: any; // JWK
    preKeySignature: string;
    oneTimePreKey: any | null; // JWK
  }
): Promise<{ session: SessionState; ephemeralPublicKeyJWK: any }> {
  // Generate Alice's ephemeral key
  const aliceEphemeralKeyPair = await window.crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveKey', 'deriveBits']
  );

  const bobIdentityKey = await importPublicKeyJWK(bobBundle.identityKey);
  const bobSignedPreKey = await importPublicKeyJWK(bobBundle.signedPreKey);

  // DH1 = DH(IK_A, SPK_B)
  const dh1 = await deriveDHBits(aliceIdentityKeyPair.privateKey, bobSignedPreKey);
  // DH2 = DH(EK_A, IK_B)
  const dh2 = await deriveDHBits(aliceEphemeralKeyPair.privateKey, bobIdentityKey);
  // DH3 = DH(EK_A, SPK_B)
  const dh3 = await deriveDHBits(aliceEphemeralKeyPair.privateKey, bobSignedPreKey);

  // Concatenate DH outputs
  let totalLength = dh1.byteLength + dh2.byteLength + dh3.byteLength;
  let dh4Bytes: ArrayBuffer | null = null;

  if (bobBundle.oneTimePreKey) {
    const bobOneTimePreKey = await importPublicKeyJWK(bobBundle.oneTimePreKey);
    // DH4 = DH(EK_A, OPK_B)
    dh4Bytes = await deriveDHBits(aliceEphemeralKeyPair.privateKey, bobOneTimePreKey);
    totalLength += dh4Bytes.byteLength;
  }

  const combinedDH = new Uint8Array(totalLength);
  combinedDH.set(new Uint8Array(dh1), 0);
  combinedDH.set(new Uint8Array(dh2), dh1.byteLength);
  combinedDH.set(new Uint8Array(dh3), dh1.byteLength + dh2.byteLength);

  if (dh4Bytes) {
    combinedDH.set(new Uint8Array(dh4Bytes), dh1.byteLength + dh2.byteLength + dh3.byteLength);
  }

  // Derive Root Key and Sending/Receiving Chain Keys
  const rootKeyBytes = kdf(combinedDH, 'root-key-salt');
  const sendingChainKeyBytes = kdf(rootKeyBytes, 'sending-chain-salt');
  const receivingChainKeyBytes = kdf(rootKeyBytes, 'receiving-chain-salt');

  const session: SessionState = {
    rootKey: bytesToHex(rootKeyBytes),
    sendingChainKey: bytesToHex(sendingChainKeyBytes),
    receivingChainKey: bytesToHex(receivingChainKeyBytes),
    remoteIdentityPubJWK: bobBundle.identityKey,
    messageIndex: 0
  };

  const ephemeralPublicKeyJWK = await exportPublicKeyJWK(aliceEphemeralKeyPair.publicKey);

  return { session, ephemeralPublicKeyJWK };
}

// BOB: Complete session establishment when receiving Alice's first message
export async function receiveInitiation(
  bobIdentityKeyPair: CryptoKeyPair,
  bobSignedPreKeyPrivate: CryptoKey,
  bobOneTimePreKeyPrivate: CryptoKey | null,
  aliceInitiation: {
    identityKey: any; // JWK
    ephemeralKey: any; // JWK
    oneTimePreKeyUsed: boolean;
  }
): Promise<SessionState> {
  const aliceIdentityKey = await importPublicKeyJWK(aliceInitiation.identityKey);
  const aliceEphemeralKey = await importPublicKeyJWK(aliceInitiation.ephemeralKey);

  // DH1 = DH(SPK_B, IK_A) => Bob computes DH(bobSignedPreKey, aliceIdentityKey)
  const dh1 = await deriveDHBits(bobSignedPreKeyPrivate, aliceIdentityKey);
  // DH2 = DH(IK_B, EK_A) => Bob computes DH(bobIdentityKey, aliceEphemeralKey)
  const dh2 = await deriveDHBits(bobIdentityKeyPair.privateKey, aliceEphemeralKey);
  // DH3 = DH(SPK_B, EK_A) => Bob computes DH(bobSignedPreKey, aliceEphemeralKey)
  const dh3 = await deriveDHBits(bobSignedPreKeyPrivate, aliceEphemeralKey);

  let totalLength = dh1.byteLength + dh2.byteLength + dh3.byteLength;
  let dh4Bytes: ArrayBuffer | null = null;

  if (aliceInitiation.oneTimePreKeyUsed && bobOneTimePreKeyPrivate) {
    // DH4 = DH(OPK_B, EK_A) => Bob computes DH(bobOneTimePreKey, aliceEphemeralKey)
    dh4Bytes = await deriveDHBits(bobOneTimePreKeyPrivate, aliceEphemeralKey);
    totalLength += dh4Bytes.byteLength;
  }

  const combinedDH = new Uint8Array(totalLength);
  combinedDH.set(new Uint8Array(dh1), 0);
  combinedDH.set(new Uint8Array(dh2), dh1.byteLength);
  combinedDH.set(new Uint8Array(dh3), dh1.byteLength + dh2.byteLength);

  if (dh4Bytes) {
    combinedDH.set(new Uint8Array(dh4Bytes), dh1.byteLength + dh2.byteLength + dh3.byteLength);
  }

  const rootKeyBytes = kdf(combinedDH, 'root-key-salt');
  // NOTE: Bob swaps sending and receiving chains! Alice's sending is Bob's receiving.
  const receivingChainKeyBytes = kdf(rootKeyBytes, 'sending-chain-salt');
  const sendingChainKeyBytes = kdf(rootKeyBytes, 'receiving-chain-salt');

  return {
    rootKey: bytesToHex(rootKeyBytes),
    sendingChainKey: bytesToHex(sendingChainKeyBytes),
    receivingChainKey: bytesToHex(receivingChainKeyBytes),
    remoteIdentityPubJWK: aliceInitiation.identityKey,
    messageIndex: 0
  };
}

// Encrypt payload using current message key (AES-GCM)
export async function encryptPayload(messageKeyHex: string, plaintext: string): Promise<{ ciphertext: string; iv: string }> {
  const messageKeyBytes = hexToBytes(messageKeyHex);
  const ivBytes = window.crypto.getRandomValues(new Uint8Array(12)); // 12-byte IV for GCM
  
  const cryptoKey = await window.crypto.subtle.importKey(
    'raw',
    messageKeyBytes.buffer as ArrayBuffer,
    { name: 'AES-GCM' },
    false,
    ['encrypt']
  );

  const encodedPlaintext = new TextEncoder().encode(plaintext);
  const encrypted = await window.crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: ivBytes.buffer as ArrayBuffer
    },
    cryptoKey,
    encodedPlaintext
  );

  return {
    ciphertext: bytesToHex(new Uint8Array(encrypted)),
    iv: bytesToHex(ivBytes)
  };
}

// Decrypt payload using message key (AES-GCM)
export async function decryptPayload(messageKeyHex: string, ciphertextHex: string, ivHex: string): Promise<string> {
  const messageKeyBytes = hexToBytes(messageKeyHex);
  const ciphertextBytes = hexToBytes(ciphertextHex);
  const ivBytes = hexToBytes(ivHex);

  const cryptoKey = await window.crypto.subtle.importKey(
    'raw',
    messageKeyBytes.buffer as ArrayBuffer,
    { name: 'AES-GCM' },
    false,
    ['decrypt']
  );

  const decrypted = await window.crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: ivBytes.buffer as ArrayBuffer
    },
    cryptoKey,
    ciphertextBytes.buffer as ArrayBuffer
  );

  return new TextDecoder().decode(decrypted);
}
