-- Migration: rework the inspections.category vocabulary.
--
-- Residents now pick the category themselves on the report form, so the two
-- values that only ever made sense to the system are gone:
--   * 'Other'         — redundant next to a catch-all the resident can pick.
--   * 'Uncategorised' — the stubbed AI categoriser returned this for every
--                       report, so it read as "the system gave up" rather than
--                       as a choice anyone made.
-- Both become 'Miscellaneous', which is an honest option for a resident who
-- does not know which category fits.
--
-- Order matters: the existing CHECK forbids 'Miscellaneous', so the constraint
-- comes off before the rows are rewritten and goes back on afterwards.
-- Idempotent — migrate.js re-runs every file, and DROP ... IF EXISTS followed
-- by ADD leaves the same constraint in place each time.

ALTER TABLE inspections DROP CONSTRAINT IF EXISTS inspections_category_check;

UPDATE inspections
SET category = 'Miscellaneous'
WHERE category IN ('Other', 'Uncategorised');

-- New records with no category supplied land on the same catch-all.
ALTER TABLE inspections ALTER COLUMN category SET DEFAULT 'Miscellaneous';

ALTER TABLE inspections
  ADD CONSTRAINT inspections_category_check CHECK (category IN (
    'Structural','Electrical','Plumbing','Cleanliness',
    'Lift','Doors','Cabin','Safety','Landscaping','Pest',
    'Miscellaneous'
  ));
