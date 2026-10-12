/**
 * Authentication Controller
 * Release 3.2.3 - Registration, Login, and Direct Unverified Password Reset
 */

import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { userModel } from '../models/userModel.js';
import { env } from '../config/env.js';

export const authController = {
  /**
   * Registers a new user account
   */
  async register(req, res, next) {
    try {
      const { username, password } = req.body || {};

      if (!username || !password) {
        return res.status(400).json({
          success: false,
          error: 'Username and password are required'
        });
      }

      const trimmed = username.trim();
      if (trimmed.length < 3 || trimmed.length > 50) {
        return res.status(400).json({
          success: false,
          error: 'Username must be between 3 and 50 characters'
        });
      }

      if (password.length < 6) {
        return res.status(400).json({
          success: false,
          error: 'Password must be at least 6 characters long'
        });
      }

      const existing = await userModel.findByUsername(trimmed);
      if (existing) {
        return res.status(409).json({
          success: false,
          error: 'Username is already taken'
        });
      }

      const salt = await bcrypt.genSalt(10);
      const passwordHash = await bcrypt.hash(password, salt);
      const isAdmin = trimmed.toLowerCase() === 'admin';

      const newUser = await userModel.createUser(trimmed, passwordHash, isAdmin);

      const token = jwt.sign(
        { id: newUser.id, username: newUser.username, is_admin: newUser.is_admin },
        env.JWT_SECRET,
        { expiresIn: env.JWT_EXPIRES_IN }
      );

      console.log(`[AUTH] Registered user: @${newUser.username} (ID: ${newUser.id}, Admin: ${newUser.is_admin})`);

      return res.status(201).json({
        success: true,
        token,
        user: {
          id: newUser.id,
          username: newUser.username,
          is_admin: Boolean(newUser.is_admin),
          is_active: Boolean(newUser.is_active)
        }
      });
    } catch (err) {
      next(err);
    }
  },

  /**
   * Authenticates user and issues signed JWT
   */
  async login(req, res, next) {
    try {
      const { username, password } = req.body || {};

      if (!username || !password) {
        return res.status(400).json({
          success: false,
          error: 'Username and password are required'
        });
      }

      const user = await userModel.findByUsername(username.trim());
      if (!user) {
        return res.status(401).json({
          success: false,
          error: 'Invalid username or password'
        });
      }

      const isMatch = await bcrypt.compare(password, user.password);
      if (!isMatch) {
        return res.status(401).json({
          success: false,
          error: 'Invalid username or password'
        });
      }

      if (!user.is_active) {
        return res.status(403).json({
          success: false,
          error: 'Account has been deactivated. Please contact an administrator.'
        });
      }

      // Update presence
      await userModel.updateLastSeen(user.id);

      const token = jwt.sign(
        { id: user.id, username: user.username, is_admin: user.is_admin },
        env.JWT_SECRET,
        { expiresIn: env.JWT_EXPIRES_IN }
      );

      console.log(`[AUTH] User logged in: @${user.username} (ID: ${user.id}, Admin: ${user.is_admin})`);

      return res.status(200).json({
        success: true,
        token,
        user: {
          id: user.id,
          username: user.username,
          is_admin: Boolean(user.is_admin),
          is_active: Boolean(user.is_active),
          last_seen: user.last_seen
        }
      });
    } catch (err) {
      next(err);
    }
  },

  /**
   * DIRECT UNVERIFIED PASSWORD RESET:
   * Accepts { username, newPassword }. Validates input, hashes new password with bcrypt,
   * directly updates PostgreSQL/database row. No OTP, SMS, or email verification required.
   */
  async resetPassword(req, res, next) {
    try {
      const { username, newPassword } = req.body || {};

      if (!username || !newPassword) {
        return res.status(400).json({
          success: false,
          error: 'Username and new password are required'
        });
      }

      const trimmed = username.trim();
      if (newPassword.length < 6) {
        return res.status(400).json({
          success: false,
          error: 'New password must be at least 6 characters long'
        });
      }

      const user = await userModel.findByUsername(trimmed);
      if (!user) {
        return res.status(404).json({
          success: false,
          error: 'User not found'
        });
      }

      const salt = await bcrypt.genSalt(10);
      const passwordHash = await bcrypt.hash(newPassword, salt);

      const updated = await userModel.updatePasswordByUsername(trimmed, passwordHash);
      if (!updated) {
        return res.status(500).json({
          success: false,
          error: 'Failed to update password'
        });
      }

      console.log(`[AUTH] Direct password reset successful for @${trimmed}`);

      return res.status(200).json({
        success: true,
        message: 'Password updated successfully. You may now log in with your new password.'
      });
    } catch (err) {
      next(err);
    }
  },

  /**
   * Retrieves profile of authenticated user
   */
  async getMe(req, res, next) {
    try {
      const user = await userModel.findById(req.user.id);
      if (!user) {
        return res.status(404).json({
          success: false,
          error: 'User not found'
        });
      }

      return res.status(200).json({
        success: true,
        user: {
          id: user.id,
          username: user.username,
          is_admin: Boolean(user.is_admin),
          is_active: Boolean(user.is_active),
          last_seen: user.last_seen,
          created_at: user.created_at
        }
      });
    } catch (err) {
      next(err);
    }
  }
};
