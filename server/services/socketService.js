/**
 * Socket.IO Real-Time Service
 * Release 3.2.3 - Delivery Receipts, Read Status, Emoji Reactions & Room Management
 */

import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { messageModel } from '../models/messageModel.js';
import { reactionModel } from '../models/reactionModel.js';
import { userModel } from '../models/userModel.js';

let ioInstance = null;
const userSockets = new Map(); // userId -> Set of socketIds

export const socketService = {
  /**
   * Initializes Socket.IO event handlers and authentication middleware
   */
  init(io) {
    ioInstance = io;

    // Authentication handshake middleware
    io.use((socket, next) => {
      const token = socket.handshake.auth?.token || socket.handshake.query?.token;
      if (!token) {
        return next(new Error('Authentication token required'));
      }

      try {
        const decoded = jwt.verify(token, env.JWT_SECRET);
        socket.user = decoded;
        next();
      } catch (err) {
        return next(new Error('Invalid authentication token'));
      }
    });

    io.on('connection', (socket) => {
      const userId = socket.user.id;
      const username = socket.user.username;

      // Track active sockets
      if (!userSockets.has(userId)) {
        userSockets.set(userId, new Set());
      }
      userSockets.get(userId).add(socket.id);

      console.log(`[SOCKET CONNECT] User @${username} (ID: ${userId}) connected on socket ${socket.id}`);

      // Update presence
      userModel.updateLastSeen(userId).catch(console.error);

      // Join personal room for targeted dispatches
      socket.join(`user_${userId}`);

      // 1. Join Conversation Room
      socket.on('join_chat', ({ chatId }) => {
        if (!chatId) return;
        const room = `chat_${chatId}`;
        socket.join(room);
        console.log(`[SOCKET ROOM] User @${username} joined room ${room}`);
      });

      // 2. Leave Conversation Room
      socket.on('leave_chat', ({ chatId }) => {
        if (!chatId) return;
        const room = `chat_${chatId}`;
        socket.leave(room);
        console.log(`[SOCKET ROOM] User @${username} left room ${room}`);
      });

      // 3. Send Message
      socket.on('send_message', async (data, callback) => {
        try {
          const { chatId, content, mediaUrl, mediaType, isViewOnce, tempId } = data || {};
          if (!chatId || (!content && !mediaUrl)) {
            if (callback) callback({ success: false, error: 'Invalid message payload' });
            return;
          }

          const savedMessage = await messageModel.createMessage({
            chatId,
            senderId: userId,
            content,
            mediaUrl,
            mediaType,
            isViewOnce: Boolean(isViewOnce),
            status: 'sent'
          });

          const enriched = {
            ...savedMessage,
            sender_username: username,
            tempId,
            reactions: {}
          };

          const room = `chat_${chatId}`;
          // Broadcast to conversation room (including sender for sync confirmation)
          io.to(room).emit('new_message', enriched);

          if (callback) callback({ success: true, message: enriched });
        } catch (err) {
          console.error('[SOCKET SEND_MESSAGE ERROR]', err);
          if (callback) callback({ success: false, error: err.message });
        }
      });

      // 4. Message Delivered Receipt
      socket.on('message_delivered', async ({ messageId, chatId }) => {
        try {
          if (!messageId) return;
          const updated = await messageModel.updateMessageStatus(messageId, 'delivered');
          if (updated) {
            const room = `chat_${chatId || updated.chat_id}`;
            io.to(room).emit('status_updated', {
              messageId: updated.id,
              chatId: updated.chat_id,
              status: 'delivered',
              seen_at: null
            });
          }
        } catch (err) {
          console.error('[SOCKET MESSAGE_DELIVERED ERROR]', err);
        }
      });

      // 5. Message Seen Receipt (Turns single/double tick -> Blue Tick)
      socket.on('message_seen', async ({ messageId, chatId }) => {
        try {
          if (!messageId) return;
          const updated = await messageModel.markMessageSeen(messageId);
          if (updated) {
            const room = `chat_${chatId || updated.chat_id}`;
            io.to(room).emit('status_updated', {
              messageId: updated.id,
              chatId: updated.chat_id,
              status: 'seen',
              seen_at: updated.seen_at
            });
          }
        } catch (err) {
          console.error('[SOCKET MESSAGE_SEEN ERROR]', err);
        }
      });

      // 6. Bulk Mark Chat Seen
      socket.on('chat_seen', async ({ chatId }) => {
        try {
          if (!chatId) return;
          const updatedRows = await messageModel.markChatMessagesSeen(chatId, userId);
          if (updatedRows && updatedRows.length > 0) {
            const room = `chat_${chatId}`;
            io.to(room).emit('chat_seen_updated', {
              chatId: Number(chatId),
              seenByUserId: userId,
              updatedCount: updatedRows.length,
              seen_at: new Date().toISOString()
            });
          }
        } catch (err) {
          console.error('[SOCKET CHAT_SEEN ERROR]', err);
        }
      });

      // 7. Send Emoji Reaction
      socket.on('send_reaction', async ({ messageId, chatId, emoji }) => {
        try {
          if (!messageId || !emoji) return;
          await reactionModel.upsertReaction(messageId, userId, emoji);

          const room = `chat_${chatId}`;
          io.to(room).emit('reaction_updated', {
            messageId,
            chatId,
            userId,
            emoji
          });
        } catch (err) {
          console.error('[SOCKET SEND_REACTION ERROR]', err);
        }
      });

      // Disconnect lifecycle
      socket.on('disconnect', () => {
        if (userSockets.has(userId)) {
          const userSet = userSockets.get(userId);
          userSet.delete(socket.id);
          if (userSet.size === 0) {
            userSockets.delete(userId);
            userModel.updateLastSeen(userId).catch(console.error);
          }
        }
        console.log(`[SOCKET DISCONNECT] User @${username} disconnected socket ${socket.id}`);
      });
    });
  },

  /**
   * Broadcasts real-time expiration drop event to an active conversation room
   */
  emitMessageExpired(chatId, messageId) {
    if (!ioInstance) return;
    const room = `chat_${chatId}`;
    ioInstance.to(room).emit('message_expired', {
      messageId: Number(messageId),
      chatId: Number(chatId)
    });
  },

  /**
   * Returns total count of active unique socket connections
   */
  getActiveSocketCount() {
    if (!ioInstance) return 0;
    return ioInstance.engine ? ioInstance.engine.clientsCount : 0;
  },

  getIO() {
    return ioInstance;
  }
};
