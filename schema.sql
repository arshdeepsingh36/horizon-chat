-- Horizon Chat (Native Android Cloud-Synced Messenger)
-- PostgreSQL Production Schema Migration

-- 1. Accounts Table (Minimalist Auth; zero phone/email collection)
CREATE TABLE IF NOT EXISTS accounts (
    id SERIAL PRIMARY KEY,
    username VARCHAR(32) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_accounts_username ON accounts(username);

-- 2. Messages Table (Telegram-style permanent cloud record)
CREATE TABLE IF NOT EXISTS messages (
    id BIGSERIAL PRIMARY KEY,
    sender_id INT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    recipient_id INT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    message_text TEXT,
    attachment_type VARCHAR(20) DEFAULT 'NONE', -- 'NONE', 'IMAGE', 'FILE', 'AUDIO'
    attachment_url TEXT,
    thumbnail_blur TEXT,                        -- Base64 micro-preview (~200 bytes)
    file_size_bytes BIGINT DEFAULT 0,
    status VARCHAR(16) DEFAULT 'SENT',          -- 'SENT', 'DELIVERED', 'READ'
    reply_to_id BIGINT REFERENCES messages(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Compound index for rapid reverse-chronological cursor queries
CREATE INDEX IF NOT EXISTS idx_messages_pair_cursor 
ON messages(sender_id, recipient_id, id DESC);
