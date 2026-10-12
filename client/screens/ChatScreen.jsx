/**
 * ChatScreen Component
 * Release 3.2.3 - Main Conversation Viewport with Chronological Chat Feed
 */

import React, { useState, useRef } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import { useChat } from '../context/ChatContext.jsx';
import { useChatScroll } from '../hooks/useChatScroll.js';
import ChatBubble from '../components/ChatBubble.jsx';
import ImageZoomViewer from '../components/ImageZoomViewer.jsx';
import api from '../services/api.js';
import {
  Send,
  Paperclip,
  Image as ImageIcon,
  Shield,
  LogOut,
  UserPlus,
  MessageSquare,
  CheckCircle2,
  Eye
} from 'lucide-react';

export function ChatScreen({ onNavigate }) {
  const { user, isAdmin, logout } = useAuth();
  const {
    activeChatId,
    activePartner,
    chats,
    messages,
    loadingHistory,
    selectChat,
    startDirectChat,
    sendMessage,
    sendReaction
  } = useChat();

  const [inputText, setInputText] = useState('');
  const [newUsername, setNewUsername] = useState('');
  const [showStartChat, setShowStartChat] = useState(false);
  const [previewImage, setPreviewImage] = useState(null);
  const [isViewOnce, setIsViewOnce] = useState(false);
  const [uploading, setUploading] = useState(false);

  const fileInputRef = useRef(null);
  const { scrollRef } = useChatScroll(messages.length);

  // Send text message
  const handleSend = (e) => {
    e.preventDefault();
    if (!inputText.trim()) return;
    sendMessage(inputText.trim(), null, null, false);
    setInputText('');
  };

  // Start direct conversation with username
  const handleStartChat = async (e) => {
    e.preventDefault();
    if (!newUsername.trim()) return;
    try {
      await startDirectChat(newUsername.trim());
      setNewUsername('');
      setShowStartChat(false);
    } catch (err) {
      alert(err.message || 'Failed to start chat');
    }
  };

  // Handle media file upload to Cloudflare R2
  const handleFileUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file || !activeChatId) return;

    setUploading(true);
    try {
      const isVideo = file.type.startsWith('video/');
      const isImage = file.type.startsWith('image/');
      const mediaType = isVideo ? 'video' : (isImage ? 'image' : 'document');

      // 1. Request presigned upload URL
      const presignRes = await api.post('/api/chat/upload-url', {
        fileName: file.name,
        contentType: file.type,
        isViewOnce
      });

      if (!presignRes.success || !presignRes.uploadUrl) {
        throw new Error('Failed to obtain upload URL');
      }

      // 2. Upload file directly to Cloudflare R2 via presigned PUT
      await fetch(presignRes.uploadUrl, {
        method: 'PUT',
        headers: {
          'Content-Type': file.type
        },
        body: file
      });

      // 3. Send message with public media URL
      sendMessage(
        file.name,
        presignRes.publicUrl,
        mediaType,
        isViewOnce
      );

      setIsViewOnce(false);
    } catch (err) {
      alert(err.message || 'Failed to upload media');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  return (
    <div
      style={{
        display: 'flex',
        height: '100vh',
        backgroundColor: '#0A0F1D',
        color: '#F8FAFC',
        fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
        overflow: 'hidden'
      }}
    >
      {/* Sidebar: Conversation List */}
      <div
        style={{
          width: '320px',
          borderRight: '1px solid #1E293B',
          backgroundColor: '#0F172A',
          display: 'flex',
          flexDirection: 'column'
        }}
      >
        {/* User Profile & Actions Header */}
        <div
          style={{
            padding: '16px',
            borderBottom: '1px solid #1E293B',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div
              style={{
                width: '38px',
                height: '38px',
                borderRadius: '50%',
                backgroundColor: '#0284C7',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontWeight: 700,
                color: '#FFFFFF'
              }}
            >
              {user?.username ? user.username[0].toUpperCase() : 'U'}
            </div>
            <div>
              <div style={{ fontWeight: 600, fontSize: '14px' }}>@{user?.username}</div>
              <div style={{ fontSize: '11px', color: '#10B981', display: 'flex', alignItems: 'center', gap: '4px' }}>
                <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#10B981' }} />
                Online
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            {isAdmin && (
              <button
                type="button"
                onClick={() => onNavigate('admin')}
                style={iconBtnStyle}
                title="Superuser Admin Dashboard"
              >
                <Shield size={18} color="#F59E0B" />
              </button>
            )}
            <button
              type="button"
              onClick={logout}
              style={iconBtnStyle}
              title="Sign Out"
            >
              <LogOut size={18} color="#94A3B8" />
            </button>
          </div>
        </div>

        {/* Start Chat Button */}
        <div style={{ padding: '12px 16px', borderBottom: '1px solid #1E293B' }}>
          <button
            type="button"
            onClick={() => setShowStartChat(!showStartChat)}
            style={{
              width: '100%',
              backgroundColor: '#1E293B',
              border: '1px solid #334155',
              borderRadius: '8px',
              padding: '8px 12px',
              color: '#F8FAFC',
              fontSize: '13px',
              fontWeight: 500,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
              cursor: 'pointer'
            }}
          >
            <UserPlus size={16} /> New Conversation
          </button>

          {showStartChat && (
            <form onSubmit={handleStartChat} style={{ marginTop: '10px' }}>
              <input
                type="text"
                placeholder="Target username..."
                value={newUsername}
                onChange={(e) => setNewUsername(e.target.value)}
                style={{
                  width: '100%',
                  backgroundColor: '#0A0F1D',
                  border: '1px solid #38BDF8',
                  borderRadius: '6px',
                  padding: '8px 10px',
                  color: '#F8FAFC',
                  fontSize: '13px',
                  boxSizing: 'border-box'
                }}
              />
            </form>
          )}
        </div>

        {/* Conversation List Items */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {chats.length === 0 ? (
            <div style={{ padding: '24px', textAlign: 'center', color: '#64748B', fontSize: '13px' }}>
              No conversations yet. Start one above!
            </div>
          ) : (
            chats.map((c) => {
              const isSelected = Number(c.chat_id) === Number(activeChatId);
              return (
                <div
                  key={c.chat_id}
                  onClick={() => selectChat(c.chat_id, {
                    id: c.partner_id,
                    username: c.partner_username,
                    is_active: c.partner_is_active,
                    last_seen: c.partner_last_seen
                  })}
                  style={{
                    padding: '12px 16px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px',
                    borderBottom: '1px solid #1A2438',
                    cursor: 'pointer',
                    backgroundColor: isSelected ? '#1E293B' : 'transparent',
                    transition: 'background-color 0.15s'
                  }}
                >
                  <div
                    style={{
                      width: '40px',
                      height: '40px',
                      borderRadius: '50%',
                      backgroundColor: '#334155',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontWeight: 600,
                      fontSize: '15px'
                    }}
                  >
                    {c.partner_username ? c.partner_username[0].toUpperCase() : '?'}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontWeight: 600, fontSize: '14px', color: '#F1F5F9' }}>
                        @{c.partner_username}
                      </span>
                    </div>
                    <div
                      style={{
                        fontSize: '12px',
                        color: '#94A3B8',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        marginTop: '2px'
                      }}
                    >
                      {c.last_message_content || 'No messages yet'}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Main Conversation Feed Viewport */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', backgroundColor: '#0A0F1D' }}>
        {activeChatId ? (
          <>
            {/* Active Conversation Top Bar */}
            <div
              style={{
                height: '60px',
                borderBottom: '1px solid #1E293B',
                backgroundColor: '#0F172A',
                padding: '0 20px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div
                  style={{
                    width: '36px',
                    height: '36px',
                    borderRadius: '50%',
                    backgroundColor: '#1E293B',
                    border: '1px solid #334155',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontWeight: 600
                  }}
                >
                  {activePartner?.username ? activePartner.username[0].toUpperCase() : '?'}
                </div>
                <div>
                  <div style={{ fontWeight: 600, fontSize: '15px' }}>@{activePartner?.username}</div>
                  <div style={{ fontSize: '11px', color: '#10B981' }}>Active in Chat</div>
                </div>
              </div>
            </div>

            {/* Chronological Chat Messages Container (Pinned to Bottom) */}
            <div
              ref={scrollRef}
              style={{
                flex: 1,
                padding: '16px 24px',
                overflowY: 'auto',
                display: 'flex',
                flexDirection: 'column'
              }}
            >
              {loadingHistory ? (
                <div style={{ textAlign: 'center', color: '#64748B', marginTop: '40px' }}>
                  Loading conversation history...
                </div>
              ) : messages.length === 0 ? (
                <div style={{ textAlign: 'center', color: '#64748B', marginTop: '60px' }}>
                  No messages yet. Send a message to start chatting!
                </div>
              ) : (
                messages.map((m) => (
                  <ChatBubble
                    key={m.id}
                    message={m}
                    isOwn={Number(m.sender_id) === Number(user?.id)}
                    onReact={sendReaction}
                    onImageClick={(url) => setPreviewImage(url)}
                  />
                ))
              )}
            </div>

            {/* Input Bar */}
            <form
              onSubmit={handleSend}
              style={{
                padding: '12px 20px',
                borderTop: '1px solid #1E293B',
                backgroundColor: '#0F172A',
                display: 'flex',
                alignItems: 'center',
                gap: '10px'
              }}
            >
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileUpload}
                accept="image/*,video/*"
                style={{ display: 'none' }}
              />

              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                style={iconBtnStyle}
                title="Attach Media (Image / Video)"
              >
                <Paperclip size={19} color="#94A3B8" />
              </button>

              <button
                type="button"
                onClick={() => setIsViewOnce(!isViewOnce)}
                style={{
                  ...iconBtnStyle,
                  backgroundColor: isViewOnce ? 'rgba(56, 189, 248, 0.2)' : 'transparent',
                  color: isViewOnce ? '#38BDF8' : '#94A3B8'
                }}
                title={isViewOnce ? 'View-Once Enabled' : 'Enable View-Once Media'}
              >
                <Eye size={19} />
              </button>

              <input
                type="text"
                placeholder={uploading ? 'Uploading media...' : 'Type a message...'}
                value={inputText}
                disabled={uploading}
                onChange={(e) => setInputText(e.target.value)}
                style={{
                  flex: 1,
                  backgroundColor: '#1E293B',
                  border: '1px solid #334155',
                  borderRadius: '10px',
                  padding: '10px 14px',
                  color: '#F8FAFC',
                  fontSize: '14px',
                  outline: 'none'
                }}
              />

              <button
                type="submit"
                disabled={!inputText.trim() || uploading}
                style={{
                  backgroundColor: '#0284C7',
                  border: 'none',
                  borderRadius: '10px',
                  padding: '10px 16px',
                  color: '#FFFFFF',
                  cursor: !inputText.trim() || uploading ? 'not-allowed' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  opacity: !inputText.trim() || uploading ? 0.6 : 1
                }}
              >
                <Send size={18} />
              </button>
            </form>
          </>
        ) : (
          <div
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#64748B'
            }}
          >
            <MessageSquare size={48} style={{ marginBottom: '12px', opacity: 0.5 }} />
            <div style={{ fontSize: '18px', fontWeight: 600 }}>Select a Conversation</div>
            <div style={{ fontSize: '13px', marginTop: '4px' }}>Choose a chat from the left or start a new one</div>
          </div>
        )}
      </div>

      {/* Fullscreen Image Preview Modal */}
      {previewImage && (
        <ImageZoomViewer
          src={previewImage}
          onClose={() => setPreviewImage(null)}
        />
      )}
    </div>
  );
}

const iconBtnStyle = {
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  padding: '6px',
  borderRadius: '6px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center'
};

export default ChatScreen;
