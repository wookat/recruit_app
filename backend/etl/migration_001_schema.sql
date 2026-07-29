-- Migration 001: add normalization / dedup columns (additive only, reversible)
-- Run: psql <DB> -f backend/etl/migration_001_schema.sql

ALTER TABLE positions ADD COLUMN IF NOT EXISTS content_hash_v2 VARCHAR(32);
ALTER TABLE positions ADD COLUMN IF NOT EXISTS dup_of_id INTEGER;
ALTER TABLE positions ADD COLUMN IF NOT EXISTS exam_type_norm VARCHAR(50);
ALTER TABLE positions ADD COLUMN IF NOT EXISTS province VARCHAR(30);
ALTER TABLE positions ADD COLUMN IF NOT EXISTS city VARCHAR(50);
ALTER TABLE positions ADD COLUMN IF NOT EXISTS district VARCHAR(50);
ALTER TABLE positions ADD COLUMN IF NOT EXISTS college_major TEXT;
ALTER TABLE positions ADD COLUMN IF NOT EXISTS invalid_reason VARCHAR(50);

CREATE INDEX IF NOT EXISTS idx_pos_hash_v2 ON positions(content_hash_v2);
CREATE INDEX IF NOT EXISTS idx_pos_dup_of ON positions(dup_of_id) WHERE dup_of_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pos_exam_type_norm ON positions(exam_type_norm);
CREATE INDEX IF NOT EXISTS idx_pos_province ON positions(province);
CREATE INDEX IF NOT EXISTS idx_pos_city ON positions(city);

-- Clean view: excludes duplicates and invalid rows without deleting anything
CREATE OR REPLACE VIEW positions_clean AS
SELECT * FROM positions
WHERE dup_of_id IS NULL AND invalid_reason IS NULL;
