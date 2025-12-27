-- ============================================
-- COMPLETE DATABASE SCHEMA - NEXUS BOT
-- Normalized with Separate Warning Settings Table
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
-- GROUPS TABLE - Simplified Core Settings
-- ============================================
CREATE TABLE IF NOT EXISTS groups (
    id BIGSERIAL PRIMARY KEY,
    jid VARCHAR(255) UNIQUE NOT NULL,
    name VARCHAR(255),
    description TEXT,
    telegram_id BIGINT,
    
    -- Core modes
    grouponly_enabled BOOLEAN DEFAULT FALSE,
    public_mode BOOLEAN DEFAULT TRUE,
    is_closed BOOLEAN DEFAULT FALSE,
    closed_until TIMESTAMP,
    
    -- Scheduling
    scheduled_close_time TIME,
    scheduled_open_time TIME,
    auto_schedule_enabled BOOLEAN DEFAULT FALSE,
    timezone VARCHAR(50) DEFAULT 'UTC',
    
    -- Anti-features enabled/disabled flags
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
    tag_limit INTEGER DEFAULT 5,
    
    -- Metadata
    participants_count INTEGER DEFAULT 0,
    is_bot_admin BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- GROUP WARNING SETTINGS - Separate Table
-- ============================================
CREATE TABLE IF NOT EXISTS group_warning_settings (
    id BIGSERIAL PRIMARY KEY,
    group_jid VARCHAR(255) NOT NULL,
    group_name VARCHAR(255),
    
    -- Per-command warning limits (0 = instant kick, 1-10 = warnings before kick)
    antilink_warning_limit INTEGER DEFAULT 4,
    antispam_warning_limit INTEGER DEFAULT 0,
    antiremove_warning_limit INTEGER DEFAULT 2,
    antivirtex_warning_limit INTEGER DEFAULT 1,
    antitag_warning_limit INTEGER DEFAULT 4,
    antitagadmin_warning_limit INTEGER DEFAULT 3,
    antigroupmention_warning_limit INTEGER DEFAULT 3,
    antiimage_warning_limit INTEGER DEFAULT 5,
    antivideo_warning_limit INTEGER DEFAULT 5,
    antiaudio_warning_limit INTEGER DEFAULT 5,
    antidocument_warning_limit INTEGER DEFAULT 5,
    antisticker_warning_limit INTEGER DEFAULT 6,
    antidelete_warning_limit INTEGER DEFAULT 3,
    antiviewonce_warning_limit INTEGER DEFAULT 3,
    antiraid_warning_limit INTEGER DEFAULT 0,
    antibot_warning_limit INTEGER DEFAULT 0,
    antipromote_warning_limit INTEGER DEFAULT 2,
    antidemote_warning_limit INTEGER DEFAULT 2,
    anticall_warning_limit INTEGER DEFAULT 2,
    antiadd_warning_limit INTEGER DEFAULT 2,
    
    -- Manual warning limit (for .warn command)
    manual_warning_limit INTEGER DEFAULT 4,
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    UNIQUE(group_jid),
    FOREIGN KEY (group_jid) REFERENCES groups(jid) ON DELETE CASCADE
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
-- GROUP ACTIVITY TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS group_activity (
    id BIGSERIAL PRIMARY KEY,
    group_jid VARCHAR(255) UNIQUE NOT NULL,
    group_name VARCHAR(255),
    activity_data JSONB DEFAULT '{}'::jsonb,
    total_members INTEGER DEFAULT 0,
    active_members_7d INTEGER DEFAULT 0,
    last_message_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (group_jid) REFERENCES groups(jid) ON DELETE CASCADE
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
CREATE INDEX IF NOT EXISTS idx_vip_level ON whatsapp_users(vip_level) WHERE vip_level > 0;
CREATE INDEX IF NOT EXISTS idx_is_default_vip ON whatsapp_users(telegram_id) WHERE is_default_vip = true;

-- VIP indexes
CREATE INDEX IF NOT EXISTS idx_vip_owned_active ON vip_owned_users(vip_telegram_id, is_active);
CREATE INDEX IF NOT EXISTS idx_owned_user_active ON vip_owned_users(owned_telegram_id, is_active);

-- Groups indexes
CREATE INDEX IF NOT EXISTS idx_groups_jid ON groups(jid);
CREATE INDEX IF NOT EXISTS idx_group_user ON admin_promotions(group_jid, user_jid);

-- Warning Settings indexes
CREATE INDEX IF NOT EXISTS idx_warning_settings_group_jid ON group_warning_settings(group_jid);

-- Activity indexes
CREATE INDEX IF NOT EXISTS idx_group_activity_jid ON group_activity(group_jid);
CREATE INDEX IF NOT EXISTS idx_group_activity_data ON group_activity USING gin(activity_data);

-- Messages indexes
CREATE INDEX IF NOT EXISTS idx_messages_session_id ON messages(session_id);
CREATE INDEX IF NOT EXISTS idx_messages_from_jid ON messages(from_jid);
CREATE INDEX IF NOT EXISTS idx_messages_timestamp_desc ON messages(timestamp DESC);

-- Warnings indexes
CREATE INDEX IF NOT EXISTS idx_warnings_user_group ON warnings(user_jid, group_jid);

-- Violations indexes
CREATE INDEX IF NOT EXISTS idx_violations_user_group ON violations(user_jid, group_jid);
CREATE INDEX IF NOT EXISTS idx_violations_date ON violations(violated_at DESC);

-- Analytics indexes
CREATE INDEX IF NOT EXISTS idx_analytics_group_date ON group_analytics(group_jid, date);

-- ============================================
-- CREATE UPDATE TRIGGERS
-- ============================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_users_updated_at ON users;
CREATE TRIGGER update_users_updated_at 
    BEFORE UPDATE ON users FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_whatsapp_users_updated_at ON whatsapp_users;
CREATE TRIGGER update_whatsapp_users_updated_at 
    BEFORE UPDATE ON whatsapp_users FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_groups_updated_at ON groups;
CREATE TRIGGER update_groups_updated_at 
    BEFORE UPDATE ON groups FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_warning_settings_updated_at ON group_warning_settings;
CREATE TRIGGER update_warning_settings_updated_at 
    BEFORE UPDATE ON group_warning_settings FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_warnings_updated_at ON warnings;
CREATE TRIGGER update_warnings_updated_at 
    BEFORE UPDATE ON warnings FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- AUTO-CREATE WARNING SETTINGS TRIGGER
-- ============================================

CREATE OR REPLACE FUNCTION create_warning_settings_for_group()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO group_warning_settings (group_jid, group_name)
    VALUES (NEW.jid, NEW.name)
    ON CONFLICT (group_jid) DO NOTHING;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS auto_create_warning_settings ON groups;
CREATE TRIGGER auto_create_warning_settings
    AFTER INSERT ON groups
    FOR EACH ROW
    EXECUTE FUNCTION create_warning_settings_for_group();

-- ============================================
-- VERIFICATION
-- ============================================

DO $$
BEGIN
    RAISE NOTICE '===========================================';
    RAISE NOTICE 'NORMALIZED SCHEMA WITH SEPARATE WARNING SETTINGS';
    RAISE NOTICE '===========================================';
    RAISE NOTICE 'Groups table: Simplified (core settings only)';
    RAISE NOTICE 'Warning settings: Separate table (normalized)';
    RAISE NOTICE 'Auto-creation: Enabled via trigger';
    RAISE NOTICE 'Ready for production!';
    RAISE NOTICE '===========================================';
END $$;