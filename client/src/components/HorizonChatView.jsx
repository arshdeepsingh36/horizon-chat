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
  X,
  Eye,
  Trash2,
  Radio,
  Sparkles,
  Camera,
  FolderOpen
} from 'lucide-react';
import { uploadToR2 } from '../utils/r2Upload';

// Helper to normalize message objects across snake_case and camelCase
function normalizeMsg(m) {
  if (!m) return null;
  const id = Number(m.id);
  const senderId = Number(m.senderId ?? m.sender_id);
  const recipientId = Number(m.recipientId ?? m.recipient_id);
  const text = m.text ?? m.message_text ?? m.messageText ?? '';
  const attachmentType = m.attachmentType ?? m.attachment_type ?? 'NONE';
  const attachmentUrl = m.attachmentUrl ?? m.attachment_url ?? m.mediaUrl ?? m.media_url ?? null;
  const r2Key = m.r2Key ?? m.r2_key ?? null;
  const thumbnailBlur = m.thumbnailBlur ?? m.thumbnail_blur ?? null;
  const fileSizeBytes = Number(m.fileSizeBytes ?? m.file_size_bytes ?? 0);
  const status = m.status || 'SENT';
  const isViewOnce = Boolean(m.isViewOnce ?? m.is_view_once);
  const isViewed = Boolean(m.isViewed ?? m.is_view_viewed ?? m.is_viewed);
  const createdAt = m.createdAt ?? m.created_at ?? new Date().toISOString();
  const pending = Boolean(m.pending);

  return {
    id,
    senderId,
    recipientId,
    text,
    attachmentType,
    attachmentUrl,
    r2Key,
    thumbnailBlur,
    fileSizeBytes,
    status,
    isViewOnce,
    isViewed,
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
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [activeProfileTab, setActiveProfileTab] = useState('media'); // 'media' | 'docs' | 'links'

  // Cloudflare R2 Direct Upload & Voice Recording states
  const [isRecordingVoice, setIsRecordingVoice] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [isViewOnceSelected, setIsViewOnceSelected] = useState(false);
  const [showAttachMenu, setShowAttachMenu] = useState(false);
  const [uploadingMedia, setUploadingMedia] = useState(false);

  const activeAudioRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const recordingTimerRef = useRef(null);

  const imageInputRef = useRef(null);
  const videoInputRef = useRef(null);
  const audioInputRef = useRef(null);
  const docInputRef = useRef(null);

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

    const handleMediaViewed = ({ messageId }) => {
      setMessages((prev) =>
        prev.map((m) => (m.id === Number(messageId) ? { ...m, isViewed: true } : m))
      );
    };

    socket.on('new_message', handleNewMessage);
    socket.on('message_read_ack', handleReadAck);
    socket.on('user_status_changed', handleStatusChanged);
    socket.on('media_viewed', handleMediaViewed);

    return () => {
      socket.off('new_message', handleNewMessage);
      socket.off('message_read_ack', handleReadAck);
      socket.off('user_status_changed', handleStatusChanged);
      socket.off('media_viewed', handleMediaViewed);
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

  // 5. Cloudflare R2 Direct Binary Upload Pipeline
  const handleUploadAndSendMedia = async (file, category, attachmentType, viewOnce = isViewOnceSelected) => {
    if (!file || !socket) return;
    setUploadingMedia(true);

    const optimisticId = Date.now();
    let localPreviewUrl = null;
    try {
      if (file.type && (file.type.startsWith('image/') || file.type.startsWith('video/') || file.type.startsWith('audio/'))) {
        localPreviewUrl = URL.createObjectURL(file);
      }
    } catch (e) {
      console.error(e);
    }

    const optimisticMsg = {
      id: optimisticId,
      senderId: Number(user.id),
      recipientId: Number(partner.id),
      text: file.name || (attachmentType === 'VIDEO' ? 'Video' : (attachmentType === 'AUDIO' ? 'Voice Note' : 'Attachment')),
      attachmentType,
      attachmentUrl: localPreviewUrl,
      thumbnailBlur: null,
      fileSizeBytes: file.size || 0,
      status: isPartnerOnline ? 'DELIVERED' : 'SENT',
      isViewOnce: Boolean(viewOnce),
      isViewed: false,
      createdAt: new Date().toISOString(),
      pending: true
    };

    setMessages((prev) => [...prev, optimisticMsg]);
    setTimeout(() => {
      if (canvasRef.current) canvasRef.current.scrollTop = canvasRef.current.scrollHeight;
    }, 20);

    try {
      // Direct binary PUT upload to Cloudflare R2
      const { publicUrl, key } = await uploadToR2({
        file,
        uploadType: 'chat_media',
        recipientUsername: partner.username,
        mediaType: category,
        isViewOnce: Boolean(viewOnce),
        apiBaseUrl,
        token
      });

      socket.emit(
        'send_message',
        {
          recipientId: partner.id,
          text: file.name || (attachmentType === 'VIDEO' ? 'Video' : (attachmentType === 'AUDIO' ? 'Voice Note' : 'Attachment')),
          attachmentType,
          attachmentUrl: publicUrl,
          mediaUrl: publicUrl,
          r2Key: key,
          fileSizeBytes: file.size || 0,
          isViewOnce: Boolean(viewOnce)
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
      console.error('[R2 DIRECT UPLOAD ERROR]', err);
      setMessages((prev) =>
        prev.map((m) => (m.id === optimisticId ? { ...m, text: `${m.text} (Upload failed)`, pending: false } : m))
      );
    } finally {
      setUploadingMedia(false);
      setIsViewOnceSelected(false);
      setShowAttachMenu(false);
    }
  };

  const handleFileChange = async (e, forcedCategory = null, forcedType = null) => {
    const file = e.target.files?.[0];
    if (!file) return;

    let attachmentType = forcedType;
    let category = forcedCategory;

    if (!attachmentType || !category) {
      if (file.type.startsWith('image/')) {
        attachmentType = 'IMAGE';
        category = 'image';
      } else if (file.type.startsWith('video/')) {
        attachmentType = 'VIDEO';
        category = 'video';
      } else if (file.type.startsWith('audio/')) {
        attachmentType = 'AUDIO';
        category = 'voice';
      } else {
        attachmentType = 'DOCUMENT';
        category = 'others';
      }
    }

    await handleUploadAndSendMedia(file, category, attachmentType);
    e.target.value = '';
  };

  // Voice Note Recording with MediaRecorder
  const startVoiceRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioChunksRef.current = [];
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          audioChunksRef.current.push(e.data);
        }
      };

      mediaRecorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop());
        if (audioChunksRef.current.length === 0) return;

        const mimeType = mediaRecorder.mimeType || 'audio/webm';
        const ext = mimeType.includes('mp4') ? 'm4a' : 'webm';
        const audioBlob = new Blob(audioChunksRef.current, { type: mimeType });
        audioBlob.name = `voice_${Date.now()}.${ext}`;

        await handleUploadAndSendMedia(audioBlob, 'voice', 'AUDIO');
      };

      mediaRecorder.start();
      setIsRecordingVoice(true);
      setRecordingDuration(0);
      recordingTimerRef.current = setInterval(() => {
        setRecordingDuration((prev) => prev + 1);
      }, 1000);
    } catch (err) {
      console.error('[VOICE RECORDING ERROR]', err);
      alert('Microphone access is required to record voice notes.');
    }
  };

  const stopVoiceRecording = () => {
    if (mediaRecorderRef.current && isRecordingVoice) {
      clearInterval(recordingTimerRef.current);
      mediaRecorderRef.current.stop();
      setIsRecordingVoice(false);
    }
  };

  const cancelVoiceRecording = () => {
    if (mediaRecorderRef.current && isRecordingVoice) {
      clearInterval(recordingTimerRef.current);
      audioChunksRef.current = [];
      try {
        mediaRecorderRef.current.stream?.getTracks()?.forEach((track) => track.stop());
      } catch (e) {
        console.error(e);
      }
      mediaRecorderRef.current = null;
      setIsRecordingVoice(false);
      setRecordingDuration(0);
    }
  };

  const formatRecordingTime = (secs) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}:${s < 10 ? '0' : ''}${s}`;
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

          <div
            className="horizon-partner-info"
            onClick={() => setShowProfileModal(true)}
            style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '10px', padding: '4px 8px', borderRadius: '8px', transition: 'background 0.2s' }}
            title="View Contact Profile"
          >
            <div
              className={`horizon-cell-avatar ${isPartnerOnline ? 'online' : ''}`}
              style={{ width: '38px', height: '38px', fontSize: '14px' }}
            >
              {partner.avatarUrl || partner.avatar_url ? (
                <img src={partner.avatarUrl || partner.avatar_url} alt={partner.username} className="horizon-avatar-img" />
              ) : (
                (partner.username || 'User').slice(0, 2).toUpperCase()
              )}
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
                  {/* View Once Media Bubble Presentation */}
                  {msg.isViewOnce ? (
                    <div style={{ marginBottom: '6px' }}>
                      {(!isMe && msg.isViewed) ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 12px', background: 'rgba(255,255,255,0.05)', borderRadius: '10px', color: 'var(--color-text-muted)', fontSize: '13px' }}>
                          <Eye size={16} />
                          <span>View-once photo (Opened)</span>
                        </div>
                      ) : !isMe ? (
                        <div
                          onClick={() => {
                            fetch(`${apiBaseUrl}/api/messages/${msg.id}/view-once`, {
                              method: 'POST',
                              headers: { Authorization: `Bearer ${token}` }
                            }).catch(console.error);
                            setMessages((prev) => prev.map((m) => (m.id === msg.id ? { ...m, isViewed: true } : m)));
                            setLightboxMedia({
                              type: msg.attachmentType === 'VIDEO' ? 'VIDEO' : 'IMAGE',
                              url: msg.attachmentUrl,
                              title: `1-View Media from @${partner.username}`,
                              subtitle: formatMessageTime(msg.createdAt),
                              caption: msg.text
                            });
                          }}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px',
                            padding: '9px 14px',
                            background: 'rgba(245, 158, 11, 0.2)',
                            border: '1px solid var(--color-accent-amber)',
                            borderRadius: '12px',
                            cursor: 'pointer',
                            color: 'var(--color-accent-amber)',
                            fontSize: '13px'
                          }}
                        >
                          <Eye size={18} />
                          <span style={{ fontWeight: 700 }}>1 Photo (Tap to view once)</span>
                        </div>
                      ) : (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 12px', background: 'rgba(255,255,255,0.05)', borderRadius: '10px', color: 'var(--color-text-muted)', fontSize: '13px' }}>
                          <Eye size={16} color="var(--color-accent-amber)" />
                          <span>View-once {msg.isViewed ? '(Opened by recipient)' : '(Sent)'}</span>
                        </div>
                      )}
                    </div>
                  ) : null}

                  {/* Regular Image Card */}
                  {!msg.isViewOnce && isMedia && (
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
                          src={isDownloaded || msg.attachmentUrl ? msg.attachmentUrl : msg.thumbnailBlur}
                          alt="Attachment preview"
                          className="horizon-blur-img revealed"
                        />
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

      {/* Hidden File Pickers for Dedicated Categories */}
      <input
        type="file"
        ref={imageInputRef}
        onChange={(e) => handleFileChange(e, 'image', 'IMAGE')}
        accept="image/*"
        style={{ display: 'none' }}
      />
      <input
        type="file"
        ref={videoInputRef}
        onChange={(e) => handleFileChange(e, 'video', 'VIDEO')}
        accept="video/*"
        style={{ display: 'none' }}
      />
      <input
        type="file"
        ref={audioInputRef}
        onChange={(e) => handleFileChange(e, 'voice', 'AUDIO')}
        accept="audio/*"
        style={{ display: 'none' }}
      />
      <input
        type="file"
        ref={docInputRef}
        onChange={(e) => handleFileChange(e, 'others', 'DOCUMENT')}
        accept="application/pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.zip"
        style={{ display: 'none' }}
      />

      {/* Attachment Popover Menu */}
      {showAttachMenu && (
        <div
          style={{
            padding: '12px 16px',
            backgroundColor: 'var(--color-surface-elevated)',
            borderTop: '1px solid rgba(245, 158, 11, 0.25)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-around',
            gap: '8px',
            animation: 'fadeIn 0.2s ease'
          }}
        >
          <button
            type="button"
            onClick={() => imageInputRef.current?.click()}
            style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px', background: 'none', border: 'none', color: '#F8FAFC', cursor: 'pointer' }}
          >
            <div style={{ width: '42px', height: '42px', borderRadius: '50%', background: 'rgba(59, 130, 246, 0.2)', border: '1px solid #3B82F6', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#60A5FA' }}>
              <ImageIcon size={20} />
            </div>
            <span style={{ fontSize: '11px', fontWeight: 600 }}>Photos</span>
          </button>

          <button
            type="button"
            onClick={() => videoInputRef.current?.click()}
            style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px', background: 'none', border: 'none', color: '#F8FAFC', cursor: 'pointer' }}
          >
            <div style={{ width: '42px', height: '42px', borderRadius: '50%', background: 'rgba(239, 68, 68, 0.2)', border: '1px solid #EF4444', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#F87171' }}>
              <Film size={20} />
            </div>
            <span style={{ fontSize: '11px', fontWeight: 600 }}>Videos</span>
          </button>

          <button
            type="button"
            onClick={() => audioInputRef.current?.click()}
            style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px', background: 'none', border: 'none', color: '#F8FAFC', cursor: 'pointer' }}
          >
            <div style={{ width: '42px', height: '42px', borderRadius: '50%', background: 'rgba(16, 185, 129, 0.2)', border: '1px solid #10B981', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#34D399' }}>
              <Mic size={20} />
            </div>
            <span style={{ fontSize: '11px', fontWeight: 600 }}>Audio</span>
          </button>

          <button
            type="button"
            onClick={() => docInputRef.current?.click()}
            style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px', background: 'none', border: 'none', color: '#F8FAFC', cursor: 'pointer' }}
          >
            <div style={{ width: '42px', height: '42px', borderRadius: '50%', background: 'rgba(168, 85, 247, 0.2)', border: '1px solid #A855F7', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#C084FC' }}>
              <FileText size={20} />
            </div>
            <span style={{ fontSize: '11px', fontWeight: 600 }}>Document</span>
          </button>

          <button
            type="button"
            onClick={() => setIsViewOnceSelected(!isViewOnceSelected)}
            style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px', background: 'none', border: 'none', color: isViewOnceSelected ? 'var(--color-accent-amber)' : '#94A3B8', cursor: 'pointer' }}
          >
            <div style={{ width: '42px', height: '42px', borderRadius: '50%', background: isViewOnceSelected ? 'rgba(245, 158, 11, 0.3)' : 'rgba(255,255,255,0.06)', border: `1px solid ${isViewOnceSelected ? 'var(--color-accent-amber)' : 'rgba(255,255,255,0.1)'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: isViewOnceSelected ? 'var(--color-accent-amber)' : '#94A3B8' }}>
              <Eye size={20} />
            </div>
            <span style={{ fontSize: '11px', fontWeight: 600 }}>{isViewOnceSelected ? '1-View: ON' : '1-View: OFF'}</span>
          </button>
        </div>
      )}

      {/* Horizontal Input Dock (activity_chat.xml) */}
      <form onSubmit={handleSendMessage} className="horizon-input-dock">
        {isRecordingVoice ? (
          /* Live Voice Recording UI */
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 8px', gap: '12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#EF4444' }}>
              <Radio size={18} style={{ animation: 'pulse 1s infinite' }} />
              <span style={{ fontWeight: 700, fontSize: '14px', fontFamily: 'monospace' }}>
                {formatRecordingTime(recordingDuration)}
              </span>
            </div>

            <span style={{ fontSize: '12px', color: 'var(--color-text-muted)' }}>
              Recording voice note...
            </span>

            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <button
                type="button"
                onClick={cancelVoiceRecording}
                style={{ background: 'none', border: 'none', color: '#EF4444', padding: '6px', cursor: 'pointer' }}
                title="Cancel Recording"
              >
                <Trash2 size={18} />
              </button>
              <button
                type="button"
                onClick={stopVoiceRecording}
                className="horizon-send-fab"
                style={{ width: '36px', height: '36px' }}
                title="Send Voice Note"
              >
                <Send size={16} />
              </button>
            </div>
          </div>
        ) : (
          /* Standard Input Bar */
          <>
            <button
              type="button"
              onClick={() => setShowAttachMenu(!showAttachMenu)}
              className="horizon-dock-clip"
              style={{ color: showAttachMenu || isViewOnceSelected ? 'var(--color-accent-amber)' : undefined }}
              title="Attach Media (Cloudflare R2)"
              id="btnAttachMedia"
            >
              <Paperclip size={20} />
            </button>

            {isViewOnceSelected && (
              <span style={{ padding: '2px 6px', backgroundColor: 'rgba(245, 158, 11, 0.2)', border: '1px solid var(--color-accent-amber)', borderRadius: '6px', fontSize: '11px', color: 'var(--color-accent-amber)', fontWeight: 700, flexShrink: 0 }}>
                1-View
              </span>
            )}

            <input
              id="etMessageInput"
              type="text"
              className="horizon-input-box"
              placeholder={uploadingMedia ? "Uploading to Cloudflare R2..." : "Message..."}
              disabled={uploadingMedia}
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              autoComplete="off"
            />

            {inputText.trim() ? (
              <button
                type="submit"
                disabled={uploadingMedia}
                className="horizon-send-fab"
                id="btnSendMessage"
                title="Send Message"
              >
                <Send size={18} style={{ marginLeft: '2px' }} />
              </button>
            ) : (
              <button
                type="button"
                onClick={startVoiceRecording}
                className="horizon-dock-clip"
                style={{ color: 'var(--color-accent-amber)' }}
                title="Record Voice Note"
                id="btnRecordVoice"
              >
                <Mic size={20} />
              </button>
            )}
          </>
        )}
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

      {/* Dedicated User Profile Modal / Drawer */}
      {showProfileModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 9998,
            backgroundColor: 'rgba(10, 15, 29, 0.75)',
            backdropFilter: 'blur(6px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '16px'
          }}
          onClick={() => setShowProfileModal(false)}
        >
          <div
            style={{
              width: '100%',
              maxWidth: '440px',
              maxHeight: '90vh',
              backgroundColor: '#1E293B',
              borderRadius: '16px',
              border: '1px solid rgba(255,255,255,0.1)',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
              boxShadow: '0 20px 40px rgba(0,0,0,0.5)'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '16px 20px',
                borderBottom: '1px solid rgba(255,255,255,0.08)'
              }}
            >
              <div style={{ fontSize: '16px', fontWeight: 700, color: '#F8FAFC' }}>
                Contact Info
              </div>
              <button
                onClick={() => setShowProfileModal(false)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#94A3B8',
                  cursor: 'pointer',
                  padding: '4px'
                }}
              >
                <X size={20} />
              </button>
            </div>

            {/* Modal Body */}
            <div style={{ overflowY: 'auto', padding: '20px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
              {/* Profile Card */}
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
                <div
                  style={{
                    width: '80px',
                    height: '80px',
                    borderRadius: '50%',
                    background: 'linear-gradient(135deg, #F59E0B, #EA580C)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '28px',
                    fontWeight: 700,
                    color: '#fff',
                    marginBottom: '12px',
                    overflow: 'hidden',
                    border: '2px solid var(--color-accent-amber)'
                  }}
                >
                  {partner.avatarUrl || partner.avatar_url ? (
                    <img src={partner.avatarUrl || partner.avatar_url} alt={partner.username} className="horizon-avatar-img" />
                  ) : (
                    (partner.username || 'User').slice(0, 2).toUpperCase()
                  )}
                </div>
                <div style={{ fontSize: '18px', fontWeight: 700, color: '#F8FAFC' }}>
                  @{partner.username}
                </div>
                <div
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    marginTop: '6px',
                    padding: '4px 12px',
                    borderRadius: '12px',
                    backgroundColor: isPartnerOnline ? 'rgba(16, 185, 129, 0.15)' : 'rgba(148, 163, 184, 0.15)',
                    color: isPartnerOnline ? '#10B981' : '#94A3B8',
                    fontSize: '12px',
                    fontWeight: 600
                  }}
                >
                  <span
                    style={{
                      width: '8px',
                      height: '8px',
                      borderRadius: '50%',
                      backgroundColor: isPartnerOnline ? '#10B981' : '#94A3B8'
                    }}
                  />
                  {isPartnerOnline ? 'Online' : 'Offline'}
                </div>
                <div style={{ fontSize: '13px', color: '#94A3B8', marginTop: '10px' }}>
                  Hey there! I am using Horizon Chat.
                </div>
              </div>

              {/* Repository Tabs */}
              <div>
                <div style={{ fontSize: '14px', fontWeight: 700, color: '#F8FAFC', marginBottom: '10px' }}>
                  Shared Repository
                </div>
                <div
                  style={{
                    display: 'flex',
                    borderRadius: '8px',
                    backgroundColor: '#0F172A',
                    padding: '3px',
                    marginBottom: '12px'
                  }}
                >
                  {['media', 'docs', 'links'].map((tab) => (
                    <button
                      key={tab}
                      onClick={() => setActiveProfileTab(tab)}
                      style={{
                        flex: 1,
                        padding: '8px',
                        border: 'none',
                        borderRadius: '6px',
                        backgroundColor: activeProfileTab === tab ? '#F59E0B' : 'transparent',
                        color: activeProfileTab === tab ? '#000' : '#94A3B8',
                        fontWeight: 700,
                        fontSize: '12px',
                        cursor: 'pointer',
                        textTransform: 'capitalize',
                        transition: 'all 0.2s'
                      }}
                    >
                      {tab}
                    </button>
                  ))}
                </div>

                {/* Tab Content */}
                {activeProfileTab === 'media' && (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '6px' }}>
                    {messages.filter(m => m.attachmentType === 'IMAGE' || m.attachmentType === 'VIDEO').length === 0 ? (
                      <div style={{ gridColumn: 'span 3', textAlign: 'center', padding: '20px', color: '#94A3B8', fontSize: '13px' }}>
                        No shared photos or videos yet
                      </div>
                    ) : (
                      messages.filter(m => m.attachmentType === 'IMAGE' || m.attachmentType === 'VIDEO').map(m => (
                        <div
                          key={m.id}
                          onClick={() => {
                            setShowProfileModal(false);
                            setLightboxMedia({
                              type: m.attachmentType,
                              url: m.attachmentUrl || m.thumbnailBlur,
                              title: `${m.attachmentType === 'VIDEO' ? 'Video' : 'Photo'} from @${m.senderId === user.id ? 'You' : partner.username}`,
                              subtitle: formatMessageTime(m.createdAt),
                              caption: m.text
                            });
                          }}
                          style={{
                            aspectRatio: '1',
                            borderRadius: '8px',
                            overflow: 'hidden',
                            backgroundColor: '#0F172A',
                            cursor: 'pointer',
                            position: 'relative'
                          }}
                        >
                          {m.attachmentType === 'VIDEO' ? (
                            <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#000' }}>
                              <Film size={24} color="#F59E0B" />
                            </div>
                          ) : (
                            <img
                              src={m.attachmentUrl || m.thumbnailBlur}
                              alt="media thumbnail"
                              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                            />
                          )}
                        </div>
                      ))
                    )}
                  </div>
                )}

                {activeProfileTab === 'docs' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {messages.filter(m => m.attachmentType === 'DOCUMENT').length === 0 ? (
                      <div style={{ textAlign: 'center', padding: '20px', color: '#94A3B8', fontSize: '13px' }}>
                        No shared documents yet
                      </div>
                    ) : (
                      messages.filter(m => m.attachmentType === 'DOCUMENT').map(m => (
                        <div
                          key={m.id}
                          onClick={() => {
                            if (m.attachmentUrl) window.open(m.attachmentUrl, '_blank');
                          }}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '10px',
                            padding: '10px 12px',
                            borderRadius: '8px',
                            backgroundColor: '#0F172A',
                            cursor: 'pointer'
                          }}
                        >
                          <FileText size={20} color="#F59E0B" />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: '13px', color: '#F8FAFC', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {m.text || 'Document.pdf'}
                            </div>
                            <div style={{ fontSize: '11px', color: '#94A3B8' }}>
                              {formatFileSize(m.fileSizeBytes)}
                            </div>
                          </div>
                          <Download size={16} color="#94A3B8" />
                        </div>
                      ))
                    )}
                  </div>
                )}

                {activeProfileTab === 'links' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {messages.filter(m => /https?:\/\/[^\s]+/.test(m.text || '')).length === 0 ? (
                      <div style={{ textAlign: 'center', padding: '20px', color: '#94A3B8', fontSize: '13px' }}>
                        No shared links found in conversation
                      </div>
                    ) : (
                      messages.filter(m => /https?:\/\/[^\s]+/.test(m.text || '')).map(m => {
                        const match = (m.text || '').match(/https?:\/\/[^\s]+/);
                        const url = match ? match[0] : '';
                        return (
                          <a
                            key={m.id}
                            href={url}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: '10px',
                              padding: '10px 12px',
                              borderRadius: '8px',
                              backgroundColor: '#0F172A',
                              color: '#38BDF8',
                              textDecoration: 'none',
                              fontSize: '13px',
                              overflow: 'hidden'
                            }}
                          >
                            <ExternalLink size={16} style={{ flexShrink: 0 }} />
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {url}
                            </span>
                          </a>
                        );
                      })
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
