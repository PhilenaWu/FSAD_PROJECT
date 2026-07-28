-- Migration: apply the HLD 14-day rectification rule by default.
-- Any inspection created without an explicit target_deadline (resident
-- complaint, lift inspection, CV auto-detected) now gets NOW() + 14 days, so
-- every intake form gets a deadline without each controller repeating the rule.
ALTER TABLE inspections
  ALTER COLUMN target_deadline SET DEFAULT (NOW() + INTERVAL '14 days');

-- Backfill records that predate this rule and are still in play; closed and
-- resolved work is left as-is so historical SLA reporting is unchanged.
UPDATE inspections
   SET target_deadline = created_at + INTERVAL '14 days'
 WHERE target_deadline IS NULL
   AND status NOT IN ('Rectified', 'Resolved', 'Closed');
