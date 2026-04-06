-- Migration: 002_google_auth
-- Description: Replace device token auth with Google OAuth
-- Creates: users table, adds user_id to existing tables

-- Users table (Google OAuth)
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    google_id VARCHAR(255) UNIQUE NOT NULL,
    email VARCHAR(255) NOT NULL,
    name VARCHAR(255),
    picture VARCHAR(500),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    last_login_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add user_id columns to existing tables
ALTER TABLE candidate_profiles ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE job_profiles ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS user_id UUID;
ALTER TABLE interview_sessions ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE CASCADE;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_users_google_id ON users(google_id);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_candidate_profiles_user ON candidate_profiles(user_id);
CREATE INDEX IF NOT EXISTS idx_job_profiles_user ON job_profiles(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON interview_sessions(user_id);

-- Unique constraint on settings per user (use DO block since ADD CONSTRAINT IF NOT EXISTS is PG 17+)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'settings_user_unique'
    ) THEN
        ALTER TABLE settings ADD CONSTRAINT settings_user_unique UNIQUE (user_id);
    END IF;
END$$;
