-- Migration: EM Services inspector logins with working credentials.
--
-- Why this exists: UC-004 close requires an endorser whose users.role is
-- 'inspector' (G7/R9), and the close panel offers candidates from
-- GET /api/users/inspectors. No migration seeded an inspector, so that list came
-- back empty and closing was blocked for every record. These accounts also let
-- UC-001 spot-checks be filed against a real inspector_id.
--
-- Follows the same pattern as 022_seed_vendor_demo_data.sql: users.id is
-- REFERENCES auth.users(id) (migration 001), so the Supabase auth row must be
-- created alongside the profile row.
--
-- Idempotent: auth users are only created when the email doesn't exist yet and
-- profile inserts are ON CONFLICT DO NOTHING, so re-runs are safe — which
-- matters because migrate.js replays every file on every run.
--
-- Each login has its own unique password (below), not a shared demo one.
-- The password is re-synced on every run (not just at creation) — see the
-- UPDATE auth.users step near the bottom of the loop — so editing a password
-- here and re-running migrate.js actually changes it on an already-seeded
-- database.
DO $$
DECLARE
  rec RECORD;
  uid UUID;
BEGIN
  FOR rec IN
    SELECT * FROM (VALUES
      ('weijie.tan.inspector@emservices.sg',   'inspector1@emservices.sg', 'Wei Jie Tan',   'Falcon77!Reed'),
      ('nurul.aisyah.inspector@emservices.sg', 'inspector2@emservices.sg', 'Nurul Aisyah',  'Marble46#Dawn')
    ) AS t(login, legacy_login, full_name, password)
  LOOP
    -- Match either the current address or the one this file used to seed.
    -- migrate.js replays every file on every run with no ledger, so the rename
    -- has to live here: a separate rename migration would run *after* this one
    -- re-created the account under the old address, duplicating it.
    SELECT id INTO uid FROM auth.users WHERE email IN (rec.login, rec.legacy_login);
    IF uid IS NULL THEN
      INSERT INTO auth.users
        (instance_id, id, aud, role, email, encrypted_password,
         email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
         created_at, updated_at, confirmation_token, recovery_token,
         email_change, email_change_token_new, email_change_token_current)
      VALUES
        ('00000000-0000-0000-0000-000000000000', gen_random_uuid(),
         'authenticated', 'authenticated', rec.login,
         crypt(rec.password, gen_salt('bf')),
         NOW(), '{"provider":"email","providers":["email"]}', '{}',
         NOW(), NOW(), '', '', '', '', '')
      RETURNING id INTO uid;

    END IF;

    -- Keep the password in sync on every run, not just at creation — so
    -- changing a password above and re-running migrate.js actually applies
    -- it to an already-seeded account instead of silently no-op'ing.
    UPDATE auth.users
       SET encrypted_password = crypt(rec.password, gen_salt('bf')), updated_at = NOW()
     WHERE id = uid;

    -- Identity row, checked independently of whether the auth user was just
    -- created. Supabase refuses email/password sign-in without it, and nesting
    -- this inside the branch above is what left two UC-012 vendor accounts
    -- unable to log in after a partial run of migration 022.
    IF NOT EXISTS (SELECT 1 FROM auth.identities WHERE user_id = uid) THEN
      INSERT INTO auth.identities
        (id, user_id, provider_id, provider, identity_data,
         last_sign_in_at, created_at, updated_at)
      VALUES
        (gen_random_uuid(), uid, uid::text, 'email',
         jsonb_build_object('sub', uid::text, 'email', rec.login, 'email_verified', true),
         NOW(), NOW(), NOW());
    END IF;

    -- Carry an account seeded under the legacy address across to the current
    -- one. No-op once the rename has happened. The account id never changes,
    -- so inspections/signatures/history attributed to it stay intact.
    UPDATE auth.users
       SET email = rec.login, updated_at = NOW()
     WHERE id = uid AND email IS DISTINCT FROM rec.login;
    UPDATE auth.identities
       SET identity_data = jsonb_set(identity_data, '{email}', to_jsonb(rec.login)),
           updated_at = NOW()
     WHERE user_id = uid AND identity_data->>'email' IS DISTINCT FROM rec.login;

    -- Profile row. status defaults to 'active', which is what makes them show
    -- up in the endorser picker; job_title/contractor_id are vendor-only.
    INSERT INTO users (id, email, full_name, role)
    VALUES (uid, rec.login, rec.full_name, 'inspector')
    ON CONFLICT (id) DO NOTHING;
    UPDATE users
       SET email = rec.login, updated_at = NOW()
     WHERE id = uid AND email IS DISTINCT FROM rec.login;
  END LOOP;
END $$;
