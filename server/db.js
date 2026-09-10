import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';
import sqlite3 from 'sqlite3';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATABASE_URL = process.env.DATABASE_URL;

let isPg = false;
let pgPool = null;
let sqliteDb = null;

export async function initDb() {
  if (DATABASE_URL) {
    console.log('[DB] Connecting to PostgreSQL (Neon/External)...');
    pgPool = new pg.Pool({
      connectionString: DATABASE_URL,
      ssl: { rejectUnauthorized: false },
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000
    });
    isPg = true;

    // Accounts Table (TRD v2.0.0)
    await pgPool.query(`
      CREATE TABLE IF NOT EXISTS accounts (
        id SERIAL PRIMARY KEY,
        username VARCHAR(32) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_accounts_username ON accounts(username);
    `);

    // Messages Table with Cursor Index (TRD v2.0.0)
    await pgPool.query(`
      CREATE TABLE IF NOT EXISTS messages (
        id BIGSERIAL PRIMARY KEY,
        sender_id INT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        recipient_id INT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        message_text TEXT,
        attachment_type VARCHAR(20) DEFAULT 'NONE',
        attachment_url TEXT,
        thumbnail_blur TEXT,
        file_size_bytes BIGINT DEFAULT 0,
        status VARCHAR(16) DEFAULT 'SENT',
        reply_to_id BIGINT REFERENCES messages(id) ON DELETE SET NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_messages_pair_cursor 
      ON messages(sender_id, recipient_id, id DESC);
    `);

    console.log('[DB] PostgreSQL initialized successfully (TRD v2.0.0).');
  } else {
    console.log('[DB] DATABASE_URL not detected. Falling back to local SQLite...');
    const dataDir = path.join(__dirname, 'data');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    const dbPath = path.join(dataDir, 'horizon_chat.db');

    sqliteDb = new sqlite3.Database(dbPath);
    isPg = false;

    await new Promise((resolve, reject) => {
      sqliteDb.serialize(() => {
        sqliteDb.run(`
          CREATE TABLE IF NOT EXISTS accounts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL COLLATE NOCASE,
            password_hash TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
          );
        `, (err) => {
          if (err) return reject(err);
        });

        sqliteDb.run(`
          CREATE INDEX IF NOT EXISTS idx_accounts_username ON accounts(username);
        `);

        sqliteDb.run(`
          CREATE TABLE IF NOT EXISTS messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            sender_id INTEGER NOT NULL,
            recipient_id INTEGER NOT NULL,
            message_text TEXT,
            attachment_type TEXT DEFAULT 'NONE',
            attachment_url TEXT,
            thumbnail_blur TEXT,
            file_size_bytes INTEGER DEFAULT 0,
            status TEXT DEFAULT 'SENT',
            reply_to_id INTEGER,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
          );
        `, (err) => {
          if (err) return reject(err);
        });

        sqliteDb.run(`
          CREATE INDEX IF NOT EXISTS idx_messages_pair_cursor 
          ON messages(sender_id, recipient_id, id DESC);
        `, (err) => {
          if (err) return reject(err);
          resolve();
        });
      });
    });
    console.log('[DB] SQLite initialized at ' + dbPath + ' (TRD v2.0.0).');
  }
}

// User Methods
export async function findUserByUsername(username) {
  const normalized = username.trim();
  if (isPg) {
    const res = await pgPool.query(
      'SELECT id, username, password_hash, created_at FROM accounts WHERE LOWER(username) = LOWER($1) LIMIT 1',
      [normalized]
    );
    return res.rows[0] || null;
  } else {
    return new Promise((resolve, reject) => {
      sqliteDb.get(
        'SELECT id, username, password_hash, created_at FROM accounts WHERE LOWER(username) = LOWER(?) LIMIT 1',
        [normalized],
        (err, row) => {
          if (err) return reject(err);
          resolve(row || null);
        }
      );
    });
  }
}

export async function findUserById(id) {
  if (isPg) {
    const res = await pgPool.query('SELECT id, username, created_at FROM accounts WHERE id = $1 LIMIT 1', [id]);
    return res.rows[0] || null;
  } else {
    return new Promise((resolve, reject) => {
      sqliteDb.get('SELECT id, username, created_at FROM accounts WHERE id = ? LIMIT 1', [id], (err, row) => {
        if (err) return reject(err);
        resolve(row || null);
      });
    });
  }
}

