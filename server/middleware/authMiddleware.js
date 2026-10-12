/**
 * Authentication Middleware
 * Release 3.2.3 - JWT Verification & Identity Extraction
 */

import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { userModel } from '../models/userModel.js';

export async function authMiddleware(req, res, next) {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

    if (!token) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized: Authentication token required'
      });
    }

    const decoded = jwt.verify(token, env.JWT_SECRET);
    if (!decoded || !decoded.id) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized: Invalid token payload'
      });
    }

    // Check account status in DB
    const user = await userModel.findById(decoded.id);
    if (!user) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized: User account does not exist'
      });
    }

    if (!user.is_active) {
      return res.status(403).json({
        success: false,
        error: 'Forbidden: Account has been deactivated by an administrator'
      });
    }

    req.user = {
      id: user.id,
      username: user.username,
      is_admin: Boolean(user.is_admin)
    };

    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized: Authentication token has expired'
      });
    }
    return res.status(401).json({
      success: false,
      error: 'Unauthorized: Invalid authentication credentials'
    });
  }
}
