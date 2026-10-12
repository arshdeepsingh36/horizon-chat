/**
 * 24-Hour Post-Seen Database Ephemeral Purge Service
 * Release 3.2.3 - Automated Background Message Expiration
 *
 * STRICT ARCHITECTURAL REQUIREMENT:
 * Only delete message records from PostgreSQL database.
 * Do NOT delete any media files from Cloudflare R2.
 */

import { messageModel } from '../models/messageModel.js';
import { socketService } from './socketService.js';

let intervalId = null;

export const purgeService = {
  /**
   * Executes a single pass of the 24h post-seen database cleaner
   */
  async runCleanupPass() {
    try {
      const deletedRows = await messageModel.deleteExpiredSeenMessages();

      if (deletedRows && deletedRows.length > 0) {
        console.log(`[EPHEMERAL PURGE] Automatically deleted ${deletedRows.length} messages seen > 24 hours ago.`);

        // Notify active conversation rooms in real-time so expired bubbles drop from UI
        for (const row of deletedRows) {
          socketService.emitMessageExpired(row.chat_id, row.id);
        }
      }
    } catch (err) {
      console.error('[EPHEMERAL PURGE ERROR]', err.message);
    }
  },

  /**
   * Starts background worker running every 60 seconds
   */
  startPurgeWorker() {
    if (intervalId) return;
    console.log('[PURGE SERVICE] Starting 24h post-seen background worker (60s interval)...');

    // Run immediately on boot
    this.runCleanupPass();

    // Schedule interval
    intervalId = setInterval(() => {
      this.runCleanupPass();
    }, 60 * 1000);
  },

  /**
   * Stops background worker on server teardown
   */
  stopPurgeWorker() {
    if (intervalId) {
      clearInterval(intervalId);
      intervalId = null;
      console.log('[PURGE SERVICE] Background purge worker stopped.');
    }
  }
};
