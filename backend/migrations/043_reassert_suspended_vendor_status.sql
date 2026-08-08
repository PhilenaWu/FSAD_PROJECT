-- Migration: re-assert the seeded suspended vendor's account status.
--
-- 022 seeds Ahmad Faizal (Schindler Care) with status 'suspended' — he is the
-- UC-012 demonstration account, the vendor whose contract expired and who must
-- be locked out. But that seed ends in:
--
--     INSERT INTO users (...) VALUES (...) ON CONFLICT (id) DO NOTHING;
--
-- so once his row exists, the status is never re-applied. A row created by an
-- earlier run — before that value was set, or with it set differently — keeps
-- whatever status it had, and every later migrate run silently skips it. 022
-- already guards this exact trap for passwords (it re-syncs them on every run
-- rather than only at creation); status was left out.
--
-- Only the suspended account is re-asserted here. The other five vendors are
-- seeded 'active', which is also the column default, so a fresh row is already
-- correct — and re-asserting them would undo a suspension an admin applied
-- through the UC-012 vendor screen, which is a legitimate thing to be testing.
DO $$
DECLARE
  updated INT;
BEGIN
  UPDATE users
     SET status = 'suspended', updated_at = NOW()
   WHERE email = 'ahmad.faizal@schindlercare.sg'
     AND status <> 'suspended';
  GET DIAGNOSTICS updated = ROW_COUNT;

  IF updated > 0 THEN
    RAISE NOTICE '043: ahmad.faizal@schindlercare.sg set back to suspended.';
  ELSIF NOT EXISTS (
    SELECT 1 FROM users WHERE email = 'ahmad.faizal@schindlercare.sg'
  ) THEN
    -- Worth shouting about: with no profile row, GET /api/users/me answers 404
    -- for this login rather than ACCOUNT_SUSPENDED, so the app cannot tell the
    -- account is suspended. Re-running 022 creates the row.
    RAISE NOTICE '043: no users row for ahmad.faizal@schindlercare.sg — profile missing or keyed to a different auth id.';
  END IF;
END $$;
