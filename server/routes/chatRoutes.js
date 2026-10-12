/**
 * Chat Routes
 * Release 3.2.3 - /api/chat
 */

import { Router } from 'express';
import { chatController } from '../controllers/chatController.js';
import { authMiddleware } from '../middleware/authMiddleware.js';

const router = Router();

// Conversation & Message History Endpoints
router.get('/history/:chatId', authMiddleware, chatController.getChatHistory);
router.post('/direct', authMiddleware, chatController.getOrCreateDirectChat);
router.get('/list', authMiddleware, chatController.getUserChats);

// Cloudflare R2 Presigned Upload & Streaming
router.post('/upload-url', authMiddleware, chatController.getUploadUrl);
router.get('/media/stream', chatController.streamMedia);

export default router;
