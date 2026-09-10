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

const AVATAR_COLORS = [
  '#00A884', '#0284C7', '#7C3AED', '#DB2777', 
  '#EA580C', '#16A34A', '#2563EB', '#D97706'
];

export async function initDb() {
  if (DATABASE_URL) {
    console.log('[DB] Connecting to PostgreSQL (Neon/External)...');
    pgPool = new pg.Pool({
      connectionString: DATABASE_URL,
      ssl: { rejectUnauthorized: false }
    });
    isPg = true;

    // Accounts table
    await pgPool.query(`
      CREATE TABLE IF NOT EXISTS accounts (
        id SERIAL PRIMARY KEY,
        username VARCHAR(32) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        avatar_color VARCHAR(16) DEFAULT '#00A884',
        about TEXT DEFAULT 'Hey there! I am using WhatsApp.',
        last_seen TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_accounts_username ON accounts(username);
    `);

    // Messages table (Telegram-style permanent cloud persistence)
    await pgPool.query(`
      CREATE TABLE IF NOT EXISTS messages (
        id VARCHAR(64) PRIMARY KEY,
        sender_username VARCHAR(32) NOT NULL,
        recipient_username VARCHAR(32) NOT NULL,
        text TEXT NOT NULL,
        type VARCHAR(16) DEFAULT 'text',
        media_url TEXT DEFAULT '',
        status VARCHAR(16) DEFAULT 'sent',
        reactions TEXT DEFAULT '{}',
        created_at BIGINT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_messages_pair ON messages(sender_username, recipient_username);
      CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at);
    `);

    console.log('[DB] PostgreSQL initialized. Accounts and Messages cloud tables ready.');
  } else {
    console.log('[DB] DATABASE_URL not detected. Falling back to local SQLite...');
    const dataDir = path.join(__dirname, 'data');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    const dbPath = path.join(dataDir, 'whatsapp_cloud.db');

    sqliteDb = new sqlite3.Database(dbPath);
    isPg = false;

    await new Promise((resolve, reject) => {
      sqliteDb.serialize(() => {
        // Accounts table
        sqliteDb.run(`
          CREATE TABLE IF NOT EXISTS accounts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL COLLATE NOCASE,
            password_hash TEXT NOT NULL,
            avatar_color TEXT DEFAULT '#00A884',
            about TEXT DEFAULT 'Hey there! I am using WhatsApp.',
            last_seen DATETIME DEFAULT CURRENT_TIMESTAMP,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
          );
        `, (err) => {
          if (err) return reject(err);
        });

        sqliteDb.run(`
          CREATE INDEX IF NOT EXISTS idx_accounts_username ON accounts(username);
        `);

        // Messages table
        sqliteDb.run(`
          CREATE TABLE IF NOT EXISTS messages (
            id TEXT PRIMARY KEY,
            sender_username TEXT NOT NULL COLLATE NOCASE,
            recipient_username TEXT NOT NULL COLLATE NOCASE,
            text TEXT NOT NULL,
            type TEXT DEFAULT 'text',
            media_url TEXT DEFAULT '',
            status TEXT DEFAULT 'sent',
            reactions TEXT DEFAULT '{}',
            created_at INTEGER NOT NULL
          );
        `, (err) => {
          if (err) return reject(err);
        });

        sqliteDb.run(`
          CREATE INDEX IF NOT EXISTS idx_messages_pair ON messages(sender_username, recipient_username);
        `);
        sqliteDb.run(`
          CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at);
        `, (err) => {
          if (err) return reject(err);
          resolve();
        });
      });
    });
    console.log('[DB] SQLite initialized at ' + dbPath + '. Cloud messages and accounts ready.');
  }
}

// User methods
export async function findUserByUsername(username) {
  const normalized = username.trim();
  if (isPg) {
    const res = await pgPool.query(
      'SELECT id, username, password_hash, avatar_color, about, last_seen, created_at FROM accounts WHERE LOWER(username) = LOWER($1) LIMIT 1',
      [normalized]
    );
    return res.rows[0] || null;
  } else {
    return new Promise((resolve, reject) => {
      sqliteDb.get(
        'SELECT id, username, password_hash, avatar_color, about, last_seen, created_at FROM accounts WHERE LOWER(username) = LOWER(?) LIMIT 1',
        [normalized],
        (err, row) => {
          if (err) return reject(err);
          resolve(row || null);
        }
      );
    });
  }
}

export async function createUser(username, passwordHash) {
  const cleanUsername = username.trim();
  const avatarColor = AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)];
  if (isPg) {
    const res = await pgPool.query(
      'INSERT INTO accounts (username, password_hash, avatar_color) VALUES ($1, $2, $3) RETURNING id, username, avatar_color, about, created_at',
      [cleanUsername, passwordHash, avatarColor]
    );
    return res.rows[0];
  } else {
    return new Promise((resolve, reject) => {
      sqliteDb.run(
        'INSERT INTO accounts (username, password_hash, avatar_color) VALUES (?, ?, ?)',
        [cleanUsername, passwordHash, avatarColor],
        function (err) {
          if (err) return reject(err);
          resolve({
            id: this.lastID,
            username: cleanUsername,
            avatar_color: avatarColor,
            about: 'Hey there! I am using WhatsApp.'
          });
        }
      );
    });
  }
}

