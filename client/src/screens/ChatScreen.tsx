import React, { useState, useEffect, useRef } from 'react';
import { ArrowLeft, Send, Paperclip, Shield, Download, Lock, Users, User, RefreshCw } from 'lucide-react';
import { API_BASE_URL } from '../config';
import { getMessages, saveMessage, getSession, saveSession, getRoom } from '../storage/messageDb';
import type { LocalMessage, UserKeys } from '../storage/messageDb';
import { initiateSession, ratchetChainKey, encryptPayload } from '../crypto/session';
import { importPublicKeyJWK, importPrivateKeyJWK } from '../crypto/identity';
import { encryptFile, decryptFile } from '../crypto/fileEncryption';
import { socketClient } from '../network/socket';
import type { GroupRoom } from '../crypto/group';

interface ChatScreenProps {
  chatId: string; // Remote username for 1-1, or roomId for groups
  isGroup: boolean;
  userKeys: UserKeys;
  onBack: () => void;
  onViewSafetyNumber: (remoteUser: string) => void;
}

export const ChatScreen: React.FC<ChatScreenProps> = ({
  chatId,
  isGroup,
  userKeys,
  onBack,
  onViewSafetyNumber
}) => {
  const [messages, setMessages] = useState<LocalMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [uploading, setUploading] = useState(false);
  const [room, setRoom] = useState<GroupRoom | null>(null);
  const messageEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load message history from local database
  const loadMessages = async () => {
    const msgs = await getMessages(chatId);
    setMessages(msgs);
  };

  // Load group room details if it's a group chat
  const loadRoomDetails = async () => {
    if (isGroup) {
      const r = await getRoom(chatId);
      setRoom(r);
    }
  };

  useEffect(() => {
    loadMessages();
    loadRoomDetails();

    // Listen for incoming WebSocket messages dispatched from App.tsx for instantaneous sync
    const handleNewMessage = (e: Event) => {
      const customEvent = e as CustomEvent;
      const msg = customEvent.detail;
      // If the incoming message belongs to this chat room, reload instantly!
      if (msg && msg.roomId === chatId) {
        loadMessages();
      }
    };

    window.addEventListener('new-message-received', handleNewMessage);

    // Poll message DB for updates (e.g. from websocket events) as a robust backup fallback
    const interval = setInterval(loadMessages, 1000);

    return () => {
      window.removeEventListener('new-message-received', handleNewMessage);
      clearInterval(interval);
    };
  }, [chatId]);

  useEffect(() => {
    messageEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Core 1-1 Encrypted Sending Logic
  const encryptAndSendToUser = async (
    targetUser: string,
    payloadText: string,
    messageType: 'text' | 'file',
    fileMeta?: any
  ): Promise<boolean> => {
    try {
      let session = await getSession(targetUser);
      let isInitiation = false;
      let ephemeralKey = null;
      let oneTimePreKeyUsed = false;
      let oneTimePreKeyUsedJWK: any = null;
      let ciphertext = '';
      let iv = '';

      if (!session) {
        // 1. Fetch prekey bundle from server
        console.log(`No cryptographic session with ${targetUser}, initiating X3DH...`);
        const res = await fetch(`${API_BASE_URL}/api/prekeys/bundle/${targetUser}`);
        if (!res.ok) {
          console.error(`Failed to fetch prekey bundle for ${targetUser}`);
          return false;
        }
        const bundle = await res.json();

        // 2. Initiate session (X3DH)
        const myIdentityKeyPair = {
          publicKey: await importPublicKeyJWK(userKeys.identityKeyPairJWK.publicKey),
          privateKey: await importPrivateKeyJWK(userKeys.identityKeyPairJWK.privateKey)
        };

        const result = await initiateSession(myIdentityKeyPair as any, bundle);
        session = result.session;
        ephemeralKey = result.ephemeralPublicKeyJWK;
        oneTimePreKeyUsed = !!bundle.oneTimePreKey;
        oneTimePreKeyUsedJWK = bundle.oneTimePreKey;
        isInitiation = true;
      }

      // 3. Symmetric key ratcheting
      const { nextChainKey, messageKey } = ratchetChainKey(session.sendingChainKey);
      session.sendingChainKey = nextChainKey;

      // 4. Encrypt the plaintext payload
      const msgPayload = JSON.stringify({
        text: payloadText,
        type: messageType,
        fileMeta: fileMeta || null
      });

      const encrypted = await encryptPayload(messageKey, msgPayload);
      ciphertext = encrypted.ciphertext;
      iv = encrypted.iv;

      // 5. Send message package to the server via WebSocket
      const wsMessagePayload: any = {
        type: 'message',
        recipient: targetUser,
        ciphertext: JSON.stringify({
          ciphertext,
          iv,
          isInitiation,
          ephemeralKey,
          oneTimePreKeyUsed,
          oneTimePreKeyUsedJWK,
          identityKey: isInitiation ? userKeys.identityKeyPairJWK.publicKey : undefined
        }),
        msgType: 'whisper',
        timestamp: Date.now()
      };

      socketClient.send(wsMessagePayload);

      // Save updated session state back to IndexedDB
      await saveSession(targetUser, session);
      return true;
    } catch (err) {
      console.error(`Error encrypting message for ${targetUser}:`, err);
      return false;
    }
  };

  const handleSendMessage = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!inputText.trim()) return;

    const textToSend = inputText.trim();
    setInputText('');

    const messageId = Math.random().toString(36).substring(2);
    const timestamp = Date.now();

    if (!isGroup) {
      // 1-1 Chat: Send encrypted message to remote user
      const success = await encryptAndSendToUser(chatId, textToSend, 'text');
      if (success) {
        // Save locally as sent message
        const localMsg: LocalMessage = {
          id: messageId,
          roomId: chatId,
          sender: userKeys.username,
          recipient: chatId,
          content: textToSend,
          timestamp,
          type: 'text'
        };
        await saveMessage(localMsg);
        loadMessages();
      }
    } else {
      // Group Chat: Loop and send to all members
      if (!room) return;
      
      const promises = room.members
        .filter(m => m !== userKeys.username)
        .map(member => encryptAndSendToUser(member, textToSend, 'text'));

      await Promise.all(promises);

      // Save locally under roomId
      const localMsg: LocalMessage = {
        id: messageId,
        roomId: chatId,
        sender: userKeys.username,
        content: textToSend,
        timestamp,
        type: 'text'
      };
      await saveMessage(localMsg);
      loadMessages();
    }
  };

  // File Upload and Encryption Handler
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);

    try {
      // 1. Read file as ArrayBuffer
      const reader = new FileReader();
      const fileDataPromise = new Promise<ArrayBuffer>((resolve, reject) => {
        reader.onload = () => resolve(reader.result as ArrayBuffer);
        reader.onerror = () => reject(reader.error);
      });
      reader.readAsArrayBuffer(file);
      const fileBuffer = await fileDataPromise;

      // 2. Encrypt file locally using AES-256-GCM
      const { encryptedData, keyHex, ivHex } = await encryptFile(fileBuffer);

      // 3. Upload encrypted file to Node.js server
      const response = await fetch(`${API_BASE_URL}/api/files/upload`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: encryptedData
      });

      if (!response.ok) {
        throw new Error('Dosya yükleme hatası');
      }

      const uploadResult = await response.json();
      const fileId = uploadResult.fileId;

      // 4. Send encrypted metadata over standard double ratchet channel
      const fileMeta = {
        fileId,
        fileName: file.name,
        fileSize: file.size,
        fileType: file.type,
        keyHex,
        ivHex
      };

      const messageId = Math.random().toString(36).substring(2);
      const timestamp = Date.now();

      if (!isGroup) {
        const success = await encryptAndSendToUser(chatId, `📁 Dosya paylaştı: ${file.name}`, 'file', fileMeta);
        if (success) {
          const localMsg: LocalMessage = {
            id: messageId,
            roomId: chatId,
            sender: userKeys.username,
            recipient: chatId,
            content: `📁 Dosya paylaştı: ${file.name}`,
            timestamp,
            type: 'file',
            fileMeta
          };
          await saveMessage(localMsg);
          loadMessages();
        }
      } else {
        if (!room) return;
        const promises = room.members
          .filter(m => m !== userKeys.username)
          .map(member => encryptAndSendToUser(member, `📁 Dosya paylaştı: ${file.name}`, 'file', fileMeta));

        await Promise.all(promises);

        const localMsg: LocalMessage = {
          id: messageId,
          roomId: chatId,
          sender: userKeys.username,
          content: `📁 Dosya paylaştı: ${file.name}`,
          timestamp,
          type: 'file',
          fileMeta
        };
        await saveMessage(localMsg);
        loadMessages();
      }
    } catch (err) {
      console.error(err);
      alert('Dosya gönderilemedi.');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // Download and Decrypt File Handler
  const handleDownloadFile = async (meta: any) => {
    try {
      // 1. Download encrypted file bytes
      const res = await fetch(`${API_BASE_URL}/api/files/download/${meta.fileId}`);
      if (!res.ok) throw new Error('Dosya indirilemedi.');
      const encryptedBuffer = await res.arrayBuffer();

      // 2. Decrypt locally using GCM keys
      const decryptedBuffer = await decryptFile(encryptedBuffer, meta.keyHex, meta.ivHex);

      // 3. Create blob and trigger download
      const blob = new Blob([decryptedBuffer], { type: meta.fileType });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = meta.fileName;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (err) {
      console.error(err);
      alert('Dosya indirilemedi veya şifresi çözülemedi.');
    }
  };

  return (
    <div className="glass-panel animate-slide-up" style={{
      maxWidth: '800px',
      width: '100%',
      height: '85vh',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden'
    }}>
      {/* Chat Header */}
      <div style={{
        padding: '16px 20px',
        borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        background: 'rgba(0,0,0,0.1)'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <button className="secondary" onClick={onBack} style={{ padding: '8px', borderRadius: '10px', display: 'flex', alignItems: 'center' }}>
            <ArrowLeft size={18} />
          </button>
          
          <div style={{
            width: '40px',
            height: '40px',
            borderRadius: '10px',
            background: isGroup ? 'rgba(139, 92, 246, 0.15)' : 'rgba(236, 72, 153, 0.15)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: isGroup ? '#a78bfa' : '#f472b6'
          }}>
            {isGroup ? <Users size={20} /> : <User size={20} />}
          </div>

          <div>
            <div style={{ fontWeight: 600, fontSize: '1.05rem' }}>
              {isGroup ? (room?.name || 'Grup Sohbeti') : chatId}
            </div>
            <div style={{ fontSize: '0.75rem', color: '#a1a1aa', display: 'flex', alignItems: 'center', gap: '4px' }}>
              <Lock size={12} color="#10b981" />
              <span>Uçtan Uca Şifreli</span>
            </div>
          </div>
        </div>

        {!isGroup && (
          <button className="secondary" onClick={() => onViewSafetyNumber(chatId)} style={{
            padding: '8px 12px',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            borderRadius: '10px',
            fontSize: '0.85rem'
          }}>
            <Shield size={16} color="#8b5cf6" />
            <span>Güvenlik Numarası</span>
          </button>
        )}
      </div>

      {/* Message Area */}
      <div style={{
        flex: 1,
        overflowY: 'auto',
        padding: '24px',
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
        background: 'rgba(0,0,0,0.05)'
      }}>
        {messages.length === 0 ? (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#71717a' }}>
            <Lock size={32} style={{ marginBottom: '12px', opacity: 0.3 }} />
            <p style={{ fontSize: '0.9rem', fontStyle: 'italic' }}>Güvenli şifreli oturum başlatıldı. İlk mesajı gönderin.</p>
          </div>
        ) : (
          messages.map((msg, index) => {
            const isMe = msg.sender === userKeys.username;
            return (
              <div
                key={msg.id || index}
                style={{
                  alignSelf: isMe ? 'flex-end' : 'flex-start',
                  maxWidth: '70%',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: isMe ? 'flex-end' : 'flex-start'
                }}
              >
                {/* Sender Tag for Group Chats */}
                {isGroup && !isMe && (
                  <span style={{ fontSize: '0.75rem', color: '#8b5cf6', marginBottom: '2px', fontWeight: 600, paddingLeft: '4px' }}>
                    {msg.sender}
                  </span>
                )}

                {/* Message Bubble */}
                <div style={{
                  padding: '12px 16px',
                  borderRadius: isMe ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
                  background: isMe 
                    ? 'linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%)' 
                    : 'rgba(255, 255, 255, 0.05)',
                  border: isMe ? 'none' : '1px solid rgba(255, 255, 255, 0.06)',
                  color: '#fff',
                  boxShadow: isMe ? '0 4px 12px rgba(139, 92, 246, 0.2)' : 'none',
                  wordBreak: 'break-word'
                }}>
                  {msg.type === 'file' && msg.fileMeta ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                      <div style={{
                        width: '40px',
                        height: '40px',
                        borderRadius: '8px',
                        background: 'rgba(255, 255, 255, 0.1)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        cursor: 'pointer'
                      }} onClick={() => handleDownloadFile(msg.fileMeta)}>
                        <Download size={18} />
                      </div>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>{msg.fileMeta.fileName}</div>
                        <div style={{ fontSize: '0.75rem', opacity: 0.7 }}>
                          {(msg.fileMeta.fileSize / 1024).toFixed(1)} KB • Şifreli Dosya
                        </div>
                      </div>
                    </div>
                  ) : (
                    <span>{msg.content}</span>
                  )}
                </div>

                {/* Timestamp */}
                <span style={{ fontSize: '0.7rem', color: '#71717a', marginTop: '4px', padding: '0 4px' }}>
                  {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
            );
          })
        )}
        <div ref={messageEndRef} />
      </div>

      {/* Input Panel */}
      <form onSubmit={handleSendMessage} style={{
        padding: '16px 20px',
        borderTop: '1px solid rgba(255, 255, 255, 0.08)',
        display: 'flex',
        gap: '12px',
        alignItems: 'center',
        background: 'rgba(0,0,0,0.1)'
      }}>
        <input
          type="file"
          ref={fileInputRef}
          onChange={handleFileUpload}
          style={{ display: 'none' }}
        />
        
        <button
          type="button"
          className="secondary"
          disabled={uploading}
          onClick={() => fileInputRef.current?.click()}
          style={{
            padding: '12px',
            borderRadius: '12px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}
        >
          {uploading ? <RefreshCw className="animate-spin" size={20} /> : <Paperclip size={20} />}
        </button>

        <input
          type="text"
          placeholder="Şifreli mesajınızı yazın..."
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          disabled={uploading}
          style={{ flex: 1 }}
        />

        <button type="submit" className="primary" disabled={uploading || !inputText.trim()} style={{
          padding: '12px 20px',
          borderRadius: '12px',
          display: 'flex',
          alignItems: 'center',
          gap: '8px'
        }}>
          <Send size={18} />
          <span>Gönder</span>
        </button>
      </form>
    </div>
  );
};
