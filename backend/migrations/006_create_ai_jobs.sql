-- Migration: Create ai_jobs table (recurrence trigger queue)
CREATE TABLE IF NOT EXISTS ai_jobs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  location_block  VARCHAR(20) NOT NULL,
  category        VARCHAR(50) NOT NULL,
  triggered_by    UUID NOT NULL REFERENCES incidents(id),
  status          VARCHAR(20) NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','processed','failed')),
  created_at      TIMESTAMP NOT NULL DEFAULT NOW()
);
