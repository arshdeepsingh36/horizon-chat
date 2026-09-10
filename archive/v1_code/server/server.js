import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import crypto from 'crypto';
import {
  initDb,
  findUserByUsername,
  createUser,
  updateUserLastSeen,
  searchUsers,
  saveMessage,
  getConversation,
  getUserConversations,
  markMessagesAsRead,
  addMessageReaction
} from './db.js';

dotenv.config();

const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || 'whatsapp_telegram_cloud_jwt_secret_2026';

const app = express();
const server = http.createServer(app);

app.use(cors({
  origin: '*',
  methods: ['GET', 'POST']
}));
app.use(express.json());

// In-Memory map for real-time routing: username.toLowerCase() -> Set<socket.id>
const activeSockets = new Map(); // username -> Set of socket IDs (supports multiple tabs)

// Helper to check if a user is currently online
function isUserOnline(username) {
  const sockets = activeSockets.get(username.toLowerCase().trim());
  return !!(sockets && sockets.size > 0);
}

// REST Auth Middleware
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid or expired token' });
    }
    req.user = user;
    next();
  });
}

// Rate limiter for authentication routes
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { error: 'Too many authentication attempts. Please wait 15 minutes.' }
});

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    mode: 'Telegram-Style Cloud Persistence + WhatsApp Android UI',
    uptime: process.uptime(),
    onlineUsers: activeSockets.size,
    timestamp: new Date().toISOString()
  });
});

// Register
app.post('/api/register', authLimiter, async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and passphrase are required.' });
    }

    const trimmed = username.trim();
    if (!/^[a-zA-Z0-9_]{3,32}$/.test(trimmed)) {
      return res.status(400).json({ error: 'Username must be 3–32 alphanumeric characters.' });
    }

    if (password.length < 8) {
      return res.status(400).json({ error: 'Passphrase must be at least 8 characters long.' });
    }

    const existing = await findUserByUsername(trimmed);
    if (existing) {
      return res.status(409).json({ error: 'Username is already taken.' });
    }

    const hash = await bcrypt.hash(password, 10);
    const user = await createUser(trimmed, hash);

    const token = jwt.sign(
      { id: user.id, username: user.username },
      JWT_SECRET,
      { expiresIn: '30d' }
    );

    console.log(`[AUTH] User registered: @${user.username}`);
    return res.status(201).json({
      message: 'Account created successfully.',
      token,
      user: {
        id: user.id,
        username: user.username,
        avatarColor: user.avatar_color,
        about: user.about
      }
    });
  } catch (err) {
    console.error('[AUTH ERROR - REGISTER]', err);
    return res.status(500).json({ error: 'Server error during registration.' });
  }
});

// Login
app.post('/api/login', authLimiter, async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and passphrase are required.' });
    }

    const trimmed = username.trim();
    const user = await findUserByUsername(trimmed);
    if (!user) {
      return res.status(401).json({ error: 'Invalid username or passphrase.' });
    }

    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      return res.status(401).json({ error: 'Invalid username or passphrase.' });
    }

    const token = jwt.sign(
      { id: user.id, username: user.username },
      JWT_SECRET,
      { expiresIn: '30d' }
    );

    console.log(`[AUTH] User logged in: @${user.username}`);
    return res.json({
      message: 'Authentication successful.',
      token,
      user: {
        id: user.id,
        username: user.username,
        avatarColor: user.avatar_color,
        about: user.about
      }
    });
  } catch (err) {
    console.error('[AUTH ERROR - LOGIN]', err);
    return res.status(500).json({ error: 'Server error during login.' });
  }
});