export async function updateUserLastSeen(username) {
  const now = new Date();
  if (isPg) {
    await pgPool.query('UPDATE accounts SET last_seen = $1 WHERE LOWER(username) = LOWER($2)', [now, username]);
  } else {
    return new Promise((resolve, reject) => {
      sqliteDb.run('UPDATE accounts SET last_seen = CURRENT_TIMESTAMP WHERE LOWER(username) = LOWER(?)', [username], (err) => {
        if (err) return reject(err);
        resolve();
      });
    });
  }
}

export async function searchUsers(query, currentUsername) {
  const pattern = `%${query.trim().toLowerCase()}%`;
  const cleanCurrent = currentUsername.trim().toLowerCase();
  if (isPg) {
    const res = await pgPool.query(
      'SELECT id, username, avatar_color, about, last_seen FROM accounts WHERE LOWER(username) LIKE $1 AND LOWER(username) != $2 ORDER BY username ASC LIMIT 20',
      [pattern, cleanCurrent]
    );
    return res.rows;
  } else {
    return new Promise((resolve, reject) => {
      sqliteDb.all(
        'SELECT id, username, avatar_color, about, last_seen FROM accounts WHERE LOWER(username) LIKE ? AND LOWER(username) != ? ORDER BY username ASC LIMIT 20',
        [pattern, cleanCurrent],
        (err, rows) => {
          if (err) return reject(err);
          resolve(rows || []);
        }
      );
    });
  }
}

// Telegram-Style Cloud Message Storage
export async function saveMessage({ id, sender, recipient, text, type = 'text', mediaUrl = '', status = 'sent', createdAt = Date.now() }) {
  const reactionsJson = '{}';
  if (isPg) {
    await pgPool.query(
      `INSERT INTO messages (id, sender_username, recipient_username, text, type, media_url, status, reactions, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [id, sender, recipient, text, type, mediaUrl, status, reactionsJson, createdAt]
    );
  } else {
    await new Promise((resolve, reject) => {
      sqliteDb.run(
        `INSERT INTO messages (id, sender_username, recipient_username, text, type, media_url, status, reactions, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, sender, recipient, text, type, mediaUrl, status, reactionsJson, createdAt],
        (err) => {
          if (err) return reject(err);
          resolve();
        }
      );
    });
  }
  return {
    id,
    sender,
    recipient,
    text,
    type,
    mediaUrl,
    status,
    reactions: {},
    createdAt
  };
}

export async function getConversation(user1, user2) {
  const u1 = user1.trim().toLowerCase();
  const u2 = user2.trim().toLowerCase();
  const sql = `
    SELECT id, sender_username AS sender, recipient_username AS recipient, text, type, media_url AS "mediaUrl", status, reactions, created_at AS "createdAt"
    FROM messages
    WHERE (LOWER(sender_username) = $1 AND LOWER(recipient_username) = $2)
       OR (LOWER(sender_username) = $3 AND LOWER(recipient_username) = $4)
    ORDER BY created_at ASC
  `;
  if (isPg) {
    const res = await pgPool.query(sql, [u1, u2, u2, u1]);
    return res.rows.map(r => ({
      ...r,
      createdAt: Number(r.createdAt),
      reactions: typeof r.reactions === 'string' ? JSON.parse(r.reactions || '{}') : (r.reactions || {})
    }));
  } else {
    const sqliteSql = sql.replace(/\$[1-4]/g, '?');
    return new Promise((resolve, reject) => {
      sqliteDb.all(sqliteSql, [u1, u2, u2, u1], (err, rows) => {
        if (err) return reject(err);
        resolve((rows || []).map(r => ({
          ...r,
          createdAt: Number(r.createdAt),
          reactions: JSON.parse(r.reactions || '{}')
        })));
      });
    });
  }
}