export async function createUser(username, passwordHash) {
  const clean = username.trim();
  if (isPg) {
    const res = await pgPool.query(
      'INSERT INTO accounts (username, password_hash) VALUES ($1, $2) RETURNING id, username, created_at',
      [clean, passwordHash]
    );
    return res.rows[0];
  } else {
    return new Promise((resolve, reject) => {
      sqliteDb.run(
        'INSERT INTO accounts (username, password_hash) VALUES (?, ?)',
        [clean, passwordHash],
        function (err) {
          if (err) return reject(err);
          resolve({ id: this.lastID, username: clean });
        }
      );
    });
  }
}

export async function lookupUser(query) {
  const clean = query.trim().toLowerCase();
  if (isPg) {
    const res = await pgPool.query(
      'SELECT id, username FROM accounts WHERE LOWER(username) = LOWER($1) LIMIT 1',
      [clean]
    );
    return res.rows[0] || null;
  } else {
    return new Promise((resolve, reject) => {
      sqliteDb.get(
        'SELECT id, username FROM accounts WHERE LOWER(username) = LOWER(?) LIMIT 1',
        [clean],
        (err, row) => {
          if (err) return reject(err);
          resolve(row || null);
        }
      );
    });
  }
}

// Cursor-based Pagination Query (TRD v2.0.0)
function formatMessage(r) {
  if (!r) return null;
  const text = r.message_text ?? r.text ?? r.messageText ?? '';
  const senderId = Number(r.sender_id ?? r.senderId);
  const recipientId = Number(r.recipient_id ?? r.recipientId);
  const createdAt = r.created_at ?? r.createdAt;
  const attachmentType = r.attachment_type ?? r.attachmentType ?? 'NONE';
  const attachmentUrl = r.attachment_url ?? r.attachmentUrl ?? null;
  const thumbnailBlur = r.thumbnail_blur ?? r.thumbnailBlur ?? null;
  const fileSizeBytes = Number(r.file_size_bytes ?? r.fileSizeBytes ?? 0);
  const status = r.status || 'SENT';
  const replyToId = r.reply_to_id ? Number(r.reply_to_id) : (r.replyToId ? Number(r.replyToId) : null);
  const id = Number(r.id);

  return {
    id,
    senderId,
    sender_id: senderId,
    recipientId,
    recipient_id: recipientId,
    text,
    messageText: text,
    message_text: text,
    attachmentType,
    attachment_type: attachmentType,
    attachmentUrl,
    attachment_url: attachmentUrl,
    thumbnailBlur,
    thumbnail_blur: thumbnailBlur,
    fileSizeBytes,
    file_size_bytes: fileSizeBytes,
    status,
    replyToId,
    reply_to_id: replyToId,
    createdAt,
    created_at: createdAt
  };
}

export async function getMessagesCursor(currentUserId, targetUserId, cursorId = null, limit = 25) {
  const safeLimit = Math.min(parseInt(limit, 10) || 25, 50);

  if (isPg) {
    let query;
    let params;
    if (cursorId) {
      query = `
        SELECT id, sender_id, recipient_id, message_text, attachment_type, attachment_url, thumbnail_blur, file_size_bytes, status, reply_to_id, created_at
        FROM messages
        WHERE ((sender_id = $1 AND recipient_id = $2) OR (sender_id = $2 AND recipient_id = $1))
          AND id < $3
        ORDER BY id DESC
        LIMIT $4
      `;
      params = [currentUserId, targetUserId, cursorId, safeLimit];
    } else {
      query = `
        SELECT id, sender_id, recipient_id, message_text, attachment_type, attachment_url, thumbnail_blur, file_size_bytes, status, reply_to_id, created_at
        FROM messages
        WHERE (sender_id = $1 AND recipient_id = $2) OR (sender_id = $2 AND recipient_id = $1)
        ORDER BY id DESC
        LIMIT $3
      `;
      params = [currentUserId, targetUserId, safeLimit];
    }
    const res = await pgPool.query(query, params);
    return res.rows.reverse().map(formatMessage);
  } else {
    let query;
    let params;
    if (cursorId) {
      query = `
        SELECT id, sender_id, recipient_id, message_text, attachment_type, attachment_url, thumbnail_blur, file_size_bytes, status, reply_to_id, created_at
        FROM messages
        WHERE ((sender_id = ? AND recipient_id = ?) OR (sender_id = ? AND recipient_id = ?))
          AND id < ?
        ORDER BY id DESC
        LIMIT ?
      `;
      params = [currentUserId, targetUserId, targetUserId, currentUserId, cursorId, safeLimit];
    } else {
      query = `
        SELECT id, sender_id, recipient_id, message_text, attachment_type, attachment_url, thumbnail_blur, file_size_bytes, status, reply_to_id, created_at
        FROM messages
        WHERE (sender_id = ? AND recipient_id = ?) OR (sender_id = ? AND recipient_id = ?)
        ORDER BY id DESC
        LIMIT ?
      `;
      params = [currentUserId, targetUserId, targetUserId, currentUserId, safeLimit];
    }
    return new Promise((resolve, reject) => {
      sqliteDb.all(query, params, (err, rows) => {
        if (err) return reject(err);
        resolve((rows || []).reverse().map(formatMessage));
      });
    });
  }
}

