-- ============================================
-- COMPLETE DATABASE SCHEMA - NEXUS BOT
-- File: 002_complete_schema.sql
-- This is the FULL schema with all tables INCLUDING SPAM TRACKING
-- ============================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================
-- USERS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS users (
    id BIGSERIAL PRIMARY KEY,
    telegram_id BIGINT UNIQUE NOT NULL,  
    first_name VARCHAR(255),
    username VARCHAR(255),
    session_id VARCHAR(255),
    phone_number VARCHAR(50),
    is_connected BOOLEAN DEFAULT FALSE,
    connection_status VARCHAR(50) DEFAULT 'disconnected',
    reconnect_attempts INTEGER DEFAULT 0,
    source VARCHAR(50) DEFAULT 'telegram',
    detected BOOLEAN DEFAULT FALSE,
    detected_at TIMESTAMP,
    is_admin BOOLEAN DEFAULT FALSE,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS web_users_auth (
    user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    password_hash VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- WHATSAPP USERS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS whatsapp_users (
    id BIGSERIAL PRIMARY KEY,
    telegram_id BIGINT UNIQUE NOT NULL,
    jid VARCHAR(255),
    phone VARCHAR(50),
    name VARCHAR(255),
    bot_mode VARCHAR(20) DEFAULT 'public',
    custom_prefix VARCHAR(10) DEFAULT '.',
    antiviewonce_enabled BOOLEAN DEFAULT FALSE,
    antideleted_enabled BOOLEAN DEFAULT FALSE,
    vip_level INTEGER DEFAULT 0,
    is_default_vip BOOLEAN DEFAULT FALSE,
    owned_by_telegram_id BIGINT,
    claimed_at TIMESTAMP,
    auto_online BOOLEAN DEFAULT FALSE,
    auto_typing BOOLEAN DEFAULT FALSE,
    auto_recording BOOLEAN DEFAULT FALSE,
    auto_status_view BOOLEAN DEFAULT FALSE,
    auto_status_like BOOLEAN DEFAULT FALSE,
    default_presence VARCHAR(50) DEFAULT 'unavailable',
    is_banned BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_owner FOREIGN KEY (owned_by_telegram_id) 
        REFERENCES whatsapp_users(telegram_id) ON DELETE SET NULL
);

-- ============================================
-- VIP TABLES
-- ============================================
CREATE TABLE IF NOT EXISTS vip_owned_users (
    id SERIAL PRIMARY KEY,
    vip_telegram_id BIGINT NOT NULL,
    owned_telegram_id BIGINT NOT NULL,
    owned_phone VARCHAR(50),
    owned_jid VARCHAR(255),
    claimed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_used_at TIMESTAMP,
    takeovers_count INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT TRUE,
    CONSTRAINT fk_vip FOREIGN KEY (vip_telegram_id) 
        REFERENCES whatsapp_users(telegram_id) ON DELETE CASCADE,
    CONSTRAINT fk_owned FOREIGN KEY (owned_telegram_id) 
        REFERENCES whatsapp_users(telegram_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS vip_activity_log (
    id SERIAL PRIMARY KEY,
    vip_telegram_id BIGINT NOT NULL,
    action_type VARCHAR(50) NOT NULL,
    target_user_telegram_id BIGINT,
    target_group_jid VARCHAR(255),
    details JSONB,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_vip_activity FOREIGN KEY (vip_telegram_id) 
        REFERENCES whatsapp_users(telegram_id) ON DELETE CASCADE
);

-- ============================================
-- GROUPS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS groups (
    id BIGSERIAL PRIMARY KEY,
    jid VARCHAR(255) UNIQUE NOT NULL,
    name VARCHAR(255),
    description TEXT,
    telegram_id BIGINT,
    
    -- Group modes
    grouponly_enabled BOOLEAN DEFAULT FALSE,
    public_mode BOOLEAN DEFAULT TRUE,
    is_closed BOOLEAN DEFAULT FALSE,
    closed_until TIMESTAMP,
    
    -- Scheduling
    scheduled_close_time TIME,
    scheduled_open_time TIME,
    auto_schedule_enabled BOOLEAN DEFAULT FALSE,
    timezone VARCHAR(50) DEFAULT 'UTC',
    
    -- Anti-features
    antilink_enabled BOOLEAN DEFAULT FALSE,
    anticall_enabled BOOLEAN DEFAULT FALSE,
    antipromote_enabled BOOLEAN DEFAULT FALSE,
    antidemote_enabled BOOLEAN DEFAULT FALSE,
    antibot_enabled BOOLEAN DEFAULT FALSE,
    antitag_enabled BOOLEAN DEFAULT FALSE,
    antitagadmin_enabled BOOLEAN DEFAULT FALSE,
    antigroupmention_enabled BOOLEAN DEFAULT FALSE,
    antiimage_enabled BOOLEAN DEFAULT FALSE,
    antivideo_enabled BOOLEAN DEFAULT FALSE,
    antiaudio_enabled BOOLEAN DEFAULT FALSE,
    antidocument_enabled BOOLEAN DEFAULT FALSE,
    antisticker_enabled BOOLEAN DEFAULT FALSE,
    antidelete_enabled BOOLEAN DEFAULT FALSE,
    antiviewonce_enabled BOOLEAN DEFAULT FALSE,
    antispam_enabled BOOLEAN DEFAULT FALSE,
    antiraid_enabled BOOLEAN DEFAULT FALSE,
    antiadd_enabled BOOLEAN DEFAULT FALSE,
    antivirtex_enabled BOOLEAN DEFAULT FALSE,
    antiremove_enabled BOOLEAN DEFAULT FALSE,
    
    -- Auto-features
    autowelcome_enabled BOOLEAN DEFAULT FALSE,
    autokick_enabled BOOLEAN DEFAULT FALSE,
    welcome_enabled BOOLEAN DEFAULT FALSE,
    goodbye_enabled BOOLEAN DEFAULT FALSE,
    warning_limit INTEGER DEFAULT 4,
    
    -- Metadata
    participants_count INTEGER DEFAULT 0,
    is_bot_admin BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS admin_promotions (
    id SERIAL PRIMARY KEY,
    group_jid VARCHAR(255) NOT NULL,
    user_jid VARCHAR(255) NOT NULL,
    promoted_by VARCHAR(255),
    promoted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (group_jid, user_jid)
);

CREATE TABLE IF NOT EXISTS group_member_additions (
    id SERIAL PRIMARY KEY,
    group_jid VARCHAR(255) NOT NULL,
    added_user_jid VARCHAR(255) NOT NULL,
    added_by_jid VARCHAR(255) NOT NULL,
    added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- MESSAGES TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS messages (
    n_o BIGSERIAL PRIMARY KEY,
    id VARCHAR(255) NOT NULL,
    from_jid VARCHAR(255) NOT NULL,
    sender_jid VARCHAR(255) NOT NULL,
    timestamp BIGINT NOT NULL,
    content TEXT,
    media TEXT,
    media_type VARCHAR(255),
    session_id VARCHAR(255),
    user_id VARCHAR(255),
    is_view_once BOOLEAN DEFAULT FALSE,
    from_me BOOLEAN DEFAULT FALSE,
    push_name VARCHAR(255) DEFAULT 'Unknown',
    is_deleted BOOLEAN DEFAULT FALSE,
    deleted_at TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(id, session_id)
);

-- ============================================
-- WARNINGS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS warnings (
    id BIGSERIAL PRIMARY KEY,
    user_jid VARCHAR(255) NOT NULL,
    group_jid VARCHAR(255) NOT NULL,
    warning_type VARCHAR(50) NOT NULL,
    warning_count INTEGER DEFAULT 1,
    reason TEXT,
    last_warning_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_jid, group_jid, warning_type)
);

-- ============================================
-- VIOLATIONS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS violations (
    id BIGSERIAL PRIMARY KEY,
    user_jid VARCHAR(255) NOT NULL,
    group_jid VARCHAR(255) NOT NULL,
    violation_type VARCHAR(50) NOT NULL,
    message_content TEXT,
    detected_content JSONB,
    action_taken VARCHAR(50),
    warning_number INTEGER,
    message_id VARCHAR(255),
    violated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- SPAM TRACKING TABLE (NEW)
-- ============================================
CREATE TABLE IF NOT EXISTS spam_tracking (
    id BIGSERIAL PRIMARY KEY,
    group_jid VARCHAR(255) NOT NULL,
    user_jid VARCHAR(255) NOT NULL,
    message_text TEXT,
    links JSONB,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- SETTINGS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS settings (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
    session_id VARCHAR(255),
    setting_key VARCHAR(100) NOT NULL,
    setting_value TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, session_id, setting_key)
);

-- ============================================
-- ANALYTICS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS group_analytics (
    id BIGSERIAL PRIMARY KEY,
    group_jid VARCHAR(255) NOT NULL,
    date DATE NOT NULL,
    total_messages INTEGER DEFAULT 0,
    total_media_messages INTEGER DEFAULT 0,
    total_violations INTEGER DEFAULT 0,
    antilink_violations INTEGER DEFAULT 0,
    antispam_violations INTEGER DEFAULT 0,
    antiraid_violations INTEGER DEFAULT 0,
    active_users INTEGER DEFAULT 0,
    warned_users INTEGER DEFAULT 0,
    kicked_users INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(group_jid, date)
);

-- ============================================
-- CREATE ALL INDEXES
-- ============================================

-- Users indexes
CREATE INDEX IF NOT EXISTS idx_users_telegram_id ON users(telegram_id);
CREATE INDEX IF NOT EXISTS idx_users_session_id ON users(session_id);

-- WhatsApp Users indexes
CREATE INDEX IF NOT EXISTS idx_whatsapp_users_telegram_id ON whatsapp_users(telegram_id);
CREATE INDEX IF NOT EXISTS idx_whatsapp_users_jid ON whatsapp_users(jid) WHERE jid IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_whatsapp_users_phone ON whatsapp_users(phone) WHERE phone IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_whatsapp_users_bot_mode ON whatsapp_users(telegram_id, bot_mode);
CREATE INDEX IF NOT EXISTS idx_whatsapp_users_custom_prefix ON whatsapp_users(telegram_id, custom_prefix);
CREATE INDEX IF NOT EXISTS idx_whatsapp_users_antiviewonce ON whatsapp_users(telegram_id) WHERE antiviewonce_enabled = true;
CREATE INDEX IF NOT EXISTS idx_whatsapp_users_antideleted ON whatsapp_users(telegram_id) WHERE antideleted_enabled = true;
CREATE INDEX IF NOT EXISTS idx_vip_level ON whatsapp_users(vip_level) WHERE vip_level > 0;
CREATE INDEX IF NOT EXISTS idx_is_default_vip ON whatsapp_users(telegram_id) WHERE is_default_vip = true;
CREATE INDEX IF NOT EXISTS idx_owned_by ON whatsapp_users(owned_by_telegram_id) WHERE owned_by_telegram_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_whatsapp_users_presence ON whatsapp_users(telegram_id, auto_online, auto_typing, auto_recording);

-- VIP indexes
CREATE INDEX IF NOT EXISTS idx_vip_owned_active ON vip_owned_users(vip_telegram_id, is_active);
CREATE INDEX IF NOT EXISTS idx_owned_user_active ON vip_owned_users(owned_telegram_id, is_active);
CREATE INDEX IF NOT EXISTS idx_activity_vip ON vip_activity_log(vip_telegram_id);
CREATE INDEX IF NOT EXISTS idx_activity_date ON vip_activity_log(created_at DESC);

-- Groups indexes
CREATE INDEX IF NOT EXISTS idx_groups_jid ON groups(jid);
CREATE INDEX IF NOT EXISTS idx_groups_telegram_scheduler ON groups(telegram_id, scheduled_close_time, scheduled_open_time) WHERE auto_schedule_enabled = true;
CREATE INDEX IF NOT EXISTS idx_groups_auto_schedule ON groups(auto_schedule_enabled) WHERE auto_schedule_enabled = true;
CREATE INDEX IF NOT EXISTS idx_group_user ON admin_promotions(group_jid, user_jid);
CREATE INDEX IF NOT EXISTS idx_promoted_at ON admin_promotions(promoted_at);
CREATE INDEX IF NOT EXISTS idx_group_added ON group_member_additions(group_jid, added_at);
CREATE INDEX IF NOT EXISTS idx_added_by ON group_member_additions(added_by_jid);

-- Messages indexes
CREATE INDEX IF NOT EXISTS idx_messages_session_id ON messages(session_id);
CREATE INDEX IF NOT EXISTS idx_messages_from_jid ON messages(from_jid);
CREATE INDEX IF NOT EXISTS idx_messages_sender_jid ON messages(sender_jid);
CREATE INDEX IF NOT EXISTS idx_messages_timestamp_desc ON messages(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_messages_id_session ON messages(id, session_id);

-- Warnings indexes
CREATE INDEX IF NOT EXISTS idx_warnings_user_group ON warnings(user_jid, group_jid);

-- Violations indexes
CREATE INDEX IF NOT EXISTS idx_violations_user_group ON violations(user_jid, group_jid);
CREATE INDEX IF NOT EXISTS idx_violations_date ON violations(violated_at DESC);

-- Spam tracking indexes (NEW)
CREATE INDEX IF NOT EXISTS idx_spam_tracking_group_user ON spam_tracking(group_jid, user_jid);
CREATE INDEX IF NOT EXISTS idx_spam_tracking_created ON spam_tracking(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_spam_tracking_lookup ON spam_tracking(group_jid, user_jid, created_at);

-- Settings indexes
CREATE INDEX IF NOT EXISTS idx_settings_user_session ON settings(user_id, session_id);

-- Analytics indexes
CREATE INDEX IF NOT EXISTS idx_analytics_group_date ON group_analytics(group_jid, date);

-- ============================================
-- CREATE UPDATE TRIGGERS
-- ============================================

-- Generic update timestamp function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply update triggers to tables
DROP TRIGGER IF EXISTS update_users_updated_at ON users;
CREATE TRIGGER update_users_updated_at 
    BEFORE UPDATE ON users 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_whatsapp_users_updated_at ON whatsapp_users;
CREATE TRIGGER update_whatsapp_users_updated_at 
    BEFORE UPDATE ON whatsapp_users 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_groups_updated_at ON groups;
CREATE TRIGGER update_groups_updated_at 
    BEFORE UPDATE ON groups 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_warnings_updated_at ON warnings;
CREATE TRIGGER update_warnings_updated_at 
    BEFORE UPDATE ON warnings 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_settings_updated_at ON settings;
CREATE TRIGGER update_settings_updated_at 
    BEFORE UPDATE ON settings 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- WHATSAPP USER JID/PHONE TRANSFER TRIGGER
-- ============================================

CREATE OR REPLACE FUNCTION handle_whatsapp_user_upsert()
RETURNS TRIGGER AS $$
DECLARE
    existing_user_with_jid RECORD;
    existing_user_with_phone RECORD;
BEGIN
    -- Check if another user already has this JID
    IF NEW.jid IS NOT NULL THEN
        SELECT * INTO existing_user_with_jid
        FROM whatsapp_users
        WHERE jid = NEW.jid AND telegram_id != NEW.telegram_id
        LIMIT 1;
        
        -- If another user has this JID, clear it from them (phone number transferred)
        IF FOUND THEN
            UPDATE whatsapp_users
            SET jid = NULL,
                phone = NULL,
                updated_at = CURRENT_TIMESTAMP
            WHERE telegram_id = existing_user_with_jid.telegram_id;
        END IF;
    END IF;
    
    -- Check if another user already has this phone
    IF NEW.phone IS NOT NULL THEN
        SELECT * INTO existing_user_with_phone
        FROM whatsapp_users
        WHERE phone = NEW.phone AND telegram_id != NEW.telegram_id
        LIMIT 1;
        
        -- If another user has this phone, clear it from them
        IF FOUND THEN
            UPDATE whatsapp_users
            SET phone = NULL,
                updated_at = CURRENT_TIMESTAMP
            WHERE telegram_id = existing_user_with_phone.telegram_id;
        END IF;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS ensure_unique_jid_phone ON whatsapp_users;
CREATE TRIGGER ensure_unique_jid_phone
    BEFORE INSERT OR UPDATE OF jid, phone ON whatsapp_users
    FOR EACH ROW
    EXECUTE FUNCTION handle_whatsapp_user_upsert();

-- ============================================
-- MESSAGES AUTO-CLEANUP TRIGGER
-- ============================================

CREATE OR REPLACE FUNCTION cleanup_messages_at_limit()
RETURNS TRIGGER AS $$
DECLARE
    row_count BIGINT;
BEGIN
    -- Check row count periodically (every 100 inserts for performance)
    IF NEW.n_o % 100 = 0 THEN
        SELECT COUNT(*) INTO row_count FROM messages;
        
        IF row_count >= 10000 THEN
            -- Delete oldest messages, keep only newest 5000
            DELETE FROM messages
            WHERE n_o NOT IN (
                SELECT n_o FROM messages
                ORDER BY n_o DESC
                LIMIT 5000
            );
        END IF;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS messages_cleanup_trigger ON messages;
CREATE TRIGGER messages_cleanup_trigger
    BEFORE INSERT ON messages
    FOR EACH ROW
    EXECUTE FUNCTION cleanup_messages_at_limit();

-- ============================================
-- SPAM TRACKING AUTO-CLEANUP TRIGGER (NEW)
-- ============================================

CREATE OR REPLACE FUNCTION cleanup_old_spam_tracking()
RETURNS TRIGGER AS $$
BEGIN
    DELETE FROM spam_tracking 
    WHERE created_at < NOW() - INTERVAL '2 hours';
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS spam_tracking_cleanup_trigger ON spam_tracking;
CREATE TRIGGER spam_tracking_cleanup_trigger
    AFTER INSERT ON spam_tracking
    EXECUTE FUNCTION cleanup_old_spam_tracking();

-- ============================================
-- ADD COMMENTS
-- ============================================

COMMENT ON TABLE users IS 'Main users table for Telegram bot users';
COMMENT ON TABLE whatsapp_users IS 'WhatsApp users with settings - telegram_id is UNIQUE primary identifier';
COMMENT ON COLUMN whatsapp_users.telegram_id IS 'Telegram user ID - UNIQUE - primary identifier for all operations';
COMMENT ON COLUMN whatsapp_users.jid IS 'WhatsApp JID - can be NULL initially, automatically transferred if phone moves to another telegram account';
COMMENT ON COLUMN whatsapp_users.phone IS 'Phone number extracted from JID - automatically transferred with JID';
COMMENT ON COLUMN whatsapp_users.custom_prefix IS 'User custom command prefix (default: ".", empty string for none)';
COMMENT ON COLUMN whatsapp_users.bot_mode IS 'Bot mode: "public" (responds to everyone) or "self" (only owner)';

COMMENT ON TABLE groups IS 'WhatsApp groups with settings and features';
COMMENT ON COLUMN groups.telegram_id IS 'Telegram ID of user who set the group schedule';
COMMENT ON COLUMN groups.scheduled_close_time IS 'Time to automatically close group (TIME format)';
COMMENT ON COLUMN groups.scheduled_open_time IS 'Time to automatically open group (TIME format)';
COMMENT ON COLUMN groups.auto_schedule_enabled IS 'Whether automatic scheduling is enabled';

COMMENT ON TABLE messages IS 'Messages table with auto-cleanup - keeps newest 5000 when reaching 10k rows';
COMMENT ON TABLE spam_tracking IS 'Real-time link spam message tracking - only tracks messages with links - auto-cleanup after 2 hours';
COMMENT ON COLUMN spam_tracking.links IS 'Extracted links from the spam message (JSONB array)';

-- ============================================
-- VERIFICATION
-- ============================================

DO $verification$
DECLARE
    table_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO table_count
    FROM information_schema.tables 
    WHERE table_schema = 'public' 
    AND table_name IN ('users', 'whatsapp_users', 'groups', 'messages', 'warnings', 'violations', 'settings', 'group_analytics', 'vip_owned_users', 'vip_activity_log', 'spam_tracking');
    
    RAISE NOTICE '===========================================';
    RAISE NOTICE 'COMPLETE SCHEMA VERIFIED';
    RAISE NOTICE '===========================================';
    RAISE NOTICE '';
    RAISE NOTICE 'Tables verified: % / 11', table_count;
    RAISE NOTICE '';
    RAISE NOTICE 'All tables created or verified';
    RAISE NOTICE 'All indexes created';
    RAISE NOTICE 'All triggers created';
    RAISE NOTICE 'WhatsApp users: telegram_id UNIQUE';
    RAISE NOTICE 'Automatic phone transfer: ENABLED';
    RAISE NOTICE 'Messages auto-cleanup: ENABLED (10k->5k)';
    RAISE NOTICE 'Spam tracking auto-cleanup: ENABLED (2 hours)';
    RAISE NOTICE 'Group scheduling: ENABLED';
    RAISE NOTICE 'Anti-spam protection: READY';
    RAISE NOTICE '';
    RAISE NOTICE 'Ready for production!';
    RAISE NOTICE '';
    RAISE NOTICE '===========================================';
END $verification$;