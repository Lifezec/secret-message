import { useState, useEffect, useRef } from 'react';
import { LockScreen } from './screens/LockScreen';
import { SetupScreen } from './screens/SetupScreen';
import { ChatListScreen } from './screens/ChatListScreen';
import { ChatScreen } from './screens/ChatScreen';
import { SafetyNumberScreen } from './screens/SafetyNumberScreen';
import { CreateRoomScreen } from './screens/CreateRoomScreen';
import { socketClient } from './network/socket';
import { 
  getUserKeys, 
  saveSession, 
  getSession, 
  saveMessage, 
  clearUserKeys, 
  clearAllSessions, 
  clearAllMessages,
  clearAllRooms
} from './storage/messageDb';
import type { LocalMessage, UserKeys } from './storage/messageDb';
import { receiveInitiation, ratchetChainKey, decryptPayload } from './crypto/session';
import { importPublicKeyJWK, importPrivateKeyJWK } from './crypto/identity';
import { Shield, Cloud, Sun, CloudRain, Wind, Droplets, Search as SearchIcon, CloudLightning } from 'lucide-react';

type ScreenState = 'loading' | 'weather' | 'setup' | 'lock' | 'chat-list' | 'chat' | 'create-room' | 'safety-number';

const POPULAR_CITIES = [
  // Türkiye (81 il ve popüler ilçeler)
  'İstanbul', 'Ankara', 'İzmir', 'Bursa', 'Antalya', 'Adana', 'Konya', 'Gaziantep', 'Şanlıurfa', 'Mersin',
  'Kocaeli', 'Diyarbakır', 'Hatay', 'Manisa', 'Kayseri', 'Samsun', 'Balıkesir', 'Kahramanmaraş', 'Van', 'Aydın',
  'Denizli', 'Sakarya', 'Muğla', 'Eskişehir', 'Trabzon', 'Malatya', 'Erzurum', 'Ordu', 'Afyonkarahisar', 'Sivas',
  'Batman', 'Tokat', 'Adıyaman', 'Elazığ', 'Zonguldak', 'Kütahya', 'Çanakkale', 'Osmaniye', 'Çorum', 'Şırnak',
  'Giresun', 'Isparta', 'Yozgat', 'Muş', 'Edirne', 'Aksaray', 'Kastamonu', 'Düzce', 'Kırklareli', 'Niğde',
  'Uşak', 'Rize', 'Amasya', 'Kars', 'Bitlis', 'Kırıkkale', 'Bolu', 'Burdur', 'Karaman', 'Bingöl', 'Karabük',
  'Yalova', 'Hakkari', 'Kırşehir', 'Mardin', 'Artvin', 'Bilecik', 'Erzincan', 'Nevşehir', 'Sinop', 'Siirt',
  'Bartın', 'Çankırı', 'Gümüşhane', 'Tunceli', 'Ardahan', 'Kilis', 'Bayburt', 'Iğdır', 'Bodrum', 'Fethiye',
  'Marmaris', 'Alanya', 'Kuşadası', 'Çeşme',
  
  // Dünya Başkentleri ve Popüler Şehirler
  'London', 'Londra', 'Paris', 'New York', 'Tokyo', 'Berlin', 'Rome', 'Roma', 'Madrid', 'Moscow', 'Moskova',
  'Sydney', 'Sidney', 'Toronto', 'Los Angeles', 'Los Santos', 'Chicago', 'Miami', 'Dubai', 'Cairo', 'Kahire',
  'Beijing', 'Pekin', 'Seoul', 'Seul', 'Mumbai', 'Amsterdam', 'Vienna', 'Viyana', 'Brussels', 'Brüksel',
  'Stockholm', 'Oslo', 'Copenhagen', 'Kopenhag', 'Dublin', 'Helsinki', 'Zurich', 'Zürih', 'Geneva', 'Cenevre',
  'Lisbon', 'Lizbon', 'Athens', 'Atina', 'Barcelona', 'Barselona', 'Milano', 'Milan', 'Munich', 'Münih',
  'Prague', 'Prag', 'Budapest', 'Budapeşte', 'Warsaw', 'Varşova', 'Kiev', 'Baku', 'Bakü'
];

