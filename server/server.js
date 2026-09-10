import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
  initDb,
  findUserByUsername,
  findUserById,
  createUser,
  lookupUser,
  getMessagesCursor,
  saveMessageTRD,
  updateMessageStatus,
  getUserConversations,
  updateUserProfile,
  updateUserPassword,
  markMediaViewed
} from './db.js';

dotenv.config();

const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || 'horizon_chat_secure_secret_2026_q4';

// Cloudflare R2 Client (Zero-Cost Egress Storage)
const r2Client = (process.env.R2_ACCOUNT_ID && process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY)
  ? new S3Client({
      region: 'auto',
      endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY
      }
    })
  : null;

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const app = express();
const server = http.createServer(app);

app.use(cors({ origin: '*', methods: ['GET', 'POST', 'PUT'] }));
app.use(express.json({ limit: '20mb' }));
app.use('/uploads', express.static(uploadsDir));

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

// 3. User Lookup (TRD Section 3.4)
app.get('/api/users/lookup', authenticateToken, async (req, res) => {
  try {
    const query = req.query.username;
    if (!query) return res.status(400).json({ error: 'Username query required' });

    const user = await lookupUser(query);
    if (!user) return res.status(404).json({ error: 'User not found' });

    return res.json({
      id: user.id,
      username: user.username,
      displayName: user.display_name || user.username,
      bioStatus: user.bio_status || 'Hey there! I am using Horizon Chat.',
      avatarUrl: user.avatar_url || null,
      online: isUserOnline(user.id)
    });
  } catch (err) {
    console.error('[LOOKUP ERROR]', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// 3b. Current User Profile (Phase 2)
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
      createdAt: user.created_at
    });
  } catch (err) {
    console.error('[PROFILE ME ERROR]', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// 3c. Update Profile (Phase 2)
app.put('/api/users/profile', authenticateToken, async (req, res) => {
  try {
    const { displayName, bioStatus, avatarUrl } = req.body || {};
    const updated = await updateUserProfile(req.user.id, {
      displayName: displayName !== undefined ? displayName.trim() : null,
      bioStatus: bioStatus !== undefined ? bioStatus.trim() : null,
      avatarUrl: avatarUrl !== undefined ? avatarUrl : null
    });

    return res.json({
      success: true,
      user: {
        id: updated.id,
        username: updated.username,
        displayName: updated.display_name || updated.username,
        bioStatus: updated.bio_status,
        avatarUrl: updated.avatar_url
      }
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

// 3e. Mark View-Once Media Viewed (Phase 2)
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

    let uploadUrl;
    let publicUrl;

    if (r2Client && process.env.R2_BUCKET_NAME) {
      const command = new PutObjectCommand({
        Bucket: process.env.R2_BUCKET_NAME,
        Key: key,
        ContentType: contentType
      });
      uploadUrl = await getSignedUrl(r2Client, command, { expiresIn: 3600 });
      const publicBase = process.env.R2_PUBLIC_DOMAIN || `https://${process.env.R2_BUCKET_NAME}.r2.cloudflarestorage.com`;
      publicUrl = `${publicBase}/${key}`;
    } else {
      // Local/Testing Simulated Presigned URL (Zero-Cost Free Tier Fallback)
      uploadUrl = `${req.protocol}://${req.get('host')}/api/media/mock-upload/${encodeURIComponent(key)}`;
      publicUrl = `https://pub-r2.storage.cloud/${key}`;
    }

    // Standard 20x20 blurred micro-thumbnail sample Base64 (~200 bytes) (rules.md Section 3)
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
    return res.status(500).json({ error: 'Failed to generate presigned upload URL' });
  }
});

// Mock binary receiver for testing direct-to-R2 uploads without live Cloudflare credentials
app.put('/api/media/mock-upload/:key', (req, res) => {
  // Simulates cloud storage bucket acknowledging the PUT upload
  return res.status(200).send({ success: true, message: 'Simulated R2 Direct Upload Successful' });
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
        if (mime.includes('png')) ext = 'png';
        else if (mime.includes('webp')) ext = 'webp';
        else if (mime.includes('mp4') || mime.includes('m4a') || mime.includes('aac')) ext = 'm4a';
        else if (mime.includes('ogg')) ext = 'ogg';
        else if (mime.includes('webm')) ext = 'webm';
        else if (mime.includes('wav')) ext = 'wav';
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

// Initialize Socket.io
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
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
  }
  onlineUsers.get(userId).add(socket.id);
  console.log(`[SOCKET CONNECT] User @${socket.user.username} (ID: ${userId}). Total online: ${onlineUsers.size}`);

  // Broadcast user_status_changed (online)
  socket.broadcast.emit('user_status_changed', {
    userId,
    status: 'online'
  });

  // Outbound Message Event (TRD Section 4.2 + Phase 2)
  socket.on('send_message', async (data, callback) => {
    const { 
      recipientId, 
      text, 
      attachmentType = 'NONE', 
      attachmentUrl = null, 
      thumbnailBlur = null, 
      fileSizeBytes = 0, 
      isViewOnce = false,
      replyToId = null 
    } = data || {};

    if (!recipientId || (!text && !attachmentUrl)) return;

    const rId = Number(recipientId);
    const recipientOnline = isUserOnline(rId);
    const initialStatus = recipientOnline ? 'DELIVERED' : 'SENT';

    // Auto-save direct Base64 Data URL to uploads directory (Images and Audio)
    let finalAttachmentUrl = attachmentUrl;
    if (attachmentUrl && typeof attachmentUrl === 'string' && (attachmentUrl.startsWith('data:image/') || attachmentUrl.startsWith('data:audio/'))) {
      try {
        const isAudio = attachmentUrl.startsWith('data:audio/');
        const matches = attachmentUrl.match(/^data:([A-Za-z0-9\-\+\.\/]+);base64,(.+)$/s);
        let ext = isAudio ? 'm4a' : 'jpg';
        let buf;
        if (matches && matches.length === 3) {
          const mime = matches[1].toLowerCase();
          if (mime.includes('png')) ext = 'png';
          else if (mime.includes('webp')) ext = 'webp';
          else if (mime.includes('mp4') || mime.includes('m4a') || mime.includes('aac')) ext = 'm4a';
          else if (mime.includes('ogg')) ext = 'ogg';
          else if (mime.includes('webm')) ext = 'webm';
          else if (mime.includes('wav')) ext = 'wav';
          buf = Buffer.from(matches[2], 'base64');
        } else {
          const cleanBase64 = attachmentUrl.includes('base64,') ? attachmentUrl.split('base64,')[1] : attachmentUrl;
          buf = Buffer.from(cleanBase64, 'base64');
        }
        const prefix = isAudio ? 'voice' : 'img';
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
        attachmentType,
        attachmentUrl: finalAttachmentUrl,
        thumbnailBlur,
        fileSizeBytes,
        status: initialStatus,
        isViewOnce: Boolean(isViewOnce),
        replyToId
      });

      // 2. Server calls client acknowledgement callback with ID
      if (typeof callback === 'function') {
        callback({ success: true, message: savedRecord });
      }

      // 3. Emit new_message to recipient sockets
      const recipientSockets = onlineUsers.get(rId);
      if (recipientSockets) {
        recipientSockets.forEach(sockId => {
          io.to(sockId).emit('new_message', savedRecord);
        });
      }

      // 4. Also emit to sender's other sockets (multi-device sync)
      const senderSockets = onlineUsers.get(userId);
      if (senderSockets) {
        senderSockets.forEach(sockId => {
          if (sockId !== socket.id) {
            io.to(sockId).emit('new_message', savedRecord);
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

  // Delivery Receipt Acknowledgement
  socket.on('mark_delivered', async ({ messageId, senderId }) => {
    if (!messageId) return;

    try {
      await updateMessageStatus(messageId, 'DELIVERED');

      // Emit message_delivered_ack to sender active socket
      const sId = Number(senderId);
      const senderSockets = onlineUsers.get(sId);
      if (senderSockets) {
        senderSockets.forEach(sockId => {
          io.to(sockId).emit('message_delivered_ack', { messageId: Number(messageId) });
        });
      }
    } catch (err) {
      console.error('[MARK DELIVERED ERROR]', err);
    }
  });

  // Read Receipt Acknowledgement (TRD Section 4.3)
  socket.on('mark_read', async ({ messageId, senderId }) => {
    if (!messageId) return;

    try {
      await updateMessageStatus(messageId, 'READ');

      // Emit message_read_ack to sender active socket
      const sId = Number(senderId);
      const senderSockets = onlineUsers.get(sId);
      if (senderSockets) {
        senderSockets.forEach(sockId => {
          io.to(sockId).emit('message_read_ack', { messageId: Number(messageId) });
        });
      }
    } catch (err) {
      console.error('[MARK READ ERROR]', err);
    }
  });

  // Disconnect
  socket.on('disconnect', () => {
    const userSockets = onlineUsers.get(userId);
    if (userSockets) {
      userSockets.delete(socket.id);
      if (userSockets.size === 0) {
        onlineUsers.delete(userId);
        console.log(`[SOCKET DISCONNECT] User @${socket.user.username} (ID: ${userId}) went offline.`);
        socket.broadcast.emit('user_status_changed', {
          userId,
          status: 'offline'
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
      console.log(`Theme: Sunset Glow & Twilight Ocean`);
      console.log(`Ready for Android and Web clients.`);
      console.log(`=======================================================`);
    });
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
}

start();
