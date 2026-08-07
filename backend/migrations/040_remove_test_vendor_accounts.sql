-- Migration: Remove the test vendor accounts from the admin vendors page.
--
-- Three vendors on /admin/vendors were never seeded by any migration — they
-- were created through the onboarding form straight into the shared database,
-- so there was no seed file to correct. They are cleared here instead, leaving
-- only the six vendors migration 022 seeds.
--
-- DESTRUCTIVE, and deliberately cautious about it:
--
--   * Nothing is deleted while another row still points at it. Neither
--     lifts.contractor_id nor inspections.contractor_id cascades (003 / 004),
--     so deleting a referenced vendor would raise a foreign key violation and
--     abort the whole migrate.js run for everyone. Same for the login:
--     inspection_history.actor_id, signatures.signer_id, notifications.manager_id
--     and feedback.user_id are all NOT NULL references to users(id) with no
--     ON DELETE clause.
--   * inspections.resident_id is the opposite hazard — it IS ON DELETE CASCADE
--     (004), so deleting a login that ever filed a complaint would silently take
--     the complaints with it. It is counted as a blocker rather than allowed to
--     cascade.
--   * A vendor that fails any check is skipped with a NOTICE and left exactly as
--     it was, rather than partially unlinked.
--   * The six seeded logins are a hard exclusion, so no rename or re-link can
--     make this file delete a working account.
--
-- Idempotent: once a vendor is gone the lookup finds nothing and the loop body
-- is a no-op, which matters because migrate.js replays every file on every run.
-- The flip side is that a NEW vendor later given one of these three names would
-- be removed on the next run — rename this file's targets if that ever happens.
DO $$
DECLARE
  rec       RECORD;
  cid       UUID;
  uid       UUID;
  login     TEXT;
  blockers  INT;
BEGIN
  FOR rec IN
    SELECT * FROM (VALUES
      ('FSPT Services')
    ) AS t(company)
    -- Two names have been taken off this list:
    --   'Dymatics Management' — its login was re-pointed to
    --     dymatics@emservices.com, i.e. somebody is curating it rather than
    --     leaving it as onboarding-form debris. Rule 3 of the cleaned task list:
    --     no deleting a teammate's live row without their say-so.
    --   'Test Lift Co.' — it turned out to carry three real inspections, so the
    --     guard below refused it. It is renamed into a proper vendor by
    --     migration 041 instead of being deleted, which keeps those records
    --     attached to something coherent.
  LOOP
    SELECT id, user_id INTO cid, uid FROM contractors WHERE name = rec.company;
    IF cid IS NULL THEN
      RAISE NOTICE '040: skip "%" — not present', rec.company;
      CONTINUE;
    END IF;

    -- users.contractor_id is the other direction of the link and 022 sets both;
    -- fall back to it so a half-linked row is still found.
    IF uid IS NULL THEN
      SELECT id INTO uid FROM users WHERE contractor_id = cid;
    END IF;

    SELECT email INTO login FROM users WHERE id = uid;

    -- Hard exclusion: the six vendor logins seeded by migration 022 are kept
    -- whatever contractor row they are attached to.
    IF login IN (
      'marcus.tan@konemaint.com.sg',
      'priya.nair@kone-sg.com',
      'wei.jie.lim@otiselevator.sg',
      'sarah.chen@otisservice.sg',
      'ahmad.faizal@schindlercare.sg',
      'grace.ho@schindlerlifts.sg'
    ) THEN
      RAISE NOTICE '040: skip "%" — linked to seeded login %', rec.company, login;
      CONTINUE;
    END IF;

    -- Work still pointing at the vendor company.
    SELECT (SELECT count(*) FROM lifts       WHERE contractor_id = cid)
         + (SELECT count(*) FROM inspections WHERE contractor_id = cid)
      INTO blockers;
    IF blockers > 0 THEN
      RAISE NOTICE '040: skip "%" — % lift/inspection row(s) still reference it',
        rec.company, blockers;
      CONTINUE;
    END IF;

    -- Work still pointing at the login. vendor_history rows for THIS contractor
    -- are excluded: they cascade away with the contractor delete below.
    IF uid IS NOT NULL THEN
      SELECT (SELECT count(*) FROM inspections        WHERE inspector_id = uid)
           + (SELECT count(*) FROM inspections        WHERE resident_id  = uid)
           + (SELECT count(*) FROM inspection_history WHERE actor_id     = uid)
           + (SELECT count(*) FROM signatures         WHERE signer_id    = uid)
           + (SELECT count(*) FROM ai_predictions     WHERE dismissed_by = uid)
           + (SELECT count(*) FROM notifications      WHERE manager_id   = uid)
           + (SELECT count(*) FROM feedback           WHERE user_id      = uid)
           + (SELECT count(*) FROM vendor_history
               WHERE actor_id = uid AND contractor_id <> cid)
        INTO blockers;
      IF blockers > 0 THEN
        RAISE NOTICE '040: skip "%" — login % has % row(s) of recorded activity',
          rec.company, login, blockers;
        CONTINUE;
      END IF;
    END IF;

    -- Clear both sides of the link before deleting either row.
    UPDATE contractors SET user_id = NULL WHERE id = cid;
    IF uid IS NOT NULL THEN
      UPDATE users SET contractor_id = NULL WHERE id = uid;
    END IF;

    -- Contractor first: cascades its vendor_history (021).
    DELETE FROM contractors WHERE id = cid;

    -- Then the login. users.id references auth.users ON DELETE CASCADE (001),
    -- so removing the auth user takes the profile and identity rows with it.
    IF uid IS NOT NULL THEN
      DELETE FROM auth.users WHERE id = uid;
    END IF;

    RAISE NOTICE '040: removed "%" (login %)', rec.company, COALESCE(login, 'none');
  END LOOP;
END $$;
