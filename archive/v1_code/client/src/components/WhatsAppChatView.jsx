import React, { useState, useEffect, useRef } from 'react';
import {
  ArrowLeft,
  Video,
  Phone,
  MoreVertical,
  Smile,
  Paperclip,
  Camera,
  Mic,
  Send,
  Check,
  CheckCheck,
  FileText,
  Image as ImageIcon,
  Headphones,
  Play,
  Pause,
  X
} from 'lucide-react';

const REACTION_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];

export default function WhatsAppChatView({
  user,
  partnerUsername,
  socket,
  apiBaseUrl,
  token,
  onBack,
  onMessageSent
}) {
  const [partnerInfo, setPartnerInfo] = useState({
    username: partnerUsername,
    avatarColor: '#00A884',
    online: false,
    about: 'Hey there! I am using WhatsApp.'
  });
  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [showAttachmentMenu, setShowAttachmentMenu] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [selectedMessageForReaction, setSelectedMessageForReaction] = useState(null);
  const [playingVoiceId, setPlayingVoiceId] = useState(null);

  const messagesEndRef = useRef(null);
  const typingTimerRef = useRef(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isTyping]);

  // Load cloud persistent message history from server (Telegram-style cloud retention)
  useEffect(() => {
    let isMounted = true;

    async function loadChatHistory() {
      try {
        const res = await fetch(`${apiBaseUrl}/api/messages/${partnerUsername}`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        const data = await res.json();
        if (isMounted && data) {
          if (data.partner) {
            setPartnerInfo(data.partner);
          }
          if (data.messages) {
            setMessages(data.messages);
          }
        }
      } catch (err) {
        console.error('Failed to load cloud messages:', err);
      }
    }

    loadChatHistory();

    // Notify partner that we opened the chat (triggering double blue ticks)
    if (socket) {
      socket.emit('mark_read', { partnerUsername });
    }

    return () => {
      isMounted = false;
    };
  }, [partnerUsername, apiBaseUrl, token, socket]);

  // Real-time socket listeners for incoming messages, blue ticks, reactions, and typing
  useEffect(() => {
    if (!socket) return;

    // Incoming message
    const handleIncomingMessage = (msg) => {
      if (
        msg.sender.toLowerCase() === partnerUsername.toLowerCase() ||
        msg.recipient.toLowerCase() === partnerUsername.toLowerCase()
      ) {
        setMessages((prev) => {
          if (prev.some((m) => m.id === msg.id)) return prev;
          return [...prev, msg];
        });

        // Automatically mark as read if message is from the active partner
        if (msg.sender.toLowerCase() === partnerUsername.toLowerCase()) {
          socket.emit('mark_read', { partnerUsername });
        }
      }
    };

    // Blue ticks: partner read our messages!
    const handleMessagesRead = ({ by, messageIds }) => {
      if (by.toLowerCase() === partnerUsername.toLowerCase()) {
        setMessages((prev) =>
          prev.map((m) =>
            messageIds.includes(m.id) ? { ...m, status: 'read' } : m
          )
        );
      }
    };

    // Reaction updated
    const handleReactionUpdated = ({ messageId, reactions }) => {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === messageId ? { ...m, reactions } : m
        )
      );
    };

    // Partner typing indicator
    const handleUserTyping = ({ from, isTyping: typingStatus }) => {
      if (from.toLowerCase() === partnerUsername.toLowerCase()) {
        setIsTyping(typingStatus);
      }
    };

    // Partner presence change
    const handlePresenceChange = ({ username: pUser, online: pOnline, lastSeen }) => {
      if (pUser.toLowerCase() === partnerUsername.toLowerCase()) {
        setPartnerInfo((prev) => ({ ...prev, online: pOnline, lastSeen }));
      }
    };

    socket.on('message_received', handleIncomingMessage);
    socket.on('messages_read', handleMessagesRead);
    socket.on('message_reaction_updated', handleReactionUpdated);
    socket.on('user_typing', handleUserTyping);
    socket.on('user_presence_change', handlePresenceChange);

    return () => {
      socket.off('message_received', handleIncomingMessage);
      socket.off('messages_read', handleMessagesRead);
      socket.off('message_reaction_updated', handleReactionUpdated);
      socket.off('user_typing', handleUserTyping);
      socket.off('user_presence_change', handlePresenceChange);
    };
  }, [socket, partnerUsername]);

  // Handle Input typing and emit typing status
  const handleInputChange = (e) => {
    const val = e.target.value;
    setInputText(val);

    if (socket) {
      socket.emit('typing', { to: partnerUsername, isTyping: true });
      if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
      typingTimerRef.current = setTimeout(() => {
        socket.emit('typing', { to: partnerUsername, isTyping: false });
      }, 1400);
    }
  };

  // Send message
  const handleSend = (customText = null, type = 'text', mediaUrl = '') => {
    const textToSend = (customText !== null ? customText : inputText).trim();
    if (!textToSend || !socket) return;

    // Optimistically create message
    const tempId = crypto.randomUUID();
    const createdAt = Date.now();
    const optimisticMsg = {
      id: tempId,
      sender: user.username,
      recipient: partnerUsername,
      text: textToSend,
      type,
      mediaUrl,
      status: partnerInfo.online ? 'delivered' : 'sent',
      reactions: {},
      createdAt
    };

    setMessages((prev) => [...prev, optimisticMsg]);
    if (customText === null) setInputText('');
    setShowAttachmentMenu(false);
    setShowEmojiPicker(false);

    // Transmit to server to save in cloud database
    socket.emit('send_message', {
      to: partnerUsername,
      text: textToSend,
      type,
      mediaUrl
    }, (res) => {
      if (res?.success && res.message) {
        setMessages((prev) =>
          prev.map((m) => (m.id === tempId ? res.message : m))
        );
        onMessageSent?.(res.message);
      }
    });

    socket.emit('typing', { to: partnerUsername, isTyping: false });
  };

  // Handle reaction on a message
  const handleToggleReaction = (msgId, emoji) => {
    if (!socket) return;
    socket.emit('add_reaction', {
      messageId: msgId,
      emoji,
      partnerUsername
    });
    setSelectedMessageForReaction(null);
  };

  // Format time
  const formatTime = (ts) => {
    if (!ts) return '';
    return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="wa-chat-view" onClick={() => setSelectedMessageForReaction(null)}>
      {/* WhatsApp Android Top Bar */}
      <header className="wa-chat-header" onClick={(e) => e.stopPropagation()}>
        <div className="wa-header-partner">
          <button className="wa-back-btn" onClick={onBack} title="Back to chats">
            <ArrowLeft size={20} />
          </button>
          <div
            className="wa-header-avatar"
            style={{ backgroundColor: partnerInfo.avatarColor || '#00A884' }}
          >
            {partnerUsername.charAt(0)}
          </div>
          <div className="wa-header-title-block">
            <span className="wa-header-name">@{partnerUsername}</span>
            <span
              className={`wa-header-subtitle ${isTyping ? 'typing' : partnerInfo.online ? 'online' : ''}`}
            >
              {isTyping
                ? 'typing...'
                : partnerInfo.online
                ? 'online'
                : partnerInfo.about || 'offline'}
            </span>
          </div>
        </div>

        <div className="wa-chat-actions">
          <button
            className="wa-action-icon"
            title="Video call"
            onClick={() => alert(`Starting simulated video call with @${partnerUsername}...`)}
          >
            <Video size={20} />
          </button>
          <button
            className="wa-action-icon"
            title="Voice call"
            onClick={() => alert(`Calling @${partnerUsername}...`)}
          >
            <Phone size={19} />
          </button>
          <button
            className="wa-action-icon"
            title="More"
            onClick={() => alert(`Chat with @${partnerUsername} is backed up in the cloud.`)}
          >
            <MoreVertical size={19} />
          </button>
        </div>
      </header>

      {/* Message Feed with WhatsApp Doodle Background */}
      <main className="wa-message-feed wa-wallpaper" role="log" aria-live="polite">
        <div className="wa-date-separator">TODAY</div>

        {messages.map((msg) => {
          const isOutgoing = msg.sender.toLowerCase() === user.username.toLowerCase();
          const reactionEntries = Object.entries(msg.reactions || {});
          const isReactionMenuOpen = selectedMessageForReaction === msg.id;

          return (
            <div
              key={msg.id}
              className={`wa-msg-row ${isOutgoing ? 'outgoing' : 'incoming'}`}
              onClick={(e) => {
                e.stopPropagation();
                setSelectedMessageForReaction(isReactionMenuOpen ? null : msg.id);
              }}
            >
              {/* Floating Reaction Bar */}
              {isReactionMenuOpen && (
                <div className="wa-reaction-bar" onClick={(e) => e.stopPropagation()}>
                  {REACTION_EMOJIS.map((emoji) => (
                    <button
                      key={emoji}
                      className="wa-reaction-btn"
                      onClick={() => handleToggleReaction(msg.id, emoji)}
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              )}

              <div className={`wa-bubble ${isOutgoing ? 'outgoing' : 'incoming'}`}>
                {/* Voice note simulation */}
                {msg.type === 'voice' ? (
                  <div className="wa-voice-note">
                    <button
                      className="wa-voice-play-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        setPlayingVoiceId(playingVoiceId === msg.id ? null : msg.id);
                      }}
                    >
                      {playingVoiceId === msg.id ? <Pause size={16} /> : <Play size={16} fill="white" />}
                    </button>
                    <div className="wa-voice-waveform">
                      {[12, 18, 8, 22, 14, 20, 10, 16, 24, 12, 18, 14, 8, 22, 16, 12].map((h, i) => (
                        <div
                          key={i}
                          className="wa-waveform-bar"
                          style={{
                            height: `${h}px`,
                            backgroundColor: playingVoiceId === msg.id && i < 8 ? 'var(--wa-teal)' : undefined
                          }}
                        />
                      ))}
                    </div>
                    <span style={{ fontSize: 11, color: 'var(--wa-text-secondary)', marginLeft: 4 }}>
                      {playingVoiceId === msg.id ? '0:07' : '0:14'}
                    </span>
                  </div>
                ) : (
                  <div className="wa-bubble-text">{msg.text}</div>
                )}

                <div className="wa-bubble-meta">
                  <span className="wa-bubble-time">{formatTime(msg.createdAt)}</span>
                  {isOutgoing && (
                    <span
                      className={`wa-tick-icon ${msg.status === 'read' ? 'read' : msg.status === 'delivered' ? 'delivered' : 'sent'}`}
                      title={`Status: ${msg.status}`}
                    >
                      {msg.status === 'sent' ? (
                        <Check size={13} strokeWidth={2.4} />
                      ) : (
                        <CheckCheck size={14} strokeWidth={2.4} />
                      )}
                    </span>
                  )}
                </div>

                {/* Reaction badge */}
                {reactionEntries.length > 0 && (
                  <div
                    className="wa-reactions-badge"
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedMessageForReaction(msg.id);
                    }}
                  >
                    {reactionEntries.map(([emoji, users]) => (
                      <span key={emoji}>
                        {emoji} {users.length > 1 && users.length}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {/* Typing indicator pill */}
        {isTyping && (
          <div
            style={{
              alignSelf: 'flex-start',
              backgroundColor: 'var(--wa-incoming)',
              padding: '6px 12px',
              borderRadius: '8px 8px 8px 0px',
              fontSize: 12,
              color: 'var(--wa-teal)',
              fontStyle: 'italic',
              boxShadow: '0 1px 2px rgba(0,0,0,0.3)'
            }}
          >
            @{partnerUsername} is typing...
          </div>
        )}

        <div ref={messagesEndRef} />
      </main>

      {/* Attachment Options Drawer */}
      {showAttachmentMenu && (
        <div className="wa-attachment-sheet" onClick={(e) => e.stopPropagation()}>
          <button
            className="wa-attach-item"
            onClick={() => handleSend('Shared Document: project_spec_2026.pdf 📄', 'text')}
          >
            <div className="wa-attach-circle" style={{ backgroundColor: '#7F66FF' }}>
              <FileText size={22} />
            </div>
            <span className="wa-attach-label">Document</span>
          </button>

          <button
            className="wa-attach-item"
            onClick={() => handleSend('Photo: IMG_20260910_1340.jpg 📸', 'text')}
          >
            <div className="wa-attach-circle" style={{ backgroundColor: '#D3396D' }}>
              <Camera size={22} />
            </div>
            <span className="wa-attach-label">Camera</span>
          </button>

          <button
            className="wa-attach-item"
            onClick={() => handleSend('Photo from Gallery 🖼️', 'text')}
          >
            <div className="wa-attach-circle" style={{ backgroundColor: '#AC44CF' }}>
              <ImageIcon size={22} />
            </div>
            <span className="wa-attach-label">Gallery</span>
          </button>

          <button
            className="wa-attach-item"
            onClick={() => handleSend('Voice Message Note 🎙️', 'voice')}
          >
            <div className="wa-attach-circle" style={{ backgroundColor: '#00A884' }}>
              <Headphones size={22} />
            </div>
            <span className="wa-attach-label">Audio</span>
          </button>
        </div>
      )}

      {/* Quick Emoji Bar */}
      {showEmojiPicker && (
        <div
          style={{
            position: 'absolute',
            bottom: 60,
            left: 8,
            right: 8,
            backgroundColor: 'var(--wa-header-bg)',
            border: '1px solid var(--wa-border)',
            borderRadius: 16,
            padding: '10px 14px',
            display: 'flex',
            justifyContent: 'space-around',
            fontSize: 24,
            boxShadow: '0 8px 24px rgba(0,0,0,0.6)',
            zIndex: 40
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {['😀', '😂', '🔥', '🎉', '❤️', '👍', '🙏', '🚀', '💯'].map((emo) => (
            <span
              key={emo}
              style={{ cursor: 'pointer', transition: 'transform 0.1s' }}
              onClick={() => {
                setInputText((prev) => prev + emo);
                setShowEmojiPicker(false);
              }}
            >
              {emo}
            </span>
          ))}
        </div>
      )}

      {/* WhatsApp Bottom Input Dock */}
      <footer className="wa-input-dock" onClick={(e) => e.stopPropagation()}>
        <div className="wa-input-capsule">
          <button
            type="button"
            className="wa-dock-icon"
            onClick={() => setShowEmojiPicker(!showEmojiPicker)}
            title="Emojis"
          >
            <Smile size={22} />
          </button>

          <textarea
            className="wa-message-textarea"
            placeholder="Message"
            rows={1}
            value={inputText}
            onChange={handleInputChange}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            id="wa-message-input"
          />

          <button
            type="button"
            className="wa-dock-icon"
            onClick={() => setShowAttachmentMenu(!showAttachmentMenu)}
            title="Attach"
          >
            <Paperclip size={20} />
          </button>

          <button
            type="button"
            className="wa-dock-icon"
            onClick={() => handleSend('Photo: Snap from camera 📷', 'text')}
            title="Camera"
          >
            <Camera size={20} />
          </button>
        </div>

        {/* Circular Send or Mic Button */}
        <button
          type="button"
          className="wa-send-circle-btn"
          onClick={() => {
            if (inputText.trim()) {
              handleSend();
            } else {
              // Click microphone to simulate voice note
              handleSend('Voice message (0:14)', 'voice');
            }
          }}
          title={inputText.trim() ? 'Send message' : 'Send Voice Note'}
          id="wa-send-action-btn"
        >
          {inputText.trim() ? (
            <Send size={20} style={{ marginLeft: 2 }} />
          ) : (
            <Mic size={22} />
          )}
        </button>
      </footer>
    </div>
  );
}
