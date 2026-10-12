/**
 * Admin Controller
 * Release 3.2.3 - Superuser System Stats, User Controls, and Administrative Password Reset
 */

import bcrypt from 'bcryptjs';
import { userModel } from '../models/userModel.js';
import { messageModel } from '../models/messageModel.js';
import { socketService } from '../services/socketService.js';

export const adminController = {
  /**
   * Retrieves system metrics and full registered users list
   */
  async getDashboardStats(req, res, next) {
    try {
      const [totalUsers, totalMessages, users] = await Promise.all([
        userModel.countUsers(),
        messageModel.countMessages(),
        userModel.getAllUsers()
      ]);

      const activeSockets = socketService.getActiveSocketCount();

      return res.status(200).json({
        success: true,
        stats: {
          totalUsers,
          totalMessages,
          activeSockets,
          serverTimestamp: new Date().toISOString()
        },
        users: users.map(u => ({
          id: u.id,
          username: u.username,
          is_admin: Boolean(u.is_admin),
          is_active: Boolean(u.is_active),
          last_seen: u.last_seen,
          created_at: u.created_at
        }))
      });
    } catch (err) {
      next(err);
    }
  },

  /**
   * Activates or deactivates target user account
   */
  async toggleUserStatus(req, res, next) {
    try {
      const { userId } = req.params;
      const { isActive } = req.body || {};

      if (isActive === undefined) {
        return res.status(400).json({
          success: false,
          error: 'isActive boolean is required'
        });
      }

      const updated = await userModel.setUserActiveStatus(userId, Boolean(isActive));
      if (!updated) {
        return res.status(404).json({
          success: false,
          error: 'User not found'
        });
      }

      console.log(`[ADMIN] User @${updated.username} (ID: ${userId}) status set to: ${isActive}`);

      return res.status(200).json({
        success: true,
        message: `User account @${updated.username} has been ${isActive ? 'activated' : 'deactivated'}.`,
        user: updated
      });
    } catch (err) {
      next(err);
    }
  },

  /**
   * Superuser forced password reset for any target user by username
   */
  async adminResetPassword(req, res, next) {
    try {
      const { username, newPassword } = req.body || {};

      if (!username || !newPassword) {
        return res.status(400).json({
          success: false,
          error: 'Username and new password are required'
        });
      }

      if (newPassword.length < 6) {
        return res.status(400).json({
          success: false,
          error: 'Password must be at least 6 characters long'
        });
      }

      const user = await userModel.findByUsername(username.trim());
      if (!user) {
        return res.status(404).json({
          success: false,
          error: 'Target user not found'
        });
      }

      const salt = await bcrypt.genSalt(10);
      const passwordHash = await bcrypt.hash(newPassword, salt);

      const updated = await userModel.updatePasswordByUsername(user.username, passwordHash);
      if (!updated) {
        return res.status(500).json({
          success: false,
          error: 'Failed to reset password'
        });
      }

      console.log(`[ADMIN] Administrator forced password reset for @${user.username}`);

      return res.status(200).json({
        success: true,
        message: `Password for @${user.username} has been updated successfully.`
      });
    } catch (err) {
      next(err);
    }
  }
};