const normalizeString = (str: string): string => {
  return str
    .replace(/İ/g, 'i')
    .replace(/I/g, 'i')
    .replace(/ı/g, 'i')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ş/g, 's')
    .replace(/ç/g, 'c')
    .replace(/ğ/g, 'g')
    .replace(/ü/g, 'u')
    .replace(/ö/g, 'o');
};

function App() {
  const [screen, setScreen] = useState<ScreenState>('weather');
  const [unlockedKeys, setUnlockedKeys] = useState<UserKeys | null>(null);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [activeChatIsGroup, setActiveChatIsGroup] = useState<boolean>(false);
  const [socketStatus, setSocketStatus] = useState<'disconnected' | 'connecting' | 'connected'>('disconnected');
  const [safetyNumberUser, setSafetyNumberUser] = useState<string | null>(null);
  const [hasKeys, setHasKeys] = useState<boolean>(false);

  // Weather Decoy States
  const [cityInput, setCityInput] = useState('');
  const [weatherLoading, setWeatherLoading] = useState(false);
  const [weatherError, setWeatherError] = useState<string | null>(null);
  const [weatherData, setWeatherData] = useState({
    city: 'İstanbul',
    temp: '26°C',
    condition: 'Açık',
    humidity: '%45',
    wind: '15 km/s',
    icon: 'sunny'
  });
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);

  const handleInputChange = (value: string) => {
    setCityInput(value);
    const query = value.trim();
    if (!query) {
      setSuggestions([]);
      return;
    }

    const normalizedQuery = normalizeString(query);
    const filtered = POPULAR_CITIES.filter(city => 
      normalizeString(city).includes(normalizedQuery)
    ).slice(0, 5);

    setSuggestions(filtered);
    setShowSuggestions(true);
  };

  // Keep a mutable ref of unlockedKeys so the WebSocket async handler can always access it
  const unlockedKeysRef = useRef<UserKeys | null>(null);
  unlockedKeysRef.current = unlockedKeys;

  // 1. Initial Identity Check (Save to state hasKeys)
  useEffect(() => {
    const checkIdentity = async () => {
      try {
        const keys = await getUserKeys();
        setHasKeys(!!keys);
      } catch (err) {
        console.error("Identity check failed:", err);
        setHasKeys(false);
      }
    };
    checkIdentity();
  }, []);

  // Weather translating utility for Turkish UI
  const translateCondition = (cond: string): string => {
    const condLower = cond.toLowerCase();
    if (condLower.includes('sunny')) return 'Güneşli';
    if (condLower.includes('clear')) return 'Açık';
    if (condLower.includes('partly cloudy')) return 'Parçalı Bulutlu';
    if (condLower.includes('cloudy')) return 'Bulutlu';
    if (condLower.includes('overcast')) return 'Kapalı';
    if (condLower.includes('mist') || condLower.includes('fog') || condLower.includes('haze')) return 'Sisli';
    if (condLower.includes('patchy rain') || condLower.includes('light rain') || condLower.includes('drizzle')) return 'Hafif Yağmurlu';
    if (condLower.includes('heavy rain') || condLower.includes('moderate rain') || condLower.includes('shower')) return 'Yağmurlu';
    if (condLower.includes('rain')) return 'Yağmurlu';
    if (condLower.includes('thunder') || condLower.includes('storm')) return 'Gök Gürültülü';
    if (condLower.includes('snow')) return 'Karlı';
    return cond;
  };



  // Real-time weather fetch handler (wttr.in)
  const fetchWeather = async (cityName: string) => {
    setWeatherLoading(true);
    setWeatherError(null);
    try {
      let fetchName = cityName;
      if (cityName.toLowerCase() === 'los santos') {
        fetchName = 'Los Angeles';
      }
      const response = await fetch(`https://wttr.in/${encodeURIComponent(fetchName)}?format=j1`);
      if (!response.ok) {
        setWeatherError("Şehir bulunamadı. Lütfen geçerli bir şehir adı girin.");
        setWeatherLoading(false);
        return;
      }
      const data = await response.json();

      if (!data || !data.current_condition || !data.current_condition[0]) {
        setWeatherError("Şehir bulunamadı. Lütfen geçerli bir şehir adı girin.");
        setWeatherLoading(false);
        return;
      }

      const current = data.current_condition[0];
      const desc = current.weatherDesc[0].value;
      const descLower = desc.toLowerCase();

      let icon = 'sunny';
      if (descLower.includes('rain') || descLower.includes('drizzle') || descLower.includes('shower')) {
        icon = 'rainy';
      } else if (descLower.includes('thunder') || descLower.includes('storm') || descLower.includes('lightning')) {
        icon = 'lightning';
      } else if (descLower.includes('cloud') || descLower.includes('overcast') || descLower.includes('mist') || descLower.includes('fog')) {
        icon = 'cloudy';
      } else if (descLower.includes('wind') || descLower.includes('gale')) {
        icon = 'windy';
      }

      // Format city name nicely
      let formattedCity = cityName
        .split(' ')
        .map(word => {
          if (!word) return '';
          const firstChar = word.charAt(0).toLowerCase();
          if (firstChar === 'i' || firstChar === 'ı') {
            return 'İ' + word.slice(1).toLowerCase();
          }
          return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
        })
        .join(' ');

      if (cityName.toLowerCase() === 'istanbul') formattedCity = 'İstanbul';
      if (cityName.toLowerCase() === 'los santos') formattedCity = 'Los Santos';

      setWeatherData({
        city: formattedCity,
        temp: `${current.temp_C}°C`,
        condition: translateCondition(desc),
        humidity: `%${current.humidity}`,
        wind: `${current.windspeedKmph} km/s`,
        icon
      });
      setCityInput('');
      setSuggestions([]);
    } catch (err) {
      console.error("Weather API fetch or parse error:", err);
      setWeatherError("Şehir bulunamadı. Lütfen geçerli bir şehir adı girin.");
    } finally {
      setWeatherLoading(false);
    }
  };

  // 2. Dynamic Title / Tab Name & Initial Weather Fetch
  useEffect(() => {
    if (screen === 'weather') {
      document.title = "Meteoroloji - Canlı Hava Durumu";
      fetchWeather('Istanbul');
    } else {
      document.title = "R6V2 Chat";
    }
  }, [screen]);

  // 3. Incoming WebSocket message routing
  const handleIncomingMessage = async (data: any) => {
    if (data.type !== 'message') return;

    const { sender, ciphertext: encStr } = data;
    try {
      const encContainer = JSON.parse(encStr);
      let session = await getSession(sender);

      // If it's an X3DH initiation message
      if (encContainer.isInitiation) {
        console.log(`Processing X3DH session initiation from ${sender}...`);
        
        const myKeys = unlockedKeysRef.current;
        if (!myKeys) {
          console.error("Cannot decrypt initiation message: user keys not unlocked in memory");
          return;
        }

        // Import our identity key pair
        const myIdentityKeyPair = {
          publicKey: await importPublicKeyJWK(myKeys.identityKeyPairJWK.publicKey),
          privateKey: await importPublicKeyJWK(myKeys.identityKeyPairJWK.privateKey)
        };

        // Import our signed prekey private key
        const mySignedPreKeyPrivate = await importPrivateKeyJWK(myKeys.signedPreKeyPairJWK.privateKey);

        // Import the selected one-time prekey private key
        let myOneTimePreKeyPrivate: CryptoKey | null = null;
        if (encContainer.oneTimePreKeyUsed && encContainer.oneTimePreKeyUsedJWK) {
          const match = myKeys.oneTimePreKeysJWK.find(
            opk => opk.publicKey.x === encContainer.oneTimePreKeyUsedJWK.x && 
                   opk.publicKey.y === encContainer.oneTimePreKeyUsedJWK.y
          );
          if (match) {
            myOneTimePreKeyPrivate = await importPrivateKeyJWK(match.privateKey);
          } else if (myKeys.oneTimePreKeysJWK.length > 0) {
            myOneTimePreKeyPrivate = await importPrivateKeyJWK(myKeys.oneTimePreKeysJWK[0].privateKey);
          }
        }

        const aliceInitiation = {
          identityKey: encContainer.identityKey,
          ephemeralKey: encContainer.ephemeralKey,
          oneTimePreKeyUsed: encContainer.oneTimePreKeyUsed
        };

        session = await receiveInitiation(
          myIdentityKeyPair as any,
          mySignedPreKeyPrivate,
          myOneTimePreKeyPrivate,
          aliceInitiation
        );
      }

      if (!session) {
        console.error(`No session state exists and no initiation parameter found for message from ${sender}`);
        return;
      }

      // Advance receiving chain
      const { nextChainKey, messageKey } = ratchetChainKey(session.receivingChainKey);
      session.receivingChainKey = nextChainKey;

      // Decrypt GCM payload
      const decryptedJson = await decryptPayload(messageKey, encContainer.ciphertext, encContainer.iv);
      const payload = JSON.parse(decryptedJson);

      // Save updated session state
      await saveSession(sender, session);

      // Save the message locally
      const messageId = Math.random().toString(36).substring(2);
      const localMsg: LocalMessage = {
        id: messageId,
        roomId: payload.roomId || sender,
        sender,
        content: payload.text,
        timestamp: Date.now(),
        type: payload.type,
        fileMeta: payload.fileMeta || undefined
      };

      await saveMessage(localMsg);
      console.log(`Saved decrypted message from ${sender} under room ${localMsg.roomId}`);
    } catch (err) {
      console.error("Failed to decrypt received WebSocket message:", err);
    }
  };

  // 4. Connect WebSocket when keys are unlocked
  useEffect(() => {
    if (unlockedKeys) {
      console.log(`Connecting socket client for ${unlockedKeys.username}`);
      socketClient.connect(
        unlockedKeys.username,
        handleIncomingMessage,
        (success, error) => {
          if (!success) {
            console.error("Socket authentication failed:", error);
          } else {
            console.log("Socket authenticated successfully");
          }
        },
        (status) => {
          setSocketStatus(status);
        }
      );
    }

    return () => {
      socketClient.disconnect();
    };
  }, [unlockedKeys]);

  const handleUnlock = (keys: UserKeys) => {
    setUnlockedKeys(keys);
    setScreen('chat-list');
  };

  const handleSetupComplete = (keys: UserKeys) => {
    setUnlockedKeys(keys);
    setScreen('chat-list');
  };

  const handleSelectChat = (chatId: string, isGroup: boolean) => {
    setActiveChatId(chatId);
    setActiveChatIsGroup(isGroup);
    setScreen('chat');
  };

  const handleLockApp = async () => {
    socketClient.disconnect();
    setUnlockedKeys(null);
    setScreen('weather'); // Go back to decoy when locking
  };

  const handleResetApp = async () => {
    if (window.confirm("Bütün verileriniz, yerel anahtarlarınız ve konuşma geçmişiniz silinecektir! Emin misiniz?")) {
      socketClient.disconnect();
      await clearUserKeys();
      await clearAllSessions();
      await clearAllMessages();
      await clearAllRooms();
      setUnlockedKeys(null);
      setHasKeys(false);
      setScreen('setup');
    }
  };

  // Transition helper from weather decoy to secure area
  const triggerSecureTransition = () => {
    setWeatherError(null);
    setCityInput('');
    setScreen(hasKeys ? 'lock' : 'setup');
  };

  const isValidCity = (city: string): boolean => {
    const normalizedInput = normalizeString(city.trim());
    return POPULAR_CITIES.some(popularCity => 
      normalizeString(popularCity) === normalizedInput
    );
  };

  // Weather search and secret key trigger handler
  const handleWeatherSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const query = cityInput.trim().toLowerCase();

    // SECRET TRIGGER WORD!
    if (query === 'r6v2' || query === 'gizlisohbet' || query === 'secretchat') {
      triggerSecureTransition();
      setCityInput('');
      return;
    }

    if (!query) return;

    if (!isValidCity(query)) {
      setWeatherError("Lütfen arama kutusuna yazıp listeden geçerli bir şehir seçin.");
      return;
    }

    fetchWeather(query);
  };

  const renderWeatherIcon = (iconName: string, size = 72) => {
    switch (iconName) {
      case 'sunny':
        return <Sun size={size} color="#fbbf24" style={{ filter: 'drop-shadow(0 0 12px rgba(251,191,36,0.5))' }} />;
      case 'cloudy':
        return <Cloud size={size} color="#9ca3af" style={{ filter: 'drop-shadow(0 0 8px rgba(156,163,175,0.3))' }} />;
      case 'rainy':
        return <CloudRain size={size} color="#60a5fa" style={{ filter: 'drop-shadow(0 0 8px rgba(96,165,250,0.3))' }} />;
      case 'windy':
        return <Wind size={size} color="#38bdf8" style={{ filter: 'drop-shadow(0 0 8px rgba(56,189,248,0.3))' }} />;
      case 'lightning':
        return <CloudLightning size={size} color="#f59e0b" style={{ filter: 'drop-shadow(0 0 10px rgba(245,158,11,0.5))' }} />;
      default:
        return <Sun size={size} color="#fbbf24" />;
    }
  };

  const renderScreen = () => {
    switch (screen) {
      case 'loading':
        return (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', color: '#71717a' }}>
            <div style={{ fontSize: '1.2rem', fontWeight: 600 }}>Güvenli veritabanı yükleniyor...</div>
          </div>
        );

      case 'weather':
        return (
          <div className="glass-panel animate-slide-up" style={{ maxWidth: '500px', width: '100%', padding: '32px', border: '1px solid rgba(255, 255, 255, 0.08)' }}>
            
            {/* Decoy Header Design */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px', marginBottom: '24px' }}>
              <div className="pulse-radar" style={{
                width: '10px',
                height: '10px',
                background: '#10b981',
                borderRadius: '50%',
                boxShadow: '0 0 8px #10b981'
              }} />
              <h1 style={{
                fontSize: '1rem',
                fontWeight: 800,
                color: '#10b981',
                letterSpacing: '0.15em',
                margin: 0,
                textTransform: 'uppercase'
              }}>
                Canlı Meteoroloji Servisi
              </h1>
            </div>

            {/* Weather Search Bar */}
            <form onSubmit={handleWeatherSearch} style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '24px' }}>
              <div style={{ flex: 1, minWidth: '200px', position: 'relative' }}>
                <input
                  type="text"
                  placeholder="Şehir arayın (örn: Londra, Tokyo)..."
                  value={cityInput}
                  onChange={(e) => handleInputChange(e.target.value)}
                  onFocus={() => {
                    if (cityInput.trim().length > 0) {
                      setShowSuggestions(true);
                    }
                  }}
                  onBlur={() => {
                    setTimeout(() => setShowSuggestions(false), 200);
                  }}
                  style={{
                    paddingLeft: '44px',
                    borderColor: weatherError ? '#ef4444' : 'rgba(255, 255, 255, 0.05)',
                    background: 'rgba(255, 255, 255, 0.02)'
                  }}
                />
                <SearchIcon size={18} color="#71717a" style={{ position: 'absolute', left: '16px', top: '50%', transform: 'translateY(-50%)' }} />

                {/* Suggestions Dropdown */}
                {showSuggestions && suggestions.length > 0 && (
                  <div style={{
                    position: 'absolute',
                    top: 'calc(100% + 6px)',
                    left: 0,
                    right: 0,
                    background: 'rgba(20, 20, 25, 0.95)',
                    backdropFilter: 'blur(12px)',
                    border: '1px solid rgba(255, 255, 255, 0.08)',
                    borderRadius: '12px',
                    boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.5), 0 8px 10px -6px rgba(0, 0, 0, 0.5)',
                    zIndex: 50,
                    overflow: 'hidden'
                  }}>
                    {suggestions.map((city, idx) => (
                      <div
                        key={idx}
                        onClick={() => {
                          setCityInput(city);
                          setSuggestions([]);
                          setShowSuggestions(false);
                          fetchWeather(city);
                        }}
                        style={{
                          padding: '12px 16px',
                          fontSize: '0.95rem',
                          color: '#e4e4e7',
                          cursor: 'pointer',
                          textAlign: 'left',
                          transition: 'all 0.2s ease',
                          borderBottom: idx < suggestions.length - 1 ? '1px solid rgba(255, 255, 255, 0.03)' : 'none'
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.background = 'rgba(16, 185, 129, 0.1)';
                          e.currentTarget.style.color = '#10b981';
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.background = 'transparent';
                          e.currentTarget.style.color = '#e4e4e7';
                        }}
                      >
                        {city}
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <button type="submit" className="primary" style={{ padding: '12px 20px', borderRadius: '12px', background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)', border: 'none', color: '#fff', fontWeight: 600 }}>
                Ara
              </button>

              {weatherError && (
                <div style={{ width: '100%', color: '#ef4444', fontSize: '0.8rem', marginTop: '6px', paddingLeft: '4px' }}>
                  {weatherError}
                </div>
              )}
            </form>

            {/* Main Weather Card (Double click triggers secret chat entrance) */}
            <div 
              onDoubleClick={triggerSecureTransition}
              style={{
                textAlign: 'center',
                padding: '30px 24px',
                background: 'linear-gradient(180deg, rgba(255, 255, 255, 0.03) 0%, rgba(255, 255, 255, 0.01) 100%)',
                border: '1px solid rgba(255, 255, 255, 0.06)',
                borderRadius: '24px',
                cursor: 'default',
                userSelect: 'none',
                position: 'relative',
                overflow: 'hidden',
                minHeight: '260px',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'center'
              }}
            >
              {/* Decorative Glow Grid */}
              <div style={{
                position: 'absolute',
                top: '-50%',
                left: '-50%',
                width: '200%',
                height: '200%',
                background: 'radial-gradient(circle, rgba(16, 185, 129, 0.04) 0%, transparent 70%)',
                pointerEvents: 'none'
              }} />

              {weatherLoading ? (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '12px' }}>
                  <div style={{ width: '32px', height: '32px', border: '3px solid rgba(16, 185, 129, 0.1)', borderTop: '3px solid #10b981', borderRadius: '50%', animation: 'pulse-radar 1s infinite linear' }} />
                  <span style={{ fontSize: '0.9rem', color: '#71717a', fontWeight: 500 }}>Güncel veriler alınıyor...</span>
                </div>
              ) : weatherError ? (
                <div style={{ padding: '20px 10px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px' }}>
                  <div style={{
                    width: '56px',
                    height: '56px',
                    borderRadius: '50%',
                    background: 'rgba(239, 68, 68, 0.1)',
                    border: '1px solid rgba(239, 68, 68, 0.2)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#ef4444'
                  }}>
                    <CloudRain size={28} />
                  </div>
                  <div>
                    <h3 style={{ fontSize: '1.25rem', fontWeight: 700, color: '#fff', margin: '0 0 6px 0' }}>Şehir Bulunamadı</h3>
                    <p style={{ fontSize: '0.85rem', color: '#a1a1aa', margin: 0, maxWidth: '280px', lineHeight: '1.4' }}>
                      Aradığınız şehir için meteoroloji verisi bulunamadı. Lütfen yazımı kontrol edip tekrar deneyin.
                    </p>
                  </div>
                </div>
              ) : (
                <>
                  <h2 style={{ fontSize: '2.25rem', fontWeight: 800, margin: '0 0 8px 0', color: '#fff', letterSpacing: '-0.02em' }}>
                    {weatherData.city}
                  </h2>
                  <div style={{ fontSize: '0.8rem', color: '#71717a', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '24px' }}>
                    Anlık Hava Durumu Raporu
                  </div>
                  
                  <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '24px', marginBottom: '20px' }}>
                    {renderWeatherIcon(weatherData.icon, 80)}
                    <span style={{ fontSize: '4rem', fontWeight: 900, color: '#fff', letterSpacing: '-0.03em' }}>
                      {weatherData.temp}
                    </span>
                  </div>

                  <div style={{ fontSize: '1.2rem', fontWeight: 700, color: '#e4e4e7', marginBottom: '28px' }}>
                    {weatherData.condition}
                  </div>

                  {/* Sub-parameters */}
                  <div style={{ display: 'flex', justifyContent: 'space-around', borderTop: '1px solid rgba(255, 255, 255, 0.06)', paddingTop: '24px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <Droplets size={22} color="#60a5fa" />
                      <div style={{ textAlign: 'left' }}>
                        <div style={{ fontSize: '0.75rem', color: '#71717a', fontWeight: 500 }}>Nem Oranı</div>
                        <div style={{ fontSize: '1rem', fontWeight: 700, color: '#fff' }}>{weatherData.humidity}</div>
                      </div>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <Wind size={22} color="#34d399" />
                      <div style={{ textAlign: 'left' }}>
                        <div style={{ fontSize: '0.75rem', color: '#71717a', fontWeight: 500 }}>Rüzgar Hızı</div>
                        <div style={{ fontSize: '1rem', fontWeight: 700, color: '#fff' }}>{weatherData.wind}</div>
                      </div>
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* World Cities Interactive List */}
            <div style={{ marginTop: '28px' }}>
              <h4 style={{ margin: '0 0 14px 4px', fontSize: '0.75rem', color: '#71717a', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 700 }}>
                Dünya Şehirleri
              </h4>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {[
                  { name: 'Londra', query: 'London', icon: 'rainy', temp: '14°C' },
                  { name: 'New York', query: 'New York', icon: 'sunny', temp: '22°C' },
                  { name: 'Tokyo', query: 'Tokyo', icon: 'cloudy', temp: '25°C' },
                  { name: 'Paris', query: 'Paris', icon: 'sunny', temp: '20°C' },
                  { name: 'Sidney', query: 'Sydney', icon: 'sunny', temp: '18°C' }
                ].map((d) => (
                  <div 
                    key={d.query} 
                    onClick={() => fetchWeather(d.query)}
                    className="weather-district-row"
                    style={{ 
                      display: 'flex', 
                      justifyContent: 'space-between', 
                      alignItems: 'center', 
                      padding: '12px 18px', 
                      background: 'rgba(255,255,255,0.01)', 
                      border: '1px solid rgba(255,255,255,0.03)', 
                      borderRadius: '16px',
                      cursor: 'pointer',
                      transition: 'all 0.2s ease'
                    }}
                  >
                    <span style={{ fontSize: '0.9rem', fontWeight: 600, color: '#d4d4d8' }}>{d.name}</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      {renderWeatherIcon(d.icon, 20)}
                      <span style={{ fontSize: '0.9rem', fontWeight: 700, color: '#a1a1aa' }}>
                        Canlı veri için tıklayın
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div style={{ textAlign: 'center', marginTop: '24px', fontSize: '0.75rem', color: 'rgba(255, 255, 255, 0.15)' }}>
              © 2026 R6V2 Meteorological Technologies. All rights reserved.
            </div>
          </div>
        );

      case 'setup':
        return <SetupScreen onSetupComplete={handleSetupComplete} />;

      case 'lock':
        return (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '20px' }}>
            <LockScreen onUnlock={handleUnlock} />
            <button className="secondary" onClick={handleResetApp} style={{ fontSize: '0.85rem', color: '#ef4444', border: '1px solid rgba(239, 68, 68, 0.2)', background: 'rgba(239, 68, 68, 0.05)' }}>
              Uygulamayı Sıfırla (Bütün Verileri Sil)
            </button>
          </div>
        );

      case 'chat-list':
        return (
          <ChatListScreen
            username={unlockedKeys?.username || ''}
            socketStatus={socketStatus}
            onSelectChat={handleSelectChat}
            onNavigateToCreateRoom={() => setScreen('create-room')}
            onLock={handleLockApp}
          />
        );

      case 'chat':
        if (!activeChatId || !unlockedKeys) return null;
        return (
          <ChatScreen
            chatId={activeChatId}
            isGroup={activeChatIsGroup}
            userKeys={unlockedKeys}
            onBack={() => {
              setActiveChatId(null);
              setScreen('chat-list');
            }}
            onViewSafetyNumber={(remoteUser) => {
              setSafetyNumberUser(remoteUser);
              setScreen('safety-number');
            }}
          />
        );

      case 'create-room':
        return (
          <CreateRoomScreen
            username={unlockedKeys?.username || ''}
            onBack={() => setScreen('chat-list')}
            onRoomCreated={(roomId) => {
              setActiveChatId(roomId);
              setActiveChatIsGroup(true);
              setScreen('chat');
            }}
          />
        );

      case 'safety-number':
        if (!safetyNumberUser || !unlockedKeys) return null;
        return (
          <SafetyNumberScreen
            remoteUser={safetyNumberUser}
            userKeys={unlockedKeys}
            onBack={() => setScreen('chat')}
          />
        );

      default:
        return null;
    }
  };

  return (
    <div className="app-container">
      {/* Title logo branding overlay (ONLY visible inside secure area) */}
      {screen !== 'weather' && screen !== 'loading' && (
        <div style={{
          position: 'absolute',
          top: '20px',
          left: '30px',
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          color: '#fff',
          userSelect: 'none'
        }}>
          <Shield size={22} color="#8b5cf6" />
          <span style={{ fontWeight: 800, fontSize: '1.25rem', letterSpacing: '0.05em', background: 'linear-gradient(135deg, #fff 0%, #a1a1aa 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
            R6V2 CHAT
          </span>
        </div>
      )}

      {renderScreen()}
    </div>
  );
}

export default App;
