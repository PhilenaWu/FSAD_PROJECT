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
-- Demo password for every inspector login: TempPass123!
DO $$
DECLARE
  rec RECORD;
  uid UUID;
BEGIN
  FOR rec IN
    SELECT * FROM (VALUES
      ('inspector1@emservices.sg', 'Wei Jie Tan'),
      ('inspector2@emservices.sg', 'Nurul Aisyah')
    ) AS t(login, full_name)
  LOOP
    -- Auth login: create only if this email has no auth user yet.
    SELECT id INTO uid FROM auth.users WHERE email = rec.login;
    IF uid IS NULL THEN
      INSERT INTO auth.users
        (instance_id, id, aud, role, email, encrypted_password,
         email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
         created_at, updated_at, confirmation_token, recovery_token,
         email_change, email_change_token_new, email_change_token_current)
      VALUES
        ('00000000-0000-0000-0000-000000000000', gen_random_uuid(),
         'authenticated', 'authenticated', rec.login,
         crypt('TempPass123!', gen_salt('bf')),
         NOW(), '{"provider":"email","providers":["email"]}', '{}',
         NOW(), NOW(), '', '', '', '', '')
      RETURNING id INTO uid;

      INSERT INTO auth.identities
        (id, user_id, provider_id, provider, identity_data,
         last_sign_in_at, created_at, updated_at)
      VALUES
        (gen_random_uuid(), uid, uid::text, 'email',
         jsonb_build_object('sub', uid::text, 'email', rec.login, 'email_verified', true),
         NOW(), NOW(), NOW());
    END IF;

    -- Profile row. status defaults to 'active', which is what makes them show
    -- up in the endorser picker; job_title/contractor_id are vendor-only.
    INSERT INTO users (id, email, full_name, role)
    VALUES (uid, rec.login, rec.full_name, 'inspector')
    ON CONFLICT (id) DO NOTHING;
  END LOOP;
END $$;
