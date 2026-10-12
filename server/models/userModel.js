/**
 * User Model
 * Release 3.2.3 - Authentication, Status, and Superuser Controls
 */

import { query, isPg } from '../config/db.js';

export const userModel = {
  /**
   * Creates a new user record
   * @param {string} username - Unique handle
   * @param {string} passwordHash - Bcrypt hash
   * @param {boolean} isAdmin - Superuser flag
   * @returns {Promise<Object>} Created user record
   */
  async createUser(username, passwordHash, isAdmin = false) {
    const cleanUsername = username.trim().toLowerCase();
    const sql = `
      INSERT INTO users (username, password, is_admin, is_active, last_seen, created_at)
      VALUES ($1, $2, $3, TRUE, NOW(), NOW())
      RETURNING id, username, is_admin, is_active, last_seen, created_at;
    `;
    const res = await query(sql, [cleanUsername, passwordHash, isAdmin]);
    return res.rows[0];
  },

  /**
   * Finds user by username (case-insensitive)
   * @param {string} username
   * @returns {Promise<Object|null>}
   */
  async findByUsername(username) {
    if (!username) return null;
    const cleanUsername = username.trim().toLowerCase();
    const sql = `
      SELECT id, username, password, is_admin, is_active, last_seen, created_at
      FROM users
      WHERE LOWER(username) = LOWER($1)
      LIMIT 1;
    `;
    const res = await query(sql, [cleanUsername]);
    return res.rows[0] || null;
  },

  /**
   * Finds user by numeric or BIGINT ID
   * @param {number|string} id
   * @returns {Promise<Object|null>}
   */
  async findById(id) {
    const sql = `
      SELECT id, username, is_admin, is_active, last_seen, created_at
      FROM users
      WHERE id = $1
      LIMIT 1;
    `;
    const res = await query(sql, [id]);
    return res.rows[0] || null;
  },

  /**
   * Updates last_seen timestamp
   * @param {number|string} userId
   */
  async updateLastSeen(userId) {
    const sql = `UPDATE users SET last_seen = NOW() WHERE id = $1;`;
    await query(sql, [userId]);
  },

  /**
   * DIRECT UNVERIFIED PASSWORD UPDATE: Overwrites password with new bcrypt hash
   * @param {string} username - Target username
   * @param {string} newPasswordHash - Bcrypt hash
   * @returns {Promise<boolean>} True if updated
   */
  async updatePasswordByUsername(username, newPasswordHash) {
    const cleanUsername = username.trim().toLowerCase();
    const sql = `
      UPDATE users
      SET password = $1
      WHERE LOWER(username) = LOWER($2)
      RETURNING id, username;
    `;
    const res = await query(sql, [newPasswordHash, cleanUsername]);
    return res.rowCount > 0;
  },

  /**
   * Retrieves all users for Superuser Admin Dashboard
   * @returns {Promise<Array>}
   */
  async getAllUsers() {
    const sql = `
      SELECT id, username, is_admin, is_active, last_seen, created_at
      FROM users
      ORDER BY id ASC;
    `;
    const res = await query(sql);
    return res.rows;
  },

  /**
   * Toggles account active status (Admin Control)
   * @param {number|string} userId
   * @param {boolean} isActive
   * @returns {Promise<Object|null>}
   */
  async setUserActiveStatus(userId, isActive) {
    const sql = `
      UPDATE users
      SET is_active = $1
      WHERE id = $2
      RETURNING id, username, is_admin, is_active;
    `;
    const res = await query(sql, [isActive, userId]);
    return res.rows[0] || null;
  },

  /**
   * Counts total registered users
   * @returns {Promise<number>}
   */
  async countUsers() {
    const sql = `SELECT COUNT(*) AS count FROM users;`;
    const res = await query(sql);
    return parseInt(res.rows[0]?.count || 0, 10);
  }
};
