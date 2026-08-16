import React, { useState, useEffect } from 'react';
import { MessageSquare, Users, LogOut, ShieldCheck, RotateCw } from 'lucide-react';
import { API_BASE_URL } from '../config';
import { getAllRooms } from '../storage/messageDb';
import type { LocalMessage } from '../storage/messageDb';
import localforage from 'localforage';

interface ChatListScreenProps {
  username: string;
  socketStatus: 'disconnected' | 'connecting' | 'connected';
  onSelectChat: (chatId: string, isGroup: boolean) => void;
  onNavigateToCreateRoom: () => void;
  onLock: () => void;
}

export const ChatListScreen: React.FC<ChatListScreenProps> = ({
  username,
  socketStatus,
  onSelectChat,
  onNavigateToCreateRoom,
  onLock
}) => {
  const [activeChats, setActiveChats] = useState<{ id: string; name: string; isGroup: boolean; lastMessage?: string; timestamp?: number }[]>([]);
  const [newChatUser, setNewChatUser] = useState('');
  const [searchError, setSearchError] = useState('');
  const [searchLoading, setSearchLoading] = useState(false);
  const [showNewChatModal, setShowNewChatModal] = useState(false);
  const [registeredUsers, setRegisteredUsers] = useState<string[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  // Fetch all registered users
  const fetchUsers = async () => {
    setRefreshing(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/users/list`);
      if (res.ok) {
        const data = await res.json();
        setRegisteredUsers(data.users || []);
      }
    } catch (err) {
      console.error("Failed to fetch registered users:", err);
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  // Load chat list from IndexedDB messages and group rooms
  const loadChatList = async () => {
    try {
      const rooms = await getAllRooms();
      
      // We can also find 1-1 chats by looking at all saved message rooms (since roomIds in messageDb are usernames for 1-1 chats)
      // localforage messages store holds arrays of messages keyed by roomId.
      // Since localforage API requires iterating keys, we can get list of all chats that have message history.
      const messagesStore = localforage.createInstance({
        name: 'secure_messenger',
        storeName: 'messages'
      });

      const chatMap = new Map<string, { id: string; name: string; isGroup: boolean; lastMessage?: string; timestamp?: number }>();

      // Add rooms (groups) first
      rooms.forEach(r => {
        chatMap.set(r.roomId, {
          id: r.roomId,
          name: r.name,
          isGroup: true
        });
      });

      // Retrieve all message keys if possible
      if (messagesStore) {
        const keys: string[] = await messagesStore.keys();
        for (const key of keys) {
          const isGroup = rooms.some(r => r.roomId === key);
          const msgs = (await messagesStore.getItem<LocalMessage[]>(key)) || [];
          const lastMsg = msgs[msgs.length - 1];

          if (chatMap.has(key)) {
            const val = chatMap.get(key)!;
            val.lastMessage = lastMsg ? (lastMsg.type === 'file' ? '📁 Dosya' : lastMsg.content) : '';
            val.timestamp = lastMsg ? lastMsg.timestamp : 0;
          } else if (!isGroup) {
            // 1-1 Chat
            chatMap.set(key, {
              id: key,
              name: key, // name is their username
              isGroup: false,
              lastMessage: lastMsg ? (lastMsg.type === 'file' ? '📁 Dosya' : lastMsg.content) : '',
              timestamp: lastMsg ? lastMsg.timestamp : 0
            });
          }
        }
      }

      const chats = Array.from(chatMap.values()).sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
      setActiveChats(chats);
    } catch (err) {
      console.error("Error loading chat list:", err);
    }
  };

  useEffect(() => {
    loadChatList();
    
    // Refresh list periodically or on props change
    const interval = setInterval(loadChatList, 3000);
    return () => clearInterval(interval);
  }, []);

  const handleStart1to1Chat = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newChatUser.trim()) return;

    const targetUser = newChatUser.trim().toLowerCase();
    if (targetUser === username) {
      setSearchError('Kendinizle sohbet başlatamazsınız.');
      return;
    }

    setSearchError('');
    setSearchLoading(true);

    try {
      // Check if user exists on server
      const res = await fetch(`${API_BASE_URL}/api/users/exists/${targetUser}`);
      const data = await res.json();

      if (!data.exists) {
        setSearchError('Kullanıcı bulunamadı.');
        setSearchLoading(false);
        return;
      }

      // Open chat (even if no messages exist yet, the ChatScreen will fetch prekey bundle on first message)
      onSelectChat(targetUser, false);
      setShowNewChatModal(false);
      setNewChatUser('');
    } catch (err) {
      console.error(err);
      setSearchError('Bağlantı hatası.');
    } finally {
      setSearchLoading(false);
    }
  };

  return (
    <div className="glass-panel animate-slide-up" style={{
      maxWidth: '900px',
      width: '100%',
      height: '82vh',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      boxShadow: '0 20px 50px rgba(0, 0, 0, 0.4), 0 0 40px rgba(139, 92, 246, 0.05)',
      border: '1px solid rgba(255, 255, 255, 0.07)'
    }}>
      {/* Header */}
      <div className="glowing-header" style={{
        padding: '22px 28px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        background: 'rgba(10, 10, 12, 0.4)',
        backdropFilter: 'blur(10px)',
        borderBottom: '1px solid rgba(255, 255, 255, 0.06)'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <div className="premium-avatar" style={{
            width: '46px',
            height: '46px',
            borderRadius: '14px',
            fontSize: '1.2rem',
            letterSpacing: '0.05em'
          }}>
            {username.substring(0, 2)}
          </div>
          <div>
            <div style={{ fontWeight: 700, fontSize: '1.1rem', display: 'flex', alignItems: 'center', gap: '6px', color: '#fff' }}>
              {username}
              <ShieldCheck size={18} color="#a78bfa" style={{ filter: 'drop-shadow(0 0 6px rgba(167, 139, 250, 0.5))' }} />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.8rem', color: '#a1a1aa', marginTop: '2px' }}>
              <span className={socketStatus === 'connected' ? 'pulse-online' : ''} style={{
                width: socketStatus === 'connected' ? '8px' : '6px',
                height: socketStatus === 'connected' ? '8px' : '6px',
                backgroundColor: socketStatus === 'connected' ? '#10b981' : socketStatus === 'connecting' ? '#f59e0b' : '#ef4444',
                borderRadius: '50%'
              }}></span>
              <span style={{ fontWeight: 500 }}>
                {socketStatus === 'connected' ? 'Sunucuya Bağlı' : socketStatus === 'connecting' ? 'Bağlanıyor...' : 'Bağlantı Yok'}
              </span>
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '10px' }}>
          <button className="header-btn secondary" onClick={() => setShowNewChatModal(true)} style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
            <MessageSquare size={16} color="#a78bfa" />
            <span style={{ color: '#e4e4e7', fontSize: '0.85rem' }}>Yeni Sohbet</span>
          </button>
          <button className="header-btn secondary" onClick={onNavigateToCreateRoom} style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
            <Users size={16} color="#f472b6" />
            <span style={{ color: '#e4e4e7', fontSize: '0.85rem' }}>Grup Oluştur</span>
          </button>
          <button className="header-btn danger" onClick={onLock} style={{ padding: '10px 14px' }}>
            <LogOut size={16} />
          </button>
        </div>
      </div>

      {/* Two Column Layout: Left (Active Chats), Right (Registered Users) */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* Left Side: Active Chats (65% width) */}
        <div style={{ flex: '0 0 65%', display: 'flex', flexDirection: 'column', borderRight: '1px solid rgba(255, 255, 255, 0.06)' }}>
          <div className="custom-scroll" style={{ flex: 1, overflowY: 'auto', padding: '20px' }}>
            {activeChats.length === 0 ? (
              <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#71717a' }}>
                <MessageSquare size={54} style={{ marginBottom: '18px', opacity: 0.25, color: '#a78bfa', filter: 'drop-shadow(0 0 10px rgba(167,139,250,0.15))' }} />
                <p style={{ fontSize: '1.05rem', fontWeight: 600, color: '#e4e4e7' }}>Aktif Sohbet Bulunmuyor</p>
                <p style={{ fontSize: '0.85rem', textAlign: 'center', maxWidth: '320px', margin: '6px 0 0 0', lineHeight: 1.4, color: '#71717a' }}>
                  Üst menüden yeni bir 1-1 sohbet veya grup oluşturarak hemen şifreli mesajlaşmaya başlayın.
                </p>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {activeChats.map(chat => (
                  <div
                    key={chat.id}
                    onClick={() => onSelectChat(chat.id, chat.isGroup)}
                    className="chat-card"
                  >
                    <div style={{
                      width: '46px',
                      height: '46px',
                      borderRadius: '14px',
                      background: chat.isGroup ? 'rgba(139, 92, 246, 0.12)' : 'rgba(236, 72, 153, 0.12)',
                      border: chat.isGroup ? '1px solid rgba(139, 92, 246, 0.25)' : '1px solid rgba(236, 72, 153, 0.25)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: chat.isGroup ? '#c084fc' : '#f472b6',
                      boxShadow: chat.isGroup ? '0 0 12px rgba(139, 92, 246, 0.1)' : '0 0 12px rgba(236, 72, 153, 0.1)',
                      transition: 'all 0.3s ease'
                    }}>
                      {chat.isGroup ? <Users size={20} /> : <MessageSquare size={20} />}
                    </div>

                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                        <span style={{ fontWeight: 600, fontSize: '1.02rem', color: '#fff' }}>{chat.name}</span>
                        {chat.timestamp ? (
                          <span style={{ fontSize: '0.75rem', color: '#71717a' }}>
                            {new Date(chat.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        ) : null}
                      </div>
                      <div style={{
                        fontSize: '0.88rem',
                        color: '#a1a1aa',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis'
                      }}>
                        {chat.lastMessage || <span style={{ fontStyle: 'italic', opacity: 0.5 }}>Henüz mesaj yok</span>}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right Side: Registered Users Panel (35% width) */}
        <div style={{ flex: '0 0 35%', display: 'flex', flexDirection: 'column', background: 'rgba(5, 5, 8, 0.15)' }}>
          <div style={{
            padding: '18px 24px',
            borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
            fontWeight: 700,
            fontSize: '0.78rem',
            color: '#a78bfa',
            textTransform: 'uppercase',
            letterSpacing: '0.12em',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center'
          }}>
            <span>Kayıtlı Kullanıcılar</span>
            <button 
              onClick={fetchUsers} 
              disabled={refreshing}
              style={{
                background: 'none',
                border: 'none',
                padding: '4px',
                color: '#a78bfa',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                opacity: refreshing ? 0.5 : 0.8,
                transition: 'all 0.2s ease'
              }}
              onMouseEnter={(e) => e.currentTarget.style.color = '#fff'}
              onMouseLeave={(e) => e.currentTarget.style.color = '#a78bfa'}
            >
              <RotateCw size={14} className={refreshing ? 'animate-spin' : ''} />
            </button>
          </div>
          <div className="custom-scroll" style={{ flex: 1, overflowY: 'auto', padding: '18px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {registeredUsers.length <= 1 ? (
              <span style={{ fontSize: '0.85rem', color: '#71717a', textAlign: 'center', marginTop: '24px' }}>Başka kayıtlı kullanıcı yok</span>
            ) : (
              registeredUsers.filter(u => u !== username).map(u => (
                <div
                  key={u}
                  onClick={() => onSelectChat(u, false)}
                  className="user-pill"
                >
                  <div style={{
                    width: '34px',
                    height: '34px',
                    borderRadius: '10px',
                    background: 'rgba(139, 92, 246, 0.08)',
                    border: '1px solid rgba(139, 92, 246, 0.18)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontWeight: 700,
                    color: '#c084fc',
                    fontSize: '0.85rem',
                    textTransform: 'uppercase'
                  }}>
                    {u.substring(0, 2)}
                  </div>
                  <span style={{ fontSize: '0.9rem', fontWeight: 500, color: '#e4e4e7' }}>{u}</span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* New Chat Modal */}
      {showNewChatModal && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0,0,0,0.6)',
          backdropFilter: 'blur(4px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 99
        }}>
          <div className="glass-panel animate-fade-in" style={{ padding: '32px', width: '90%', maxWidth: '400px' }}>
            <h3 style={{ margin: '0 0 8px 0', fontSize: '1.3rem', fontWeight: 600 }}>Yeni 1-1 Sohbet Başlat</h3>
            <p style={{ margin: '0 0 20px 0', color: '#a1a1aa', fontSize: '0.85rem' }}>
              Eklemek istediğiniz kullanıcının adını girin. Sunucuda aranacaktır.
            </p>

            <form onSubmit={handleStart1to1Chat} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div style={{ position: 'relative' }}>
                <input
                  type="text"
                  placeholder="Kullanıcı Adı"
                  value={newChatUser}
                  onChange={(e) => setNewChatUser(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ''))}
                  disabled={searchLoading}
                  autoFocus
                />
              </div>

              {searchError && (
                <div style={{ color: '#ef4444', fontSize: '0.85rem' }}>
                  {searchError}
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                <button type="button" className="secondary" onClick={() => { setShowNewChatModal(false); setSearchError(''); }} disabled={searchLoading}>
                  İptal
                </button>
                <button type="submit" className="primary" disabled={searchLoading || !newChatUser.trim()}>
                  {searchLoading ? 'Aranıyor...' : 'Sohbeti Başlat'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
