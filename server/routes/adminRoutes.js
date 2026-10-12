/**
 * Admin Routes
 * Release 3.2.3 - /api/admin
 */

import { Router } from 'express';
import { adminController } from '../controllers/adminController.js';
import { authMiddleware } from '../middleware/authMiddleware.js';
import { adminGuard } from '../middleware/adminGuard.js';

const router = Router();

// Protect all admin endpoints with both authentication and superuser verification
router.use(authMiddleware, adminGuard);

router.get('/stats', adminController.getDashboardStats);
router.patch('/users/:userId/status', adminController.toggleUserStatus);
router.post('/users/reset-password', adminController.adminResetPassword);

export default router;
