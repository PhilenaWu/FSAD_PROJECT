-- Migration: Attribute the demo lift spot-checks to a real inspector.
--
-- 018_seed_demo_data.sql left inspector_id NULL on its 12 'Demo:' lift
-- inspections because users.id must reference a real Supabase auth account and
-- no inspector existed yet (see its header note). 029 seeds inspectors, so those
-- records can now name who performed the check — which also makes the UC-004
-- close panel pre-select an endorser instead of asking the manager to pick one
-- for every demo record.
--
-- Scoped to 'Demo:%' rows with a NULL inspector_id, so real spot-checks (which
-- already carry the submitting inspector's id) are never touched. Idempotent:
-- once set, the IS NULL filter makes a re-run a no-op.
DO $$
DECLARE
  insp1 UUID;
  insp2 UUID;
BEGIN
  SELECT id INTO insp1 FROM users WHERE email = 'inspector1@emservices.sg';
  SELECT id INTO insp2 FROM users WHERE email = 'inspector2@emservices.sg';

  -- Fall back to whatever active inspector exists if the 029 seed was skipped.
  IF insp1 IS NULL THEN
    SELECT id INTO insp1
    FROM users
    WHERE role = 'inspector' AND status = 'active'
    ORDER BY email
    LIMIT 1;
  END IF;

  IF insp1 IS NULL THEN RETURN; END IF;  -- no inspector to attribute to
  IF insp2 IS NULL THEN insp2 := insp1; END IF;

  -- Alternate between the two so the demo doesn't show one inspector doing
  -- every check.
  WITH numbered AS (
    SELECT id, row_number() OVER (ORDER BY created_at, id) AS rn
    FROM inspections
    WHERE source_type = 'lift_inspection'
      AND inspector_id IS NULL
      AND title LIKE 'Demo:%'
  )
  UPDATE inspections i
  SET inspector_id = CASE WHEN n.rn % 2 = 1 THEN insp1 ELSE insp2 END
  FROM numbered n
  WHERE i.id = n.id;
END $$;
