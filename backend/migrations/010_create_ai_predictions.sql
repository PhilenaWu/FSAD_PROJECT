-- Migration: Create ai_predictions table
CREATE TABLE IF NOT EXISTS ai_predictions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  location_block VARCHAR(20) NOT NULL,
  category      VARCHAR(50)  NOT NULL,
  velocity_pct  NUMERIC(8,2) NOT NULL,
  -- UC-006 projected cost impact: avg actual_cost of past closed records of the
  -- same category × predicted occurrences next period. Nullable (no cost history).
  estimated_cost NUMERIC(10,2),
  alert_text    TEXT         NOT NULL,
  status        VARCHAR(20)  NOT NULL DEFAULT 'Active'
                CHECK (status IN ('Active','Accepted','Dismissed')),
  dismissed_by  UUID         REFERENCES users(id),
  dismissed_at  TIMESTAMP,
  created_at    TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Non-breaking add for databases where this migration already ran without the
-- column above. Idempotent, so a re-run of the migration is safe either way.
ALTER TABLE ai_predictions ADD COLUMN IF NOT EXISTS estimated_cost NUMERIC(10,2);

CREATE INDEX IF NOT EXISTS idx_ai_predictions_status ON ai_predictions(status);
