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
      ALTER TABLE accounts ADD COLUMN IF NOT EXISTS last_seen TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP;
      ALTER TABLE messages ADD COLUMN IF NOT EXISTS is_view_once BOOLEAN DEFAULT FALSE;
      ALTER TABLE messages ADD COLUMN IF NOT EXISTS is_viewed BOOLEAN DEFAULT FALSE;
      ALTER TABLE messages ADD COLUMN IF NOT EXISTS reactions TEXT DEFAULT '{}';
      ALTER TABLE messages ADD COLUMN IF NOT EXISTS is_pinned BOOLEAN DEFAULT FALSE;
      ALTER TABLE messages ADD COLUMN IF NOT EXISTS deleted_for_everyone BOOLEAN DEFAULT FALSE;
      ALTER TABLE messages ADD COLUMN IF NOT EXISTS deleted_by_users TEXT DEFAULT '[]';

      CREATE TABLE IF NOT EXISTS user_blocks (
        id SERIAL PRIMARY KEY,
        blocker_id INT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        blocked_id INT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (blocker_id, blocked_id)
      );

      CREATE TABLE IF NOT EXISTS user_reports (
        id SERIAL PRIMARY KEY,
        reporter_id INT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        reported_id INT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        reason TEXT NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);

    console.log('[DB] PostgreSQL initialized successfully (Phase 2b).');
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
          // Safe SQLite column additions (SQLite cannot use non-constant defaults like CURRENT_TIMESTAMP in ALTER TABLE)
          sqliteDb.serialize(() => {
            const tryAdd = (sql) => sqliteDb.run(sql, () => {});
            tryAdd("ALTER TABLE accounts ADD COLUMN avatar_url TEXT");
            tryAdd("ALTER TABLE accounts ADD COLUMN display_name TEXT");
            tryAdd("ALTER TABLE accounts ADD COLUMN bio_status TEXT DEFAULT 'Hey there! I am using Horizon Chat.'");
            tryAdd("ALTER TABLE accounts ADD COLUMN last_seen DATETIME");
            tryAdd("ALTER TABLE messages ADD COLUMN is_view_once INTEGER DEFAULT 0");
            tryAdd("ALTER TABLE messages ADD COLUMN is_viewed INTEGER DEFAULT 0");
            tryAdd("ALTER TABLE messages ADD COLUMN reactions TEXT DEFAULT '{}'");
            tryAdd("ALTER TABLE messages ADD COLUMN is_pinned INTEGER DEFAULT 0");
            tryAdd("ALTER TABLE messages ADD COLUMN deleted_for_everyone INTEGER DEFAULT 0");
            tryAdd("ALTER TABLE messages ADD COLUMN deleted_by_users TEXT DEFAULT '[]'");

            sqliteDb.run(`
              CREATE TABLE IF NOT EXISTS user_blocks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                blocker_id INTEGER NOT NULL,
                blocked_id INTEGER NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                UNIQUE (blocker_id, blocked_id)
              );
            `, () => {});

            sqliteDb.run(`
              CREATE TABLE IF NOT EXISTS user_reports (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                reporter_id INTEGER NOT NULL,
                reported_id INTEGER NOT NULL,
                reason TEXT NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
              );
            `, (err) => {
              if (err) return reject(err);
              resolve();
            });
          });
        });
      });
    });
    console.log('[DB] SQLite initialized at ' + dbPath + ' (Phase 2b).');
  }
}

