/**
 * Message Model
 * Release 3.2.3 - High-Speed Chat Queries & Ephemeral 24h Purging
 */

import { query, isPg } from '../config/db.js';

export const messageModel = {
  /**
   * Persists a new message
   */
  async createMessage({
    chatId,
    senderId,
    content = null,
    mediaUrl = null,
    mediaType = null,
    isViewOnce = false,
    status = 'sent'
  }) {
    const sql = `
      INSERT INTO messages (
        chat_id, sender_id, content, media_url, media_type, is_view_once, status, created_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
      RETURNING id, chat_id, sender_id, content, media_url, media_type, is_view_once, status, seen_at, created_at;
    `;
    const res = await query(sql, [
      chatId,
      senderId,
      content,
      mediaUrl,
      mediaType,
      isViewOnce,
      status
    ]);
    return res.rows[0];
  },

  /**
   * Fetches latest messages for a chat in DESC order (limit 100)
   * The client will reverse this array once to render chronologically (ASC).
   * @param {number|string} chatId
   * @param {number} limit
   * @returns {Promise<Array>}
   */
  async getMessagesByChatId(chatId, limit = 100) {
    const safeLimit = Math.min(parseInt(limit, 10) || 100, 100);
    const sql = `
      SELECT 
        m.id, 
        m.chat_id, 
        m.sender_id, 
        m.content, 
        m.media_url, 
        m.media_type, 
        m.is_view_once, 
        m.status, 
        m.seen_at, 
        m.created_at,
        u.username AS sender_username
      FROM messages m
      JOIN users u ON m.sender_id = u.id
      WHERE m.chat_id = $1
      ORDER BY m.created_at DESC
      LIMIT $2;
    `;
    const res = await query(sql, [chatId, safeLimit]);
    return res.rows;
  },

  /**
   * Updates status of a message ('delivered' or 'seen')
   */
  async updateMessageStatus(messageId, status) {
    const sql = `
      UPDATE messages
      SET status = $1
      WHERE id = $2
      RETURNING id, chat_id, sender_id, status, seen_at;
    `;
    const res = await query(sql, [status, messageId]);
    return res.rows[0] || null;
  },

  /**
   * Marks a message as seen and stamps seen_at = NOW()
   */
  async markMessageSeen(messageId) {
    const sql = `
      UPDATE messages
      SET status = 'seen', seen_at = NOW()
      WHERE id = $1 AND (status != 'seen' OR seen_at IS NULL)
      RETURNING id, chat_id, sender_id, status, seen_at;
    `;
    const res = await query(sql, [messageId]);
    return res.rows[0] || null;
  },

  /**
   * Marks all messages in a chat as seen by a recipient
   */
  async markChatMessagesSeen(chatId, recipientUserId) {
    const sql = `
      UPDATE messages
      SET status = 'seen', seen_at = NOW()
      WHERE chat_id = $1 AND sender_id != $2 AND (status != 'seen' OR seen_at IS NULL)
      RETURNING id, chat_id, sender_id, status, seen_at;
    `;
    const res = await query(sql, [chatId, recipientUserId]);
    return res.rows;
  },

  /**
   * Permanently deletes message records where seen_at < NOW() - INTERVAL '24 hours'
   * CRITICAL: Only deletes database records. R2 media files are preserved.
   * @returns {Promise<Array<{ id: number|string, chat_id: number|string }>>} Deleted message references
   */
  async deleteExpiredSeenMessages() {
    let sql;
    if (isPg) {
      sql = `
        DELETE FROM messages
        WHERE seen_at IS NOT NULL AND seen_at < NOW() - INTERVAL '24 hours'
        RETURNING id, chat_id;
      `;
    } else {
      sql = `
        DELETE FROM messages
        WHERE seen_at IS NOT NULL AND seen_at < datetime('now', '-24 hours');
      `;
    }
    const res = await query(sql);
    return res.rows;
  },

  /**
   * Finds or creates a direct conversation chat between two users
   */
  async findOrCreateDirectChat(userAId, userBId) {
    const findSql = `
      SELECT p1.chat_id
      FROM chat_participants p1
      JOIN chat_participants p2 ON p1.chat_id = p2.chat_id
      WHERE p1.user_id = $1 AND p2.user_id = $2
      LIMIT 1;
    `;
    const found = await query(findSql, [userAId, userBId]);
    if (found.rows.length > 0) {
      return found.rows[0].chat_id;
    }

    // Create new chat
    const createChatSql = `INSERT INTO chats (created_at) VALUES (NOW()) RETURNING id;`;
    const chatRes = await query(createChatSql);
    const newChatId = chatRes.rows[0].id;

    await query(`INSERT INTO chat_participants (chat_id, user_id) VALUES ($1, $2);`, [newChatId, userAId]);
    await query(`INSERT INTO chat_participants (chat_id, user_id) VALUES ($1, $2);`, [newChatId, userBId]);

    return newChatId;
  },

  /**
   * Gets list of conversations for a user
   */
  async getUserChats(userId) {
    const sql = `
      SELECT 
        c.id AS chat_id,
        u.id AS partner_id,
        u.username AS partner_username,
        u.is_active AS partner_is_active,
        u.last_seen AS partner_last_seen,
        (
          SELECT content FROM messages 
          WHERE chat_id = c.id 
          ORDER BY created_at DESC LIMIT 1
        ) AS last_message_content,
        (
          SELECT created_at FROM messages 
          WHERE chat_id = c.id 
          ORDER BY created_at DESC LIMIT 1
        ) AS last_message_time,
        (
          SELECT status FROM messages 
          WHERE chat_id = c.id 
          ORDER BY created_at DESC LIMIT 1
        ) AS last_message_status,
        (
          SELECT COUNT(*) FROM messages 
          WHERE chat_id = c.id AND sender_id != $1 AND status != 'seen'
        ) AS unread_count
      FROM chats c
      JOIN chat_participants cp ON c.id = cp.chat_id
      JOIN chat_participants cp2 ON c.id = cp2.chat_id AND cp2.user_id != $1
      JOIN users u ON cp2.user_id = u.id
      WHERE cp.user_id = $1
      ORDER BY last_message_time DESC NULLS LAST;
    `;
    const res = await query(sql, [userId]);
    return res.rows;
  },

  /**
   * Counts total messages in database
   */
  async countMessages() {
    const sql = `SELECT COUNT(*) AS count FROM messages;`;
    const res = await query(sql);
    return parseInt(res.rows[0]?.count || 0, 10);
  }
};
