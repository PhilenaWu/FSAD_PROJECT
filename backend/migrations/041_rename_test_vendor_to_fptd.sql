-- Migration: Turn the "Test Lift Co." placeholder into a real vendor.
--
-- It was created through the onboarding form as an obvious placeholder
-- (contractor@test.com, no contract dates, holder "Test Contractor") and looked
-- like debris on /admin/vendors. Migration 040 was going to delete it, but it
-- carries three live inspections — two seeded 'Demo PQ:' records that feed the
-- UC-005 priority queue, plus a manually filed complaint — and
-- inspections.contractor_id does not cascade, so deleting it would either abort
-- the migrate run or orphan real records. Renaming keeps all three attached to
-- a vendor that reads properly.
--
-- Covers the company, the contract, the account holder and the login address in
-- one pass, so nothing is left half-renamed.
--
-- Idempotent: keyed off the old name, so once renamed the lookup finds nothing
-- and the block is a no-op. Guarded against the new name already existing, so a
-- database where somebody onboarded FPTD Services by hand is left alone.
DO $$
DECLARE
  cid   UUID;
  uid   UUID;
BEGIN
  SELECT id, user_id INTO cid, uid FROM contractors WHERE name = 'Test Lift Co.';
  IF cid IS NULL THEN
    RAISE NOTICE '041: nothing to rename — "Test Lift Co." not present';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM contractors WHERE name = 'FPTD Services') THEN
    RAISE NOTICE '041: skip — "FPTD Services" already exists';
    RETURN;
  END IF;

  -- Company record. Contract dates were NULL ("No contract" on the vendors
  -- page); this gives it a current two-year term so it sorts and renders like
  -- every other active vendor. contact_email is the shared company inbox — the
  -- fallback address defect mail uses when the holder's login is unavailable —
  -- so it is deliberately NOT the same as the login below.
  UPDATE contractors
     SET name           = 'FPTD Services',
         contact_email  = 'service@fptdservices.sg',
         contract_start = DATE '2025-09-01',
         contract_end   = DATE '2027-08-31',
         access_reason  = 'Services Otis and KONE lifts across the estate'
   WHERE id = cid;

  IF uid IS NULL THEN
    RAISE NOTICE '041: renamed company only — no linked login';
    RETURN;
  END IF;

  -- Account holder profile. The name is taken from the login address the
  -- rename targets (evan_siam@fptdservices.sg), so the two agree on screen.
  UPDATE users
     SET full_name  = 'Evan Siam',
         email      = 'evan_siam@fptdservices.sg',
         job_title  = 'Service Manager',
         updated_at = NOW()
   WHERE id = uid;

  -- The login itself. Both auth.users and auth.identities carry the address —
  -- GoTrue reads the identity_data copy when matching an email sign-in, so
  -- updating only auth.users would leave the account unable to log in.
  UPDATE auth.users
     SET email = 'evan_siam@fptdservices.sg', updated_at = NOW()
   WHERE id = uid;

  UPDATE auth.identities
     SET identity_data = jsonb_set(identity_data, '{email}',
                                   to_jsonb('evan_siam@fptdservices.sg'::text)),
         updated_at    = NOW()
   WHERE user_id = uid AND provider = 'email';

  RAISE NOTICE '041: renamed "Test Lift Co." to "FPTD Services" (login evan_siam@fptdservices.sg)';
END $$;
