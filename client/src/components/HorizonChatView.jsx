import React, { useState, useEffect, useRef } from 'react';
import {
  ArrowLeft,
  Paperclip,
  Send,
  Check,
  CheckCheck,
  Download,
  Loader2,
  Image as ImageIcon,
  Clock,
  Play,
  Pause,
  Mic,
  FileText,
  Film,
  ExternalLink,
  Share2,
  X
} from 'lucide-react';

// Helper to normalize message objects across snake_case and camelCase
function normalizeMsg(m) {
  if (!m) return null;
  const id = Number(m.id);
  const senderId = Number(m.senderId ?? m.sender_id);
  const recipientId = Number(m.recipientId ?? m.recipient_id);
  const text = m.text ?? m.message_text ?? m.messageText ?? '';
  const attachmentType = m.attachmentType ?? m.attachment_type ?? 'NONE';
  const attachmentUrl = m.attachmentUrl ?? m.attachment_url ?? null;
  const thumbnailBlur = m.thumbnailBlur ?? m.thumbnail_blur ?? null;
  const fileSizeBytes = Number(m.fileSizeBytes ?? m.file_size_bytes ?? 0);
  const status = m.status || 'SENT';
  const createdAt = m.createdAt ?? m.created_at ?? new Date().toISOString();
  const pending = Boolean(m.pending);

  return {
    id,
    senderId,
    recipientId,
    text,
    attachmentType,
    attachmentUrl,
    thumbnailBlur,
    fileSizeBytes,
    status,
    createdAt,
    pending
  };
}

