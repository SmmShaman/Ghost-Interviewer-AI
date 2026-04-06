-- Migration: 001_initial_schema
-- Description: Initial database schema for Ghost Interviewer AI
-- Creates: devices, candidate_profiles, job_profiles, settings, interview_sessions

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Device/session identification (no auth for now)
CREATE TABLE devices (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    device_token VARCHAR(64) UNIQUE NOT NULL,
    name VARCHAR(255),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    last_seen_at TIMESTAMPTZ DEFAULT NOW()
);

-- Candidate profiles (static: resume + knowledge)
CREATE TABLE candidate_profiles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    device_id UUID REFERENCES devices(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    resume TEXT DEFAULT '',
    knowledge_base TEXT DEFAULT '',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Job profiles (dynamic: per application)
CREATE TABLE job_profiles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    device_id UUID REFERENCES devices(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    company_description TEXT DEFAULT '',
    job_description TEXT DEFAULT '',
    application_letter TEXT DEFAULT '',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- User settings (language, UI, AI config)
CREATE TABLE settings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    device_id UUID UNIQUE REFERENCES devices(id) ON DELETE CASCADE,
    target_language VARCHAR(50) DEFAULT 'Norwegian',
    native_language VARCHAR(50) DEFAULT 'Ukrainian',
    proficiency_level VARCHAR(10) DEFAULT 'B1',
    tone VARCHAR(20) DEFAULT 'Professional',
    system_instruction TEXT DEFAULT '',
    stereo_mode BOOLEAN DEFAULT FALSE,
    view_mode VARCHAR(10) DEFAULT 'FOCUS',
    ghost_model VARCHAR(10) DEFAULT 'opus',
    mode_config JSONB DEFAULT '{}',
    active_candidate_profile_id UUID,
    active_job_profile_id UUID,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Interview sessions (history)
CREATE TABLE interview_sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    device_id UUID REFERENCES devices(id) ON DELETE CASCADE,
    candidate_profile_id UUID REFERENCES candidate_profiles(id),
    job_profile_id UUID REFERENCES job_profiles(id),
    started_at TIMESTAMPTZ DEFAULT NOW(),
    ended_at TIMESTAMPTZ,
    view_mode VARCHAR(10),
    messages JSONB DEFAULT '[]'
);

-- Indexes
CREATE INDEX idx_candidate_profiles_device ON candidate_profiles(device_id);
CREATE INDEX idx_job_profiles_device ON job_profiles(device_id);
CREATE INDEX idx_sessions_device ON interview_sessions(device_id);
CREATE INDEX idx_devices_token ON devices(device_token);
