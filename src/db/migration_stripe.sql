-- =============================================
-- MIGRATION: Add Stripe Connect Support
-- =============================================
-- Run via: npm run db:migrate
-- Safe to re-run (all statements are idempotent)
--
-- NOTE: If starting from scratch, run db:init instead.
--       This migration is only needed for existing databases
--       that used the old schema.

-- -----------------------------------------------
-- 1. Make users.email nullable (was NOT NULL in old schema)
-- -----------------------------------------------
ALTER TABLE users
  ALTER COLUMN email DROP NOT NULL;

-- -----------------------------------------------
-- 2. Add stripe_account_id to users
-- -----------------------------------------------
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS stripe_account_id TEXT;

-- -----------------------------------------------
-- 3. Add link_entrega to configs
-- -----------------------------------------------
ALTER TABLE configs
  ADD COLUMN IF NOT EXISTS link_entrega TEXT;

-- -----------------------------------------------
-- 4. Create payments table
-- -----------------------------------------------
CREATE TABLE IF NOT EXISTS payments (
    id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    bot_id            UUID NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
    telegram_id       TEXT NOT NULL,
    stripe_session_id TEXT NOT NULL UNIQUE,
    amount_cents      INTEGER,
    currency          TEXT DEFAULT 'brl',
    status            VARCHAR(20) NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'completed', 'failed')),
    created_at        TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    completed_at      TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_payments_bot_id      ON payments(bot_id);
CREATE INDEX IF NOT EXISTS idx_payments_telegram_id ON payments(telegram_id);
CREATE INDEX IF NOT EXISTS idx_payments_session_id  ON payments(stripe_session_id);