// Current User Profile
app.get('/api/me', authenticateToken, async (req, res) => {
  try {
    const user = await findUserByUsername(req.user.username);
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({
      id: user.id,
      username: user.username,
      avatarColor: user.avatar_color,
      about: user.about,
      lastSeen: user.last_seen
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
});

// Search users to start new chat
app.get('/api/users/search', authenticateToken, async (req, res) => {
  try {
    const q = req.query.q || '';
    const users = await searchUsers(q, req.user.username);
    const enriched = users.map(u => ({
      ...u,
      online: isUserOnline(u.username)
    }));
    res.json(enriched);
  } catch (err) {
    res.status(500).json({ error: 'Failed to search users' });
  }
});

// Get user's active chats (WhatsApp Chats list)
app.get('/api/chats', authenticateToken, async (req, res) => {
  try {
    const conversations = await getUserConversations(req.user.username);
    const enriched = conversations.map(c => ({
      ...c,
      online: isUserOnline(c.partnerUsername)
    }));
    res.json(enriched);
  } catch (err) {
    console.error('[GET CHATS ERROR]', err);
    res.status(500).json({ error: 'Failed to fetch conversations' });
  }
});

// Get full persistent message history for a conversation (Telegram-style cloud)
app.get('/api/messages/:partner', authenticateToken, async (req, res) => {
  try {
    const partner = req.params.partner;
    const history = await getConversation(req.user.username, partner);
    
    // Automatically mark unread messages as read
    const readIds = await markMessagesAsRead(req.user.username, partner);
    if (readIds.length > 0) {
      // Notify partner sockets of blue ticks
      const partnerSockets = activeSockets.get(partner.toLowerCase().trim());
      if (partnerSockets) {
        partnerSockets.forEach(sockId => {
          io.to(sockId).emit('messages_read', {
            by: req.user.username,
            messageIds: readIds
          });
        });
      }
    }

    const partnerUser = await findUserByUsername(partner);
    res.json({
      partner: {
        username: partner,
        avatarColor: partnerUser?.avatar_color || '#00A884',
        about: partnerUser?.about || 'Hey there! I am using WhatsApp.',
        online: isUserOnline(partner),
        lastSeen: partnerUser?.last_seen
      },
      messages: history
    });
  } catch (err) {
    console.error('[GET MESSAGES ERROR]', err);
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

// Initialize Socket.io with JWT handshake
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  if (!token) return next(new Error('Authentication token required'));
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    socket.user = decoded;
    next();
  } catch (err) {
    next(new Error('Invalid token'));
  }
});

io.on('connection', (socket) => {
  const username = socket.user.username;
  const userKey = username.toLowerCase();

  // Add socket to set
  if (!activeSockets.has(userKey)) {
    activeSockets.set(userKey, new Set());
  }
  activeSockets.get(userKey).add(socket.id);
  console.log(`[SOCKET CONNECT] @${username} (socket: ${socket.id}). Active users: ${activeSockets.size}`);

  // Broadcast online presence
  socket.broadcast.emit('user_presence_change', {
    username,
    online: true
  });

  // Direct Send Message (Telegram-style cloud persistence)
  socket.on('send_message', async ({ to, text, type = 'text', mediaUrl = '' }, callback) => {
    if (!to || !text || typeof text !== 'string') return;
    const cleanText = text.trim();
    if (cleanText.length === 0 || cleanText.length > 5000) return;

    const targetKey = to.toLowerCase().trim();
    const isOnline = isUserOnline(targetKey);
    const initialStatus = isOnline ? 'delivered' : 'sent';
    const messageId = crypto.randomUUID();
    const createdAt = Date.now();

    try {
      // 1. Permanently persist in Database
      const savedMsg = await saveMessage({
        id: messageId,
        sender: username,
        recipient: to,
        text: cleanText,
        type,
        mediaUrl,
        status: initialStatus,
        createdAt
      });

      // 2. Transmit in real-time to recipient if connected
      const recipientSockets = activeSockets.get(targetKey);
      if (recipientSockets) {
        recipientSockets.forEach(sockId => {
          io.to(sockId).emit('message_received', savedMsg);
        });
      }

      // 3. Acknowledge back to sender
      if (typeof callback === 'function') {
        callback({ success: true, message: savedMsg });
      } else {
        socket.emit('message_sent_ack', savedMsg);
      }
    } catch (err) {
      console.error('[SEND MESSAGE ERROR]', err);
      if (typeof callback === 'function') {
        callback({ success: false, error: 'Failed to save message' });
      }
    }
  });

  // Mark messages as read (Blue Ticks)
  socket.on('mark_read', async ({ partnerUsername }) => {
    if (!partnerUsername) return;
    try {
      const readIds = await markMessagesAsRead(username, partnerUsername);
      if (readIds.length > 0) {
        const partnerSockets = activeSockets.get(partnerUsername.toLowerCase().trim());
        if (partnerSockets) {
          partnerSockets.forEach(sockId => {
            io.to(sockId).emit('messages_read', {
              by: username,
              messageIds: readIds
            });
          });
        }
      }
    } catch (err) {
      console.error('[MARK READ ERROR]', err);
    }
  });

  // Emoji Reaction
  socket.on('add_reaction', async ({ messageId, emoji, partnerUsername }) => {
    if (!messageId) return;
    try {
      const updatedReactions = await addMessageReaction(messageId, emoji, username);
      const payload = { messageId, reactions: updatedReactions, by: username };

      // Broadcast to sender and recipient
      socket.emit('message_reaction_updated', payload);
      if (partnerUsername) {
        const partnerSockets = activeSockets.get(partnerUsername.toLowerCase().trim());
        if (partnerSockets) {
          partnerSockets.forEach(sockId => {
            io.to(sockId).emit('message_reaction_updated', payload);
          });
        }
      }
    } catch (err) {
      console.error('[REACTION ERROR]', err);
    }
  });

  // WhatsApp Typing Indicator
  socket.on('typing', ({ to, isTyping }) => {
    if (!to) return;
    const recipientSockets = activeSockets.get(to.toLowerCase().trim());
    if (recipientSockets) {
      recipientSockets.forEach(sockId => {
        io.to(sockId).emit('user_typing', {
          from: username,
          isTyping: !!isTyping
        });
      });
    }
  });

  // Disconnect
  socket.on('disconnect', async () => {
    const userSockets = activeSockets.get(userKey);
    if (userSockets) {
      userSockets.delete(socket.id);
      if (userSockets.size === 0) {
        activeSockets.delete(userKey);
        await updateUserLastSeen(username);
        console.log(`[SOCKET DISCONNECT] @${username} is offline. Active users: ${activeSockets.size}`);
        socket.broadcast.emit('user_presence_change', {
          username,
          online: false,
          lastSeen: Date.now()
        });
      }
    }
  });
});

async function startServer() {
  try {
    await initDb();
    server.listen(PORT, () => {
      console.log(`=======================================================`);
      console.log(`WhatsApp Android Chat Server running on port ${PORT}`);
      console.log(`Persistence: Telegram-Style Permanent Cloud Storage`);
      console.log(`UI Target: Android WhatsApp Client`);
      console.log(`Ready for connections.`);
      console.log(`=======================================================`);
    });
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
}

startServer();
