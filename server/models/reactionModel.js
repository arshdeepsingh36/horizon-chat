/**
 * Reaction Model
 * Release 3.2.3 - Real-Time Emoji Reactions & Aggregations
 */

import { query, isPg } from '../config/db.js';

export const reactionModel = {
  /**
   * Upserts an emoji reaction for a user on a message
   * @param {number|string} messageId
   * @param {number|string} userId
   * @param {string} emoji
   */
  async upsertReaction(messageId, userId, emoji) {
    if (isPg) {
      const sql = `
        INSERT INTO reactions (message_id, user_id, emoji, created_at)
        VALUES ($1, $2, $3, NOW())
        ON CONFLICT (message_id, user_id)
        DO UPDATE SET emoji = EXCLUDED.emoji, created_at = NOW()
        RETURNING id, message_id, user_id, emoji;
      `;
      const res = await query(sql, [messageId, userId, emoji]);
      return res.rows[0];
    } else {
      // SQLite upsert
      const sql = `
        INSERT INTO reactions (message_id, user_id, emoji, created_at)
        VALUES (?, ?, ?, datetime('now'))
        ON CONFLICT (message_id, user_id)
        DO UPDATE SET emoji = excluded.emoji;
      `;
      await query(sql, [messageId, userId, emoji]);
      return { message_id: messageId, user_id: userId, emoji };
    }
  },

  /**
   * Removes a user's reaction from a message
   */
  async removeReaction(messageId, userId) {
    const sql = `DELETE FROM reactions WHERE message_id = $1 AND user_id = $2;`;
    const res = await query(sql, [messageId, userId]);
    return res.rowCount > 0;
  },

  /**
   * Fetches aggregated reaction counts for an array of message IDs
   * Returns a map: { [messageId]: { [emoji]: count } }
   * @param {Array<number|string>} messageIds
   */
  async getAggregatedReactions(messageIds) {
    if (!messageIds || messageIds.length === 0) return {};

    const placeholders = messageIds.map((_, i) => `$${i + 1}`).join(',');
    const sql = `
      SELECT message_id, emoji, COUNT(*) AS count
      FROM reactions
      WHERE message_id IN (${placeholders})
      GROUP BY message_id, emoji;
    `;
    const res = await query(sql, messageIds);

    const reactionMap = {};
    for (const row of res.rows) {
      const mId = row.message_id;
      if (!reactionMap[mId]) {
        reactionMap[mId] = {};
      }
      reactionMap[mId][row.emoji] = parseInt(row.count, 10);
    }
    return reactionMap;
  }
};
