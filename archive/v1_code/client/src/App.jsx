import React, { useState, useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import AndroidStatusBar from './components/AndroidStatusBar';
import WhatsAppAuth from './components/WhatsAppAuth';
import WhatsAppChatList from './components/WhatsAppChatList';
import WhatsAppChatView from './components/WhatsAppChatView';
import { Smartphone, Monitor } from 'lucide-react';
import './App.css';

export default function App() {
  const [token, setToken] = useState(() => localStorage.getItem('wa_token') || null);
  const [user, setUser] = useState(() => {
    try {
      const stored = localStorage.getItem('wa_user');
      return stored ? JSON.parse(stored) : null;
    } catch {
      return null;
    }
  });
  const [socket, setSocket] = useState(null);
  const [chats, setChats] = useState([]);
  const [activePartner, setActivePartner] = useState(null);
  const [isPhoneFrame, setIsPhoneFrame] = useState(true);

  const apiBaseUrl = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000';

  // Fetch chats list from cloud database
  const refreshChats = async (authToken = token) => {
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
      console.error('Failed to fetch chats:', err);
    }
  };

  // Socket Connection setup
  useEffect(() => {
    if (!token || !user) {
      if (socket) socket.disconnect();
      return;
    }

    refreshChats(token);

    const s = io(apiBaseUrl, {
      auth: { token },
      transports: ['websocket', 'polling']
    });

    s.on('connect', () => {
      console.log('[WhatsApp Cloud Socket] Connected as @' + user.username);
    });

    // When a message is received in real-time
    s.on('message_received', (msg) => {
      // Update chats list
      setChats((prev) => {
        const partner = msg.sender.toLowerCase() === user.username.toLowerCase() ? msg.recipient : msg.sender;
        const exists = prev.find((c) => c.partnerUsername.toLowerCase() === partner.toLowerCase());
        if (exists) {
          return prev.map((c) => {
            if (c.partnerUsername.toLowerCase() === partner.toLowerCase()) {
              return {
                ...c,
                lastMessage: {
                  id: msg.id,
                  sender: msg.sender,
                  text: msg.text,
                  type: msg.type,
                  status: msg.status,
                  createdAt: msg.createdAt
                },
                unreadCount: activePartner === partner ? 0 : (c.unreadCount || 0) + 1
              };
            }
            return c;
          });
        } else {
          return [
            {
              partnerUsername: partner,
              avatarColor: '#00A884',
              lastMessage: {
                id: msg.id,
                sender: msg.sender,
                text: msg.text,
                type: msg.type,
                status: msg.status,
                createdAt: msg.createdAt
              },
              unreadCount: activePartner === partner ? 0 : 1,
              online: true
            },
            ...prev
          ];
        }
      });
    });

    // Update presence
    s.on('user_presence_change', ({ username: pUser, online }) => {
      setChats((prev) =>
        prev.map((c) =>
          c.partnerUsername.toLowerCase() === pUser.toLowerCase()
            ? { ...c, online }
            : c
        )
      );
    });

    setSocket(s);

    return () => {
      s.disconnect();
    };
  }, [token, user?.username, apiBaseUrl, activePartner]);

  const handleLogin = ({ token: newToken, user: newUser }) => {
    setToken(newToken);
    setUser(newUser);
  };

  const handleLogout = () => {
    localStorage.removeItem('wa_token');
    localStorage.removeItem('wa_user');
    if (socket) socket.disconnect();
    setToken(null);
    setUser(null);
    setActivePartner(null);
    setChats([]);
  };

  const handleSelectChat = (partnerUsername) => {
    setActivePartner(partnerUsername);
    // Mark unread as 0 locally
    setChats((prev) =>
      prev.map((c) =>
        c.partnerUsername.toLowerCase() === partnerUsername.toLowerCase()
          ? { ...c, unreadCount: 0 }
          : c
      )
    );
  };

  const handleBackToChats = () => {
    setActivePartner(null);
    refreshChats();
  };

  return (
    <div className="android-device-wrapper">
      {/* Screen Mode Toggle */}
      <button
        className="screen-mode-toggle"
        onClick={() => setIsPhoneFrame(!isPhoneFrame)}
        title="Toggle Android Device Frame"
      >
        {isPhoneFrame ? <Monitor size={14} /> : <Smartphone size={14} />}
        <span>{isPhoneFrame ? 'Desktop Mode' : 'Android Frame'}</span>
      </button>

      {/* Android Device Container */}
      <div
        className="android-phone"
        style={{
          maxWidth: isPhoneFrame ? '440px' : '900px',
          borderRadius: isPhoneFrame ? undefined : '18px'
        }}
      >
        {/* Status Bar */}
        <AndroidStatusBar />

        {/* Dynamic Screen */}
        {!token || !user ? (
          <WhatsAppAuth onLogin={handleLogin} apiBaseUrl={apiBaseUrl} />
        ) : activePartner ? (
          <WhatsAppChatView
            user={user}
            partnerUsername={activePartner}
            socket={socket}
            apiBaseUrl={apiBaseUrl}
            token={token}
            onBack={handleBackToChats}
            onMessageSent={() => refreshChats()}
          />
        ) : (
          <WhatsAppChatList
            user={user}
            chats={chats}
            onSelectChat={handleSelectChat}
            onLogout={handleLogout}
            apiBaseUrl={apiBaseUrl}
            token={token}
          />
        )}

        {/* Soft Navigation Gesture Bar */}
        <div className="android-nav-bar">
          <div className="android-gesture-pill"></div>
        </div>
      </div>
    </div>
  );
}
