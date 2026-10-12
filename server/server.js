/**
 * Horizon Chat Server
 * Release 3.2.3 - Production-Grade Modular Bootstrap
 */

import http from 'http';
import express from 'express';
import cors from 'cors';
import { Server as SocketIOServer } from 'socket.io';

import { env } from './config/env.js';
import { initDatabase, pool } from './config/db.js';
import { socketService } from './services/socketService.js';
import { purgeService } from './services/purgeService.js';

import authRoutes from './routes/authRoutes.js';
import chatRoutes from './routes/chatRoutes.js';
import adminRoutes from './routes/adminRoutes.js';
import { errorHandler } from './middleware/errorHandler.js';

const app = express();
const server = http.createServer(app);

// CORS configuration
app.use(cors({
  origin: env.CORS_ORIGIN === '*' ? true : env.CORS_ORIGIN,
  credentials: true
}));

// Body parsing middleware
app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: true, limit: '25mb' }));

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    version: '3.2.3',
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});

// Mount modular API routes
app.use('/api/auth', authRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/admin', adminRoutes);

// Centralized JSON error boundary
app.use(errorHandler);

// Socket.IO configuration
const io = new SocketIOServer(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  },
  pingTimeout: 30000,
  pingInterval: 10000
});

// Initialize real-time Socket.IO lifecycle service
socketService.init(io);

// Bootstrap Server & Background Services
async function bootstrap() {
  try {
    // 1. Initialize DB tables and indexes
    await initDatabase();

    // 2. Start automated 24h post-seen database purge worker
    purgeService.startPurgeWorker();

    // 3. Listen on configured port
    server.listen(env.PORT, () => {
      console.log(`[BOOTSTRAP] Horizon Chat Server v3.2.3 running on http://localhost:${env.PORT}`);
    });
  } catch (err) {
    console.error('[FATAL BOOTSTRAP ERROR]', err);
    process.exit(1);
  }
}

// Graceful Shutdown Handler
function handleGracefulShutdown(signal) {
  console.log(`\n[SHUTDOWN] Received ${signal}. Closing Horizon Chat server gracefully...`);

  purgeService.stopPurgeWorker();

  server.close(async () => {
    console.log('[SHUTDOWN] HTTP and WebSocket listeners closed.');
    if (pool) {
      try {
        await pool.end();
        console.log('[SHUTDOWN] Database connection pool ended.');
      } catch (poolErr) {
        console.error('[SHUTDOWN ERROR] Error closing pool:', poolErr);
      }
    }
    process.exit(0);
  });

  // Force close if graceful shutdown hangs
  setTimeout(() => {
    console.error('[SHUTDOWN] Forceful shutdown initiated after timeout.');
    process.exit(1);
  }, 10000);
}

process.on('SIGINT', () => handleGracefulShutdown('SIGINT'));
process.on('SIGTERM', () => handleGracefulShutdown('SIGTERM'));

bootstrap();

export { app, server };
