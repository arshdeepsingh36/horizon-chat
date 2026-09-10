import React, { useState, useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import { Trash2, Send, CheckCheck, AlertOctagon, User, ShieldAlert } from 'lucide-react';

export default function ChatScreen({ user, token, apiBaseUrl, onWipeSession }) {
  const [socket, setSocket] = useState(null);
  const [socketConnected, setSocketConnected] = useState(false);
  const [partnerUsername, setPartnerUsername] = useState('');
  const [partnerOnline, setPartnerOnline] = useState(false);
  const [peerTyping, setPeerTyping] = useState(false);
  
  // STRICT EPHEMERAL STATE: Messages exist in component RAM only!
  const [messages, setMessages] = useState([
    {
      id: 'init-sys',
      type: 'system',
      text: 'Session established. Zero data recorded to disk. Messages transit in RAM only.',
      timestamp: Date.now()
    }
  ]);
  const [inputText, setInputText] = useState('');
  const [showWipeModal, setShowWipeModal] = useState(false);
  const [connectingColdStart, setConnectingColdStart] = useState(false);

  const messagesEndRef = useRef(null);
  const typingTimeoutRef = useRef(null);

  // Auto-scroll to bottom of message feed
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, peerTyping]);

  // Tab unload warning per TRD / design rules
  useEffect(() => {
    const handleBeforeUnload = (e) => {
      e.preventDefault();
      e.returnValue = 'Chats are not saved. Reloading will erase all messages.';
      return 'Chats are not saved. Reloading will erase all messages.';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, []);

  // Establish authenticated WebSocket connection
  useEffect(() => {
    const coldTimer = setTimeout(() => {
      if (!socketConnected) setConnectingColdStart(true);
    }, 1500);

    const newSocket = io(apiBaseUrl, {
      auth: { token },
      transports: ['websocket', 'polling']
    });

    newSocket.on('connect', () => {
      clearTimeout(coldTimer);
      setConnectingColdStart(false);
      setSocketConnected(true);
      console.log('[Socket] Connected to ephemeral server');
    });

    newSocket.on('disconnect', () => {
      setSocketConnected(false);
      console.log('[Socket] Disconnected from ephemeral server');
    });

    // Handle incoming direct message
    newSocket.on('message_received', (msg) => {
      setMessages((prev) => [
        ...prev,
        {
          id: msg.id || crypto.randomUUID(),
          type: 'incoming',
          from: msg.from,
          text: msg.text,
          timestamp: msg.timestamp || Date.now()
        }
      ]);
      // If we don't have a partner selected yet, set it to the sender!
      setPartnerUsername((prevPartner) => prevPartner || msg.from);
    });

    // Handle dropped packet notification (recipient offline)
    newSocket.on('message_dropped', (data) => {
      setMessages((prev) => [
        ...prev,
        {
          id: data.id || crypto.randomUUID(),
          type: 'system-warning',
          text: `@${data.to} is offline. Ephemeral message was dropped immediately per zero-retention rules.`,
          timestamp: Date.now()
        }
      ]);
      setPartnerOnline(false);
    });

    // Listen for presence changes of other users
    newSocket.on('user_presence_change', (data) => {
      setPartnerUsername((currentPartner) => {
        if (currentPartner && currentPartner.toLowerCase() === data.username.toLowerCase()) {
          setPartnerOnline(data.online);
          if (!data.online) {
            setMessages((prev) => [
              ...prev,
              {
                id: crypto.randomUUID(),
                type: 'system-warning',
                text: `@${data.username} went offline. Undelivered messages are permanently dropped.`,
                timestamp: Date.now()
              }
            ]);
          }
        }
        return currentPartner;
      });
    });

    // Peer typing status
    newSocket.on('user_typing', (data) => {
      setPartnerUsername((currentPartner) => {
        if (currentPartner && currentPartner.toLowerCase() === data.from.toLowerCase()) {
          setPeerTyping(data.isTyping);
        }
        return currentPartner;
      });
    });

    setSocket(newSocket);

    return () => {
      clearTimeout(coldTimer);
      newSocket.disconnect();
    };
  }, [apiBaseUrl, token]);

  // Query partner presence when partner input changes
  useEffect(() => {
    if (!socket || !partnerUsername.trim()) {
      setPartnerOnline(false);
      return;
    }
    const cleanPartner = partnerUsername.trim().toLowerCase();
    socket.emit('user_status', { targetUsername: cleanPartner }, (response) => {
      if (response && response.username?.toLowerCase() === cleanPartner) {
        setPartnerOnline(!!response.online);
      }
    });

    const interval = setInterval(() => {
      socket.emit('user_status', { targetUsername: cleanPartner }, (response) => {
        if (response && response.username?.toLowerCase() === cleanPartner) {
          setPartnerOnline(!!response.online);
        }
      });
    }, 5000);

    return () => clearInterval(interval);
  }, [socket, partnerUsername]);

  // Handle typing indicator
  const handleInputChange = (e) => {
    const val = e.target.value;
    setInputText(val);

    if (socket && partnerUsername.trim()) {
      socket.emit('typing', { to: partnerUsername.trim(), isTyping: true });
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = setTimeout(() => {
        socket.emit('typing', { to: partnerUsername.trim(), isTyping: false });
      }, 1500);
    }
  };

  // Send ephemeral message
  const handleSendMessage = (e) => {
    e?.preventDefault();
    const cleanText = inputText.trim();
    const cleanPartner = partnerUsername.trim();

    if (!cleanText || !socket) return;
    if (!cleanPartner) {
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          type: 'system-warning',
          text: 'Please enter a target username handle above before sending.',
          timestamp: Date.now()
        }
      ]);
      return;
    }

    if (cleanPartner.toLowerCase() === user.username.toLowerCase()) {
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          type: 'system-warning',
          text: 'You cannot send an ephemeral direct message to yourself.',
          timestamp: Date.now()
        }
      ]);
      return;
    }

    const msgId = crypto.randomUUID();
    const timestamp = Date.now();

    // Optimistically push outgoing message to RAM state
    setMessages((prev) => [
      ...prev,
      {
        id: msgId,
        type: 'outgoing',
        to: cleanPartner,
        text: cleanText,
        timestamp,
        delivered: partnerOnline
      }
    ]);

    // Transmit over socket
    socket.emit('direct_message', {
      to: cleanPartner,
      text: cleanText
    });

    // Reset input
    setInputText('');
    if (socket) {
      socket.emit('typing', { to: cleanPartner, isTyping: false });
    }
  };

  // Wipe session: cleans RAM, disconnects socket, logs out
  const handleConfirmWipe = () => {
    if (socket) {
      socket.disconnect();
    }
    setMessages([]);
    onWipeSession();
  };

  const formatTime = (ts) => {
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="chat-layout" role="region" aria-label="Ephemeral Chat Room">
      {/* Top App Bar */}
      <header className="chat-header">
        <div className="header-left">
          <div className="user-badge" title="Your Authenticated Handle">
            <User size={14} />
            <span>@{user.username}</span>
          </div>
        </div>

        <div className="header-center" title="Chat Partner Handle & Presence">
          <div className="peer-input-wrapper">
            <span className="peer-prefix">to: @</span>
            <input
              type="text"
              className="peer-input"
              placeholder="target_handle"
              value={partnerUsername}
              onChange={(e) => setPartnerUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
              id="partner-username-input"
            />
          </div>

          <div
            className={`status-badge ${partnerOnline ? 'online' : socketConnected ? 'offline' : 'connecting'}`}
            aria-label={partnerOnline ? 'User is online' : 'User is offline'}
          >
            <span
              className={`presence-dot ${partnerOnline ? 'online' : socketConnected ? 'offline' : 'connecting'}`}
            ></span>
            <span>{partnerOnline ? 'ONLINE' : socketConnected ? 'OFFLINE' : 'CONNECTING'}</span>
          </div>
        </div>

        <div className="header-right">
          <button
            type="button"
            className="wipe-btn"
            onClick={() => setShowWipeModal(true)}
            id="wipe-session-btn"
            title="Wipe conversation from RAM"
          >
            <Trash2 size={14} />
            <span>WIPE</span>
          </button>
        </div>
      </header>

      {/* Cold Start Banner */}
      {connectingColdStart && (
        <div className="cold-start-banner" role="status" aria-live="polite">
          <span>Server instance is spinning up (~30s on cold start). Please wait...</span>
          <div className="cold-start-progress"></div>
        </div>
      )}

      {/* Ephemeral Message Stream */}
      <main className="message-stream" role="log" aria-live="polite">
        {messages.map((msg) => {
          if (msg.type === 'system') {
            return (
              <div key={msg.id} className="system-pill">
                {msg.text}
              </div>
            );
          }

          if (msg.type === 'system-warning') {
            return (
              <div key={msg.id} className="system-pill warning">
                {msg.text}
              </div>
            );
          }

          const isOutgoing = msg.type === 'outgoing';

          return (
            <div
              key={msg.id}
              className={`message-row ${isOutgoing ? 'outgoing' : 'incoming'}`}
            >
              <div className={`bubble ${isOutgoing ? 'outgoing' : 'incoming'}`}>
                <div className="bubble-text">{msg.text}</div>
                <div className="bubble-meta">
                  <span className="caption">{formatTime(msg.timestamp)}</span>
                  {isOutgoing && (
                    <span className="bubble-status-icon" title="Delivered in memory">
                      <CheckCheck size={13} strokeWidth={2.4} />
                    </span>
                  )}
                </div>
              </div>
            </div>
          );
        })}

        {/* Peer Typing Indicator */}
        {peerTyping && (
          <div className="typing-indicator" role="status">
            <span>@{partnerUsername} is typing</span>
            <div className="typing-dots">
              <span className="typing-dot"></span>
              <span className="typing-dot"></span>
              <span className="typing-dot"></span>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </main>

      {/* Bottom Input Dock */}
      <footer className="input-dock">
        <input
          type="text"
          className="message-input"
          placeholder={partnerUsername ? `Message @${partnerUsername}...` : "Set recipient handle above to chat..."}
          value={inputText}
          onChange={handleInputChange}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleSendMessage();
            }
          }}
          maxLength={2000}
          id="message-input-box"
          autoComplete="off"
        />
        <button
          type="button"
          className="send-btn"
          disabled={!inputText.trim()}
          onClick={handleSendMessage}
          id="send-message-btn"
          aria-label="Send ephemeral message"
        >
          <Send size={18} />
        </button>
      </footer>

      {/* Wipe Confirmation Modal */}
      {showWipeModal && (
        <div className="modal-overlay" role="dialog" aria-modal="true">
          <div className="modal-card">
            <div className="modal-icon-circle">
              <AlertOctagon size={28} />
            </div>
            <h2 className="modal-title">Wipe Session From Memory?</h2>
            <p className="modal-desc">
              This will permanently purge all messages from RAM, terminate the active WebSocket connection, and flush your session token. Undelivered messages are dropped forever.
            </p>
            <div className="modal-actions">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setShowWipeModal(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn-danger"
                onClick={handleConfirmWipe}
                id="confirm-wipe-btn"
              >
                Wipe & Discard
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
