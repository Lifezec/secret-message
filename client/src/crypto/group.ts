
export interface GroupRoom {
  roomId: string;
  name: string;
  members: string[]; // List of usernames
  createdAt: number;
}

export interface EncryptedGroupMessage {
  roomId: string;
  sender: string;
  ciphertext: string;
  iv: string;
  ephemeralKey?: any; // For initial message if establishing session
  isInitiation: boolean;
  oneTimePreKeyUsed?: boolean;
}

// Group encryption helper is client-side.
// The actual group chat is implemented by sending individual encrypted messages
// to each recipient in the group.
// This file can provide structures and helper descriptions if needed.
// Since the frontend screens will handle the actual encryption/decryption loop,
// we can document the logic here.
