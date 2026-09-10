import React, { useState } from 'react';
import {
  Search,
  MoreVertical,
  MessageSquarePlus,
  Check,
  CheckCheck,
  LogOut,
  X,
  User,
  Loader2,
  Image as ImageIcon
} from 'lucide-react';

export default function HorizonChatList({
  user,
  chats,
  onSelectChat,
  onLogout,
  apiBaseUrl,
  token
}) {
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [showMenu, setShowMenu] = useState(false);
  const [showNewChatModal, setShowNewChatModal] = useState(false);
  const [searchUsername, setSearchUsername] = useState('');
  const [lookupResult, setLookupResult] = useState(null);
  const [lookupError, setLookupError] = useState('');
  const [lookingUp, setLookingUp] = useState(false);

  // Filter existing chats locally
  const filteredChats = chats.filter((c) => {
    const partner = (c.partnerUsername || '').toLowerCase();
    const text = (c.lastMessage?.text || '').toLowerCase();
    const q = searchQuery.toLowerCase().trim();
    return partner.includes(q) || text.includes(q);
  });

  const handleLookupUser = async (e) => {
    e?.preventDefault();
    const clean = searchUsername.trim().toLowerCase().replace(/^@/, '');
    setLookupError('');
    setLookupResult(null);

    if (!clean) {
      setLookupError('Enter a username to search.');
      return;
    }

    if (clean === user.username.toLowerCase()) {
      setLookupError('You cannot start a conversation with yourself.');
      return;
    }

    setLookingUp(true);
    try {
      const res = await fetch(`${apiBaseUrl}/api/users/lookup?username=${encodeURIComponent(clean)}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (!res.ok) {
        setLookupError(data.error || 'User not found in Horizon directory.');
        return;
      }
      setLookupResult(data);
    } catch (err) {
      console.error('[LOOKUP ERROR]', err);
      setLookupError('Network error connecting to directory.');
    } finally {
      setLookingUp(false);
    }
  };

  const handleStartChatWith = (partner) => {
    setShowNewChatModal(false);
    setSearchUsername('');
    setLookupResult(null);
    setLookupError('');
    onSelectChat(partner);
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
    <div className="horizon-chat-list-view">
      {/* Top App Bar (Dusk Navy #162238) */}
      <div className="horizon-toolbar">
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span className="horizon-toolbar-title">Horizon Chat</span>
          <span
            style={{
              fontSize: '11px',
              padding: '2px 8px',
              backgroundColor: 'rgba(245, 158, 11, 0.15)',
              color: 'var(--color-accent-amber)',
              borderRadius: '12px',
              fontWeight: 600
            }}
          >
            @{user.username}
          </span>
        </div>

        <div className="horizon-toolbar-actions">
          <button
            className="horizon-dock-clip"
            onClick={() => setShowSearch(!showSearch)}
            title="Search conversations"
            id="btnSearchConversations"
          >
            <Search size={19} />
          </button>

          <div style={{ position: 'relative' }}>
            <button
              className="horizon-dock-clip"
              onClick={() => setShowMenu(!showMenu)}
              title="Menu"
              id="btnMenu"
            >
              <MoreVertical size={19} />
            </button>

            {showMenu && (
              <div
                style={{
                  position: 'absolute',
                  top: '32px',
                  right: 0,
                  backgroundColor: 'var(--color-surface-elevated)',
                  border: '1px solid rgba(245, 158, 11, 0.25)',
                  borderRadius: '12px',
                  padding: '8px 0',
                  width: '170px',
                  boxShadow: '0 8px 24px rgba(0,0,0,0.6)',
                  zIndex: 100
                }}
              >
                <div
                  style={{
                    padding: '8px 16px',
                    fontSize: '12px',
                    color: 'var(--color-text-muted)',
                    borderBottom: '1px solid rgba(255,255,255,0.06)'
                  }}
                >
                  Signed in as<br />
                  <strong style={{ color: 'var(--color-text-primary)' }}>@{user.username}</strong>
                </div>
                <button
                  onClick={() => {
                    setShowMenu(false);
                    setShowNewChatModal(true);
                  }}
                  style={{
                    width: '100%',
                    padding: '10px 16px',
                    textAlign: 'left',
                    background: 'none',
                    border: 'none',
                    color: 'var(--color-text-primary)',
                    fontSize: '13px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    cursor: 'pointer'
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--color-surface)')}
                  onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                >
                  <MessageSquarePlus size={15} color="var(--color-accent-amber)" />
                  <span>New Conversation</span>
                </button>
                <button
                  onClick={() => {
                    setShowMenu(false);
                    onLogout();
                  }}
                  style={{
                    width: '100%',
                    padding: '10px 16px',
                    textAlign: 'left',
                    background: 'none',
                    border: 'none',
                    color: '#EF4444',
                    fontSize: '13px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    cursor: 'pointer'
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--color-surface)')}
                  onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                >
                  <LogOut size={15} />
                  <span>Sign Out</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Inline Search Bar */}
      {showSearch && (
        <div
          style={{
            padding: '8px 16px',
            backgroundColor: 'var(--color-surface)',
            borderBottom: '1px solid rgba(255, 255, 255, 0.04)',
            display: 'flex',
            alignItems: 'center',
            gap: '8px'
          }}
        >
          <Search size={16} color="var(--color-text-muted)" />
          <input
            type="text"
            placeholder="Search chats by name or message..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{
              flex: 1,
              background: 'transparent',
              border: 'none',
              color: 'var(--color-text-primary)',
              fontSize: '13px',
              outline: 'none'
            }}
            autoFocus
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              style={{ background: 'none', border: 'none', color: 'var(--color-text-muted)', cursor: 'pointer' }}
            >
              <X size={15} />
            </button>
          )}
        </div>
      )}

      {/* Conversations Recycler Canvas */}
      <div className="horizon-chat-recycler" id="recyclerChats">
        {filteredChats.length === 0 ? (
          <div
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '32px 24px',
              textAlign: 'center',
              color: 'var(--color-text-muted)'
            }}
          >
            <div
              style={{
                width: '64px',
                height: '64px',
                borderRadius: '50%',
                backgroundColor: 'var(--color-surface)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: '16px',
                color: 'var(--color-accent-amber)',
                border: '1px solid rgba(245, 158, 11, 0.2)'
              }}
            >
              <MessageSquarePlus size={28} />
            </div>
            <h3 style={{ color: 'var(--color-text-primary)', fontSize: '17px', marginBottom: '6px' }}>
              No Conversations Yet
            </h3>
            <p style={{ fontSize: '13px', lineHeight: '1.5', maxWidth: '280px' }}>
              Tap the amber button below to search the directory and start a real-time cloud chat.
            </p>
          </div>
        ) : (
          filteredChats.map((chat) => {
            const partnerName = chat.partnerUsername;
            const lastMsg = chat.lastMessage;
            const senderId = Number(lastMsg?.senderId ?? lastMsg?.sender_id);
            const isSentByMe = senderId === Number(user.id);
            const isOnline = chat.online;
            const messageText = lastMsg?.text ?? lastMsg?.message_text ?? lastMsg?.messageText ?? '';
            const isImage = (lastMsg?.attachmentType || lastMsg?.attachment_type) === 'IMAGE';
            const msgTime = lastMsg?.createdAt || lastMsg?.created_at;

            return (
              <div
                key={chat.partnerId || partnerName}
                className="horizon-chat-cell"
                onClick={() => onSelectChat({ id: chat.partnerId, username: partnerName, online: isOnline })}
              >
                {/* 48x48 Circular Avatar with Online Amber Dot */}
                <div className={`horizon-cell-avatar ${isOnline ? 'online' : ''}`}>
                  {(partnerName || 'U').slice(0, 2).toUpperCase()}
                </div>

                {/* Content */}
                <div className="horizon-cell-content">
                  <div className="horizon-cell-top">
                    <span className="horizon-cell-username">@{partnerName}</span>
                    <span className="horizon-cell-time">
                      {formatChatTime(msgTime)}
                    </span>
                  </div>

                  <div className="horizon-cell-bottom">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px', minWidth: 0 }}>
                      {isSentByMe && lastMsg && (
                        <span className={`horizon-tick ${lastMsg.status === 'READ' ? 'read' : 'sent'}`}>
                          {lastMsg.status === 'SENT' ? (
                            <Check size={14} />
                          ) : (
                            <CheckCheck size={14} />
                          )}
                        </span>
                      )}

                      <span className="horizon-cell-snippet">
                        {isImage ? (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
                            <ImageIcon size={12} color="var(--color-accent-amber)" />
                            Photo
                          </span>
                        ) : (
                          messageText || 'No messages yet'
                        )}
                      </span>
                    </div>

                    {chat.unreadCount > 0 && (
                      <span
                        style={{
                          backgroundColor: 'var(--color-accent-amber)',
                          color: '#0E1626',
                          fontSize: '11px',
                          fontWeight: 700,
                          minWidth: '18px',
                          height: '18px',
                          borderRadius: '999px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          padding: '0 6px',
                          flexShrink: 0
                        }}
                      >
                        {chat.unreadCount}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Floating Action Button (Sunset Glow Amber #F59E0B) */}
      <button
        id="fabNewChat"
        className="horizon-fab"
        onClick={() => setShowNewChatModal(true)}
        title="Start New Conversation"
      >
        <MessageSquarePlus size={24} />
      </button>

      {/* New Conversation Modal (Search Directory) */}
      {showNewChatModal && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            backgroundColor: 'rgba(14, 22, 38, 0.85)',
            backdropFilter: 'blur(6px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '20px',
            zIndex: 150,
            animation: 'fadeIn 0.2s ease'
          }}
        >
          <div
            style={{
              width: '100%',
              maxWidth: '360px',
              backgroundColor: 'var(--color-surface-elevated)',
              borderRadius: '16px',
              padding: '22px',
              border: '1px solid rgba(245, 158, 11, 0.3)',
              boxShadow: '0 20px 40px rgba(0,0,0,0.8)'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
              <h3 style={{ fontSize: '18px', fontWeight: 700, color: 'var(--color-text-primary)' }}>
                Start New Chat
              </h3>
              <button
                onClick={() => {
                  setShowNewChatModal(false);
                  setSearchUsername('');
                  setLookupResult(null);
                  setLookupError('');
                }}
                style={{ background: 'none', border: 'none', color: 'var(--color-text-muted)', cursor: 'pointer' }}
              >
                <X size={20} />
              </button>
            </div>

            <p style={{ fontSize: '13px', color: 'var(--color-text-muted)', marginBottom: '14px' }}>
              Lookup a user by their unique alphanumeric handle:
            </p>

            <form onSubmit={handleLookupUser} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div style={{ position: 'relative' }}>
                <input
                  id="etSearchUsername"
                  type="text"
                  placeholder="e.g. sarah or @sarah"
                  value={searchUsername}
                  onChange={(e) => setSearchUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
                  className="horizon-input-field"
                  style={{ height: '46px', fontSize: '14px' }}
                  autoFocus
                />
              </div>

              {lookupError && (
                <div className="horizon-error-banner" style={{ fontSize: '12px', padding: '6px 10px' }}>
                  {lookupError}
                </div>
              )}

              {lookupResult && (
                <div
                  style={{
                    backgroundColor: 'var(--color-surface)',
                    border: '1px solid rgba(245, 158, 11, 0.35)',
                    borderRadius: '12px',
                    padding: '12px 14px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    marginTop: '4px'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <div className={`horizon-cell-avatar ${lookupResult.online ? 'online' : ''}`} style={{ width: '40px', height: '40px', fontSize: '15px' }}>
                      {lookupResult.username.slice(0, 2).toUpperCase()}
                    </div>
                    <div>
                      <div style={{ fontWeight: 700, color: 'var(--color-text-primary)', fontSize: '15px' }}>
                        @{lookupResult.username}
                      </div>
                      <div style={{ fontSize: '11px', color: lookupResult.online ? 'var(--color-accent-amber)' : 'var(--color-text-muted)' }}>
                        {lookupResult.online ? 'Online now' : 'Offline'}
                      </div>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => handleStartChatWith(lookupResult)}
                    style={{
                      backgroundColor: 'var(--color-accent-amber)',
                      color: '#0E1626',
                      border: 'none',
                      padding: '7px 14px',
                      borderRadius: '8px',
                      fontWeight: 700,
                      fontSize: '12px',
                      cursor: 'pointer'
                    }}
                  >
                    Open Chat
                  </button>
                </div>
              )}

              <button
                type="submit"
                disabled={lookingUp || !searchUsername.trim()}
                className="horizon-btn-primary"
                style={{ height: '44px', marginTop: '4px' }}
              >
                {lookingUp ? (
                  <>
                    <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} />
                    <span>Searching...</span>
                  </>
                ) : (
                  <span>Search Directory</span>
                )}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
