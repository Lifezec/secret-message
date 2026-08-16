import React, { useEffect, useState } from 'react';
import { ShieldCheck, ArrowLeft, AlertTriangle } from 'lucide-react';
import { API_BASE_URL } from '../config';
import { computeSafetyNumber } from '../crypto/identity';
import type { UserKeys } from '../storage/messageDb';

interface SafetyNumberScreenProps {
  remoteUser: string;
  userKeys: UserKeys;
  onBack: () => void;
}

export const SafetyNumberScreen: React.FC<SafetyNumberScreenProps> = ({
  remoteUser,
  userKeys,
  onBack
}) => {
  const [safetyNumber, setSafetyNumber] = useState('');
  const [loading, setLoading] = useState(true);
  const [verified, setVerified] = useState(false);

  useEffect(() => {
    const fetchRemoteKey = async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/api/prekeys/bundle/${remoteUser}`);
        if (!res.ok) throw new Error('Could not fetch prekey bundle');
        const bundle = await res.json();
        
        const num = computeSafetyNumber(userKeys.identityKeyPairJWK.publicKey, bundle.identityKey);
        setSafetyNumber(num);
      } catch (err) {
        console.error("Error calculating safety number:", err);
      } finally {
        setLoading(false);
      }
    };

    fetchRemoteKey();
  }, [remoteUser]);

  return (
    <div className="glass-panel animate-slide-up" style={{ maxWidth: '480px', width: '100%', padding: '40px', textAlign: 'center' }}>
      <div style={{ display: 'flex', justifyContent: 'flex-start', marginBottom: '24px' }}>
        <button className="secondary" onClick={onBack} style={{ padding: '8px', borderRadius: '10px', display: 'flex', alignItems: 'center' }}>
          <ArrowLeft size={18} />
        </button>
      </div>

      <div style={{
        width: '64px',
        height: '64px',
        background: 'rgba(16, 185, 129, 0.1)',
        borderRadius: '50%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        margin: '0 auto 20px auto',
        border: '1px solid rgba(16, 185, 129, 0.2)'
      }}>
        <ShieldCheck size={32} color="#10b981" />
      </div>

      <h3 style={{ margin: '0 0 8px 0', fontSize: '1.5rem', fontWeight: 700 }}>Güvenlik Numarası Doğrulama</h3>
      <p style={{ margin: '0 0 24px 0', color: '#a1a1aa', fontSize: '0.88rem', lineHeight: '1.4' }}>
        {remoteUser} ile aranızdaki uçtan uca şifrelemenin doğruluğunu teyit edin. Aşağıdaki numaraların {remoteUser} kullanıcısının ekranındaki numaralarla aynı olduğunu fiziksel olarak doğrulayın.
      </p>

      {loading ? (
        <div style={{ padding: '32px 0', color: '#71717a' }}>Güvenlik numarası hesaplanıyor...</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          {/* Numbers Display Box */}
          <div style={{
            background: 'rgba(255, 255, 255, 0.02)',
            border: '1px dashed rgba(255, 255, 255, 0.1)',
            padding: '24px 16px',
            borderRadius: '16px',
            fontSize: '1.4rem',
            fontWeight: 700,
            letterSpacing: '0.1em',
            color: '#8b5cf6',
            fontFamily: 'monospace',
            display: 'flex',
            justifyContent: 'center',
            gap: '8px',
            flexWrap: 'wrap'
          }}>
            {safetyNumber.split(' ').map((chunk, i) => (
              <span key={i} style={{ margin: '0 4px' }}>{chunk}</span>
            ))}
          </div>

          <div style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: '10px',
            background: 'rgba(245, 158, 11, 0.05)',
            border: '1px solid rgba(245, 158, 11, 0.15)',
            padding: '16px',
            borderRadius: '12px',
            color: '#f59e0b',
            fontSize: '0.8rem',
            textAlign: 'left',
            lineHeight: '1.4'
          }}>
            <AlertTriangle size={18} style={{ flexShrink: 0, marginTop: '2px' }} />
            <span>
              Eğer bu numaralar uyuşmuyorsa, aradaki bağlantıya müdahale edilmiş (Man-in-the-Middle) veya karşı taraf kimliğini sıfırlamış olabilir. Bu durumda görüşmeyi durdurun.
            </span>
          </div>

          {/* Verification Status */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '10px',
            marginTop: '8px'
          }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', fontSize: '0.95rem' }}>
              <input
                type="checkbox"
                checked={verified}
                onChange={(e) => setVerified(e.target.checked)}
                style={{ width: '18px', height: '18px', cursor: 'pointer' }}
              />
              <span>Bu kanalı doğrulanmış olarak işaretle</span>
            </label>
          </div>
        </div>
      )}

      <button className="primary" onClick={onBack} style={{ marginTop: '32px', width: '100%' }}>
        Kapat ve Sohbete Dön
      </button>
    </div>
  );
};
