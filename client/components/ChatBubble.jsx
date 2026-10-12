/**
 * ChatBubble Component
 * Release 3.2.3 - Responsive Layout, Inline Status Ticks, and Reaction Badge
 */

import React, { useState, useRef, useCallback } from 'react';
import StatusTick from './StatusTick.jsx';
import ReactionBar from './ReactionBar.jsx';
import VideoPlayer from './VideoPlayer.jsx';

export const ChatBubble = React.memo(function ChatBubble({
  message,
  isOwn,
  onReact,
  onImageClick
}) {
  const [showReactionBar, setShowReactionBar] = useState(false);
  const touchTimerRef = useRef(null);

  // Format timestamp (e.g. 10:45 AM)
  const formattedTime = React.useMemo(() => {
    try {
      const date = new Date(message.created_at);
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch {
      return '';
    }
  }, [message.created_at]);

  // Handle touch long-press
  const handleTouchStart = useCallback(() => {
    touchTimerRef.current = setTimeout(() => {
      setShowReactionBar(true);
    }, 450); // 450ms long press threshold
  }, []);

  const handleTouchEnd = useCallback(() => {
    if (touchTimerRef.current) {
      clearTimeout(touchTimerRef.current);
    }
  }, []);

  // Aggregated reaction counts
  const reactionEntries = React.useMemo(() => {
    if (!message.reactions) return [];
    return Object.entries(message.reactions).filter(([_, count]) => count > 0);
  }, [message.reactions]);

  const totalReactions = React.useMemo(() => {
    return reactionEntries.reduce((sum, [_, count]) => sum + count, 0);
  }, [reactionEntries]);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: isOwn ? 'flex-end' : 'flex-start',
        marginBottom: '10px',
        position: 'relative',
        width: '100%'
      }}
      onMouseEnter={() => setShowReactionBar(true)}
      onMouseLeave={() => setShowReactionBar(false)}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      onTouchMove={handleTouchEnd}
      onContextMenu={(e) => {
        e.preventDefault();
        setShowReactionBar(true);
      }}
    >
      {/* Floating Reaction Bar */}
      {showReactionBar && (
        <ReactionBar
          position="top"
          onSelect={(emoji) => {
            onReact(message.id, emoji);
            setShowReactionBar(false);
          }}
          onClose={() => setShowReactionBar(false)}
        />
      )}

      {/* Bubble Container */}
      <div
        style={{
          maxWidth: '80%',
          width: 'fit-content',
          backgroundColor: isOwn ? '#0284C7' : '#1E293B',
          color: '#F8FAFC',
          borderRadius: isOwn ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
          padding: '8px 12px',
          boxShadow: '0 2px 8px rgba(0, 0, 0, 0.25)',
          position: 'relative',
          wordBreak: 'break-word',
          fontSize: '14px',
          lineHeight: '1.45'
        }}
      >
        {/* Media Content */}
        {message.media_url && message.media_type === 'image' && (
          <div style={{ marginBottom: '6px', borderRadius: '8px', overflow: 'hidden' }}>
            <img
              src={message.media_url}
              alt="Media"
              loading="lazy"
              onClick={() => onImageClick && onImageClick(message.media_url)}
              style={{
                width: '100%',
                maxHeight: '280px',
                objectFit: 'cover',
                display: 'block',
                cursor: 'pointer',
                borderRadius: '8px'
              }}
            />
          </div>
        )}

        {message.media_url && message.media_type === 'video' && (
          <div style={{ marginBottom: '6px' }}>
            <VideoPlayer src={message.media_url} isViewOnce={message.is_view_once} />
          </div>
        )}

        {/* Text Message */}
        {message.content && (
          <div style={{ whiteSpace: 'pre-wrap' }}>
            {message.content}
          </div>
        )}

        {/* Inline Timestamp & Status Ticks */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-end',
            gap: '3px',
            marginTop: '4px',
            fontSize: '11px',
            color: isOwn ? 'rgba(255, 255, 255, 0.75)' : '#94A3B8'
          }}
        >
          <span>{formattedTime}</span>
          {isOwn && <StatusTick status={message.status} />}
        </div>

        {/* Aggregated Reactions Pill Badge */}
        {reactionEntries.length > 0 && (
          <div
            style={{
              position: 'absolute',
              bottom: '-10px',
              [isOwn ? 'left' : 'right']: '8px',
              backgroundColor: '#0F172A',
              border: '1px solid #334155',
              borderRadius: '9999px',
              padding: '2px 6px',
              display: 'flex',
              alignItems: 'center',
              gap: '3px',
              fontSize: '11px',
              boxShadow: '0 2px 6px rgba(0, 0, 0, 0.3)',
              cursor: 'pointer'
            }}
            onClick={(e) => {
              e.stopPropagation();
              setShowReactionBar(true);
            }}
          >
            {reactionEntries.slice(0, 3).map(([emoji]) => (
              <span key={emoji}>{emoji}</span>
            ))}
            {totalReactions > 1 && (
              <span style={{ color: '#94A3B8', fontWeight: 600 }}>{totalReactions}</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
});

export default ChatBubble;
