-- Migration: Create lifts table (physical lift assets)
CREATE TABLE IF NOT EXISTS lifts (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  block_number     VARCHAR(20)  NOT NULL,
  lift_code        VARCHAR(20)  NOT NULL,        -- e.g. "44A-L1"
  brand            VARCHAR(100) NOT NULL,        -- e.g. Otis, Schindler, KONE
  contractor_id    UUID         REFERENCES contractors(id),  -- responsible LC
  bca_cert_expiry  DATE,                         -- for the BCA expiry tracker quick-win
  created_at       TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (block_number, lift_code)
);
CREATE INDEX IF NOT EXISTS idx_lifts_contractor ON lifts(contractor_id);
