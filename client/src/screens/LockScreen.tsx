import React, { useState } from 'react';
import { ShieldAlert, Lock } from 'lucide-react';
import { getUserKeys } from '../storage/messageDb';
import type { UserKeys } from '../storage/messageDb';
import { decryptPayload } from '../crypto/session';
import { sha256 } from '@noble/hashes/sha2.js';

interface LockScreenProps {
  onUnlock: (keys: UserKeys) => void;
}

export const LockScreen: React.FC<LockScreenProps> = ({ onUnlock }) => {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleUnlock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password) return;

    setError('');
    setLoading(true);

    try {
      const stored = await getUserKeys();
      if (!stored) {
        setError('Yerel anahtar bulunamadı. Lütfen uygulamayı yeniden kurun.');
        setLoading(false);
        return;
      }

      // Check password by attempting to decrypt the identity private key
      // During setup, we encrypted the private key string using the sha256 hash of the master password.
      // Let's derive the master key from the password.
      const encoder = new TextEncoder();
      const passHashBytes = sha256(encoder.encode(password));
      const passHashHex = (Array.from(passHashBytes) as number[]).map(b => b.toString(16).padStart(2, '0')).join('');

      // We stored the private key JWK encrypted inside the keys database.
      // Specifically: keys.identityKeyPairJWK.privateKey is a structure: { ciphertext, iv }
      const encPrivKey = stored.identityKeyPairJWK.privateKey;
      
      try {
        const decryptedJson = await decryptPayload(passHashHex, encPrivKey.ciphertext, encPrivKey.iv);
        const decryptedPrivKeyJWK = JSON.parse(decryptedJson);
        
        // Decrypt signed prekey private key too
        const encSignedPrivKey = stored.signedPreKeyPairJWK.privateKey;
        const decryptedSignedJson = await decryptPayload(passHashHex, encSignedPrivKey.ciphertext, encSignedPrivKey.iv);
        const decryptedSignedPrivKeyJWK = JSON.parse(decryptedSignedJson);

        // Fully unlocked keys structure (keys in memory)
        const unlockedKeys: UserKeys = {
          ...stored,
          identityKeyPairJWK: {
            ...stored.identityKeyPairJWK,
            privateKey: decryptedPrivKeyJWK
          },
          signedPreKeyPairJWK: {
            ...stored.signedPreKeyPairJWK,
            privateKey: decryptedSignedPrivKeyJWK
          }
        };

        onUnlock(unlockedKeys);
      } catch (decryptionError) {
        console.error("Decryption failed:", decryptionError);
        setError('Geçersiz Master Şifre. Lütfen tekrar deneyin.');
      }
    } catch (err) {
      console.error(err);
      setError('Sistem hatası oluştu.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="glass-panel animate-slide-up" style={{ maxWidth: '400px', width: '100%', padding: '40px', textAlign: 'center' }}>
      <div style={{
        width: '64px',
        height: '64px',
        background: 'rgba(139, 92, 246, 0.1)',
        borderRadius: '50%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        margin: '0 auto 24px auto',
        border: '1px solid rgba(139, 92, 246, 0.2)'
      }}>
        <Lock size={32} color="#8b5cf6" />
      </div>

      <h2 style={{ margin: '0 0 8px 0', fontSize: '1.8rem', fontWeight: 700 }}>R6V2 Güvenli Giriş</h2>
      <p style={{ margin: '0 0 32px 0', color: '#a1a1aa', fontSize: '0.95rem' }}>
        Veritabanını çözmek ve özel anahtarlarınızı yüklemek için Master Şifrenizi girin.
      </p>

      <form onSubmit={handleUnlock} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <div>
          <input
            type="password"
            placeholder="Master Şifre"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={loading}
            style={{ textAlign: 'center', letterSpacing: '0.15em' }}
            autoFocus
          />
        </div>

        {error && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            background: 'rgba(239, 68, 68, 0.1)',
            border: '1px solid rgba(239, 68, 68, 0.2)',
            padding: '12px',
            borderRadius: '10px',
            color: '#ef4444',
            fontSize: '0.85rem',
            textAlign: 'left'
          }}>
            <ShieldAlert size={16} style={{ flexShrink: 0 }} />
            <span>{error}</span>
          </div>
        )}

        <button type="submit" className="primary" disabled={loading || !password}>
          {loading ? 'Şifre Çözülüyor...' : 'Kilidi Aç'}
        </button>
      </form>
      <div style={{ textAlign: 'center', marginTop: '24px', fontSize: '0.75rem', color: '#71717a', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        R6V2 Secure Messaging Architecture
      </div>
    </div>
  );
};
