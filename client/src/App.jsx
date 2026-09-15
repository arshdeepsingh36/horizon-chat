import React, { useState, useEffect, useCallback } from 'react';
import { io } from 'socket.io-client';
import AndroidStatusBar from './components/AndroidStatusBar';
import HorizonAuth from './components/HorizonAuth';
import HorizonChatList from './components/HorizonChatList';
import HorizonChatView from './components/HorizonChatView';
import { Smartphone, Monitor } from 'lucide-react';
import './App.css';

export default function App() {
  const [token, setToken] = useState(() => localStorage.getItem('horizon_token') || null);
  const [user, setUser] = useState(() => {
    try {
      const stored = localStorage.getItem('horizon_user');
      return stored ? JSON.parse(stored) : null;
    } catch {
      return null;
    }
  });

  const [socket, setSocket] = useState(null);
  const [chats, setChats] = useState([]);
  const [activePartner, setActivePartner] = useState(null); // { id, username, online }
  const [isPhoneFrame, setIsPhoneFrame] = useState(true);

  const apiBaseUrl = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000';

  // Fetch conversations summary from PostgreSQL / SQLite
  const refreshChats = useCallback(async (authToken = token) => {
    if (!authToken) return;
    try {
      const res = await fetch(`${apiBaseUrl}/api/chats`, {
        headers: { Authorization: `Bearer ${authToken}` }
      });
      const data = await res.json();
      if (Array.isArray(data)) {
        setChats(data);
      }
    } catch (err) {
      console.error('[FETCH CHATS ERROR]', err);
    }
  }, [apiBaseUrl, token]);

  // Socket Lifecycle (Rules Section 5: Socket Lifecycle cleanly managed)
  useEffect(() => {
    if (!token || !user) {
      if (socket) {
        socket.disconnect();
        setSocket(null);
      }
      return;
    }

    refreshChats(token);

    const s = io(apiBaseUrl, {
      auth: { token },
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000
    });

    const handleRoomJoin = () => {
      console.log(`[HORIZON SOCKET] Connected/Reconnected as @${user.username} (ID: ${user.id})`);
      s.emit('join_user', { userId: user.id });
      s.emit('join', `user_${user.id}`);
    };

    s.on('connect', handleRoomJoin);
    s.on('reconnect', handleRoomJoin);
    s.io?.on('reconnect', handleRoomJoin);

    // Real-time message receiver for dashboard updates
    s.on('new_message', (msg) => {
      setChats((prev) => {
        const sId = Number(msg.senderId ?? msg.sender_id);
        const rId = Number(msg.recipientId ?? msg.recipient_id);
        const partnerId = sId === Number(user.id) ? rId : sId;
        const exists = prev.find((c) => Number(c.partnerId) === partnerId);

        if (exists) {
          return prev.map((c) => {
            if (Number(c.partnerId) === partnerId) {
              return {
                ...c,
                lastMessage: {
                  id: Number(msg.id),
                  senderId: sId,
                  recipientId: rId,
                  text: msg.text ?? msg.message_text ?? msg.messageText ?? '',
                  attachmentType: msg.attachmentType ?? msg.attachment_type ?? 'NONE',
                  status: msg.status,
                  createdAt: msg.createdAt ?? msg.created_at
                },
                unreadCount: Number(activePartner?.id) === partnerId ? 0 : (c.unreadCount || 0) + 1
              };
            }
            return c;
          });
        } else {
          // New conversation appeared, trigger full refresh
          refreshChats(token);
          return prev;
        }
      });
    });

    // Online presence updates
    s.on('user_status_changed', ({ userId, status }) => {
      const isOnline = status === 'online';
      setChats((prev) =>
        prev.map((c) => (c.partnerId === userId ? { ...c, online: isOnline } : c))
      );

      setActivePartner((curr) =>
        curr && curr.id === userId ? { ...curr, online: isOnline } : curr
      );
    });

    // Real-time user profile updates
    s.on('user_profile_updated', (updatedUser) => {
      if (Number(updatedUser.id) === Number(user.id)) {
        setUser((prev) => {
          const next = { ...prev, ...updatedUser };
          localStorage.setItem('horizon_user', JSON.stringify(next));
          return next;
        });
      }
      setChats((prev) =>
        prev.map((c) =>
          Number(c.partnerId) === Number(updatedUser.id)
            ? { ...c, partnerDisplayName: updatedUser.displayName, partnerAvatarUrl: updatedUser.avatarUrl }
            : c
        )
      );
    });

    setSocket(s);

    return () => {
      s.disconnect();
    };
  }, [token, user?.id, apiBaseUrl, refreshChats, activePartner?.id]);

  // Push Notification Subscription (Web Push)
  useEffect(() => {
    if (!token || !user || !('serviceWorker' in navigator) || !('PushManager' in window)) return;

    const urlBase64ToUint8Array = (base64String) => {
      const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
      const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
      const rawData = window.atob(base64);
      const outputArray = new Uint8Array(rawData.length);
      for (let i = 0; i < rawData.length; ++i) {
        outputArray[i] = rawData.charCodeAt(i);
      }
      return outputArray;
    };

    const setupPush = async () => {
      try {
        const registration = await navigator.serviceWorker.register('/sw.js');
        const perm = await Notification.requestPermission();
        if (perm !== 'granted') return;

        const keyRes = await fetch(`${apiBaseUrl}/api/notifications/vapid-public-key`);
        const { publicKey } = await keyRes.json();
        if (!publicKey) return;

        let subscription = await registration.pushManager.getSubscription();
        if (!subscription) {
          subscription = await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(publicKey)
          });
        }

        await fetch(`${apiBaseUrl}/api/notifications/register-token`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`
          },
          body: JSON.stringify({
            subscription,
            deviceType: 'web'
          })
        });
      } catch (err) {
        console.warn('[PUSH REGISTRATION NOTICE]', err.message);
      }
    };

    setupPush();
  }, [token, user, apiBaseUrl]);

  // Silent sync on visibilitychange & window focus (catch missed messages while inactive)
  useEffect(() => {
    if (!token) return;

    const handleSync = () => {
      if (document.visibilityState === 'visible') {
        refreshChats(token);
      }
    };

    document.addEventListener('visibilitychange', handleSync);
    window.addEventListener('focus', handleSync);

    return () => {
      document.removeEventListener('visibilitychange', handleSync);
      window.removeEventListener('focus', handleSync);
    };
  }, [token, refreshChats]);

  const handleLogin = ({ token: newToken, user: newUser }) => {
    setToken(newToken);
    setUser(newUser);
  };

  const handleUpdateUser = (updatedFields) => {
    setUser((prev) => {
      const next = { ...prev, ...updatedFields };
      localStorage.setItem('horizon_user', JSON.stringify(next));
      return next;
    });
  };

  const handleLogout = () => {
    localStorage.removeItem('horizon_token');
    localStorage.removeItem('horizon_user');
    if (socket) socket.disconnect();
    setToken(null);
    setUser(null);
    setActivePartner(null);
    setChats([]);
  };

  const handleSelectChat = (partnerObj) => {
    setActivePartner(partnerObj);
    // Reset unread count locally
    setChats((prev) =>
      prev.map((c) =>
        c.partnerId === partnerObj.id ? { ...c, unreadCount: 0 } : c
      )
    );
  };

  const handleBackToChats = () => {
    setActivePartner(null);
    refreshChats();
  };

  return (
    <div className="horizon-wrapper">
      {/* Device Mode Toggle */}
      <button
        className="horizon-mode-toggle"
        onClick={() => setIsPhoneFrame(!isPhoneFrame)}
        title="Toggle Android Device Frame"
      >
        {isPhoneFrame ? <Monitor size={14} /> : <Smartphone size={14} />}
        <span>{isPhoneFrame ? 'Desktop Mode' : 'Android Frame'}</span>
      </button>

      {/* Android Device Chassis */}
      <div
        className="horizon-phone-chassis"
        style={{
          maxWidth: isPhoneFrame ? '440px' : '920px',
          borderRadius: isPhoneFrame ? undefined : '20px'
        }}
      >
        {/* Android Status Bar */}
        <AndroidStatusBar />

        {/* Dynamic View State */}
        {!token || !user ? (
          <HorizonAuth onLogin={handleLogin} apiBaseUrl={apiBaseUrl} />
        ) : activePartner ? (
          <HorizonChatView
            user={user}
            partner={activePartner}
            socket={socket}
            apiBaseUrl={apiBaseUrl}
            token={token}
            onBack={handleBackToChats}
            onMessageSent={() => refreshChats()}
            onUpdateUser={handleUpdateUser}
          />
        ) : (
          <HorizonChatList
            user={user}
            chats={chats}
            onSelectChat={handleSelectChat}
            onLogout={handleLogout}
            apiBaseUrl={apiBaseUrl}
            token={token}
            onUpdateUser={handleUpdateUser}
          />
        )}

        {/* Soft Navigation Gesture Bar */}
        <div className="horizon-nav-bar">
          <div className="horizon-nav-pill"></div>
        </div>
      </div>
    </div>
  );
}
