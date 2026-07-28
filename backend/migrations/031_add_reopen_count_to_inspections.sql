-- Migration: Add inspections.reopen_count for the UC-004 rejection loop.
--
-- Incremented each time a manager rejects a contractor's rectification
-- (POST /api/inspections/:id/reject), so a record that bounces repeatedly is
-- visible to the manager and to the contractor scorecard.
--
-- analyticsController already reads this column behind a runtime
-- hasReopenCount() probe and renders "—" while it is absent; adding it here
-- lights up the scorecard's average-reopens column with no code change.
ALTER TABLE inspections
  ADD COLUMN IF NOT EXISTS reopen_count INTEGER NOT NULL DEFAULT 0;
