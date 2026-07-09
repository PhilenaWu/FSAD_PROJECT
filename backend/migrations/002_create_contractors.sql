-- Migration: Create contractors table (lift maintenance companies)
CREATE TABLE IF NOT EXISTS contractors (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name             VARCHAR(255) NOT NULL,
  brands_serviced  TEXT,                         -- comma-separated brands
  contact_email    VARCHAR(255) NOT NULL,        -- for Nodemailer defect alerts
  user_id          UUID         REFERENCES users(id),  -- linked login account
  created_at       TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Deferred foreign key from users (001) — contractors did not exist yet when
-- that table was created. Guarded so re-runs do not error.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_users_contractor'
  ) THEN
    ALTER TABLE users
      ADD CONSTRAINT fk_users_contractor
      FOREIGN KEY (contractor_id) REFERENCES contractors(id);
  END IF;
END $$;
