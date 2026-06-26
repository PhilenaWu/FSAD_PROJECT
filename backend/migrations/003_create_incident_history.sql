-- Migration: Create incident_history table (audit log)
CREATE TABLE IF NOT EXISTS incident_history (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id     UUID NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  actor_id        UUID NOT NULL REFERENCES users(id),
  action          VARCHAR(50) NOT NULL,          -- 'Assigned','Reassigned','Priority Escalated','Closed','Force-Closed'
  previous_status VARCHAR(30),
  new_status      VARCHAR(30),
  note            TEXT,
  created_at      TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_incident_history_incident_id ON incident_history(incident_id);
