-- =============================================================================
-- HORIZON CHAT v3.2.3 - PRODUCTION POSTGRESQL SCHEMA (NEON OPTIMIZED)
-- =============================================================================

-- 1. USERS TABLE
CREATE TABLE IF NOT EXISTS users (
    id BIGSERIAL PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    is_admin BOOLEAN DEFAULT FALSE,
    is_active BOOLEAN DEFAULT TRUE,
    last_seen TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for rapid username resolution during authentication
CREATE INDEX IF NOT EXISTS idx_users_username ON users(LOWER(username));

-- 2. CHATS TABLE
CREATE TABLE IF NOT EXISTS chats (
    id BIGSERIAL PRIMARY KEY,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. CHAT PARTICIPANTS (CONVERSATION MEMBERSHIP)
CREATE TABLE IF NOT EXISTS chat_participants (
    chat_id BIGINT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (chat_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_chat_participants_user ON chat_participants(user_id);

-- 4. MESSAGES TABLE
CREATE TABLE IF NOT EXISTS messages (
    id BIGSERIAL PRIMARY KEY,
    chat_id BIGINT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    sender_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content TEXT,
    media_url TEXT,
    media_type VARCHAR(20) CHECK (media_type IN ('image', 'video', 'audio', 'document') OR media_type IS NULL),
    is_view_once BOOLEAN DEFAULT FALSE,
    status VARCHAR(20) DEFAULT 'sent' CHECK (status IN ('sent', 'delivered', 'seen')),
    seen_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- High-speed pagination index: Fetch 100 messages descending
CREATE INDEX IF NOT EXISTS idx_messages_chat_created ON messages(chat_id, created_at DESC);

-- Accelerated 24-hour post-seen cleanup index (sparse index)
CREATE INDEX IF NOT EXISTS idx_messages_seen_at ON messages(seen_at) WHERE seen_at IS NOT NULL;

-- 5. REACTIONS TABLE
CREATE TABLE IF NOT EXISTS reactions (
    id BIGSERIAL PRIMARY KEY,
    message_id BIGINT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    emoji VARCHAR(10) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT unique_user_message_reaction UNIQUE (message_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_reactions_message ON reactions(message_id);