// User Methods
export async function findUserByUsername(username) {
  const normalized = username.trim();
  if (isPg) {
    const res = await pgPool.query(
      'SELECT id, username, password_hash, display_name, bio_status, avatar_url, last_seen, created_at FROM accounts WHERE LOWER(username) = LOWER($1) LIMIT 1',
      [normalized]
    );
    return res.rows[0] || null;
  } else {
    return new Promise((resolve, reject) => {
      sqliteDb.get(
        'SELECT id, username, password_hash, display_name, bio_status, avatar_url, last_seen, created_at FROM accounts WHERE LOWER(username) = LOWER(?) LIMIT 1',
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
      'SELECT id, username, display_name, bio_status, avatar_url, last_seen, created_at FROM accounts WHERE id = $1 LIMIT 1',
      [id]
    );
    return res.rows[0] || null;
  } else {
    return new Promise((resolve, reject) => {
      sqliteDb.get(
        'SELECT id, username, display_name, bio_status, avatar_url, last_seen, created_at FROM accounts WHERE id = ? LIMIT 1',
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
      'INSERT INTO accounts (username, password_hash, display_name) VALUES ($1, $2, $3) RETURNING id, username, display_name, bio_status, avatar_url, last_seen, created_at',
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
          resolve({ id: this.lastID, username: clean, display_name: dName, bio_status: 'Hey there! I am using Horizon Chat.', avatar_url: null, last_seen: new Date().toISOString() });
        }
      );
    });
  }
}

export async function lookupUser(query) {
  const clean = query.trim().toLowerCase();
  if (isPg) {
    const res = await pgPool.query(
      'SELECT id, username, display_name, bio_status, avatar_url, last_seen FROM accounts WHERE LOWER(username) = LOWER($1) LIMIT 1',
      [clean]
    );
    return res.rows[0] || null;
  } else {
    return new Promise((resolve, reject) => {
      sqliteDb.get(
        'SELECT id, username, display_name, bio_status, avatar_url, last_seen FROM accounts WHERE LOWER(username) = LOWER(?) LIMIT 1',
        [clean],
        (err, row) => {
          if (err) return reject(err);
          resolve(row || null);
        }
      );
    });
  }
}

export async function updateUserLastSeen(userId) {
  if (isPg) {
    await pgPool.query('UPDATE accounts SET last_seen = CURRENT_TIMESTAMP WHERE id = $1', [userId]);
  } else {
    return new Promise((resolve, reject) => {
      sqliteDb.run('UPDATE accounts SET last_seen = CURRENT_TIMESTAMP WHERE id = ?', [userId], (err) => {
        if (err) return reject(err);
        resolve();
      });
    });
  }
}

export async function blockUser(blockerId, blockedId) {
  if (isPg) {
    await pgPool.query(
      'INSERT INTO user_blocks (blocker_id, blocked_id) VALUES ($1, $2) ON CONFLICT (blocker_id, blocked_id) DO NOTHING',
      [blockerId, blockedId]
    );
    return true;
  } else {
    return new Promise((resolve, reject) => {
      sqliteDb.run(
        'INSERT OR IGNORE INTO user_blocks (blocker_id, blocked_id) VALUES (?, ?)',
        [blockerId, blockedId],
        (err) => {
          if (err) return reject(err);
          resolve(true);
        }
      );
    });
  }
}

export async function unblockUser(blockerId, blockedId) {
  if (isPg) {
    await pgPool.query('DELETE FROM user_blocks WHERE blocker_id = $1 AND blocked_id = $2', [blockerId, blockedId]);
    return true;
  } else {
    return new Promise((resolve, reject) => {
      sqliteDb.run('DELETE FROM user_blocks WHERE blocker_id = ? AND blocked_id = ?', [blockerId, blockedId], (err) => {
        if (err) return reject(err);
        resolve(true);
      });
    });
  }
}

export async function isUserBlocked(userA, userB) {
  if (isPg) {
    const res = await pgPool.query(
      'SELECT id FROM user_blocks WHERE (blocker_id = $1 AND blocked_id = $2) OR (blocker_id = $2 AND blocked_id = $1) LIMIT 1',
      [userA, userB]
    );
    return res.rows.length > 0;
  } else {
    return new Promise((resolve, reject) => {
      sqliteDb.get(
        'SELECT id FROM user_blocks WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?) LIMIT 1',
        [userA, userB, userB, userA],
        (err, row) => {
          if (err) return reject(err);
          resolve(!!row);
        }
      );
    });
  }
}

export async function reportUser(reporterId, reportedId, reason) {
  if (isPg) {
    await pgPool.query(
      'INSERT INTO user_reports (reporter_id, reported_id, reason) VALUES ($1, $2, $3)',
      [reporterId, reportedId, reason]
    );
    return true;
  } else {
    return new Promise((resolve, reject) => {
      sqliteDb.run(
        'INSERT INTO user_reports (reporter_id, reported_id, reason) VALUES (?, ?, ?)',
        [reporterId, reportedId, reason],
        (err) => {
          if (err) return reject(err);
          resolve(true);
        }
      );
    });
  }
}

export async function clearConversationMessages(userId, partnerId) {
  if (isPg) {
    await pgPool.query(
      'DELETE FROM messages WHERE (sender_id = $1 AND recipient_id = $2) OR (sender_id = $2 AND recipient_id = $1)',
      [userId, partnerId]
    );
    return true;
  } else {
    return new Promise((resolve, reject) => {
      sqliteDb.run(
        'DELETE FROM messages WHERE (sender_id = ? AND recipient_id = ?) OR (sender_id = ? AND recipient_id = ?)',
        [userId, partnerId, partnerId, userId],
        (err) => {
          if (err) return reject(err);
          resolve(true);
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

// Cursor-based Pagination Query (TRD v2.0.0 + Phase 2 + Phase 2C)
function formatMessage(r) {
  if (!r) return null;
  const rawText = r.message_text ?? r.text ?? r.messageText ?? '';
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

  const isPinned = Boolean(r.is_pinned ?? r.isPinned);
  const deletedForEveryone = Boolean(r.deleted_for_everyone ?? r.deletedForEveryone);

  let reactions = {};
  try {
    const rRaw = r.reactions;
    reactions = typeof rRaw === 'string' ? JSON.parse(rRaw || '{}') : (rRaw || {});
  } catch (e) {
    reactions = {};
  }

  let deletedByUsers = [];
  try {
    const dRaw = r.deleted_by_users;
    deletedByUsers = typeof dRaw === 'string' ? JSON.parse(dRaw || '[]') : (dRaw || []);
  } catch (e) {
    deletedByUsers = [];
  }

  const displayText = deletedForEveryone ? '🚫 This message was deleted' : rawText;
  const displayAttachmentType = deletedForEveryone ? 'NONE' : attachmentType;
  const displayAttachmentUrl = deletedForEveryone ? null : attachmentUrl;
  const displayThumbnailBlur = deletedForEveryone ? null : thumbnailBlur;
  const displayFileSize = deletedForEveryone ? 0 : fileSizeBytes;

  return {
    id,
    senderId,
    sender_id: senderId,
    recipientId,
    recipient_id: recipientId,
    text: displayText,
    messageText: displayText,
    message_text: displayText,
    attachmentType: displayAttachmentType,
    attachment_type: displayAttachmentType,
    attachmentUrl: displayAttachmentUrl,
    attachment_url: displayAttachmentUrl,
    thumbnailBlur: displayThumbnailBlur,
    thumbnail_blur: displayThumbnailBlur,
    fileSizeBytes: displayFileSize,
    file_size_bytes: displayFileSize,
    status,
    isViewOnce,
    is_view_once: isViewOnce,
    isViewed,
    is_view_viewed: isViewed,
    is_viewed: isViewed,
    replyToId,
    reply_to_id: replyToId,
    reactions,
    isPinned,
    is_pinned: isPinned,
    deletedForEveryone,
    deleted_for_everyone: deletedForEveryone,
    deletedByUsers,
    deleted_by_users: deletedByUsers,
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
        SELECT id, sender_id, recipient_id, message_text, attachment_type, attachment_url, thumbnail_blur, file_size_bytes, status, is_view_once, is_viewed, reply_to_id, reactions, is_pinned, deleted_for_everyone, deleted_by_users, created_at
        FROM messages
        WHERE ((sender_id = $1 AND recipient_id = $2) OR (sender_id = $2 AND recipient_id = $1))
          AND id < $3
        ORDER BY id DESC
        LIMIT $4
      `;
      params = [currentUserId, targetUserId, cursorId, safeLimit];
    } else {
      query = `
        SELECT id, sender_id, recipient_id, message_text, attachment_type, attachment_url, thumbnail_blur, file_size_bytes, status, is_view_once, is_viewed, reply_to_id, reactions, is_pinned, deleted_for_everyone, deleted_by_users, created_at
        FROM messages
        WHERE (sender_id = $1 AND recipient_id = $2) OR (sender_id = $2 AND recipient_id = $1)
        ORDER BY id DESC
        LIMIT $3
      `;
      params = [currentUserId, targetUserId, safeLimit];
    }
    const res = await pgPool.query(query, params);
    return res.rows
      .map(formatMessage)
      .filter(m => !m.deletedByUsers.includes(Number(currentUserId)))
      .reverse();
  } else {
    let query;
    let params;
    if (cursorId) {
      query = `
        SELECT id, sender_id, recipient_id, message_text, attachment_type, attachment_url, thumbnail_blur, file_size_bytes, status, is_view_once, is_viewed, reply_to_id, reactions, is_pinned, deleted_for_everyone, deleted_by_users, created_at
        FROM messages
        WHERE ((sender_id = ? AND recipient_id = ?) OR (sender_id = ? AND recipient_id = ?))
          AND id < ?
        ORDER BY id DESC
        LIMIT ?
      `;
      params = [currentUserId, targetUserId, targetUserId, currentUserId, cursorId, safeLimit];
    } else {
      query = `
        SELECT id, sender_id, recipient_id, message_text, attachment_type, attachment_url, thumbnail_blur, file_size_bytes, status, is_view_once, is_viewed, reply_to_id, reactions, is_pinned, deleted_for_everyone, deleted_by_users, created_at
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
        const mapped = (rows || [])
          .map(formatMessage)
          .filter(m => !m.deletedByUsers.includes(Number(currentUserId)))
          .reverse();
        resolve(mapped);
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

export async function searchUsers(query, currentUserId) {
  const clean = `%${(query || '').trim().toLowerCase()}%`;
  if (isPg) {
    const res = await pgPool.query(
      `SELECT id, username, display_name, bio_status, avatar_url, last_seen
       FROM accounts
       WHERE id != $1 AND (LOWER(username) LIKE $2 OR LOWER(COALESCE(display_name, '')) LIKE $2)
       ORDER BY username ASC
       LIMIT 20`,
      [currentUserId, clean]
    );
    return res.rows;
  } else {
    return new Promise((resolve, reject) => {
      sqliteDb.all(
        `SELECT id, username, display_name, bio_status, avatar_url, last_seen
         FROM accounts
         WHERE id != ? AND (LOWER(username) LIKE ? OR LOWER(COALESCE(display_name, '')) LIKE ?)
         ORDER BY username ASC
         LIMIT 20`,
        [currentUserId, clean, clean],
        (err, rows) => {
          if (err) return reject(err);
          resolve(rows || []);
        }
      );
    });
  }
}

export async function toggleMessageReaction(messageId, userId, emoji) {
  let messageRow;
  if (isPg) {
    const res = await pgPool.query('SELECT * FROM messages WHERE id = $1', [messageId]);
    messageRow = res.rows[0];
  } else {
    messageRow = await new Promise((resolve, reject) => {
      sqliteDb.get('SELECT * FROM messages WHERE id = ?', [messageId], (err, row) => {
        if (err) return reject(err);
        resolve(row);
      });
    });
  }

  if (!messageRow) return null;

  let reactions = {};
  try {
    const rRaw = messageRow.reactions;
    reactions = typeof rRaw === 'string' ? JSON.parse(rRaw || '{}') : (rRaw || {});
  } catch (e) {
    reactions = {};
  }

  const uId = Number(userId);

  // If user already reacted with this emoji, toggle it off
  if (reactions[emoji] && Array.isArray(reactions[emoji]) && reactions[emoji].includes(uId)) {
    reactions[emoji] = reactions[emoji].filter(id => id !== uId);
    if (reactions[emoji].length === 0) {
      delete reactions[emoji];
    }
  } else {
    // Remove user from any other emoji reactions first (WhatsApp style: 1 reaction per user)
    for (const [e, users] of Object.entries(reactions)) {
      if (Array.isArray(users)) {
        reactions[e] = users.filter(id => id !== uId);
        if (reactions[e].length === 0) {
          delete reactions[e];
        }
      }
    }
    if (!reactions[emoji]) reactions[emoji] = [];
    reactions[emoji].push(uId);
  }

  const jsonStr = JSON.stringify(reactions);
  if (isPg) {
    const res = await pgPool.query(
      'UPDATE messages SET reactions = $1 WHERE id = $2 RETURNING *',
      [jsonStr, messageId]
    );
    return formatMessage(res.rows[0]);
  } else {
    return new Promise((resolve, reject) => {
      sqliteDb.run('UPDATE messages SET reactions = ? WHERE id = ?', [jsonStr, messageId], function(err) {
        if (err) return reject(err);
        sqliteDb.get('SELECT * FROM messages WHERE id = ?', [messageId], (err2, row) => {
          if (err2) return reject(err2);
          resolve(formatMessage(row));
        });
      });
    });
  }
}

export async function deleteMessage(messageId, userId, mode = 'me') {
  let messageRow;
  if (isPg) {
    const res = await pgPool.query('SELECT * FROM messages WHERE id = $1', [messageId]);
    messageRow = res.rows[0];
  } else {
    messageRow = await new Promise((resolve, reject) => {
      sqliteDb.get('SELECT * FROM messages WHERE id = ?', [messageId], (err, row) => {
        if (err) return reject(err);
        resolve(row);
      });
    });
  }

  if (!messageRow) return null;
  const uId = Number(userId);

  if (mode === 'everyone') {
    if (isPg) {
      const res = await pgPool.query(
        'UPDATE messages SET deleted_for_everyone = TRUE, message_text = $1 WHERE id = $2 RETURNING *',
        ['🚫 This message was deleted', messageId]
      );
      return formatMessage(res.rows[0]);
    } else {
      return new Promise((resolve, reject) => {
        sqliteDb.run('UPDATE messages SET deleted_for_everyone = 1, message_text = ? WHERE id = ?', ['🚫 This message was deleted', messageId], function(err) {
          if (err) return reject(err);
          sqliteDb.get('SELECT * FROM messages WHERE id = ?', [messageId], (err2, row) => {
            if (err2) return reject(err2);
            resolve(formatMessage(row));
          });
        });
      });
    }
  } else {
    // Delete for me
    let deletedByUsers = [];
    try {
      const dRaw = messageRow.deleted_by_users;
      deletedByUsers = typeof dRaw === 'string' ? JSON.parse(dRaw || '[]') : (dRaw || []);
    } catch (e) {
      deletedByUsers = [];
    }
    if (!deletedByUsers.includes(uId)) {
      deletedByUsers.push(uId);
    }
    const jsonStr = JSON.stringify(deletedByUsers);

    if (isPg) {
      const res = await pgPool.query(
        'UPDATE messages SET deleted_by_users = $1 WHERE id = $2 RETURNING *',
        [jsonStr, messageId]
      );
      return formatMessage(res.rows[0]);
    } else {
      return new Promise((resolve, reject) => {
        sqliteDb.run('UPDATE messages SET deleted_by_users = ? WHERE id = ?', [jsonStr, messageId], function(err) {
          if (err) return reject(err);
          sqliteDb.get('SELECT * FROM messages WHERE id = ?', [messageId], (err2, row) => {
            if (err2) return reject(err2);
            resolve(formatMessage(row));
          });
        });
      });
    }
  }
}

export async function pinMessage(messageId, isPinned = true) {
  if (isPg) {
    const res = await pgPool.query(
      'UPDATE messages SET is_pinned = $1 WHERE id = $2 RETURNING *',
      [Boolean(isPinned), messageId]
    );
    return formatMessage(res.rows[0]);
  } else {
    return new Promise((resolve, reject) => {
      sqliteDb.run('UPDATE messages SET is_pinned = ? WHERE id = ?', [isPinned ? 1 : 0, messageId], function(err) {
        if (err) return reject(err);
        sqliteDb.get('SELECT * FROM messages WHERE id = ?', [messageId], (err2, row) => {
          if (err2) return reject(err2);
          resolve(formatMessage(row));
        });
      });
    });
  }
}

export async function markConversationRead(currentUserId, partnerId) {
  if (isPg) {
    await pgPool.query(
      "UPDATE messages SET status = 'READ' WHERE sender_id = $1 AND recipient_id = $2 AND status != 'READ'",
      [partnerId, currentUserId]
    );
    return true;
  } else {
    return new Promise((resolve, reject) => {
      sqliteDb.run(
        "UPDATE messages SET status = 'READ' WHERE sender_id = ? AND recipient_id = ? AND status != 'READ'",
        [partnerId, currentUserId],
        (err) => {
          if (err) return reject(err);
          resolve(true);
        }
      );
    });
  }
}

