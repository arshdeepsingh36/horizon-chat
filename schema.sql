-- Horizon Chat (Native Android Cloud-Synced Messenger)
-- PostgreSQL Production Schema Migration

-- 1. Accounts Table (Minimalist Auth; zero phone/email collection)
CREATE TABLE IF NOT EXISTS accounts (
    id SERIAL PRIMARY KEY,
    username VARCHAR(32) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    avatar_url TEXT,
    display_name TEXT,
    bio_status TEXT DEFAULT 'Hey there! I am using Horizon Chat.',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_accounts_username ON accounts(username);

-- 2. Messages Table (Telegram-style permanent cloud record)
CREATE TABLE IF NOT EXISTS messages (
    id BIGSERIAL PRIMARY KEY,
    sender_id INT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    recipient_id INT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    message_text TEXT,
    attachment_type VARCHAR(20) DEFAULT 'NONE', -- 'NONE', 'IMAGE', 'VIDEO', 'AUDIO', 'LOCATION', 'DOCUMENT'
    attachment_url TEXT,
    thumbnail_blur TEXT,                        -- Base64 micro-preview (~200 bytes)
    file_size_bytes BIGINT DEFAULT 0,
    status VARCHAR(16) DEFAULT 'SENT',          -- 'SENT', 'DELIVERED', 'READ'
    is_view_once BOOLEAN DEFAULT FALSE,
    is_viewed BOOLEAN DEFAULT FALSE,
    reply_to_id BIGINT REFERENCES messages(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Compound index for rapid reverse-chronological cursor queries
CREATE INDEX IF NOT EXISTS idx_messages_pair_cursor 
ON messages(sender_id, recipient_id, id DESC);

-- Safe migrations for existing deployments
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS avatar_url TEXT;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS display_name TEXT;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS bio_status TEXT DEFAULT 'Hey there! I am using Horizon Chat.';
ALTER TABLE messages ADD COLUMN IF NOT EXISTS is_view_once BOOLEAN DEFAULT FALSE;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS is_viewed BOOLEAN DEFAULT FALSE;

