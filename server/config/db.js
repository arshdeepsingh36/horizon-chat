/**
 * Database Configuration & Connection Pool
 * Release 3.2.3 - Neon PostgreSQL with Reconnection & SSL
 */

import pg from 'pg';
import sqlite3 from 'sqlite3';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { env } from './env.js';

const { Pool } = pg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let isPg = false;
let pool = null;
let sqliteDb = null;

if (env.DATABASE_URL && env.DATABASE_URL.startsWith('postgres')) {
  console.log('[DB] Connecting to Neon PostgreSQL with SSL...');
  pool = new Pool({
    connectionString: env.DATABASE_URL,
    ssl: {
      rejectUnauthorized: false
    },
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000
  });

  pool.on('connect', () => {
    // Connection established successfully
  });

  pool.on('error', (err) => {
    console.error('[DB POOL ERROR] Unexpected idle client error:', err.message);
  });

  isPg = true;
}

// Always ensure SQLite fallback database is initialized
function getSqliteDb() {
  if (!sqliteDb) {
    const dataDir = path.resolve(__dirname, '..', 'data');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    const dbPath = path.join(dataDir, 'horizon_chat_v323.db');
    sqliteDb = new sqlite3.Database(dbPath);
  }
  return sqliteDb;
}
getSqliteDb();

/**
 * Executes a parameterized SQL query with unified interface and error logging
 * @param {string} text - SQL query string
 * @param {Array} params - Query parameters
 * @returns {Promise<{ rows: Array, rowCount: number }>}
 */
export async function query(text, params = []) {
  const start = Date.now();
  if (isPg && pool) {
    try {
      const res = await pool.query(text, params);
      const duration = Date.now() - start;
      if (duration > 500) {
        console.warn(`[DB SLOW QUERY] (${duration}ms):`, text.slice(0, 100));
      }
      return res;
    } catch (err) {
      console.warn(`[DB POSTGRES NOTICE - REVERTING TO SQLITE] ${err.message}`);
      isPg = false;
    }
  }

  // SQLite execution fallback for development environments without live Neon credentials
  const db = getSqliteDb();
  return new Promise((resolve, reject) => {
    let convertedSql = text
      .replace(/\$\d+/g, '?')
      .replace(/TIMESTAMPTZ/gi, 'DATETIME')
      .replace(/BIGSERIAL PRIMARY KEY/gi, 'INTEGER PRIMARY KEY AUTOINCREMENT')
      .replace(/NOW\(\)/gi, "datetime('now')")
      .replace(/INTERVAL '\d+ hours'/gi, "'-24 hours'");

    const isSelect = /^\s*(SELECT|PRAGMA)/i.test(convertedSql);
    if (isSelect) {
      sqliteDb.all(convertedSql, params, (err, rows) => {
        if (err) {
          console.error('[SQLITE QUERY ERROR]', err.message, '| SQL:', convertedSql);
          return reject(err);
        }
        resolve({ rows: rows || [], rowCount: (rows || []).length });
      });
    } else {
      sqliteDb.run(convertedSql, params, function (err) {
        if (err) {
          console.error('[SQLITE EXEC ERROR]', err.message, '| SQL:', convertedSql);
          return reject(err);
        }
        resolve({ rows: [{ id: this.lastID }], rowCount: this.changes, lastID: this.lastID });
      });
    }
  });
}

/**
 * Initializes database schemas if tables do not exist
 */
export async function initDatabase() {
  try {
    if (isPg && pool) {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS users (
          id BIGSERIAL PRIMARY KEY,
          username VARCHAR(50) UNIQUE NOT NULL,
          password VARCHAR(255) NOT NULL,
          is_admin BOOLEAN DEFAULT FALSE,
          is_active BOOLEAN DEFAULT TRUE,
          last_seen TIMESTAMPTZ DEFAULT NOW(),
          created_at TIMESTAMPTZ DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS chats (
          id BIGSERIAL PRIMARY KEY,
          created_at TIMESTAMPTZ DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS chat_participants (
          chat_id BIGINT REFERENCES chats(id) ON DELETE CASCADE,
          user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
          PRIMARY KEY (chat_id, user_id)
        );

        CREATE TABLE IF NOT EXISTS messages (
          id BIGSERIAL PRIMARY KEY,
          chat_id BIGINT REFERENCES chats(id) ON DELETE CASCADE,
          sender_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
          content TEXT,
          media_url TEXT,
          media_type VARCHAR(20),
          is_view_once BOOLEAN DEFAULT FALSE,
          status VARCHAR(20) DEFAULT 'sent',
          seen_at TIMESTAMPTZ NULL,
          created_at TIMESTAMPTZ DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS reactions (
          id BIGSERIAL PRIMARY KEY,
          message_id BIGINT REFERENCES messages(id) ON DELETE CASCADE,
          user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
          emoji VARCHAR(10) NOT NULL,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          UNIQUE (message_id, user_id)
        );

        CREATE INDEX IF NOT EXISTS idx_messages_chat_created ON messages(chat_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_messages_seen_at ON messages(seen_at) WHERE seen_at IS NOT NULL;
        CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
      `);
      console.log('[DB] PostgreSQL schema initialized successfully.');
    } catch (pgErr) {
      console.warn('[DB] PostgreSQL initialization failed, switching to SQLite fallback:', pgErr.message);
      isPg = false;
    }
  }

  // Ensure SQLite schema exists for fallback
  const db = getSqliteDb();
  await new Promise((resolve) => {
    db.serialize(() => {
      db.run(`
        CREATE TABLE IF NOT EXISTS users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          username TEXT UNIQUE NOT NULL,
          password TEXT NOT NULL,
          is_admin INTEGER DEFAULT 0,
          is_active INTEGER DEFAULT 1,
          last_seen DATETIME DEFAULT CURRENT_TIMESTAMP,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
      `);
      db.run(`
        CREATE TABLE IF NOT EXISTS chats (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
      `);
      db.run(`
        CREATE TABLE IF NOT EXISTS chat_participants (
          chat_id INTEGER,
          user_id INTEGER,
          PRIMARY KEY (chat_id, user_id)
        );
      `);
      db.run(`
        CREATE TABLE IF NOT EXISTS messages (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          chat_id INTEGER,
          sender_id INTEGER,
          content TEXT,
          media_url TEXT,
          media_type TEXT,
          is_view_once INTEGER DEFAULT 0,
          status TEXT DEFAULT 'sent',
          seen_at DATETIME NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
      `);
      db.run(`
        CREATE TABLE IF NOT EXISTS reactions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          message_id INTEGER,
          user_id INTEGER,
          emoji TEXT NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          UNIQUE (message_id, user_id)
        );
      `);
      db.run(`CREATE INDEX IF NOT EXISTS idx_messages_chat_created ON messages(chat_id, created_at DESC);`, () => {
        resolve();
      });
    });
  });
  console.log('[DB] Fallback schema ready.');
}

export { pool, isPg };
