-- ============================================
-- Migration: Add admin_password column
-- ============================================

ALTER TABLE users 
ADD COLUMN IF NOT EXISTS admin_password VARCHAR(255);

-- Add index for admin queries
CREATE INDEX IF NOT EXISTS idx_users_admin ON users(is_admin, telegram_id);
