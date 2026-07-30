-- Migration 002: signup_deadline parsed from signup_time (additive only)
-- Run: psql <DB> -f backend/etl/migration_002_signup_deadline.sql
-- Then populate: python backend/etl/run_etl.py --db <DB> --steps normalize

ALTER TABLE positions ADD COLUMN IF NOT EXISTS signup_deadline TIMESTAMP;
CREATE INDEX IF NOT EXISTS idx_pos_signup_deadline ON positions(signup_deadline)
    WHERE signup_deadline IS NOT NULL;
