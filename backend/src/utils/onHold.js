// Is a record currently on hold?
//
// A hold used to be a status ('On Hold'). It is now a fact in the audit trail:
// the contractor's "unable to rectify" writes an 'On Hold' history row and
// resuming writes a 'Resumed' one, while the status stays 'Assigned'. So "on
// hold" means the most recent of those two rows is the hold.
//
// This matters beyond display: a hold pauses the rectification clock (G11), so
// held work must not be counted overdue or chased by email. Both of those
// queries used to test `status <> 'On Hold'` and would otherwise start
// hounding a contractor who has already said they are blocked.
'use strict';

/**
 * SQL predicate, true when the record is currently held.
 * @param {string} alias - the inspections table/alias in the caller's query.
 *   A code-level constant, never user input — it is interpolated, not bound.
 */
function onHoldSql(alias = 'inspections') {
  // COALESCE, and the outer parentheses, both matter. A record that has never
  // been held has no such row, so the subquery is NULL — and `NOT (NULL =
  // 'On Hold')` is NULL, not true, which would quietly drop every never-held
  // record from the callers' NOT clauses. The parentheses keep `NOT` binding
  // over the whole comparison.
  return `(COALESCE((SELECT h.action
                       FROM inspection_history h
                      WHERE h.inspection_id = ${alias}.id
                        AND h.action IN ('On Hold', 'Resumed')
                      ORDER BY h.created_at DESC, h.id DESC
                      LIMIT 1), '') = 'On Hold')`;
}

module.exports = { onHoldSql };
