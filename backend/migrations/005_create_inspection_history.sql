-- Migration: Create inspection_history table (audit log)
CREATE TABLE IF NOT EXISTS inspection_history (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inspection_id   UUID NOT NULL REFERENCES inspections(id) ON DELETE CASCADE,
  actor_id        UUID NOT NULL REFERENCES users(id),
  action          VARCHAR(50) NOT NULL,          -- 'Assigned','Reassigned','Priority Escalated','Closed','Force-Closed'
  previous_status VARCHAR(30),
  new_status      VARCHAR(30),
  note            TEXT,
  created_at      TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_inspection_history_inspection_id ON inspection_history(inspection_id);
