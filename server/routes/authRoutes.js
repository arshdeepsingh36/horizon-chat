/**
 * Authentication Routes
 * Release 3.2.3 - /api/auth
 */

import { Router } from 'express';
import { authController } from '../controllers/authController.js';
import { authMiddleware } from '../middleware/authMiddleware.js';

const router = Router();

// Public Authentication Endpoints
router.post('/register', authController.register);
router.post('/login', authController.login);
router.post('/reset-password', authController.resetPassword);

// Protected Identity Endpoint
router.get('/me', authMiddleware, authController.getMe);

export default router;
