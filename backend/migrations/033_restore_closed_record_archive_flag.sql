-- Migration: restore the "a Closed record is an archived record" invariant.
--
-- is_deleted is written in exactly two places in the backend — the manual close
-- (UC-004) and the G6 zero-defect auto-file — and both set it TRUE. It therefore
-- means "archived out of the active queues", not "deleted", and every Closed
-- record carries it.
--
-- Migration 024 previously flipped the 55 seeded Closed records (018, inserted
-- with is_deleted = TRUE) to FALSE, to force the UC-009 report's
-- `status = 'Closed' AND is_deleted = FALSE` filter to match. That predicate can
-- never be satisfied, so the real fix belongs in the queries (reportModel and
-- adminController, both now corrected) rather than in the data. The un-deleted
-- rows meanwhile leaked into every view that treats is_deleted = FALSE as "still
-- active" — most visibly the manager triage queue (findAllForManager).
--
-- Scoped to the rows 024 modified, restoring the values 018 seeded.
-- Idempotent: safe to re-run.
UPDATE inspections
   SET is_deleted = TRUE
 WHERE is_deleted = FALSE
   AND status = 'Closed'
   AND title LIKE 'Demo: closed record %';