export async function saveMessageTRD({ senderId, recipientId, text, attachmentType = 'NONE', attachmentUrl = null, thumbnailBlur = null, fileSizeBytes = 0, status = 'SENT', replyToId = null }) {
  if (isPg) {
    const res = await pgPool.query(
      `INSERT INTO messages (sender_id, recipient_id, message_text, attachment_type, attachment_url, thumbnail_blur, file_size_bytes, status, reply_to_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id, sender_id, recipient_id, message_text, attachment_type, attachment_url, thumbnail_blur, file_size_bytes, status, reply_to_id, created_at`,
      [senderId, recipientId, text, attachmentType, attachmentUrl, thumbnailBlur, fileSizeBytes, status, replyToId]
    );
    return formatMessage(res.rows[0]);
  } else {
    return new Promise((resolve, reject) => {
      sqliteDb.run(
        `INSERT INTO messages (sender_id, recipient_id, message_text, attachment_type, attachment_url, thumbnail_blur, file_size_bytes, status, reply_to_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [senderId, recipientId, text, attachmentType, attachmentUrl, thumbnailBlur, fileSizeBytes, status, replyToId],
        function (err) {
          if (err) return reject(err);
          const newId = this.lastID;
          sqliteDb.get(
            `SELECT id, sender_id, recipient_id, message_text, attachment_type, attachment_url, thumbnail_blur, file_size_bytes, status, reply_to_id, created_at FROM messages WHERE id = ?`,
            [newId],
            (err2, row) => {
              if (err2) return reject(err2);
              resolve(formatMessage(row));
            }
          );
        }
      );
    });
  }
}

export async function updateMessageStatus(messageId, status) {
  if (isPg) {
    await pgPool.query('UPDATE messages SET status = $1 WHERE id = $2', [status, messageId]);
  } else {
    return new Promise((resolve, reject) => {
      sqliteDb.run('UPDATE messages SET status = ? WHERE id = ?', [status, messageId], (err) => {
        if (err) return reject(err);
        resolve();
      });
    });
  }
}

export async function getUserConversations(currentUserId) {
  const sql = `
    SELECT 
      CASE WHEN sender_id = $1 THEN recipient_id ELSE sender_id END AS partner_id,
      id, sender_id, recipient_id, message_text, attachment_type, status, created_at
    FROM messages
    WHERE sender_id = $1 OR recipient_id = $2
    ORDER BY id DESC
  `;

  let rows = [];
  if (isPg) {
    const res = await pgPool.query(sql, [currentUserId, currentUserId]);
    rows = res.rows;
  } else {
    const sqliteSql = sql.replace(/\$1/g, '?').replace(/\$2/g, '?');
    rows = await new Promise((resolve, reject) => {
      sqliteDb.all(sqliteSql, [currentUserId, currentUserId], (err, resRows) => {
        if (err) return reject(err);
        resolve(resRows || []);
      });
    });
  }

  const partnerMap = new Map();
  for (const row of rows) {
    const pId = Number(row.partner_id);
    if (!partnerMap.has(pId)) {
      const formatted = formatMessage(row);
      partnerMap.set(pId, {
        partnerId: pId,
        lastMessage: formatted,
        unreadCount: 0
      });
    }

    if (pId === Number(row.sender_id) && row.status !== 'READ') {
      const entry = partnerMap.get(pId);
      entry.unreadCount++;
    }
  }

  const list = Array.from(partnerMap.values());
  for (const item of list) {
    const partner = await findUserById(item.partnerId);
    item.partnerUsername = partner?.username || `user_${item.partnerId}`;
  }

  return list;
}
