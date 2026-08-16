// Helper to convert ArrayBuffer to Hex
function bufferToHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

// Helper to convert Hex to Uint8Array
function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

export interface EncryptedFileResult {
  encryptedData: ArrayBuffer;
  keyHex: string;
  ivHex: string;
}

// Encrypt file using AES-256-GCM
export async function encryptFile(fileData: ArrayBuffer): Promise<EncryptedFileResult> {
  const keyBytes = window.crypto.getRandomValues(new Uint8Array(32)); // 256-bit key
  const ivBytes = window.crypto.getRandomValues(new Uint8Array(12)); // 12-byte IV

  const aesKey = await window.crypto.subtle.importKey(
    'raw',
    keyBytes.buffer as ArrayBuffer,
    { name: 'AES-GCM' },
    false,
    ['encrypt']
  );

  const encrypted = await window.crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: ivBytes.buffer as ArrayBuffer
    },
    aesKey,
    fileData
  );

  return {
    encryptedData: encrypted,
    keyHex: bufferToHex(keyBytes.buffer),
    ivHex: bufferToHex(ivBytes.buffer)
  };
}

// Decrypt file using AES-256-GCM
export async function decryptFile(
  encryptedData: ArrayBuffer,
  keyHex: string,
  ivHex: string
): Promise<ArrayBuffer> {
  const keyBytes = hexToBytes(keyHex);
  const ivBytes = hexToBytes(ivHex);

  const aesKey = await window.crypto.subtle.importKey(
    'raw',
    keyBytes.buffer as ArrayBuffer,
    { name: 'AES-GCM' },
    false,
    ['decrypt']
  );

  const decrypted = await window.crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: ivBytes.buffer as ArrayBuffer
    },
    aesKey,
    encryptedData
  );

  return decrypted;
}
