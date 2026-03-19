-- =============================================
-- TELEGRAM SAAS BACKEND - Initial Database Schema
-- =============================================
-- Run this script once to initialize all tables.
-- Compatible with PostgreSQL 14+

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- -----------------------------------------------
-- TABLE: users
-- -----------------------------------------------
CREATE TABLE IF NOT EXISTS users (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email       VARCHAR(255) NOT NULL UNIQUE,
    created_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- -----------------------------------------------
-- TABLE: bots
-- -----------------------------------------------
CREATE TABLE IF NOT EXISTS bots (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    bot_token   TEXT NOT NULL,
    status      VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
    created_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index to speed up lookups by user
CREATE INDEX IF NOT EXISTS idx_bots_user_id ON bots(user_id);

-- -----------------------------------------------
-- TABLE: configs
-- -----------------------------------------------
CREATE TABLE IF NOT EXISTS configs (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    bot_id          UUID NOT NULL UNIQUE REFERENCES bots(id) ON DELETE CASCADE,
    produto         TEXT,
    preco           TEXT,
    tom             TEXT DEFAULT 'amigável e profissional',
    link_pagamento  TEXT,
    updated_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index for bot_id lookups
CREATE INDEX IF NOT EXISTS idx_configs_bot_id ON configs(bot_id);
