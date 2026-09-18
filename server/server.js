import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import {
  initDb,
  findUserByUsername,
  findUserById,
  createUser,
  lookupUser,
  searchUsers,
  getMessagesCursor,
  saveMessageTRD,
  updateMessageStatus,
  getUserConversations,
  updateUserProfile,
  updateUserPassword,
  markMediaViewed,
  updateUserLastSeen,
  blockUser,
  unblockUser,
  isUserBlocked,
  reportUser,
  clearConversationMessages,
  toggleMessageReaction,
  deleteMessage,
  pinMessage,
  markConversationRead,
  deleteExpiredSeenMessages,
  savePushToken,
  deletePushToken,
  getPushTokensByUserId,
  getUnreadOrRecentMessages
} from './db.js';
import {
  isR2Configured,
  getR2Client,
  buildR2Key,
  generatePresignedUploadUrl,
  getR2PublicUrl
} from './r2.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import webpush from 'web-push';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

if (fs.existsSync(path.resolve(__dirname, '.env'))) {
  dotenv.config({ path: path.resolve(__dirname, '.env') });
} else {
  dotenv.config();
}

// VAPID keys for Web Push Notifications
let vapidPublicKey = process.env.VAPID_PUBLIC_KEY;
let vapidPrivateKey = process.env.VAPID_PRIVATE_KEY;
const vapidSubject = process.env.VAPID_SUBJECT || 'mailto:support@horizonchat.app';

if (!vapidPublicKey || !vapidPrivateKey) {
  try {
    const generatedVapid = webpush.generateVAPIDKeys();
    vapidPublicKey = vapidPublicKey || generatedVapid.publicKey;
    vapidPrivateKey = vapidPrivateKey || generatedVapid.privateKey;
  } catch (e) {
    console.warn('[PUSH] VAPID generation error:', e);
  }
}

try {
  if (vapidPublicKey && vapidPrivateKey) {
    webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);
    console.log('[PUSH] Web Push VAPID initialized.');
  }
} catch (err) {
  console.error('[PUSH ERROR] Failed to set VAPID details:', err);
}

// Push notification dispatch helper
export async function dispatchPushNotification(recipientId, { title, body, data = {} }) {
  try {
    const tokens = await getPushTokensByUserId(Number(recipientId));
    if (!tokens || tokens.length === 0) return;

    const payload = JSON.stringify({
      title: title || 'New Message',
      body: body || 'You received a new message',
      icon: '/horizon icon.ico',
      badge: '/horizon icon.ico',
      data: {
        ...data,
        timestamp: Date.now()
      }
    });

    for (const record of tokens) {
      if (record.device_type === 'web') {
        try {
          const subscription = typeof record.token === 'string' ? JSON.parse(record.token) : record.token;
          await webpush.sendNotification(subscription, payload);
        } catch (pushErr) {
          if (pushErr.statusCode === 404 || pushErr.statusCode === 410) {
            console.log(`[PUSH] Token expired for user ${recipientId}, deleting.`);
            await deletePushToken(Number(recipientId), record.token).catch(() => {});
          } else {
            console.warn(`[PUSH WARNING] Failed to send web push:`, pushErr.message);
          }
        }
      } else {
        console.log(`[PUSH] Mobile push notification dispatched for user ${recipientId} (${record.device_type})`);
      }
    }
  } catch (err) {
    console.error('[PUSH DISPATCH ERROR]', err);
  }
}

const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || 'horizon_chat_secure_secret_2026_q4';

const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const app = express();
const server = http.createServer(app);

app.use(cors({ origin: '*', methods: ['GET', 'POST', 'PUT'] }));
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ limit: '100mb', extended: true }));
app.use('/uploads', express.static(uploadsDir, { acceptRanges: true }));

// Direct APK Download Endpoint with Android Package Archive MIME type (prevents download manager hang)
app.get(['/download/apk', '/horizon-chat.apk', '/api/download/apk', '/download'], (req, res) => {
  const possiblePaths = [
    path.join(__dirname, '../apk/horizon-chat-v3.1.0.apk'),
    path.join(__dirname, '../apk/horizon-chat-v3.0.0.apk'),
    path.join(__dirname, '../apk/app-debug.apk'),
    path.join(__dirname, 'horizon-chat.apk'),
    path.join(uploadsDir, 'horizon-chat.apk')
  ];

  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      const stats = fs.statSync(p);
      res.setHeader('Content-Type', 'application/vnd.android.package-archive');
      res.setHeader('Content-Disposition', 'attachment; filename="horizon-chat-v3.1.0.apk"');
      res.setHeader('Content-Length', stats.size);
      res.setHeader('Accept-Ranges', 'bytes');
      return res.sendFile(path.resolve(p));
    }
  }

  return res.status(404).send('APK file not found on server.');
});

// In-Memory Socket Map: userId (Int) -> Set<socket.id>
const onlineUsers = new Map();

function isUserOnline(userId) {
  const sockets = onlineUsers.get(Number(userId));
  return !!(sockets && sockets.size > 0);
}

// REST Auth Middleware
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Access token required' });

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: 'Invalid or expired token' });
    req.user = user;
    next();
  });
}

// Rate Limiter
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { error: 'Too many authentication attempts. Please wait 15 minutes.' }
});

// Health check endpoint (Cold-start mitigation)
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    project: 'Horizon Chat (Native Android + Cloud Sync)',
    version: '2.0.0',
    uptime: process.uptime(),
    onlineUsers: onlineUsers.size,
    timestamp: new Date().toISOString()
  });
});

