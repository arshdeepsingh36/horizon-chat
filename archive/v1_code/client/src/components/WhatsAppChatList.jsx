import React, { useState } from 'react';
import {
  Search,
  MoreVertical,
  Camera,
  MessageSquarePlus,
  Check,
  CheckCheck,
  User,
  LogOut,
  X,
  Phone,
  Video
} from 'lucide-react';

export default function WhatsAppChatList({
  user,
  chats,
  onSelectChat,
  onLogout,
  apiBaseUrl,
  token
}) {
  const [activeTab, setActiveTab] = useState('chats'); // 'chats' | 'status' | 'calls'
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [showMenu, setShowMenu] = useState(false);
  const [showNewChatModal, setShowNewChatModal] = useState(false);
  const [newChatHandle, setNewChatHandle] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);

  // Filter existing chats based on search
  const filteredChats = chats.filter((c) =>
    c.partnerUsername.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (c.lastMessage?.text || '').toLowerCase().includes(searchQuery.toLowerCase())
  );

  const totalUnread = chats.reduce((acc, c) => acc + (c.unreadCount || 0), 0);

  // Search users for new chat
  const handleSearchUsers = async (q) => {
    setNewChatHandle(q);
    if (!q.trim()) {
      setSearchResults([]);
      return;
    }
    setSearching(true);
    try {
      const res = await fetch(`${apiBaseUrl}/api/users/search?q=${encodeURIComponent(q)}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      setSearchResults(data || []);
    } catch (err) {
      console.error(err);
    } finally {
      setSearching(false);
    }
  };

  const handleStartChatWith = (partnerHandle) => {
    const clean = partnerHandle.trim().toLowerCase();
    if (!clean || clean === user.username.toLowerCase()) return;
    setShowNewChatModal(false);
    setNewChatHandle('');
    onSelectChat(clean);
  };

  const formatChatTime = (ts) => {
    if (!ts) return '';
    const date = new Date(ts);
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();
    if (isToday) {
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  };

  return (
    <div className="wa-chat-list-screen">
      {/* WhatsApp Android Top App Bar */}
      <div className="wa-app-bar">
        <div className="wa-app-bar-top">
          <span className="wa-app-title">WhatsApp</span>
          <div className="wa-app-actions">
            <button
              className="wa-action-icon"
              title="Camera"
              onClick={() => alert('Camera feature: Snap photo to send in chat.')}
            >
              <Camera size={19} />
            </button>
            <button
              className="wa-action-icon"
              title="Search"
              onClick={() => setShowSearch(!showSearch)}
            >
              <Search size={19} />
            </button>
            <div style={{ position: 'relative' }}>
              <button
                className="wa-action-icon"
                title="More options"
                onClick={() => setShowMenu(!showMenu)}
              >
                <MoreVertical size={19} />
              </button>
              {showMenu && (
                <div
                  style={{
                    position: 'absolute',
                    top: 28,
                    right: 0,
                    backgroundColor: 'var(--wa-header-bg)',
                    border: '1px solid var(--wa-border)',
                    borderRadius: 8,
                    padding: '8px 0',
                    width: 160,
                    boxShadow: '0 8px 24px rgba(0,0,0,0.6)',
                    zIndex: 100
                  }}
                >
                  <div
                    style={{
                      padding: '8px 16px',
                      fontSize: 13,
                      cursor: 'pointer',
                      color: 'var(--wa-text-primary)'
                    }}
                    onClick={() => { setShowMenu(false); setShowNewChatModal(true); }}
                  >
                    New Chat
                  </div>
                  <div
                    style={{
                      padding: '8px 16px',
                      fontSize: 13,
                      cursor: 'pointer',
                      color: 'var(--wa-text-primary)'
                    }}
                    onClick={() => { setShowMenu(false); alert(`Logged in as @${user.username}`); }}
                  >
                    Profile (@{user.username})
                  </div>
                  <div
                    style={{
                      padding: '8px 16px',
                      fontSize: 13,
                      cursor: 'pointer',
                      color: 'var(--wa-danger)',
                      borderTop: '1px solid var(--wa-border)',
                      marginTop: 4
                    }}
                    onClick={() => { setShowMenu(false); onLogout(); }}
                  >
                    Log Out
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Tabs Bar: CHATS / STATUS / CALLS */}
        <div className="wa-tabs-bar">
          <div
            className={`wa-tab-item ${activeTab === 'chats' ? 'active' : ''}`}
            onClick={() => setActiveTab('chats')}
          >
            <span>CHATS</span>
            {totalUnread > 0 && <span className="wa-badge-pill">{totalUnread}</span>}
          </div>
          <div
            className={`wa-tab-item ${activeTab === 'status' ? 'active' : ''}`}
            onClick={() => setActiveTab('status')}
          >
            <span>STATUS</span>
          </div>
          <div
            className={`wa-tab-item ${activeTab === 'calls' ? 'active' : ''}`}
            onClick={() => setActiveTab('calls')}
          >
            <span>CALLS</span>
          </div>
        </div>
      </div>

      {/* Search Bar */}
      {showSearch && (
        <div className="wa-search-container animate-fade-in">
          <div className="wa-search-input-box">
            <Search size={16} />
            <input
              type="text"
              className="wa-search-input"
              placeholder="Search chats or messages..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              autoFocus
            />
            {searchQuery && (
              <button
                style={{ background: 'none', border: 'none', color: 'var(--wa-text-secondary)', cursor: 'pointer' }}
                onClick={() => setSearchQuery('')}
              >
                <X size={16} />
              </button>
            )}
          </div>
        </div>
      )}

      {/* Main Tab Content */}
      {activeTab === 'chats' && (
        <div className="wa-chats-feed">
          {filteredChats.length === 0 ? (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '60px 24px',
                textAlign: 'center',
                color: 'var(--wa-text-secondary)',
                gap: 12
              }}
            >
              <div
                style={{
                  width: 60,
                  height: 60,
                  borderRadius: '50%',
                  backgroundColor: 'rgba(0,168,132,0.15)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'var(--wa-teal)'
                }}
              >
                <MessageSquarePlus size={28} />
              </div>
              <p style={{ fontSize: 15, fontWeight: 600, color: 'var(--wa-text-primary)' }}>
                No conversations yet
              </p>
              <p style={{ fontSize: 13, maxWidth: 260 }}>
                Tap the green button below to start a Telegram-style cloud backed WhatsApp chat!
              </p>
            </div>
          ) : (
            filteredChats.map((chat) => {
              const isOutgoing = chat.lastMessage?.sender?.toLowerCase() === user.username.toLowerCase();
              const hasUnread = (chat.unreadCount || 0) > 0;

              return (
                <div
                  key={chat.partnerUsername}
                  className="wa-chat-item"
                  onClick={() => onSelectChat(chat.partnerUsername)}
                >
                  <div
                    className="wa-avatar"
                    style={{ backgroundColor: chat.avatarColor || '#00A884' }}
                  >
                    {chat.partnerUsername.charAt(0)}
                    {chat.online && <span className="wa-avatar-presence"></span>}
                  </div>

                  <div className="wa-chat-info">
                    <div className="wa-chat-row-top">
                      <span className="wa-contact-name">@{chat.partnerUsername}</span>
                      <span className={`wa-chat-time ${hasUnread ? 'unread' : ''}`}>
                        {formatChatTime(chat.lastMessage?.createdAt)}
                      </span>
                    </div>

                    <div className="wa-chat-row-bottom">
                      <div className="wa-last-msg-wrapper">
                        {isOutgoing && (
                          <span
                            className={`wa-tick-icon ${chat.lastMessage?.status === 'read' ? 'read' : chat.lastMessage?.status === 'delivered' ? 'delivered' : 'sent'}`}
                          >
                            {chat.lastMessage?.status === 'sent' ? (
                              <Check size={14} />
                            ) : (
                              <CheckCheck size={14} />
                            )}
                          </span>
                        )}
                        <span className="wa-last-msg-text">
                          {chat.lastMessage?.text || 'No messages yet'}
                        </span>
                      </div>

                      {hasUnread && (
                        <span className="wa-unread-badge">{chat.unreadCount}</span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {activeTab === 'status' && (
        <div style={{ padding: 16, color: 'var(--wa-text-secondary)', textAlign: 'center' }}>
          <p style={{ fontSize: 14, marginTop: 40 }}>Status updates are clean & minimal.</p>
          <p style={{ fontSize: 12, marginTop: 8 }}>Focus strictly on real-time WhatsApp messaging.</p>
        </div>
      )}

      {activeTab === 'calls' && (
        <div style={{ padding: 16, color: 'var(--wa-text-secondary)', textAlign: 'center' }}>
          <p style={{ fontSize: 14, marginTop: 40 }}>Voice & video call records.</p>
        </div>
      )}

      {/* Floating Action Button (New Chat) */}
      <button
        type="button"
        className="wa-fab"
        onClick={() => setShowNewChatModal(true)}
        title="Start New WhatsApp Chat"
        id="wa-new-chat-fab"
      >
        <MessageSquarePlus size={24} />
      </button>

      {/* New Chat Modal */}
      {showNewChatModal && (
        <div className="wa-modal-overlay" onClick={() => setShowNewChatModal(false)}>
          <div className="wa-modal-box" onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <h2 className="wa-modal-title">New Chat</h2>
              <button
                style={{ background: 'none', border: 'none', color: 'var(--wa-text-secondary)', cursor: 'pointer' }}
                onClick={() => setShowNewChatModal(false)}
              >
                <X size={18} />
              </button>
            </div>

            <div className="wa-input-group">
              <label className="wa-input-label">Enter Contact Handle</label>
              <div className="wa-input-wrapper">
                <span className="wa-input-prefix">@</span>
                <input
                  type="text"
                  className="wa-input-field"
                  placeholder="e.g. sam, alex, john"
                  value={newChatHandle}
                  onChange={(e) => handleSearchUsers(e.target.value)}
                  autoFocus
                />
              </div>
            </div>

            {/* Matching Users */}
            {searchResults.length > 0 && (
              <div className="wa-user-results-list">
                {searchResults.map((u) => (
                  <div
                    key={u.id}
                    className="wa-search-user-row"
                    onClick={() => handleStartChatWith(u.username)}
                  >
                    <div
                      className="wa-avatar"
                      style={{ width: 34, height: 34, fontSize: 14, backgroundColor: u.avatar_color || '#00A884' }}
                    >
                      {u.username.charAt(0)}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                      <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--wa-text-primary)' }}>
                        @{u.username}
                      </span>
                      <span style={{ fontSize: 11, color: u.online ? 'var(--wa-teal)' : 'var(--wa-text-secondary)' }}>
                        {u.online ? 'online' : u.about}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <button
              type="button"
              className="wa-btn-primary"
              disabled={!newChatHandle.trim()}
              onClick={() => handleStartChatWith(newChatHandle)}
            >
              <span>START CHAT</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