export async function getUserConversations(username) {
  const u = username.trim().toLowerCase();
  // Get all unique chat partners and their latest message
  const sql = `
    SELECT 
      CASE WHEN LOWER(sender_username) = $1 THEN recipient_username ELSE sender_username END AS partner_username,
      id, sender_username AS sender, text, type, status, created_at AS "createdAt"
    FROM messages
    WHERE LOWER(sender_username) = $1 OR LOWER(recipient_username) = $2
    ORDER BY created_at DESC
  `;

  let rows = [];
  if (isPg) {
    const res = await pgPool.query(sql, [u, u]);
    rows = res.rows;
  } else {
    const sqliteSql = sql.replace(/\$[1-2]/g, '?');
    rows = await new Promise((resolve, reject) => {
      sqliteDb.all(sqliteSql, [u, u], (err, resRows) => {
        if (err) return reject(err);
        resolve(resRows || []);
      });
    });
  }

  // Deduplicate by partner_username keeping the latest
  const partnerMap = new Map();
  for (const row of rows) {
    const p = row.partner_username;
    const pKey = p.toLowerCase();
    if (!partnerMap.has(pKey)) {
      partnerMap.set(pKey, {
        partnerUsername: p,
        lastMessage: {
          id: row.id,
          sender: row.sender,
          text: row.text,
          type: row.type,
          status: row.status,
          createdAt: Number(row.createdAt)
        },
        unreadCount: 0
      });
    }
    // Count unread messages sent to me that are not 'read'
    if (row.partner_username.toLowerCase() === pKey && 
        row.sender.toLowerCase() !== u && 
        row.status !== 'read') {
      const entry = partnerMap.get(pKey);
      entry.unreadCount++;
    }
  }

  // Populate partner accounts info (avatar, about, last_seen)
  const conversationList = Array.from(partnerMap.values());
  for (const conv of conversationList) {
    const partnerAcc = await findUserByUsername(conv.partnerUsername);
    if (partnerAcc) {
      conv.avatarColor = partnerAcc.avatar_color || '#00A884';
      conv.about = partnerAcc.about || 'Hey there! I am using WhatsApp.';
      conv.lastSeen = partnerAcc.last_seen;
    } else {
      conv.avatarColor = '#00A884';
      conv.about = 'Hey there! I am using WhatsApp.';
    }
  }

  return conversationList;
}

export async function markMessagesAsRead(recipientUsername, senderUsername) {
  const rec = recipientUsername.trim().toLowerCase();
  const sen = senderUsername.trim().toLowerCase();

  // Find IDs that are not 'read'
  let unreadIds = [];
  if (isPg) {
    const selectRes = await pgPool.query(
      `SELECT id FROM messages 
       WHERE LOWER(recipient_username) = $1 AND LOWER(sender_username) = $2 AND status != 'read'`,
      [rec, sen]
    );
    unreadIds = selectRes.rows.map(r => r.id);
    if (unreadIds.length > 0) {
      await pgPool.query(
        `UPDATE messages SET status = 'read' WHERE id = ANY($1)`,
        [unreadIds]
      );
    }
  } else {
    unreadIds = await new Promise((resolve, reject) => {
      sqliteDb.all(
        `SELECT id FROM messages 
         WHERE LOWER(recipient_username) = ? AND LOWER(sender_username) = ? AND status != 'read'`,
        [rec, sen],
        (err, rows) => {
          if (err) return reject(err);
          resolve((rows || []).map(r => r.id));
        }
      );
    });

    if (unreadIds.length > 0) {
      const placeholders = unreadIds.map(() => '?').join(',');
      await new Promise((resolve, reject) => {
        sqliteDb.run(
          `UPDATE messages SET status = 'read' WHERE id IN (${placeholders})`,
          unreadIds,
          (err) => {
            if (err) return reject(err);
            resolve();
          }
        );
      });
    }
  }

  return unreadIds;
}

export async function addMessageReaction(messageId, emoji, username) {
  // Read current reactions
  let reactions = {};
  if (isPg) {
    const res = await pgPool.query('SELECT reactions FROM messages WHERE id = $1', [messageId]);
    if (res.rows[0]) {
      reactions = typeof res.rows[0].reactions === 'string' ? JSON.parse(res.rows[0].reactions || '{}') : (res.rows[0].reactions || {});
    }
  } else {
    const row = await new Promise((resolve, reject) => {
      sqliteDb.get('SELECT reactions FROM messages WHERE id = ?', [messageId], (err, r) => {
        if (err) return reject(err);
        resolve(r);
      });
    });
    if (row) {
      reactions = JSON.parse(row.reactions || '{}');
    }
  }

  // Toggle user's reaction
  // If user already reacted with this emoji, remove it; else add it (and remove from other emojis)
  for (const e in reactions) {
    reactions[e] = (reactions[e] || []).filter(u => u.toLowerCase() !== username.toLowerCase());
    if (reactions[e].length === 0) delete reactions[e];
  }

  if (emoji) {
    if (!reactions[emoji]) reactions[emoji] = [];
    reactions[emoji].push(username);
  }

  const reactionsStr = JSON.stringify(reactions);
  if (isPg) {
    await pgPool.query('UPDATE messages SET reactions = $1 WHERE id = $2', [reactionsStr, messageId]);
  } else {
    await new Promise((resolve, reject) => {
      sqliteDb.run('UPDATE messages SET reactions = ? WHERE id = ?', [reactionsStr, messageId], (err) => {
        if (err) return reject(err);
        resolve();
      });
    });
  }

  return reactions;
}