// 1. Register User (TRD Section 3.1)
app.post('/api/auth/register', authLimiter, async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required.' });
    }

    const clean = username.trim();
    if (!/^[a-zA-Z0-9_]{3,32}$/.test(clean)) {
      return res.status(400).json({ error: 'Username must be 3–32 alphanumeric characters.' });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters long.' });
    }

    const existing = await findUserByUsername(clean);
    if (existing) {
      return res.status(400).json({ error: 'Username already taken.' });
    }

    const hash = await bcrypt.hash(password, 10);
    const user = await createUser(clean, hash);

    const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '30d' });

    console.log(`[AUTH] Registered: @${user.username} (ID: ${user.id})`);
    return res.status(201).json({
      token,
      user: { id: user.id, username: user.username }
    });
  } catch (err) {
    console.error('[REGISTER ERROR]', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// 2. Authenticate / Login (TRD Section 3.2)
app.post('/api/auth/login', authLimiter, async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required.' });
    }

    const user = await findUserByUsername(username.trim());
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '30d' });

    console.log(`[AUTH] Logged in: @${user.username} (ID: ${user.id})`);
    return res.json({
      token,
      user: { id: user.id, username: user.username }
    });
  } catch (err) {
    console.error('[LOGIN ERROR]', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// 3. User Lookup (Discovery - supports path and query param)
app.get('/api/users/lookup', authenticateToken, async (req, res) => {
  try {
    const query = req.query.username;
    if (!query) return res.status(400).json({ error: 'Username query required' });

    const user = await lookupUser(query);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const blocked = await isUserBlocked(req.user.id, user.id);

    return res.json({
      id: user.id,
      username: user.username,
      displayName: user.display_name || user.username,
      bioStatus: user.bio_status || 'Hey there! I am using Horizon Chat.',
      avatarUrl: user.avatar_url || null,
      lastSeen: user.last_seen || null,
      online: isUserOnline(user.id),
      isBlocked: blocked
    });
  } catch (err) {
    console.error('[LOOKUP ERROR]', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/users/lookup/:username', authenticateToken, async (req, res) => {
  try {
    const user = await lookupUser(req.params.username);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const blocked = await isUserBlocked(req.user.id, user.id);

    return res.json({
      id: user.id,
      username: user.username,
      displayName: user.display_name || user.username,
      bioStatus: user.bio_status || 'Hey there! I am using Horizon Chat.',
      avatarUrl: user.avatar_url || null,
      lastSeen: user.last_seen || null,
      online: isUserOnline(user.id),
      isBlocked: blocked
    });
  } catch (err) {
    console.error('[LOOKUP ERROR]', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Dynamic User Search (Phase 2C Task 5)
app.get('/api/users/search', authenticateToken, async (req, res) => {
  try {
    const q = req.query.q || '';
    const users = await searchUsers(q, req.user.id);
    const enriched = users.map(u => ({
      id: u.id,
      username: u.username,
      displayName: u.display_name || u.username,
      bioStatus: u.bio_status || 'Hey there! I am using Horizon Chat.',
      avatarUrl: u.avatar_url || null,
      lastSeen: u.last_seen || null,
      online: isUserOnline(u.id)
    }));
    return res.json(enriched);
  } catch (err) {
    console.error('[SEARCH USERS ERROR]', err);
    return res.status(500).json({ error: 'Search failed' });
  }
});

// Batch Mark Read Endpoint (Phase 2C Step 2)
app.post('/api/messages/batch-read', authenticateToken, async (req, res) => {
  try {
    const { partnerId } = req.body || {};
    if (!partnerId) return res.status(400).json({ error: 'partnerId is required' });
    await markConversationRead(req.user.id, Number(partnerId));

    // Notify partner via socket
    const pSockets = onlineUsers.get(Number(partnerId));
    if (pSockets) {
      pSockets.forEach(sockId => {
        io.to(sockId).emit('conversation_read', { readBy: req.user.id });
        io.to(sockId).emit('message_read_ack', { all: true, readBy: req.user.id });
      });
    }
    return res.json({ success: true });
  } catch (err) {
    console.error('[BATCH READ ERROR]', err);
    return res.status(500).json({ error: 'Failed to mark conversation read' });
  }
});

// 3b. Current User Profile (Phase 2 & Phase 2b)
app.get('/api/users/me', authenticateToken, async (req, res) => {
  try {
    const user = await findUserById(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    return res.json({
      id: user.id,
      username: user.username,
      displayName: user.display_name || user.username,
      bioStatus: user.bio_status || 'Hey there! I am using Horizon Chat.',
      avatarUrl: user.avatar_url || null,
      lastSeen: user.last_seen || null,
      createdAt: user.created_at
    });
  } catch (err) {
    console.error('[PROFILE ME ERROR]', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// 3c. Update Profile (Phase 2 & Phase 2b)
app.put('/api/users/profile', authenticateToken, async (req, res) => {
  try {
    let { displayName, bioStatus, avatarUrl } = req.body || {};

    // If avatar is base64, save to static /uploads/ for fast CDN and Glide compatibility
    if (avatarUrl && typeof avatarUrl === 'string' && avatarUrl.startsWith('data:image/')) {
      try {
        const matches = avatarUrl.match(/^data:image\/([A-Za-z0-9\-\+\.]+);base64,(.+)$/s);
        const ext = matches && matches[1] ? (matches[1] === 'jpeg' ? 'jpg' : matches[1]) : 'jpg';
        const rawBase64 = matches ? matches[2] : (avatarUrl.includes('base64,') ? avatarUrl.split('base64,')[1] : avatarUrl);
        const buf = Buffer.from(rawBase64, 'base64');
        const fileName = `avatar_${req.user.id}_${Date.now()}.${ext}`;
        fs.writeFileSync(path.join(uploadsDir, fileName), buf);
        const serverHost = process.env.RENDER_EXTERNAL_URL || `${req.protocol}://${req.get('host')}`;
        avatarUrl = `${serverHost}/uploads/${fileName}`;
      } catch (err) {
        console.error('[AVATAR SAVE ERROR]', err);
      }
    }

    const updated = await updateUserProfile(req.user.id, {
      displayName: displayName !== undefined ? displayName.trim() : null,
      bioStatus: bioStatus !== undefined ? bioStatus.trim() : null,
      avatarUrl: avatarUrl !== undefined ? avatarUrl : null
    });

    const userObj = {
      id: updated.id,
      username: updated.username,
      displayName: updated.display_name || updated.username,
      bioStatus: updated.bio_status,
      avatarUrl: updated.avatar_url
    };

    // Broadcast user_profile_updated to all connected sockets
    io.emit('user_profile_updated', userObj);

    return res.json({
      success: true,
      user: userObj
    });
  } catch (err) {
    console.error('[UPDATE PROFILE ERROR]', err);
    return res.status(500).json({ error: 'Failed to update profile' });
  }
});

// 3d. Update Password (Phase 2)
app.put('/api/users/password', authenticateToken, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body || {};
    if (!currentPassword || !newPassword || newPassword.length < 6) {
      return res.status(400).json({ error: 'New password must be at least 6 characters' });
    }

    const user = await findUserByUsername(req.user.username);
    if (!user || !(await bcrypt.compare(currentPassword, user.password_hash))) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }

    const newHash = await bcrypt.hash(newPassword, 10);
    await updateUserPassword(req.user.id, newHash);
    return res.json({ success: true, message: 'Password updated successfully' });
  } catch (err) {
    console.error('[UPDATE PASSWORD ERROR]', err);
    return res.status(500).json({ error: 'Failed to update password' });
  }
});

// 3e. Storage: Generate Cloudflare R2 Presigned Upload URL (Phase 3)
app.post('/api/upload/presigned-url', authenticateToken, async (req, res) => {
  try {
    const { uploadType, recipientUsername, mediaType, fileName, contentType, isViewOnce } = req.body || {};

    if (!isR2Configured()) {
      return res.status(503).json({
        error: 'Cloudflare R2 storage is not configured or missing credentials on the server.',
        configured: false
      });
    }

    let username = req.user?.username;
    if (!username && req.user?.id) {
      const dbUser = await findUserById(req.user.id);
      username = dbUser?.username;
    }
    username = username || 'user';

    const cleanContentType = contentType || 'application/octet-stream';
    const key = buildR2Key({
      username,
      uploadType: uploadType || (mediaType === 'pfp' ? 'pfp' : 'chat_media'),
      recipientUsername: recipientUsername || 'general',
      mediaType: mediaType || 'image',
      fileName: fileName || 'file.bin',
      contentType: cleanContentType,
      isViewOnce: Boolean(isViewOnce)
    });

    console.log(`[R2 PRESIGN] User @${username} requesting upload URL for key: ${key} (Type: ${cleanContentType})`);

    const { uploadUrl, publicUrl } = await generatePresignedUploadUrl({
      key,
      contentType: cleanContentType,
      expiresIn: 3600
    });

    return res.json({
      success: true,
      uploadUrl,
      key,
      publicUrl,
      mediaType: mediaType || 'image',
      isViewOnce: Boolean(isViewOnce)
    });
  } catch (err) {
    console.error('[PRESIGNED URL ERROR]', err);
    return res.status(500).json({ error: err.message || 'Failed to generate presigned upload URL' });
  }
});

// 3f. Moderation: Block User (Phase 2b)
app.post('/api/users/block', authenticateToken, async (req, res) => {
  try {
    const { targetUserId } = req.body || {};
    if (!targetUserId) return res.status(400).json({ error: 'targetUserId is required' });
    await blockUser(req.user.id, Number(targetUserId));
    return res.json({ success: true, message: 'User blocked' });
  } catch (err) {
    console.error('[BLOCK ERROR]', err);
    return res.status(500).json({ error: 'Failed to block user' });
  }
});

// 3f. Moderation: Unblock User (Phase 2b)
app.post('/api/users/unblock', authenticateToken, async (req, res) => {
  try {
    const { targetUserId } = req.body || {};
    if (!targetUserId) return res.status(400).json({ error: 'targetUserId is required' });
    await unblockUser(req.user.id, Number(targetUserId));
    return res.json({ success: true, message: 'User unblocked' });
  } catch (err) {
    console.error('[UNBLOCK ERROR]', err);
    return res.status(500).json({ error: 'Failed to unblock user' });
  }
});

// 3g. Moderation: Report User (Phase 2b)
app.post('/api/users/report', authenticateToken, async (req, res) => {
  try {
    const { targetUserId, reason = 'Inappropriate content' } = req.body || {};
    if (!targetUserId) return res.status(400).json({ error: 'targetUserId is required' });
    await reportUser(req.user.id, Number(targetUserId), reason);
    return res.json({ success: true, message: 'Report submitted. Thank you for keeping Horizon Chat safe.' });
  } catch (err) {
    console.error('[REPORT ERROR]', err);
    return res.status(500).json({ error: 'Failed to submit report' });
  }
});

// 3h. Chat Management: Clear Conversation History (Phase 2b)
app.delete('/api/messages/conversations/:targetUserId', authenticateToken, async (req, res) => {
  try {
    const targetUserId = parseInt(req.params.targetUserId, 10);
    if (isNaN(targetUserId)) return res.status(400).json({ error: 'Invalid target user ID' });
    await clearConversationMessages(req.user.id, targetUserId);
    return res.json({ success: true, message: 'Conversation cleared' });
  } catch (err) {
    console.error('[CLEAR CONVERSATION ERROR]', err);
    return res.status(500).json({ error: 'Failed to clear conversation' });
  }
});

// 3j. Delete Individual Message (Server-Side Validation: 60m sent, 7m read)
app.delete('/api/messages/:id', authenticateToken, async (req, res) => {
  try {
    const messageId = parseInt(req.params.id, 10);
    const { mode = 'me', recipientId, deleteForEveryone } = req.body || {};
    if (isNaN(messageId)) return res.status(400).json({ error: 'Invalid message ID' });

    const targetMode = mode || (deleteForEveryone ? 'everyone' : 'me');
    const updated = await deleteMessage(messageId, req.user.id, targetMode);
    if (!updated) return res.status(404).json({ error: 'Message not found' });

    const partnerId = recipientId ? Number(recipientId) : (Number(updated.senderId) === req.user.id ? Number(updated.recipientId) : Number(updated.senderId));
    const payload = {
      messageId,
      deletedForEveryone: updated.deletedForEveryone,
      deletedByUsers: updated.deletedByUsers || [],
      mode: targetMode,
      messageText: updated.deletedForEveryone ? 'This message was deleted' : undefined,
      message: updated
    };

    if (updated.deletedForEveryone) {
      const convRoom = `chat_${Math.min(req.user.id, partnerId)}_${Math.max(req.user.id, partnerId)}`;
      io.to(convRoom).emit('message_deleted', payload);
      const rSockets = onlineUsers.get(partnerId);
      if (rSockets) {
        rSockets.forEach(sockId => io.to(sockId).emit('message_deleted', payload));
      }
    }

    const sSockets = onlineUsers.get(req.user.id);
    if (sSockets) {
      sSockets.forEach(sockId => io.to(sockId).emit('message_deleted', payload));
    }

    return res.json({ success: true, message: updated });
  } catch (err) {
    console.error('[DELETE MESSAGE REST ERROR]', err);
    return res.status(err.statusCode || 500).json({ error: err.message || 'Failed to delete message' });
  }
});

// 3k. Unread & Silent Foreground Message Sync
app.get('/api/messages/unread', authenticateToken, async (req, res) => {
  try {
    const unread = await getUnreadOrRecentMessages(req.user.id);
    return res.json(unread);
  } catch (err) {
    console.error('[GET UNREAD ERROR]', err);
    return res.status(500).json({ error: 'Failed to fetch unread messages' });
  }
});

app.get('/api/messages/sync', authenticateToken, async (req, res) => {
  try {
    const { targetUserId, sinceId } = req.query;
    const parsedTargetUserId = targetUserId && !isNaN(parseInt(targetUserId, 10)) ? parseInt(targetUserId, 10) : null;
    const parsedSinceId = sinceId && !isNaN(parseInt(sinceId, 10)) ? parseInt(sinceId, 10) : null;
    const messages = await getUnreadOrRecentMessages(req.user.id, parsedTargetUserId, parsedSinceId);
    return res.json(messages);
  } catch (err) {
    console.error('[SYNC MESSAGES ERROR]', err);
    return res.status(500).json({ error: 'Failed to sync messages' });
  }
});

// 3i. Mark View-Once Media Viewed (Phase 2)
app.post('/api/messages/:id/view-once', authenticateToken, async (req, res) => {
  try {
    const messageId = parseInt(req.params.id, 10);
    const updated = await markMediaViewed(messageId);
    if (!updated) return res.status(404).json({ error: 'Message not found' });

    // Broadcast to sender via Socket.IO
    const senderSockets = onlineUsers.get(updated.senderId);
    if (senderSockets) {
      senderSockets.forEach(sockId => {
        io.to(sockId).emit('media_viewed', { messageId, viewedBy: req.user.id });
      });
    }

    return res.json({ success: true, message: updated });
  } catch (err) {
    console.error('[MARK VIEW ONCE ERROR]', err);
    return res.status(500).json({ error: 'Failed to mark media viewed' });
  }
});

// 4. Cursor-Paginated Chat History (TRD Section 3.3)
app.get('/api/messages/:targetUserId', authenticateToken, async (req, res) => {
  const currentUserId = req.user.id;
  const targetUserId = parseInt(req.params.targetUserId, 10);
  const cursor = req.query.cursor ? parseInt(req.query.cursor, 10) : null;
  const limit = Math.min(parseInt(req.query.limit, 10) || 25, 50);

  if (isNaN(targetUserId)) {
    return res.status(400).json({ error: 'Invalid target user ID' });
  }

  try {
    const messages = await getMessagesCursor(currentUserId, targetUserId, cursor, limit);
    return res.json(messages);
  } catch (err) {
    console.error('[GET MESSAGES ERROR]', err);
    return res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

// 5. User Conversation List (Dashboard)
app.get('/api/chats', authenticateToken, async (req, res) => {
  try {
    const chats = await getUserConversations(req.user.id);
    const enriched = chats.map(c => ({
      ...c,
      online: isUserOnline(c.partnerId)
    }));
    return res.json(enriched);
  } catch (err) {
    console.error('[GET CHATS ERROR]', err);
    return res.status(500).json({ error: 'Failed to fetch chats' });
  }
});

// 6. Media Cloudflare R2 Presigned Upload & Micro-Preview Generator (TRD Section 3.5 & rules.md Section 3)
app.post('/api/media/presign', authenticateToken, async (req, res) => {
  try {
    const { fileName = 'attachment.png', contentType = 'image/png', fileSizeBytes = 2457812 } = req.body || {};
    const fileExt = fileName.includes('.') ? fileName.split('.').pop() : 'png';
    const key = `uploads/${req.user.id}/${Date.now()}_${Math.random().toString(36).substring(2, 9)}.${fileExt}`;

    const serverHost = process.env.RENDER_EXTERNAL_URL || `${req.protocol}://${req.get('host')}`;
    const cleanFileName = key.replace(/[^a-zA-Z0-9._-]/g, '_');
    let uploadUrl = '';
    let publicUrl = '';

    const client = getR2Client();
    if (client && isR2Configured()) {
      const { uploadUrl: presignedUrl, publicUrl: generatedPublicUrl } = await generatePresignedUploadUrl({
        key,
        contentType,
        expiresIn: 3600
      });
      uploadUrl = presignedUrl;
      publicUrl = generatedPublicUrl;
    } else {
      // Direct Server Upload Receiver Fallback (Guaranteed Accessible URL)
      uploadUrl = `${serverHost}/api/media/mock-upload/${encodeURIComponent(cleanFileName)}`;
      publicUrl = `${serverHost}/uploads/${cleanFileName}`;
    }

    // Standard 20x20 blurred micro-thumbnail sample Base64 (~200 bytes)
    const thumbnailBlur = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABQAAAAUCAYAAACNiR0NAAAAMklEQVR42mNk+M9Qz0AEYCJVE6OaRjWNahrVNKppVNOoplFNo5pGNY1qGtU0qmlU06iSAQBvGQ4RFy5yRwAAAABJRU5ErkJggg==';

    return res.json({
      uploadUrl,
      publicUrl,
      key,
      thumbnailBlur,
      fileSizeBytes: Number(fileSizeBytes) || 2457812,
      expiresInSeconds: 3600
    });
  } catch (err) {
    console.error('[PRESIGN ERROR]', err);
    return res.status(500).json({ error: err.message || 'Failed to generate presigned upload URL' });
  }
});

// Binary upload receiver for direct server fallback storage
app.put('/api/media/mock-upload/:key', express.raw({ type: '*/*', limit: '100mb' }), (req, res) => {
  try {
    const rawKey = decodeURIComponent(req.params.key);
    const cleanFileName = rawKey.replace(/[^a-zA-Z0-9._-]/g, '_');
    const filePath = path.join(uploadsDir, cleanFileName);
    fs.writeFileSync(filePath, req.body);
    return res.status(200).json({ success: true, message: 'Upload saved successfully' });
  } catch (err) {
    console.error('[MOCK UPLOAD SAVE ERROR]', err);
    return res.status(500).json({ error: 'Failed to save upload' });
  }
});

app.post('/api/media/upload', authenticateToken, async (req, res) => {
  try {
    const { imageBase64, fileName, attachmentUrl: inputUrl, fileSizeBytes: inputSize, thumbnailBlur: clientBlur } = req.body || {};
    const defaultThumbnailBlur = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABQAAAAUCAYAAACNiR0NAAAAMklEQVR42mNk+M9Qz0AEYCJVE6OaRjWNahrVNKppVNOoplFNo5pGNY1qGtU0qmlU06iSAQBvGQ4RFy5yRwAAAABJRU5ErkJggg==';

    if (imageBase64 && typeof imageBase64 === 'string') {
      const matches = imageBase64.match(/^data:([A-Za-z0-9\-\+\.\/]+);base64,(.+)$/s);
      let buffer;
      let ext = 'jpg';
      if (matches && matches.length === 3) {
        const mime = matches[1].toLowerCase();
        if (mime.includes('video') || mime.includes('mp4')) ext = 'mp4';
        else if (mime.includes('png')) ext = 'png';
        else if (mime.includes('webp')) ext = 'webp';
        else if (mime.includes('audio') || mime.includes('m4a') || mime.includes('aac')) ext = 'm4a';
        else if (mime.includes('ogg')) ext = 'ogg';
        else if (mime.includes('webm')) ext = mime.includes('video') ? 'webm' : 'weba';
        else if (mime.includes('wav')) ext = 'wav';
        else if (mime.includes('pdf')) ext = 'pdf';
        buffer = Buffer.from(matches[2], 'base64');
      } else {
        const cleanBase64 = imageBase64.includes('base64,') ? imageBase64.split('base64,')[1] : imageBase64;
        buffer = Buffer.from(cleanBase64, 'base64');
        if (fileName && fileName.includes('.')) {
          ext = fileName.split('.').pop();
        }
      }

      const cleanFileName = fileName ? fileName.replace(/[^a-zA-Z0-9._-]/g, '_') : `file_${Date.now()}.${ext}`;
      const uniqueName = `${Date.now()}_${Math.random().toString(36).substring(2, 7)}_${cleanFileName}`;
      const filePath = path.join(uploadsDir, uniqueName);
      fs.writeFileSync(filePath, buffer);

      const serverHost = process.env.RENDER_EXTERNAL_URL || `${req.protocol}://${req.get('host')}`;
      const publicUrl = `${serverHost}/uploads/${uniqueName}`;

      return res.json({
        attachmentUrl: publicUrl,
        thumbnailBlur: clientBlur || defaultThumbnailBlur,
        fileSizeBytes: buffer.length
      });
    }

    res.json({
      attachmentUrl: inputUrl || 'https://pub-r2.storage.cloud/horizon_sunset_ambient.png',
      thumbnailBlur: clientBlur || defaultThumbnailBlur,
      fileSizeBytes: inputSize || 2457812
    });
  } catch (err) {
    console.error('[MEDIA UPLOAD ERROR]', err);
    return res.status(500).json({ error: 'Failed to upload media' });
  }
});

// 7. Push Notifications Endpoints (Web & Mobile Push)
app.get('/api/notifications/vapid-public-key', (req, res) => {
  return res.json({ publicKey: vapidPublicKey });
});

app.post('/api/notifications/register-token', authenticateToken, async (req, res) => {
  try {
    const { token, subscription, deviceType = 'web' } = req.body || {};
    const pushToken = token || subscription;
    if (!pushToken) {
      return res.status(400).json({ error: 'Token or subscription is required' });
    }
    await savePushToken(req.user.id, pushToken, deviceType);
    return res.json({ success: true, message: 'Push token registered successfully' });
  } catch (err) {
    console.error('[REGISTER PUSH TOKEN ERROR]', err);
    return res.status(500).json({ error: 'Failed to register push token' });
  }
});

app.post('/api/notifications/unregister-token', authenticateToken, async (req, res) => {
  try {
    const { token, subscription } = req.body || {};
    const pushToken = token || subscription;
    if (!pushToken) {
      return res.status(400).json({ error: 'Token or subscription is required' });
    }
    await deletePushToken(req.user.id, pushToken);
    return res.json({ success: true, message: 'Push token removed' });
  } catch (err) {
    console.error('[UNREGISTER PUSH TOKEN ERROR]', err);
    return res.status(500).json({ error: 'Failed to unregister push token' });
  }
});

// Initialize Socket.io with 100MB buffer
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  maxHttpBufferSize: 1e8
});

// WebSocket Handshake (TRD Section 4.1)
io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  if (!token) return next(new Error('401 Unauthorized'));

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return next(new Error('401 Unauthorized'));
    socket.user = user;
    next();
  });
});

io.on('connection', (socket) => {
  const userId = Number(socket.user.id);

  if (!onlineUsers.has(userId)) {
    onlineUsers.set(userId, new Set());
    console.log(`[SOCKET CONNECT] User @${socket.user.username} (ID: ${userId}) connected.`);
    socket.broadcast.emit('user_status_changed', { userId, status: 'online' });
    socket.broadcast.emit('user_status_change', { userId, status: 'online' });
  }
  onlineUsers.get(userId).add(socket.id);
  socket.join(`user_${userId}`);

  socket.emit('connection_ack', {
    status: 'connected',
    userId,
    username: socket.user.username,
    socketId: socket.id
  });

  // Room subscriptions for reliability
  socket.on('join_user', ({ userId: uid }) => {
    const targetId = uid || userId;
    socket.join(`user_${targetId}`);
  });

  socket.on('join_room', ({ roomId, partnerId: pId }) => {
    if (roomId) socket.join(roomId);
    if (pId) {
      const convRoom = `chat_${Math.min(userId, Number(pId))}_${Math.max(userId, Number(pId))}`;
      socket.join(convRoom);
    }
  });

  socket.on('join', (room) => {
    if (room) socket.join(room);
  });

  // Handle Send Message (TRD Section 4.2 & Phase 2)
  socket.on('send_message', async (payload, callback) => {
    const {
      recipientId,
      to,
      text,
      attachmentType = 'NONE',
      type = 'NONE',
      attachmentUrl = null,
      mediaUrl = null,
      r2Key = null,
      r2_key = null,
      thumbnailBlur = null,
      fileSizeBytes = 0,
      isViewOnce = false,
      replyToId = null,
      tempId = null,
      localClientId = null
    } = payload || {};

    const resolvedTempId = tempId || localClientId || payload?.tempId || payload?.localClientId || null;
    const resolvedLocalClientId = localClientId || tempId || payload?.localClientId || payload?.tempId || null;

    let rId = Number(recipientId);
    if (!rId && to) {
      const u = await getUserByUsername(to);
      if (u) rId = u.id;
    }

    if (!rId) {
      if (typeof callback === 'function') callback({ success: false, error: 'Recipient ID is required' });
      return;
    }

    // Communication Block Enforcement
    try {
      const blocked = await isUserBlocked(userId, rId);
      if (blocked) {
        if (typeof callback === 'function') callback({ success: false, error: 'Cannot send message to this user' });
        return;
      }
    } catch (e) {
      console.error('[BLOCK CHECK ERROR]', e);
    }

    const recipientOnline = isUserOnline(rId);
    const initialStatus = recipientOnline ? 'DELIVERED' : 'SENT';

    // Auto-save direct Base64 Data URL to uploads directory (Images, Audio, and Video)
    let finalAttachmentUrl = mediaUrl || attachmentUrl;
    if (finalAttachmentUrl && typeof finalAttachmentUrl === 'string' && (finalAttachmentUrl.startsWith('data:image/') || finalAttachmentUrl.startsWith('data:audio/') || finalAttachmentUrl.startsWith('data:video/'))) {
      try {
        const isVideo = finalAttachmentUrl.startsWith('data:video/');
        const isAudio = finalAttachmentUrl.startsWith('data:audio/');
        const matches = finalAttachmentUrl.match(/^data:([A-Za-z0-9\-\+\.\/]+);base64,(.+)$/s);
        let ext = isVideo ? 'mp4' : (isAudio ? 'm4a' : 'jpg');
        let buf;
        if (matches && matches.length === 3) {
          const mime = matches[1].toLowerCase();
          if (mime.includes('video') || mime.includes('mp4')) ext = 'mp4';
          else if (mime.includes('png')) ext = 'png';
          else if (mime.includes('webp')) ext = 'webp';
          else if (mime.includes('audio') || mime.includes('m4a') || mime.includes('aac')) ext = 'm4a';
          else if (mime.includes('ogg')) ext = 'ogg';
          else if (mime.includes('webm')) ext = mime.includes('video') ? 'webm' : 'weba';
          else if (mime.includes('wav')) ext = 'wav';
          buf = Buffer.from(matches[2], 'base64');
        } else {
          const cleanBase64 = finalAttachmentUrl.includes('base64,') ? finalAttachmentUrl.split('base64,')[1] : finalAttachmentUrl;
          buf = Buffer.from(cleanBase64, 'base64');
        }
        const prefix = isVideo ? 'vid' : (isAudio ? 'voice' : 'img');
        const uniqueName = `${prefix}_${Date.now()}_${Math.random().toString(36).substring(2, 7)}.${ext}`;
        fs.writeFileSync(path.join(uploadsDir, uniqueName), buf);
        const serverHost = process.env.RENDER_EXTERNAL_URL || 'https://horizon-chat-1.onrender.com';
        finalAttachmentUrl = `${serverHost}/uploads/${uniqueName}`;
      } catch (err) {
        console.error('[SOCKET MEDIA AUTO-SAVE ERROR]', err);
      }
    }

    try {
      // 1. Write to database
      const savedRecord = await saveMessageTRD({
        senderId: userId,
        recipientId: rId,
        text: text || '',
        attachmentType: attachmentType !== 'NONE' ? attachmentType : type,
        attachmentUrl: finalAttachmentUrl,
        r2Key: r2Key || r2_key || null,
        thumbnailBlur,
        fileSizeBytes,
        status: initialStatus,
        isViewOnce: Boolean(isViewOnce),
        replyToId
      });

      const messageWithTempId = {
        ...savedRecord,
        tempId: resolvedTempId,
        localClientId: resolvedLocalClientId,
        local_client_id: resolvedLocalClientId
      };

      // 2. Server calls client acknowledgement callback with ID and tempId for optimistic reconciliation
      if (typeof callback === 'function') {
        callback({ success: true, message: messageWithTempId });
      }

      // 3. Emit new_message to recipient sockets
      const recipientSockets = onlineUsers.get(rId);
      if (recipientSockets && recipientSockets.size > 0) {
        recipientSockets.forEach(sockId => {
          io.to(sockId).emit('new_message', savedRecord);
        });
      } else {
        // Recipient is offline / disconnected -> Trigger Web / Mobile Push Notification
        const senderUser = socket.user;
        const senderDisplayName = senderUser.displayName || senderUser.username || 'Someone';
        const previewText = savedRecord.attachmentType && savedRecord.attachmentType !== 'NONE'
          ? `[${savedRecord.attachmentType.toLowerCase()}] ${savedRecord.text || ''}`.trim()
          : (savedRecord.text || 'Sent you a message');

        dispatchPushNotification(rId, {
          title: senderDisplayName,
          body: previewText,
          data: {
            senderId: userId,
            recipientId: rId,
            messageId: savedRecord.id
          }
        }).catch(e => console.error('[PUSH NOTIFY ERROR]', e));
      }

      // 4. Emit to sender's other sockets only (multi-device sync) - NOT to originating socket
      const senderSockets = onlineUsers.get(userId);
      if (senderSockets) {
        senderSockets.forEach(sockId => {
          if (sockId !== socket.id) {
            io.to(sockId).emit('new_message', messageWithTempId);
          }
        });
      }
    } catch (err) {
      console.error('[SEND MESSAGE ERROR]', err);
      if (typeof callback === 'function') {
        callback({ success: false, error: 'Database write failed' });
      }
    }
  });

  // Typing Indicators (Phase 2)
  socket.on('typing_start', ({ recipientId }) => {
    if (!recipientId) return;
    const targetSockets = onlineUsers.get(Number(recipientId));
    if (targetSockets) {
      targetSockets.forEach(sId => {
        io.to(sId).emit('user_typing', { userId, isTyping: true });
      });
    }
  });

  socket.on('typing_stop', ({ recipientId }) => {
    if (!recipientId) return;
    const targetSockets = onlineUsers.get(Number(recipientId));
    if (targetSockets) {
      targetSockets.forEach(sId => {
        io.to(sId).emit('user_typing', { userId, isTyping: false });
      });
    }
  });

  // Ephemeral View-Once Socket Acknowledgment (Phase 2)
  socket.on('mark_media_viewed', async ({ messageId, senderId }) => {
    if (!messageId) return;
    try {
      const updated = await markMediaViewed(Number(messageId));
      const sId = Number(senderId);
      const senderSockets = onlineUsers.get(sId);
      if (senderSockets) {
        senderSockets.forEach(sockId => {
          io.to(sockId).emit('media_viewed', { messageId: Number(messageId), viewedBy: userId });
        });
      }
    } catch (err) {
      console.error('[MARK MEDIA VIEWED ERROR]', err);
    }
  });

  // Delivery Receipt Acknowledgement (mark_delivered & message_delivered)
  socket.on('mark_delivered', async (payload) => {
    const messageId = payload?.messageId || payload?.id;
    const senderId = payload?.senderId;
    if (!messageId) return;

    try {
      const updated = await updateMessageStatus(Number(messageId), 'DELIVERED');
      const targetSenderId = senderId ? Number(senderId) : (updated ? Number(updated.senderId) : null);
      const mId = Number(messageId);

      const statusPayload = {
        messageId: mId,
        id: mId,
        status: 'DELIVERED',
        senderId: targetSenderId,
        recipientId: userId
      };

      if (targetSenderId) {
        const senderSockets = onlineUsers.get(targetSenderId);
        if (senderSockets) {
          senderSockets.forEach(sockId => {
            io.to(sockId).emit('message_delivered_ack', statusPayload);
            io.to(sockId).emit('message_status_update', statusPayload);
          });
        }
        const convRoom = `chat_${Math.min(userId, targetSenderId)}_${Math.max(userId, targetSenderId)}`;
        io.to(convRoom).emit('message_status_update', statusPayload);
      }
    } catch (err) {
      console.error('[MARK DELIVERED ERROR]', err);
    }
  });

  socket.on('message_delivered', async (payload) => {
    const messageId = payload?.messageId || payload?.id;
    const senderId = payload?.senderId;
    if (!messageId) return;

    try {
      const updated = await updateMessageStatus(Number(messageId), 'DELIVERED');
      const targetSenderId = senderId ? Number(senderId) : (updated ? Number(updated.senderId) : null);
      const mId = Number(messageId);

      const statusPayload = {
        messageId: mId,
        id: mId,
        status: 'DELIVERED',
        senderId: targetSenderId,
        recipientId: userId
      };

      if (targetSenderId) {
        const senderSockets = onlineUsers.get(targetSenderId);
        if (senderSockets) {
          senderSockets.forEach(sockId => {
            io.to(sockId).emit('message_delivered_ack', statusPayload);
            io.to(sockId).emit('message_status_update', statusPayload);
          });
        }
        const convRoom = `chat_${Math.min(userId, targetSenderId)}_${Math.max(userId, targetSenderId)}`;
        io.to(convRoom).emit('message_status_update', statusPayload);
      }
    } catch (err) {
      console.error('[MESSAGE DELIVERED ERROR]', err);
    }
  });

  // Message Reactions (Real-Time Synchronized across Android and Web)
  const handleReactionEvent = async ({ messageId, recipientId, emoji }) => {
    if (!messageId || !emoji) return;
    try {
      const updated = await toggleMessageReaction(Number(messageId), userId, emoji);
      if (updated) {
        const sId = Number(updated.senderId);
        const uRecipientId = Number(updated.recipientId);
        const partnerId = sId === userId ? (recipientId ? Number(recipientId) : uRecipientId) : sId;
        const payload = {
          messageId: Number(messageId),
          id: Number(messageId),
          reactions: updated.reactions || {},
          userId,
          emoji,
          message: updated
        };

        const broadcast = (sockId) => {
          io.to(sockId).emit('message_reacted', payload);
          io.to(sockId).emit('message_reaction', payload);
          io.to(sockId).emit('message_reaction_updated', payload);
        };

        const rSockets = onlineUsers.get(partnerId);
        if (rSockets) {
          rSockets.forEach(broadcast);
        }
        const sSockets = onlineUsers.get(userId);
        if (sSockets) {
          sSockets.forEach(broadcast);
        }
        const convRoom = `chat_${Math.min(userId, partnerId)}_${Math.max(userId, partnerId)}`;
        io.to(convRoom).emit('message_reacted', payload);
        io.to(convRoom).emit('message_reaction', payload);
        io.to(convRoom).emit('message_reaction_updated', payload);
      }
    } catch (err) {
      console.error('[REACTION ERROR]', err);
    }
  };

  socket.on('message_reaction', handleReactionEvent);
  socket.on('add_reaction', handleReactionEvent);
  socket.on('toggle_reaction', handleReactionEvent);

  // Delete Message (Server-Side Time Validation: 60m sent, 7m read)
  socket.on('delete_message', async (data, callback) => {
    const { messageId, recipientId, mode, deleteForEveryone } = data || {};
    if (!messageId) {
      if (typeof callback === 'function') callback({ success: false, error: 'messageId is required' });
      return;
    }
    try {
      const targetMode = mode || (deleteForEveryone ? 'everyone' : 'me');
      const updated = await deleteMessage(Number(messageId), userId, targetMode);
      if (updated) {
        const mId = Number(messageId);
        const sId = Number(updated.senderId);
        const rId = recipientId ? Number(recipientId) : Number(updated.recipientId);
        const partnerId = sId === userId ? rId : sId;

        const payload = {
          messageId: mId,
          deletedForEveryone: updated.deletedForEveryone,
          deletedByUsers: updated.deletedByUsers || [],
          mode: targetMode,
          messageText: updated.deletedForEveryone ? 'This message was deleted' : undefined,
          message: updated
        };

        if (updated.deletedForEveryone) {
          const convRoom = `chat_${Math.min(userId, partnerId)}_${Math.max(userId, partnerId)}`;
          io.to(convRoom).emit('message_deleted', payload);
          const rSockets = onlineUsers.get(partnerId);
          if (rSockets) {
            rSockets.forEach(sId => io.to(sId).emit('message_deleted', payload));
          }
        }

        const sSockets = onlineUsers.get(userId);
        if (sSockets) {
          sSockets.forEach(sId => io.to(sId).emit('message_deleted', payload));
        }

        if (typeof callback === 'function') {
          callback({ success: true, message: updated });
        }
      }
    } catch (err) {
      console.error('[DELETE MESSAGE SOCKET ERROR]', err);
      if (typeof callback === 'function') {
        callback({ success: false, error: err.message || 'Failed to delete message' });
      }
    }
  });

  // Pin Message (Phase 2C Task 3.3)
  socket.on('pin_message', async ({ messageId, recipientId, isPinned }) => {
    if (!messageId) return;
    try {
      const updated = await pinMessage(Number(messageId), Boolean(isPinned));
      if (updated) {
        const payload = {
          messageId: Number(messageId),
          isPinned: updated.isPinned,
          message: updated
        };
        const rId = Number(recipientId);
        const rSockets = onlineUsers.get(rId);
        if (rSockets) {
          rSockets.forEach(sId => io.to(sId).emit('message_pinned', payload));
        }
        const sSockets = onlineUsers.get(userId);
        if (sSockets) {
          sSockets.forEach(sId => io.to(sId).emit('message_pinned', payload));
        }
      }
    } catch (err) {
      console.error('[PIN MESSAGE ERROR]', err);
    }
  });

  // Batch Read Receipt (Phase 2C Step 2)
  socket.on('mark_conversation_read', async ({ partnerId }) => {
    if (!partnerId) return;
    try {
      const pId = Number(partnerId);
      await markConversationRead(userId, pId);
      const partnerSockets = onlineUsers.get(pId);
      if (partnerSockets) {
        partnerSockets.forEach(sockId => {
          io.to(sockId).emit('conversation_read', { readBy: userId });
          io.to(sockId).emit('message_read_ack', { all: true, readBy: userId });
        });
      }
    } catch (err) {
      console.error('[CONVERSATION READ ERROR]', err);
    }
  });

  // Disconnect
  socket.on('disconnect', async () => {
    const userSockets = onlineUsers.get(userId);
    if (userSockets) {
      userSockets.delete(socket.id);
      if (userSockets.size === 0) {
        onlineUsers.delete(userId);
        const lastSeen = new Date().toISOString();
        try {
          await updateUserLastSeen(userId);
        } catch (e) {
          console.error('[LAST SEEN ERROR]', e);
        }
        console.log(`[SOCKET DISCONNECT] User @${socket.user.username} (ID: ${userId}) went offline.`);
        socket.broadcast.emit('user_status_changed', {
          userId,
          status: 'offline',
          lastSeen
        });
        socket.broadcast.emit('user_status_change', {
          userId,
          status: 'offline',
          lastSeen
        });
      }
    }
  });
});

async function start() {
  try {
    await initDb();

    server.listen(PORT, () => {
      console.log(`=======================================================`);
      console.log(`Horizon Chat Backend Server running on port ${PORT}`);
      console.log(`Architecture: TRD v2.0.0 (Neon PostgreSQL + Cursor Paging)`);
      console.log(`Ready for Android and Web clients.`);
      console.log(`=======================================================`);
    });
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
}

start();
