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
      transports: ['websocket', 'polling']
    });

    s.on('connect', () => {
      console.log(`[HORIZON SOCKET] Connected as @${user.username} (ID: ${user.id})`);
    });

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

    setSocket(s);

    return () => {
      s.disconnect();
    };
  }, [token, user?.id, apiBaseUrl, refreshChats, activePartner?.id]);

  const handleLogin = ({ token: newToken, user: newUser }) => {
    setToken(newToken);
    setUser(newUser);
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
          />
        ) : (
          <HorizonChatList
            user={user}
            chats={chats}
            onSelectChat={handleSelectChat}
            onLogout={handleLogout}
            apiBaseUrl={apiBaseUrl}
            token={token}
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
