/**
 * Chat Controller
 * Release 3.2.3 - Conversation History (DESC 100), Media Presign & Byte-Range Streaming
 */

import { messageModel } from '../models/messageModel.js';
import { reactionModel } from '../models/reactionModel.js';
import { userModel } from '../models/userModel.js';
import { getPresignedUploadUrl, getMediaStream, getMediaPublicUrl } from '../config/r2.js';

export const chatController = {
  /**
   * Retrieves message history for a conversation:
   * Query: ORDER BY created_at DESC LIMIT 100.
   * Bundles reaction counts for each message.
   * The client will reverse the resulting array once to render in chronological order (ASC).
   */
  async getChatHistory(req, res, next) {
    try {
      const { chatId } = req.params;
      const limit = parseInt(req.query.limit, 10) || 100;

      if (!chatId) {
        return res.status(400).json({
          success: false,
          error: 'chatId parameter is required'
        });
      }

      // Fetch messages ordered DESC
      const messages = await messageModel.getMessagesByChatId(chatId, limit);

      // Extract message IDs to batch-fetch aggregated reactions
      const messageIds = messages.map(m => m.id);
      const reactionMap = await reactionModel.getAggregatedReactions(messageIds);

      // Attach reactions and formatted URLs to each message
      const enrichedMessages = messages.map(m => ({
        ...m,
        media_url: m.media_url ? getMediaPublicUrl(m.media_url) : null,
        reactions: reactionMap[m.id] || {}
      }));

      return res.status(200).json({
        success: true,
        chatId: Number(chatId),
        count: enrichedMessages.length,
        messages: enrichedMessages
      });
    } catch (err) {
      next(err);
    }
  },

  /**
   * Gets or creates a direct conversation between authenticated user and target username
   */
  async getOrCreateDirectChat(req, res, next) {
    try {
      const { targetUsername } = req.body || {};

      if (!targetUsername) {
        return res.status(400).json({
          success: false,
          error: 'targetUsername is required'
        });
      }

      const targetUser = await userModel.findByUsername(targetUsername);
      if (!targetUser) {
        return res.status(404).json({
          success: false,
          error: 'Target user not found'
        });
      }

      const currentUserId = req.user.id;
      const targetUserId = targetUser.id;

      if (Number(currentUserId) === Number(targetUserId)) {
        return res.status(400).json({
          success: false,
          error: 'Cannot start conversation with yourself'
        });
      }

      const chatId = await messageModel.findOrCreateDirectChat(currentUserId, targetUserId);

      return res.status(200).json({
        success: true,
        chatId,
        partner: {
          id: targetUser.id,
          username: targetUser.username,
          is_active: Boolean(targetUser.is_active),
          last_seen: targetUser.last_seen
        }
      });
    } catch (err) {
      next(err);
    }
  },

  /**
   * Retrieves all conversation summaries for the authenticated user
   */
  async getUserChats(req, res, next) {
    try {
      const chats = await messageModel.getUserChats(req.user.id);
      return res.status(200).json({
        success: true,
        chats
      });
    } catch (err) {
      next(err);
    }
  },

  /**
   * Generates a presigned Cloudflare R2 PUT URL for direct media upload
   */
  async getUploadUrl(req, res, next) {
    try {
      const { fileName, contentType, isViewOnce } = req.body || {};

      if (!fileName || !contentType) {
        return res.status(400).json({
          success: false,
          error: 'fileName and contentType are required'
        });
      }

      const ext = fileName.split('.').pop() || 'bin';
      const key = `chat_${Date.now()}_${Math.random().toString(36).substring(2, 8)}.${ext}`;

      const uploadUrl = await getPresignedUploadUrl(key, contentType, 3600);
      const publicUrl = getMediaPublicUrl(key);

      return res.status(200).json({
        success: true,
        key,
        uploadUrl,
        publicUrl
      });
    } catch (err) {
      next(err);
    }
  },

  /**
   * Byte-range streaming proxy for high-speed video/audio playback with zero buffering lag
   */
  async streamMedia(req, res, next) {
    try {
      const key = req.query.key;
      if (!key) {
        return res.status(400).json({
          success: false,
          error: 'Media key query parameter is required'
        });
      }

      const rangeHeader = req.headers.range;
      const media = await getMediaStream(key, rangeHeader);

      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Content-Type', media.contentType);

      if (rangeHeader && media.contentRange) {
        res.status(206);
        res.setHeader('Content-Range', media.contentRange);
        res.setHeader('Content-Length', media.contentLength);
      } else {
        res.status(200);
        if (media.contentLength) {
          res.setHeader('Content-Length', media.contentLength);
        }
      }

      // Pipe S3 stream to HTTP client
      media.stream.pipe(res);
    } catch (err) {
      next(err);
    }
  }
};
