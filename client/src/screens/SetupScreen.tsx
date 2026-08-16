import React, { useState } from 'react';
import { KeyRound, ShieldAlert } from 'lucide-react';
import { API_BASE_URL } from '../config';
import { 
  generateECDHKeyPair, 
  exportPublicKeyJWK, 
  exportPrivateKeyJWK,
  signPreKey
} from '../crypto/identity';
import { encryptPayload } from '../crypto/session';
import { saveUserKeys } from '../storage/messageDb';
import type { UserKeys } from '../storage/messageDb';
import { sha256 } from '@noble/hashes/sha2.js';

interface SetupScreenProps {
  onSetupComplete: (keys: UserKeys) => void;
}

export const SetupScreen: React.FC<SetupScreenProps> = ({ onSetupComplete }) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSetup = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    // Form validation
    if (!username.trim() || !password || !confirmPassword) {
      setError('Lütfen tüm alanları doldurun.');
      return;
    }

    if (username.length < 3) {
      setError('Kullanıcı adı en az 3 karakter olmalıdır.');
      return;
    }

    if (password.length < 6) {
      setError('Master şifre en az 6 karakter olmalıdır.');
      return;
    }

    if (password !== confirmPassword) {
      setError('Şifreler eşleşmiyor.');
      return;
    }

    setLoading(true);

    try {
      const cleanUsername = username.trim().toLowerCase();

      // 1. Check if username is already taken on the server
      const checkRes = await fetch(`${API_BASE_URL}/api/users/exists/${cleanUsername}`);
      const checkData = await checkRes.json();

      if (checkData.exists) {
        setError('Bu kullanıcı adı başka biri tarafından alınmış.');
        setLoading(false);
        return;
      }

      // 2. Generate Cryptographic Keys
      // a. Identity Key Pair (IK)
      const identityKeyPair = await generateECDHKeyPair();
      const identityPubJWK = await exportPublicKeyJWK(identityKeyPair.publicKey);
      const identityPrivJWK = await exportPrivateKeyJWK(identityKeyPair.privateKey);

      // b. Signed Prekey Pair (SPK)
      const signedPreKeyPair = await generateECDHKeyPair();
      const signedPrePubJWK = await exportPublicKeyJWK(signedPreKeyPair.publicKey);
      const signedPrePrivJWK = await exportPrivateKeyJWK(signedPreKeyPair.privateKey);

      // c. Signature of Signed Prekey using Identity Key
      const preKeySignature = await signPreKey(identityPrivJWK, signedPrePubJWK);

      // d. Pool of One-Time Prekeys (OPKs) - Generate 10 keys
      const oneTimePreKeys: Array<{ publicKey: any; privateKey: any }> = [];
      const oneTimePrePubsForServer: any[] = [];

      for (let i = 0; i < 10; i++) {
        const opkPair = await generateECDHKeyPair();
        const opkPubJWK = await exportPublicKeyJWK(opkPair.publicKey);
        const opkPrivJWK = await exportPrivateKeyJWK(opkPair.privateKey);
        
        oneTimePreKeys.push({
          publicKey: opkPubJWK,
          privateKey: opkPrivJWK
        });
        oneTimePrePubsForServer.push(opkPubJWK);
      }

      // 3. Register Public Keys on Backend
      const regRes = await fetch(`${API_BASE_URL}/api/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: cleanUsername,
          identityKey: identityPubJWK,
          signedPreKey: signedPrePubJWK,
          preKeySignature,
          oneTimePreKeys: oneTimePrePubsForServer
        })
      });

      if (!regRes.ok) {
        const regData = await regRes.json();
        throw new Error(regData.error || 'Sunucu kayıt hatası');
      }

      // 4. Encrypt Private Keys locally using master password
      const encoder = new TextEncoder();
      const passHashBytes = sha256(encoder.encode(password));
      const passHashHex = (Array.from(passHashBytes) as number[]).map(b => b.toString(16).padStart(2, '0')).join('');

      // Encrypt identity private key JWK
      const encIdentityPriv = await encryptPayload(passHashHex, JSON.stringify(identityPrivJWK));
      
      // Encrypt signed prekey private key JWK
      const encSignedPrePriv = await encryptPayload(passHashHex, JSON.stringify(signedPrePrivJWK));

      // We don't encrypt public keys, nor do we need to encrypt OPK private keys in this prototype, 
      // but we store them securely in the keys database.
      const keysToSave: UserKeys = {
        username: cleanUsername,
        identityKeyPairJWK: {
          publicKey: identityPubJWK,
          privateKey: encIdentityPriv as any // store ciphertext/iv in db
        },
        signedPreKeyPairJWK: {
          publicKey: signedPrePubJWK,
          privateKey: encSignedPrePriv as any // store ciphertext/iv in db
        },
        preKeySignature,
        oneTimePreKeysJWK: oneTimePreKeys
      };

      // Save keys to IndexedDB
      await saveUserKeys(keysToSave);

      // Return memory unlocked keys
      const unlockedKeys: UserKeys = {
        ...keysToSave,
        identityKeyPairJWK: {
          publicKey: identityPubJWK,
          privateKey: identityPrivJWK
        },
        signedPreKeyPairJWK: {
          publicKey: signedPrePubJWK,
          privateKey: signedPrePrivJWK
        }
      };

      onSetupComplete(unlockedKeys);
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Bir hata oluştu, kurulum başarısız.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="glass-panel animate-slide-up" style={{ maxWidth: '460px', width: '100%', padding: '40px' }}>
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
          <KeyRound size={32} color="#8b5cf6" />
        </div>
        <h2 style={{ margin: '0 0 8px 0', fontSize: '1.8rem', fontWeight: 700 }}>R6V2 Güvenli Kurulum</h2>
        <p style={{ margin: 0, color: '#a1a1aa', fontSize: '0.95rem' }}>
          Yeni bir kriptografik kimlik oluşturun ve sunucuya kaydolun.
        </p>
      </div>

      <form onSubmit={handleSetup} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <label style={{ fontSize: '0.85rem', fontWeight: 600, color: '#a1a1aa' }}>Kullanıcı Adı</label>
          <input
            type="text"
            placeholder="örn. ahmet, ceren_99"
            value={username}
            onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ''))}
            disabled={loading}
            maxLength={15}
          />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <label style={{ fontSize: '0.85rem', fontWeight: 600, color: '#a1a1aa' }}>Master Şifre</label>
          <input
            type="password"
            placeholder="Özel anahtarları yerelde şifrelemek için"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={loading}
          />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <label style={{ fontSize: '0.85rem', fontWeight: 600, color: '#a1a1aa' }}>Şifre Onayı</label>
          <input
            type="password"
            placeholder="Şifreyi tekrar girin"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            disabled={loading}
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
            fontSize: '0.85rem'
          }}>
            <ShieldAlert size={16} style={{ flexShrink: 0 }} />
            <span>{error}</span>
          </div>
        )}

        <button type="submit" className="primary" disabled={loading}>
          {loading ? 'Kripto Anahtarlar Üretiliyor...' : 'Kurulumu Başlat'}
        </button>
      </form>
      <div style={{ textAlign: 'center', marginTop: '24px', fontSize: '0.75rem', color: '#71717a', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        R6V2 Secure Messaging Architecture
      </div>
    </div>
  );
};
