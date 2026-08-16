import React, { useState } from 'react';
import { ArrowLeft, Trash2, Users } from 'lucide-react';
import { API_BASE_URL } from '../config';
import { saveRoom } from '../storage/messageDb';
import type { GroupRoom } from '../crypto/group';

interface CreateRoomScreenProps {
  username: string;
  onBack: () => void;
  onRoomCreated: (roomId: string) => void;
}

export const CreateRoomScreen: React.FC<CreateRoomScreenProps> = ({
  username,
  onBack,
  onRoomCreated
}) => {
  const [roomName, setRoomName] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [members, setMembers] = useState<string[]>([username]); // creator is auto member
  const [registeredUsers, setRegisteredUsers] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // Fetch all registered users on mount
  React.useEffect(() => {
    const fetchUsers = async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/api/users/list`);
        if (res.ok) {
          const data = await res.json();
          setRegisteredUsers(data.users || []);
        }
      } catch (err) {
        console.error("Failed to fetch registered users:", err);
      }
    };
    fetchUsers();
  }, []);

  const handleRemoveMember = (member: string) => {
    if (member === username) return; // cannot remove self
    setMembers(members.filter(m => m !== member));
  };

  const handleCreateRoom = async () => {
    if (!roomName.trim()) {
      setError('Lütfen bir grup adı belirleyin.');
      return;
    }

    if (members.length < 2) {
      setError('Grupta en az bir diğer üye olmalıdır.');
      return;
    }

    setLoading(true);

    try {
      const roomId = `group_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      
      const newRoom: GroupRoom = {
        roomId,
        name: roomName.trim(),
        members,
        createdAt: Date.now()
      };

      // Save group definition to local database
      // The GroupRoom type was defined in crypto/group.ts and imported in storage/messageDb.ts
      await saveRoom(newRoom as any);

      // Trigger callback
      onRoomCreated(roomId);
    } catch (err) {
      console.error("Error creating room:", err);
      setError('Grup oluşturulurken hata oluştu.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="glass-panel animate-slide-up" style={{ maxWidth: '480px', width: '100%', padding: '40px' }}>
      <div style={{ display: 'flex', justifyContent: 'flex-start', marginBottom: '24px' }}>
        <button className="secondary" onClick={onBack} style={{ padding: '8px', borderRadius: '10px', display: 'flex', alignItems: 'center' }}>
          <ArrowLeft size={18} />
        </button>
      </div>

      <div style={{ textAlign: 'center', marginBottom: '32px' }}>
        <div style={{
          width: '64px',
          height: '64px',
          background: 'rgba(139, 92, 246, 0.1)',
          borderRadius: '50%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          margin: '0 auto 16px auto',
          border: '1px solid rgba(139, 92, 246, 0.2)'
        }}>
          <Users size={32} color="#8b5cf6" />
        </div>
        <h2 style={{ margin: '0 0 8px 0', fontSize: '1.6rem', fontWeight: 700 }}>Yeni Grup Oluştur</h2>
        <p style={{ margin: 0, color: '#a1a1aa', fontSize: '0.9rem' }}>
          Sınırsız sayıda katılımcıyla güvenli grup sohbeti başlatın.
        </p>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        {/* Room Name Input */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <label style={{ fontSize: '0.85rem', fontWeight: 600, color: '#a1a1aa' }}>Grup Adı</label>
          <input
            type="text"
            placeholder="örn. Güvenli Oda, Proje Ekibi"
            value={roomName}
            onChange={(e) => setRoomName(e.target.value)}
            disabled={loading}
          />
        </div>

        {/* Search & Add Members */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <label style={{ fontSize: '0.85rem', fontWeight: 600, color: '#a1a1aa' }}>Kullanıcı Ara ve Ekle</label>
          <input
            type="text"
            placeholder="Kullanıcı adı ara..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value.toLowerCase())}
            disabled={loading}
          />
          
          <div style={{
            background: 'rgba(0,0,0,0.12)',
            border: '1px solid rgba(255, 255, 255, 0.05)',
            borderRadius: '12px',
            padding: '12px',
            maxHeight: '140px',
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
            marginTop: '8px'
          }}>
            {registeredUsers
              .filter(u => u !== username && u.includes(searchQuery))
              .map(u => {
                const isAdded = members.includes(u);
                return (
                  <div key={u} style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '8px 12px',
                    background: 'rgba(255, 255, 255, 0.02)',
                    borderRadius: '8px',
                    fontSize: '0.85rem'
                  }}>
                    <span style={{ fontWeight: 500, color: '#e4e4e7' }}>{u}</span>
                    <button
                      type="button"
                      onClick={() => {
                        if (isAdded) {
                          handleRemoveMember(u);
                        } else {
                          setMembers([...members, u]);
                        }
                      }}
                      className={isAdded ? "danger" : "primary"}
                      style={{
                        padding: '6px 12px',
                        fontSize: '0.75rem',
                        borderRadius: '8px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px',
                        cursor: 'pointer'
                      }}
                    >
                      {isAdded ? 'Kaldır' : 'Ekle'}
                    </button>
                  </div>
                );
              })}
            {registeredUsers.filter(u => u !== username && u.includes(searchQuery)).length === 0 && (
              <span style={{ fontSize: '0.8rem', color: '#71717a', textAlign: 'center', padding: '12px 0' }}>
                Kullanıcı bulunamadı
              </span>
            )}
          </div>
        </div>

        {/* Members List */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <label style={{ fontSize: '0.85rem', fontWeight: 600, color: '#a1a1aa' }}>
            Grup Üyeleri ({members.length})
          </label>
          <div style={{
            background: 'rgba(255, 255, 255, 0.02)',
            border: '1px solid rgba(255, 255, 255, 0.05)',
            borderRadius: '12px',
            padding: '12px',
            maxHeight: '160px',
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px'
          }}>
            {members.map(member => (
              <div key={member} style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '6px 12px',
                background: 'rgba(255, 255, 255, 0.03)',
                borderRadius: '8px',
                fontSize: '0.9rem'
              }}>
                <span>{member} {member === username ? '(Siz)' : ''}</span>
                {member !== username && (
                  <button type="button" onClick={() => handleRemoveMember(member)} style={{
                    background: 'none',
                    border: 'none',
                    color: '#ef4444',
                    cursor: 'pointer',
                    padding: '2px',
                    display: 'flex',
                    alignItems: 'center'
                  }}>
                    <Trash2 size={16} />
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>

        {error && (
          <div style={{ color: '#ef4444', fontSize: '0.85rem', marginTop: '4px' }}>
            {error}
          </div>
        )}

        <button type="button" className="primary" onClick={handleCreateRoom} disabled={loading || !roomName.trim() || members.length < 2} style={{ marginTop: '10px' }}>
          {loading ? 'Grup Kuruluyor...' : 'Grubu Oluştur'}
        </button>
      </div>
    </div>
  );
};
