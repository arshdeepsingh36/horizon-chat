/**
 * Chat Context
 * Release 3.2.3 - Map-Based Message Deduplication, Ordering (DESC->ASC Once), and Real-Time Sync
 */

import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import api from '../services/api.js';
import socketService from '../services/socket.js';
import { useAuth } from './AuthContext.jsx';

const ChatContext = createContext(null);

export function ChatProvider({ children }) {
  const { user, isAuthenticated } = useAuth();
  const [activeChatId, setActiveChatId] = useState(null);
  const [activePartner, setActivePartner] = useState(null);
  const [chats, setChats] = useState([]);
  // Messages stored as an ID-keyed Map to guarantee zero duplicate keys or looped blocks
  const [messagesMap, setMessagesMap] = useState(new Map());
  const [loadingHistory, setLoadingHistory] = useState(false);

  // Derived chronologically ordered (ASC) message list
  const messages = useMemo(() => {
    return Array.from(messagesMap.values()).sort((a, b) => {
      const timeA = new Date(a.created_at).getTime();
      const timeB = new Date(b.created_at).getTime();
      if (timeA === timeB) return Number(a.id) - Number(b.id);
      return timeA - timeB;
    });
  }, [messagesMap]);

  // Load chat conversations list
  const loadChats = useCallback(async () => {
    if (!isAuthenticated) return;
    try {
      const res = await api.get('/api/chat/list');
      if (res.success && res.chats) {
        setChats(res.chats);
      }
    } catch (err) {
      console.error('[CHAT CONTEXT] Failed to load conversations list:', err.message);
    }
  }, [isAuthenticated]);

  // Fetch message history for a conversation:
  // API returns messages in DESC order (limit 100).
  // We reverse ONCE and populate the deduplicating Map.
  const loadHistory = useCallback(async (chatId) => {
    if (!chatId) return;
    setLoadingHistory(true);
    try {
      const res = await api.get(`/api/chat/history/${chatId}?limit=100`);
      if (res.success && Array.isArray(res.messages)) {
        // Reverse incoming DESC query once to establish chronological ASC order
        const chronologicalList = [...res.messages].reverse();

        // Populate Map indexed by unique message ID
        const newMap = new Map();
        for (const msg of chronologicalList) {
          if (msg && msg.id) {
            newMap.set(Number(msg.id), msg);
          }
        }
        setMessagesMap(newMap);

        // Tell socket we entered the room
        socketService.emit('join_chat', { chatId });
        socketService.emit('chat_seen', { chatId });
      }
    } catch (err) {
      console.error('[CHAT CONTEXT] Failed to load message history:', err.message);
    } finally {
      setLoadingHistory(false);
    }
  }, []);

  // Select active conversation
  const selectChat = useCallback((chatId, partner = null) => {
    if (activeChatId && activeChatId !== chatId) {
      socketService.emit('leave_chat', { chatId: activeChatId });
    }
    setActiveChatId(chatId);
    setActivePartner(partner);
    setMessagesMap(new Map()); // Clean hydration reset
    loadHistory(chatId);
  }, [activeChatId, loadHistory]);

  // Start direct chat by username
  const startDirectChat = useCallback(async (targetUsername) => {
    const res = await api.post('/api/chat/direct', { targetUsername });
    if (res.success && res.chatId) {
      selectChat(res.chatId, res.partner);
      await loadChats();
      return res.chatId;
    }
    throw new Error(res.error || 'Failed to start conversation');
  }, [selectChat, loadChats]);

  // Send message
  const sendMessage = useCallback((content, mediaUrl = null, mediaType = null, isViewOnce = false) => {
    if (!activeChatId) return;

    const tempId = Date.now();
    const optimisticMsg = {
      id: tempId,
      chat_id: activeChatId,
      sender_id: user?.id,
      sender_username: user?.username,
      content,
      media_url: mediaUrl,
      media_type: mediaType,
      is_view_once: isViewOnce,
      status: 'sent',
      created_at: new Date().toISOString(),
      reactions: {}
    };

    // Optimistically add to map
    setMessagesMap(prev => {
      const next = new Map(prev);
      next.set(tempId, optimisticMsg);
      return next;
    });

    socketService.emit('send_message', {
      chatId: activeChatId,
      content,
      mediaUrl,
      mediaType,
      isViewOnce,
      tempId
    }, (response) => {
      if (response && response.success && response.message) {
        setMessagesMap(prev => {
          const next = new Map(prev);
          next.delete(tempId); // Remove temporary key
          next.set(Number(response.message.id), response.message);
          return next;
        });
      }
    });
  }, [activeChatId, user]);

  // Send emoji reaction
  const sendReaction = useCallback((messageId, emoji) => {
    if (!activeChatId || !messageId) return;
    socketService.emit('send_reaction', {
      chatId: activeChatId,
      messageId,
      emoji
    });
  }, [activeChatId]);

  // Mark message seen
  const markMessageSeen = useCallback((messageId) => {
    if (!activeChatId || !messageId) return;
    socketService.emit('message_seen', {
      chatId: activeChatId,
      messageId
    });
  }, [activeChatId]);

  // Socket event listeners for real-time updates
  useEffect(() => {
    if (!isAuthenticated) return;

    const socket = socketService.getSocket();
    if (!socket) return;

    // 1. Incoming new message
    const handleNewMessage = (newMsg) => {
      if (!newMsg || !newMsg.id) return;
      if (Number(newMsg.chat_id) === Number(activeChatId)) {
        setMessagesMap(prev => {
          const next = new Map(prev);
          if (newMsg.tempId) {
            next.delete(newMsg.tempId);
          }
          next.set(Number(newMsg.id), newMsg);
          return next;
        });

        // If from partner, acknowledge delivery and seen immediately
        if (Number(newMsg.sender_id) !== Number(user?.id)) {
          socketService.emit('message_delivered', { messageId: newMsg.id, chatId: activeChatId });
          socketService.emit('message_seen', { messageId: newMsg.id, chatId: activeChatId });
        }
      }
      loadChats();
    };

    // 2. Real-time status update (Single tick -> Double tick -> Blue tick)
    const handleStatusUpdated = ({ messageId, status, seen_at }) => {
      setMessagesMap(prev => {
        const id = Number(messageId);
        if (!prev.has(id)) return prev;
        const next = new Map(prev);
        const existing = next.get(id);
        next.set(id, {
          ...existing,
          status,
          seen_at: seen_at || existing.seen_at
        });
        return next;
      });
    };

    // 3. Conversation bulk seen
    const handleChatSeenUpdated = ({ chatId, seen_at }) => {
      if (Number(chatId) === Number(activeChatId)) {
        setMessagesMap(prev => {
          const next = new Map(prev);
          for (const [id, msg] of next.entries()) {
            if (Number(msg.sender_id) === Number(user?.id) && msg.status !== 'seen') {
              next.set(id, { ...msg, status: 'seen', seen_at });
            }
          }
          return next;
        });
      }
    };

    // 4. Emoji Reaction update
    const handleReactionUpdated = ({ messageId, emoji, userId }) => {
      setMessagesMap(prev => {
        const id = Number(messageId);
        if (!prev.has(id)) return prev;
        const next = new Map(prev);
        const existing = next.get(id);
        const reactions = { ...(existing.reactions || {}) };
        reactions[emoji] = (reactions[emoji] || 0) + 1;
        next.set(id, {
          ...existing,
          reactions
        });
        return next;
      });
    };

    // 5. Ephemeral 24h expired message dropped from view
    const handleMessageExpired = ({ messageId }) => {
      setMessagesMap(prev => {
        const id = Number(messageId);
        if (!prev.has(id)) return prev;
        const next = new Map(prev);
        next.delete(id);
        return next;
      });
    };

    socket.on('new_message', handleNewMessage);
    socket.on('status_updated', handleStatusUpdated);
    socket.on('chat_seen_updated', handleChatSeenUpdated);
    socket.on('reaction_updated', handleReactionUpdated);
    socket.on('message_expired', handleMessageExpired);

    return () => {
      socket.off('new_message', handleNewMessage);
      socket.off('status_updated', handleStatusUpdated);
      socket.off('chat_seen_updated', handleChatSeenUpdated);
      socket.off('reaction_updated', handleReactionUpdated);
      socket.off('message_expired', handleMessageExpired);
    };
  }, [isAuthenticated, activeChatId, user, loadChats]);

  // Initial chats load on mount
  useEffect(() => {
    if (isAuthenticated) {
      loadChats();
    }
  }, [isAuthenticated, loadChats]);

  const value = {
    activeChatId,
    activePartner,
    chats,
    messages,
    loadingHistory,
    loadChats,
    selectChat,
    startDirectChat,
    sendMessage,
    sendReaction,
    markMessageSeen
  };

  return (
    <ChatContext.Provider value={value}>
      {children}
    </ChatContext.Provider>
  );
}

export function useChat() {
  const context = useContext(ChatContext);
  if (!context) {
    throw new Error('useChat must be used within a ChatProvider');
  }
  return context;
}

export default ChatContext;
