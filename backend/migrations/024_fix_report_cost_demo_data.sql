-- Migration: make UC-009 report costs non-zero on the demo dataset.
-- The seeded ai_predictions were inserted without estimated_cost (NULL), so the
-- projected-cost side of the report summed to $0.
--
-- This file also used to flip the seeded Closed records to is_deleted = FALSE,
-- to work around the report's `status = 'Closed' AND is_deleted = FALSE` filter
-- excluding every costed record. That was the wrong layer: is_deleted is TRUE on
-- every Closed record by design, so un-deleting them broke the invariant and
-- leaked closed demo records into the manager triage queue. The filter itself is
-- fixed in reportModel/adminController instead, and migration 033 restores the
-- rows this file had modified.
-- Idempotent: safe to re-run.
DO $$
BEGIN
  -- Backfill estimated_cost on Active predictions that lack it, using the
  -- average actual_cost of Closed records in the same category (mirrors
  -- recommendationController.estimateCost). Falls back to the estate-wide
  -- average when a category has no closed cost history yet. Correlated
  -- subqueries so the target row (p) is referenced legally.
  UPDATE ai_predictions p
     SET estimated_cost = COALESCE(
       (SELECT ROUND(AVG(actual_cost), 2)
          FROM inspections
         WHERE status = 'Closed' AND actual_cost IS NOT NULL
           AND category = p.category),
       (SELECT ROUND(AVG(actual_cost), 2)
          FROM inspections
         WHERE status = 'Closed' AND actual_cost IS NOT NULL)
     )
   WHERE p.status = 'Active'
     AND p.estimated_cost IS NULL;
END $$;
