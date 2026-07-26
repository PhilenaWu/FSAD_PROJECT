-- Migration: make UC-009 report costs non-zero on the demo dataset.
-- Two demo-data artifacts left the monthly report's cost figures at $0:
--   1. The seeded Closed records (the only rows carrying actual_cost) were all
--      inserted with is_deleted = TRUE, so the report's is_deleted = FALSE
--      filter excluded every costed record.
--   2. The seeded ai_predictions were inserted without estimated_cost (NULL),
--      so the projected-cost side summed to $0.
-- Idempotent: safe to re-run.
DO $$
BEGIN
  -- 1) Un-delete the demo Closed records. Closed work is real maintenance
  --    history, not deleted data — it should feed the cost report.
  UPDATE inspections
     SET is_deleted = FALSE
   WHERE is_deleted = TRUE
     AND status = 'Closed'
     AND title LIKE 'Demo: closed record %';

  -- 2) Backfill estimated_cost on Active predictions that lack it, using the
  --    average actual_cost of Closed records in the same category (mirrors
  --    recommendationController.estimateCost). Falls back to the estate-wide
  --    average when a category has no closed cost history yet. Correlated
  --    subqueries so the target row (p) is referenced legally.
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
