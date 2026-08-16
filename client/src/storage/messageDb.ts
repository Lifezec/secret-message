import localforage from 'localforage';
import type { GroupRoom } from '../crypto/group';

// Configure localForage database instances
const keysStore = localforage.createInstance({
  name: 'secure_messenger',
  storeName: 'keys'
});

const sessionsStore = localforage.createInstance({
  name: 'secure_messenger',
  storeName: 'sessions'
});

const roomsStore = localforage.createInstance({
  name: 'secure_messenger',
  storeName: 'rooms'
});

const messagesStore = localforage.createInstance({
  name: 'secure_messenger',
  storeName: 'messages'
});

export interface LocalMessage {
  id: string;
  roomId: string; // User username for 1-1 chats, or group roomId
  sender: string;
  recipient?: string;
  content: string; // Plaintext content (decrypted)
  timestamp: number;
  type: 'text' | 'file';
  fileMeta?: {
    fileId: string;
    fileName: string;
    fileSize: number;
    fileType: string;
    keyHex: string;
    ivHex: string;
  };
}

export interface UserKeys {
  username: string;
  identityKeyPairJWK: {
    privateKey: any;
    publicKey: any;
  };
  signedPreKeyPairJWK: {
    privateKey: any;
    publicKey: any;
  };
  preKeySignature: string;
  oneTimePreKeysJWK: Array<{
    privateKey: any;
    publicKey: any;
  }>;
}

// Keys API
export async function saveUserKeys(keys: UserKeys): Promise<void> {
  await keysStore.setItem('user_keys', keys);
}

export async function getUserKeys(): Promise<UserKeys | null> {
  return await keysStore.getItem<UserKeys>('user_keys');
}

export async function clearUserKeys(): Promise<void> {
  await keysStore.removeItem('user_keys');
}

// Sessions API (1-1 cryptographic states)
export async function saveSession(remoteUsername: string, sessionState: any): Promise<void> {
  await sessionsStore.setItem(remoteUsername, sessionState);
}

export async function getSession(remoteUsername: string): Promise<any | null> {
  return await sessionsStore.getItem<any>(remoteUsername);
}

export async function clearAllSessions(): Promise<void> {
  await sessionsStore.clear();
}

// Rooms API (Groups)
export async function saveRoom(room: GroupRoom): Promise<void> {
  await roomsStore.setItem(room.roomId, room);
}

export async function getRoom(roomId: string): Promise<GroupRoom | null> {
  return await roomsStore.getItem<GroupRoom>(roomId);
}

export async function getAllRooms(): Promise<GroupRoom[]> {
  const rooms: GroupRoom[] = [];
  await roomsStore.iterate((value: GroupRoom) => {
    rooms.push(value);
  });
  return rooms;
}

export async function clearAllRooms(): Promise<void> {
  await roomsStore.clear();
}

// Messages API (Local Chat History)
export async function saveMessage(message: LocalMessage): Promise<void> {
  const messages = (await messagesStore.getItem<LocalMessage[]>(message.roomId)) || [];
  
  // Prevent duplicate messages (by ID check)
  if (!messages.some(m => m.id === message.id)) {
    messages.push(message);
    await messagesStore.setItem(message.roomId, messages);
  }
}

export async function getMessages(roomId: string): Promise<LocalMessage[]> {
  return (await messagesStore.getItem<LocalMessage[]>(roomId)) || [];
}

export async function clearAllMessages(): Promise<void> {
  await messagesStore.clear();
}
