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
        is_view_once BOOLEAN DEFAULT FALSE,
        is_viewed BOOLEAN DEFAULT FALSE,
        reply_to_id BIGINT REFERENCES messages(id) ON DELETE SET NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_messages_pair_cursor 
      ON messages(sender_id, recipient_id, id DESC);

      -- Safe migrations for existing deployments
      ALTER TABLE accounts ADD COLUMN IF NOT EXISTS avatar_url TEXT;
      ALTER TABLE accounts ADD COLUMN IF NOT EXISTS display_name TEXT;
      ALTER TABLE accounts ADD COLUMN IF NOT EXISTS bio_status TEXT DEFAULT 'Hey there! I am using Horizon Chat.';
      ALTER TABLE messages ADD COLUMN IF NOT EXISTS is_view_once BOOLEAN DEFAULT FALSE;
      ALTER TABLE messages ADD COLUMN IF NOT EXISTS is_viewed BOOLEAN DEFAULT FALSE;
    `);

    console.log('[DB] PostgreSQL initialized successfully (Phase 2).');
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
          // Safe SQLite column additions
          const tryAdd = (sql) => sqliteDb.run(sql, () => {});
          tryAdd("ALTER TABLE accounts ADD COLUMN avatar_url TEXT");
          tryAdd("ALTER TABLE accounts ADD COLUMN display_name TEXT");
          tryAdd("ALTER TABLE accounts ADD COLUMN bio_status TEXT DEFAULT 'Hey there! I am using Horizon Chat.'");
          tryAdd("ALTER TABLE messages ADD COLUMN is_view_once INTEGER DEFAULT 0");
          tryAdd("ALTER TABLE messages ADD COLUMN is_viewed INTEGER DEFAULT 0");
          resolve();
        });
      });
    });
    console.log('[DB] SQLite initialized at ' + dbPath + ' (Phase 2).');
  }
}

// User Methods
export async function findUserByUsername(username) {
  const normalized = username.trim();
  if (isPg) {
    const res = await pgPool.query(
      'SELECT id, username, password_hash, display_name, bio_status, avatar_url, created_at FROM accounts WHERE LOWER(username) = LOWER($1) LIMIT 1',
      [normalized]
    );
    return res.rows[0] || null;
  } else {
    return new Promise((resolve, reject) => {
      sqliteDb.get(
        'SELECT id, username, password_hash, display_name, bio_status, avatar_url, created_at FROM accounts WHERE LOWER(username) = LOWER(?) LIMIT 1',
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
    const res = await pgPool.query(
      'SELECT id, username, display_name, bio_status, avatar_url, created_at FROM accounts WHERE id = $1 LIMIT 1',
      [id]
    );
    return res.rows[0] || null;
  } else {
    return new Promise((resolve, reject) => {
      sqliteDb.get(
        'SELECT id, username, display_name, bio_status, avatar_url, created_at FROM accounts WHERE id = ? LIMIT 1',
        [id],
        (err, row) => {
          if (err) return reject(err);
          resolve(row || null);
        }
      );
    });
  }
}

export async function createUser(username, passwordHash, displayName = null) {
  const clean = username.trim();
  const dName = displayName || clean;
  if (isPg) {
    const res = await pgPool.query(
      'INSERT INTO accounts (username, password_hash, display_name) VALUES ($1, $2, $3) RETURNING id, username, display_name, bio_status, avatar_url, created_at',
      [clean, passwordHash, dName]
    );
    return res.rows[0];
  } else {
    return new Promise((resolve, reject) => {
      sqliteDb.run(
        'INSERT INTO accounts (username, password_hash, display_name) VALUES (?, ?, ?)',
        [clean, passwordHash, dName],
        function (err) {
          if (err) return reject(err);
          resolve({ id: this.lastID, username: clean, display_name: dName, bio_status: 'Hey there! I am using Horizon Chat.', avatar_url: null });
        }
      );
    });
  }
}

export async function lookupUser(query) {
  const clean = query.trim().toLowerCase();
  if (isPg) {
    const res = await pgPool.query(
      'SELECT id, username, display_name, bio_status, avatar_url FROM accounts WHERE LOWER(username) = LOWER($1) LIMIT 1',
      [clean]
    );
    return res.rows[0] || null;
  } else {
    return new Promise((resolve, reject) => {
      sqliteDb.get(
        'SELECT id, username, display_name, bio_status, avatar_url FROM accounts WHERE LOWER(username) = LOWER(?) LIMIT 1',
        [clean],
        (err, row) => {
          if (err) return reject(err);
          resolve(row || null);
        }
      );
    });
  }
}

export async function updateUserProfile(userId, { displayName, bioStatus, avatarUrl }) {
  if (isPg) {
    const res = await pgPool.query(
      `UPDATE accounts 
       SET display_name = COALESCE($1, display_name),
           bio_status = COALESCE($2, bio_status),
           avatar_url = COALESCE($3, avatar_url)
       WHERE id = $4
       RETURNING id, username, display_name, bio_status, avatar_url`,
      [displayName, bioStatus, avatarUrl, userId]
    );
    return res.rows[0] || null;
  } else {
    return new Promise((resolve, reject) => {
      sqliteDb.run(
        `UPDATE accounts 
         SET display_name = COALESCE(?, display_name),
             bio_status = COALESCE(?, bio_status),
             avatar_url = COALESCE(?, avatar_url)
         WHERE id = ?`,
        [displayName, bioStatus, avatarUrl, userId],
        function (err) {
          if (err) return reject(err);
          sqliteDb.get(
            'SELECT id, username, display_name, bio_status, avatar_url FROM accounts WHERE id = ?',
            [userId],
            (err2, row) => {
              if (err2) return reject(err2);
              resolve(row || null);
            }
          );
        }
      );
    });
  }
}

export async function updateUserPassword(userId, newPasswordHash) {
  if (isPg) {
    await pgPool.query('UPDATE accounts SET password_hash = $1 WHERE id = $2', [newPasswordHash, userId]);
    return true;
  } else {
    return new Promise((resolve, reject) => {
      sqliteDb.run('UPDATE accounts SET password_hash = ? WHERE id = ?', [newPasswordHash, userId], (err) => {
        if (err) return reject(err);
        resolve(true);
      });
    });
  }
}

// Cursor-based Pagination Query (TRD v2.0.0 + Phase 2)
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
  const isViewOnce = Boolean(r.is_view_once ?? r.isViewOnce);
  const isViewed = Boolean(r.is_view_viewed ?? r.is_viewed ?? r.isViewed);
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
    isViewOnce,
    is_view_once: isViewOnce,
    isViewed,
    is_viewed: isViewed,
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
        SELECT id, sender_id, recipient_id, message_text, attachment_type, attachment_url, thumbnail_blur, file_size_bytes, status, is_view_once, is_viewed, reply_to_id, created_at
        FROM messages
        WHERE ((sender_id = $1 AND recipient_id = $2) OR (sender_id = $2 AND recipient_id = $1))
          AND id < $3
        ORDER BY id DESC
        LIMIT $4
      `;
      params = [currentUserId, targetUserId, cursorId, safeLimit];
    } else {
      query = `
        SELECT id, sender_id, recipient_id, message_text, attachment_type, attachment_url, thumbnail_blur, file_size_bytes, status, is_view_once, is_viewed, reply_to_id, created_at
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
        SELECT id, sender_id, recipient_id, message_text, attachment_type, attachment_url, thumbnail_blur, file_size_bytes, status, is_view_once, is_viewed, reply_to_id, created_at
        FROM messages
        WHERE ((sender_id = ? AND recipient_id = ?) OR (sender_id = ? AND recipient_id = ?))
          AND id < ?
        ORDER BY id DESC
        LIMIT ?
      `;
      params = [currentUserId, targetUserId, targetUserId, currentUserId, cursorId, safeLimit];
    } else {
      query = `
        SELECT id, sender_id, recipient_id, message_text, attachment_type, attachment_url, thumbnail_blur, file_size_bytes, status, is_view_once, is_viewed, reply_to_id, created_at
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

export async function saveMessageTRD({ 
  senderId, 
  recipientId, 
  text, 
  attachmentType = 'NONE', 
  attachmentUrl = null, 
  thumbnailBlur = null, 
  fileSizeBytes = 0, 
  status = 'SENT', 
  isViewOnce = false,
  replyToId = null 
}) {
  if (isPg) {
    const res = await pgPool.query(
      `INSERT INTO messages (sender_id, recipient_id, message_text, attachment_type, attachment_url, thumbnail_blur, file_size_bytes, status, is_view_once, is_viewed, reply_to_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, FALSE, $10)
       RETURNING id, sender_id, recipient_id, message_text, attachment_type, attachment_url, thumbnail_blur, file_size_bytes, status, is_view_once, is_viewed, reply_to_id, created_at`,
      [senderId, recipientId, text, attachmentType, attachmentUrl, thumbnailBlur, fileSizeBytes, status, isViewOnce, replyToId]
    );
    return formatMessage(res.rows[0]);
  } else {
    return new Promise((resolve, reject) => {
      sqliteDb.run(
        `INSERT INTO messages (sender_id, recipient_id, message_text, attachment_type, attachment_url, thumbnail_blur, file_size_bytes, status, is_view_once, is_viewed, reply_to_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
        [senderId, recipientId, text, attachmentType, attachmentUrl, thumbnailBlur, fileSizeBytes, status, isViewOnce ? 1 : 0, replyToId],
        function (err) {
          if (err) return reject(err);
          const newId = this.lastID;
          sqliteDb.get(
            `SELECT id, sender_id, recipient_id, message_text, attachment_type, attachment_url, thumbnail_blur, file_size_bytes, status, is_view_once, is_viewed, reply_to_id, created_at FROM messages WHERE id = ?`,
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

export async function markMediaViewed(messageId) {
  if (isPg) {
    const res = await pgPool.query(
      'UPDATE messages SET is_viewed = TRUE WHERE id = $1 RETURNING id, sender_id, recipient_id, is_view_once, is_viewed',
      [messageId]
    );
    return res.rows[0] ? formatMessage(res.rows[0]) : null;
  } else {
    return new Promise((resolve, reject) => {
      sqliteDb.run('UPDATE messages SET is_viewed = 1 WHERE id = ?', [messageId], function (err) {
        if (err) return reject(err);
        sqliteDb.get('SELECT * FROM messages WHERE id = ?', [messageId], (err2, row) => {
          if (err2) return reject(err2);
          resolve(row ? formatMessage(row) : null);
        });
      });
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
      id, sender_id, recipient_id, message_text, attachment_type, status, is_view_once, is_viewed, created_at
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
    item.partnerDisplayName = partner?.display_name || partner?.username || `user_${item.partnerId}`;
    item.partnerAvatarUrl = partner?.avatar_url || null;
    item.partnerBioStatus = partner?.bio_status || 'Hey there! I am using Horizon Chat.';
  }

  return list;
}
