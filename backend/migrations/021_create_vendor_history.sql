-- Migration: UC-012 vendor audit trail. Every lifecycle action on a vendor
-- (onboarded, renewed, suspended, auto-suspended, details updated) is recorded
-- with the acting admin. actor_id is NULL for system actions (daily expiry job).
CREATE TABLE IF NOT EXISTS vendor_history (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contractor_id UUID NOT NULL REFERENCES contractors(id) ON DELETE CASCADE,
  actor_id      UUID REFERENCES users(id),
  action        VARCHAR(50) NOT NULL,
  note          TEXT,
  created_at    TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_vendor_history_contractor ON vendor_history(contractor_id);