export default function HorizonChatView({
  user,
  partner, // { id, username, online }
  socket,
  apiBaseUrl,
  token,
  onBack,
  onMessageSent
}) {
  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState('');
  const [loadingInitial, setLoadingInitial] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [hasMoreOlder, setHasMoreOlder] = useState(true);
  const [downloadedMedia, setDownloadedMedia] = useState({}); // { [messageId]: boolean }
  const [downloadingMedia, setDownloadingMedia] = useState({}); // { [messageId]: boolean }
  const [isPartnerOnline, setIsPartnerOnline] = useState(partner?.online || false);
  const [playingVoiceId, setPlayingVoiceId] = useState(null);
  const [voiceProgress, setVoiceProgress] = useState(0);
  const [lightboxMedia, setLightboxMedia] = useState(null); // { type: 'IMAGE'|'VIDEO', url, title, sender, timestamp, caption }
  const activeAudioRef = useRef(null);

  const canvasRef = useRef(null);
  const isFirstLoadRef = useRef(true);

  const handleToggleVoicePlay = (msgId, audioUrl) => {
    if (!audioUrl) return;

    if (playingVoiceId === msgId) {
      if (activeAudioRef.current) {
        activeAudioRef.current.pause();
      }
      setPlayingVoiceId(null);
      return;
    }

    if (activeAudioRef.current) {
      activeAudioRef.current.pause();
    }

    try {
      const resolvedUrl = (audioUrl.startsWith('http') || audioUrl.startsWith('data:'))
        ? (audioUrl.startsWith('http://horizon-chat-1.onrender.com') ? audioUrl.replace('http://', 'https://') : audioUrl)
        : `${apiBaseUrl.replace(/\/$/, '')}/${audioUrl.replace(/^\//, '')}`;

      const audio = new Audio(resolvedUrl);
      activeAudioRef.current = audio;
      setPlayingVoiceId(msgId);
      setVoiceProgress(0);

      audio.ontimeupdate = () => {
        if (audio.duration && audio.duration > 0) {
          setVoiceProgress((audio.currentTime / audio.duration) * 100);
        }
      };

      audio.onended = () => {
        setPlayingVoiceId(null);
        setVoiceProgress(0);
      };

      audio.onerror = (e) => {
        console.error('Audio playback error:', e);
        setPlayingVoiceId(null);
        setVoiceProgress(0);
      };

      audio.play().catch((err) => {
        console.error('Audio play error:', err);
        setPlayingVoiceId(null);
      });
    } catch (e) {
      console.error(e);
      setPlayingVoiceId(null);
    }
  };

  // 1. Initial Load: Strictly 25 messages (TRD Section 3.3 & Rules Section 3)
  useEffect(() => {
    let isMounted = true;

    async function loadInitialMessages() {
      setLoadingInitial(true);
      try {
        const res = await fetch(`${apiBaseUrl}/api/messages/${partner.id}?limit=25`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        const data = await res.json();
        if (isMounted && Array.isArray(data)) {
          const normalized = data.map(normalizeMsg).filter(Boolean);
          setMessages(normalized);
          setHasMoreOlder(normalized.length >= 25);

          // Mark incoming unread messages as read
          normalized.forEach((msg) => {
            if (msg.senderId === partner.id && msg.status !== 'READ' && socket) {
              socket.emit('mark_read', { messageId: msg.id, senderId: msg.senderId });
            }
          });
        }
      } catch (err) {
        console.error('[LOAD INITIAL MESSAGES ERROR]', err);
      } finally {
        if (isMounted) setLoadingInitial(false);
      }
    }

    if (partner?.id) {
      loadInitialMessages();
    }

    return () => {
      isMounted = false;
    };
  }, [partner.id, token, apiBaseUrl, socket]);

  // Auto-scroll to bottom on first load and new outgoing messages
  useEffect(() => {
    if (loadingInitial) return;
    if (isFirstLoadRef.current) {
      if (canvasRef.current) {
        canvasRef.current.scrollTop = canvasRef.current.scrollHeight;
      }
      isFirstLoadRef.current = false;
    }
  }, [loadingInitial, messages.length]);

  // 2. Socket Listeners for Real-Time Messages and Read Receipts
  useEffect(() => {
    if (!socket) return;

    const handleNewMessage = (rawMsg) => {
      const msg = normalizeMsg(rawMsg);
      if (!msg) return;

      // Check if this message belongs to the current open conversation
      if (msg.senderId === partner.id) {
        setMessages((prev) => {
          // Guard against duplicates
          if (prev.some((m) => m.id === msg.id)) return prev;
          return [...prev, msg];
        });

        // Auto-mark as read since chat is currently open
        socket.emit('mark_read', { messageId: msg.id, senderId: msg.senderId });

        // Scroll down smoothly
        setTimeout(() => {
          if (canvasRef.current) {
            canvasRef.current.scrollTo({
              top: canvasRef.current.scrollHeight,
              behavior: 'smooth'
            });
          }
        }, 50);
      }
    };

    const handleReadAck = ({ messageId }) => {
      const targetId = Number(messageId);
      setMessages((prev) =>
        prev.map((m) => (m.id === targetId ? { ...m, status: 'READ' } : m))
      );
    };

    const handleStatusChanged = ({ userId, status }) => {
      if (Number(userId) === Number(partner.id)) {
        setIsPartnerOnline(status === 'online');
      }
    };

    socket.on('new_message', handleNewMessage);
    socket.on('message_read_ack', handleReadAck);
    socket.on('user_status_changed', handleStatusChanged);

    return () => {
      socket.off('new_message', handleNewMessage);
      socket.off('message_read_ack', handleReadAck);
      socket.off('user_status_changed', handleStatusChanged);
    };
  }, [socket, partner.id]);

  // 3. Reverse Cursor Pagination: Fetch older messages when scrolling to top
  const handleScroll = async (e) => {
    const el = e.target;
    if (el.scrollTop < 30 && !loadingOlder && hasMoreOlder && messages.length > 0) {
      const oldestId = messages[0].id;
      setLoadingOlder(true);

      const prevScrollHeight = el.scrollHeight;
      const prevScrollTop = el.scrollTop;

      try {
        const res = await fetch(
          `${apiBaseUrl}/api/messages/${partner.id}?cursor=${oldestId}&limit=25`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        const olderBatch = await res.json();

        if (Array.isArray(olderBatch)) {
          const normalized = olderBatch.map(normalizeMsg).filter(Boolean);
          if (normalized.length < 25) {
            setHasMoreOlder(false);
          }
          if (normalized.length > 0) {
            setMessages((prev) => [...normalized, ...prev]);

            // Preserve scroll position so view doesn't jump
            requestAnimationFrame(() => {
              const heightDiff = el.scrollHeight - prevScrollHeight;
              el.scrollTop = prevScrollTop + heightDiff;
            });
          }
        }
      } catch (err) {
        console.error('[LOAD OLDER MESSAGES ERROR]', err);
      } finally {
        setLoadingOlder(false);
      }
    }
  };

  // 4. Send Text Message
  const handleSendMessage = (e) => {
    e?.preventDefault();
    const text = inputText.trim();
    if (!text || !socket) return;

    setInputText('');

    const optimisticId = Date.now();
    const optimisticMsg = {
      id: optimisticId,
      senderId: Number(user.id),
      recipientId: Number(partner.id),
      text,
      attachmentType: 'NONE',
      attachmentUrl: null,
      thumbnailBlur: null,
      fileSizeBytes: 0,
      status: isPartnerOnline ? 'DELIVERED' : 'SENT',
      createdAt: new Date().toISOString(),
      pending: true
    };

    setMessages((prev) => [...prev, optimisticMsg]);

    // Scroll to bottom
    setTimeout(() => {
      if (canvasRef.current) {
        canvasRef.current.scrollTop = canvasRef.current.scrollHeight;
      }
    }, 20);

    // Socket emit with ACK callback
    socket.emit(
      'send_message',
      {
        recipientId: partner.id,
        text,
        attachmentType: 'NONE'
      },
      (response) => {
        if (response?.success && response.message) {
          const saved = normalizeMsg(response.message);
          setMessages((prev) =>
            prev.map((m) => (m.id === optimisticId ? saved : m))
          );
          if (onMessageSent) onMessageSent();
        }
      }
    );
  };

  // 5. Send Real Media File with Micro-Preview
  const fileInputRef = useRef(null);

  const handleAttachClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file || !socket) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      const base64 = event.target?.result;
      if (!base64) return;

      try {
        const res = await fetch(`${apiBaseUrl}/api/media/upload`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`
          },
          body: JSON.stringify({
            imageBase64: base64,
            fileName: file.name,
            fileSizeBytes: file.size
          })
        });
        const mediaData = await res.json();
        const finalUrl = mediaData?.attachmentUrl || base64;

        const optimisticId = Date.now();
        const optimisticMsg = {
          id: optimisticId,
          senderId: Number(user.id),
          recipientId: Number(partner.id),
          text: file.name || 'Photo',
          attachmentType: 'IMAGE',
          attachmentUrl: finalUrl,
          thumbnailBlur: mediaData?.thumbnailBlur || base64,
          fileSizeBytes: file.size,
          status: isPartnerOnline ? 'DELIVERED' : 'SENT',
          createdAt: new Date().toISOString()
        };

        setMessages((prev) => [...prev, optimisticMsg]);
        setTimeout(() => {
          if (canvasRef.current) canvasRef.current.scrollTop = canvasRef.current.scrollHeight;
        }, 20);

        socket.emit(
          'send_message',
          {
            recipientId: partner.id,
            text: file.name || 'Photo',
            attachmentType: 'IMAGE',
            attachmentUrl: finalUrl,
            thumbnailBlur: mediaData?.thumbnailBlur || base64,
            fileSizeBytes: file.size
          },
          (response) => {
            if (response?.success && response.message) {
              const saved = normalizeMsg(response.message);
              setMessages((prev) =>
                prev.map((m) => (m.id === optimisticId ? saved : m))
              );
              if (onMessageSent) onMessageSent();
            }
          }
        );
      } catch (err) {
        console.error('[ATTACH FILE ERROR]', err);
      }
    };
    reader.readAsDataURL(file);
    // Reset file input value so selecting the same file again triggers onChange
    e.target.value = '';
  };

  // 6. Tap-to-Download Media Handler (Rules Section 3: Blurhash/Micro-Preview mandatory)
  const handleDownloadMedia = (messageId) => {
    setDownloadingMedia((prev) => ({ ...prev, [messageId]: true }));
    setTimeout(() => {
      setDownloadingMedia((prev) => ({ ...prev, [messageId]: false }));
      setDownloadedMedia((prev) => ({ ...prev, [messageId]: true }));
    }, 1200);
  };

  const formatMessageTime = (ts) => {
    if (!ts) return '';
    const d = new Date(ts);
    return isNaN(d.getTime()) ? '' : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const formatFileSize = (bytes) => {
    if (!bytes) return '1.8 MB';
    const mb = bytes / (1024 * 1024);
    return `${mb.toFixed(1)} MB`;
  };

  return (
    <div className="horizon-direct-view">
      {/* Top App Bar (activity_chat.xml) */}
      <div className="horizon-chat-toolbar">
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button
            onClick={onBack}
            className="horizon-dock-clip"
            id="btnBack"
            title="Back to conversations"
          >
            <ArrowLeft size={20} />
          </button>

          <div className="horizon-partner-info">
            <div
              className={`horizon-cell-avatar ${isPartnerOnline ? 'online' : ''}`}
              style={{ width: '38px', height: '38px', fontSize: '14px' }}
            >
              {(partner.username || 'User').slice(0, 2).toUpperCase()}
            </div>

            <div>
              <div style={{ fontSize: '15px', fontWeight: 700, color: 'var(--color-text-primary)' }}>
                @{partner.username}
              </div>
              <div className={`horizon-presence-badge ${isPartnerOnline ? 'online' : 'offline'}`}>
                {isPartnerOnline ? 'online' : 'offline'}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Message Canvas (Reverse Cursor Scrollable) */}
      <div
        className="horizon-message-canvas"
        ref={canvasRef}
        onScroll={handleScroll}
        id="recyclerMessages"
      >
        {/* Loading Older Banner */}
        {loadingOlder && (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '6px' }}>
            <Loader2 size={16} color="var(--color-accent-amber)" style={{ animation: 'spin 1s linear infinite' }} />
          </div>
        )}

        {!hasMoreOlder && messages.length > 0 && (
          <div style={{ textAlign: 'center', padding: '8px 0', fontSize: '11px', color: 'var(--color-text-muted)' }}>
            Beginning of cloud conversation
          </div>
        )}

        {loadingInitial ? (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Loader2 size={24} color="var(--color-accent-amber)" style={{ animation: 'spin 1s linear infinite' }} />
          </div>
        ) : messages.length === 0 ? (
          <div
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              textAlign: 'center',
              color: 'var(--color-text-muted)',
              padding: '24px'
            }}
          >
            <div
              style={{
                width: '50px',
                height: '50px',
                borderRadius: '50%',
                backgroundColor: 'var(--color-surface)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: '12px',
                color: 'var(--color-accent-amber)'
              }}
            >
              <ImageIcon size={22} />
            </div>
            <p style={{ fontSize: '14px', color: 'var(--color-text-primary)', fontWeight: 600 }}>
              Say hello to @{partner.username}!
            </p>
            <p style={{ fontSize: '12px', marginTop: '4px' }}>
              Your messages sync seamlessly across all sessions.
            </p>
          </div>
        ) : (
          messages.map((msg) => {
            const isMe = Number(msg.senderId) === Number(user.id);
            const isMedia = msg.attachmentType === 'IMAGE' || Boolean(msg.thumbnailBlur);
            const isDownloaded = downloadedMedia[msg.id] || false;
            const isDownloading = downloadingMedia[msg.id] || false;

            return (
              <div key={msg.id} className={`horizon-msg-row ${isMe ? 'outgoing' : 'incoming'}`}>
                <div className={`horizon-bubble ${isMe ? 'outgoing' : 'incoming'}`}>
                  {/* Media / Micro-Preview Card (Rules Section 3 & TRD Section 5.3) */}
                  {isMedia && (
                    <div
                      className="horizon-media-card"
                      style={{ marginBottom: '6px', cursor: (isDownloaded || msg.attachmentUrl) ? 'pointer' : 'default' }}
                      onClick={() => {
                        if (isDownloaded || msg.attachmentUrl) {
                          const url = (msg.attachmentUrl && msg.attachmentUrl.startsWith('http'))
                            ? msg.attachmentUrl
                            : `${apiBaseUrl.replace(/\/$/, '')}/${(msg.attachmentUrl || '').replace(/^\//, '')}`;
                          setLightboxMedia({
                            type: 'IMAGE',
                            url: url || msg.thumbnailBlur,
                            title: `Photo from @${isMe ? 'You' : partner.username}`,
                            subtitle: formatMessageTime(msg.createdAt),
                            caption: msg.text
                          });
                        }
                      }}
                    >
                      <div className="horizon-blur-container">
                        <img
                          src={isDownloaded ? msg.attachmentUrl : msg.thumbnailBlur}
                          alt="Attachment micro-preview"
                          className={`horizon-blur-img ${isDownloaded ? 'revealed' : ''}`}
                        />

                        {/* Scrim with tap-to-download */}
                        {!isDownloaded && (
                          <div
                            className="horizon-download-scrim"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (!isDownloading) handleDownloadMedia(msg.id);
                            }}
                            title="Tap to download media"
                          >
                            {isDownloading ? (
                              <Loader2 size={24} color="var(--color-accent-amber)" style={{ animation: 'spin 1s linear infinite' }} />
                            ) : (
                              <>
                                <div className="horizon-download-glyph">
                                  <Download size={18} />
                                </div>
                                <span className="horizon-file-size">
                                  {formatFileSize(msg.fileSizeBytes)}
                                </span>
                              </>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Voice Note Audio Card */}
                  {msg.attachmentType === 'AUDIO' && (
                    <div className="horizon-voice-note-card" style={{ marginBottom: '6px' }}>
                      <button
                        type="button"
                        onClick={() => handleToggleVoicePlay(msg.id, msg.attachmentUrl)}
                        className="horizon-voice-play-btn"
                        title={playingVoiceId === msg.id ? "Pause" : "Play voice note"}
                      >
                        {playingVoiceId === msg.id ? <Pause size={18} /> : <Play size={18} />}
                      </button>
                      <div className="horizon-voice-track">
                        <div
                          className="horizon-voice-progress"
                          style={{ width: `${playingVoiceId === msg.id ? voiceProgress : 0}%` }}
                        />
                      </div>
                      <span className="horizon-voice-duration">
                        {msg.text || '0:10'}
                      </span>
                      <Mic size={16} className="horizon-voice-mic" />
                    </div>
                  )}

                  {/* Video Attachment Card */}
                  {msg.attachmentType === 'VIDEO' && (
                    <div
                      className="horizon-media-card"
                      style={{ marginBottom: '6px', borderRadius: '12px', overflow: 'hidden', cursor: 'pointer' }}
                      onClick={() => {
                        if (msg.attachmentUrl) {
                          const url = msg.attachmentUrl.startsWith('http') ? msg.attachmentUrl : `${apiBaseUrl.replace(/\/$/, '')}/${msg.attachmentUrl.replace(/^\//, '')}`;
                          setLightboxMedia({
                            type: 'VIDEO',
                            url,
                            title: `Video from @${isMe ? 'You' : partner.username}`,
                            subtitle: formatMessageTime(msg.createdAt),
                            caption: msg.text
                          });
                        }
                      }}
                    >
                      {msg.attachmentUrl ? (
                        <video
                          src={msg.attachmentUrl.startsWith('http') ? msg.attachmentUrl : `${apiBaseUrl.replace(/\/$/, '')}/${msg.attachmentUrl.replace(/^\//, '')}`}
                          controls
                          playsInline
                          style={{ width: '100%', maxHeight: '240px', borderRadius: '12px', display: 'block', backgroundColor: '#000' }}
                          poster={msg.thumbnailBlur || undefined}
                        />
                      ) : (
                        <div style={{ padding: '16px', display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--color-accent-amber)' }}>
                          <Film size={20} />
                          <span style={{ fontSize: '13px' }}>Video Attachment ({formatFileSize(msg.fileSizeBytes)})</span>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Document Attachment Card */}
                  {msg.attachmentType === 'DOCUMENT' && (
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '10px',
                        padding: '10px 14px',
                        borderRadius: '12px',
                        background: 'rgba(245, 158, 11, 0.12)',
                        border: '1px solid rgba(245, 158, 11, 0.3)',
                        marginBottom: '6px',
                        cursor: msg.attachmentUrl ? 'pointer' : 'default'
                      }}
                      onClick={() => {
                        if (msg.attachmentUrl) {
                          const url = msg.attachmentUrl.startsWith('http') ? msg.attachmentUrl : `${apiBaseUrl.replace(/\/$/, '')}/${msg.attachmentUrl.replace(/^\//, '')}`;
                          window.open(url, '_blank');
                        }
                      }}
                    >
                      <div
                        style={{
                          width: '36px',
                          height: '36px',
                          borderRadius: '8px',
                          background: 'linear-gradient(135deg, #F59E0B, #EA580C)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          color: '#fff',
                          flexShrink: 0
                        }}
                      >
                        <FileText size={20} />
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: '13px', fontWeight: 600, color: '#F8FAFC', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                          {msg.text || 'Document Attachment'}
                        </div>
                        <div style={{ fontSize: '11px', color: '#94A3B8' }}>
                          {formatFileSize(msg.fileSizeBytes)} • Tap to download
                        </div>
                      </div>
                      <Download size={16} color="#F59E0B" />
                    </div>
                  )}

                  {/* Message Text */}
                  {msg.attachmentType !== 'AUDIO' && msg.attachmentType !== 'DOCUMENT' && (
                    msg.text ? (
                      <div className="horizon-bubble-text">{msg.text}</div>
                    ) : (!isMedia && msg.attachmentType !== 'VIDEO') ? (
                      <div className="horizon-bubble-text" style={{ fontStyle: 'italic', opacity: 0.7 }}>
                        (Empty message)
                      </div>
                    ) : null
                  )}

                  {/* Metadata (Timestamp + Status Ticks) */}
                  <div className="horizon-bubble-meta">
                    <span>{formatMessageTime(msg.createdAt)}</span>

                    {isMe && (
                      <span className={`horizon-tick ${msg.status === 'READ' ? 'read' : 'sent'}`}>
                        {msg.pending ? (
                          <Clock size={12} />
                        ) : msg.status === 'SENT' ? (
                          <Check size={13} />
                        ) : (
                          <CheckCheck size={13} />
                        )}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Horizontal Input Dock (activity_chat.xml) */}
      <form onSubmit={handleSendMessage} className="horizon-input-dock">
        <input
          type="file"
          ref={fileInputRef}
          onChange={handleFileChange}
          accept="image/*"
          style={{ display: 'none' }}
        />

        <button
          type="button"
          onClick={handleAttachClick}
          className="horizon-dock-clip"
          title="Attach Image"
          id="btnAttachMedia"
        >
          <Paperclip size={20} />
        </button>

        <input
          id="etMessageInput"
          type="text"
          className="horizon-input-box"
          placeholder="Message..."
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          autoComplete="off"
        />

        <button
          type="submit"
          disabled={!inputText.trim()}
          className="horizon-send-fab"
          id="btnSendMessage"
          title="Send"
        >
          <Send size={18} style={{ marginLeft: '2px' }} />
        </button>
      </form>

      {/* Full-Screen Interactive Player & Photo Viewer Modal */}
      {lightboxMedia && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 9999,
            backgroundColor: '#000000',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between'
          }}
        >
          {/* Top Bar */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '14px 18px',
              background: 'linear-gradient(180deg, rgba(14,22,38,0.95) 0%, rgba(14,22,38,0.6) 80%, transparent 100%)',
              zIndex: 10
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <button
                onClick={() => setLightboxMedia(null)}
                style={{
                  background: 'rgba(255, 255, 255, 0.1)',
                  border: 'none',
                  borderRadius: '50%',
                  width: '36px',
                  height: '36px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#fff',
                  cursor: 'pointer'
                }}
                title="Back"
              >
                <ArrowLeft size={20} />
              </button>
              <div>
                <div style={{ fontSize: '15px', fontWeight: 700, color: '#F8FAFC' }}>
                  {lightboxMedia.title}
                </div>
                <div style={{ fontSize: '11px', color: '#94A3B8' }}>
                  {lightboxMedia.subtitle || 'Horizon Media'}
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <button
                onClick={() => {
                  const a = document.createElement('a');
                  a.href = lightboxMedia.url;
                  a.download = `horizon_${lightboxMedia.type.toLowerCase()}_${Date.now()}`;
                  a.target = '_blank';
                  document.body.appendChild(a);
                  a.click();
                  document.body.removeChild(a);
                }}
                style={{
                  background: 'linear-gradient(135deg, #F59E0B, #EA580C)',
                  border: 'none',
                  borderRadius: '20px',
                  padding: '8px 16px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  color: '#fff',
                  fontWeight: 600,
                  fontSize: '13px',
                  cursor: 'pointer'
                }}
                title="Save / Download to Gallery"
              >
                <Download size={16} />
                <span>Save</span>
              </button>

              <button
                onClick={() => setLightboxMedia(null)}
                style={{
                  background: 'rgba(255, 255, 255, 0.15)',
                  border: 'none',
                  borderRadius: '50%',
                  width: '36px',
                  height: '36px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#fff',
                  cursor: 'pointer'
                }}
                title="Close"
              >
                <X size={20} />
              </button>
            </div>
          </div>

          {/* Media Canvas with Aspect-Ratio Fitting */}
          <div
            style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              overflow: 'hidden',
              padding: '12px'
            }}
          >
            {lightboxMedia.type === 'VIDEO' ? (
              <video
                src={lightboxMedia.url}
                controls
                autoPlay
                playsInline
                style={{
                  maxWidth: '100%',
                  maxHeight: '100%',
                  objectFit: 'contain',
                  borderRadius: '8px',
                  backgroundColor: '#000'
                }}
              />
            ) : (
              <img
                src={lightboxMedia.url}
                alt="Full size media"
                style={{
                  maxWidth: '100%',
                  maxHeight: '100%',
                  objectFit: 'contain',
                  borderRadius: '8px'
                }}
              />
            )}
          </div>

          {/* Bottom Caption Bar */}
          {lightboxMedia.caption && (
            <div
              style={{
                padding: '14px 20px',
                background: 'rgba(22, 34, 56, 0.85)',
                color: '#F8FAFC',
                fontSize: '14px',
                textAlign: 'center',
                borderTop: '1px solid rgba(255,255,255,0.08)'
              }}
            >
              {lightboxMedia.caption}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
