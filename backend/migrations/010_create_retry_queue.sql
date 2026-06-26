-- Migration: Create retry_queue table (CV rate-limit buffer)
CREATE TABLE IF NOT EXISTS retry_queue (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  image_url   VARCHAR(500) NOT NULL,
  incident_id UUID         REFERENCES incidents(id),
  attempts    INTEGER NOT NULL DEFAULT 0,
  status      VARCHAR(20)  NOT NULL DEFAULT 'pending'
              CHECK (status IN ('pending','processed','failed')),
  created_at  TIMESTAMP NOT NULL DEFAULT NOW(),
  retry_after TIMESTAMP NOT NULL DEFAULT NOW()
);
