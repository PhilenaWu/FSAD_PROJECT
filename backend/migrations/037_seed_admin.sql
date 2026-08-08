-- Migration: Admin logins.
--
-- Why this exists: the admin account was the only role not seeded by a
-- migration — SEED_ADMIN.md described creating it by hand in the Supabase
-- dashboard, so a fresh database came up with no way into /admin/costs or
-- /admin/vendors. This seeds them like every other role.
--
-- Follows the same pattern as 029/032: users.id is REFERENCES auth.users(id)
-- (migration 001), so the Supabase auth row is created alongside the profile.
-- Password is per-row here rather than a single shared literal, because
-- sophia_collins predates this file and has her own.
--
-- Idempotent: an auth user is only created when the email doesn't exist yet
-- and the profile insert is ON CONFLICT DO NOTHING, so re-runs are safe —
-- which matters because migrate.js replays every file on every run. For an
-- account that already exists the loop body is a no-op; in particular the
-- existing password is never overwritten.
DO $$
DECLARE
  rec RECORD;
  uid UUID;
BEGIN
  FOR rec IN
    SELECT * FROM (VALUES
      -- Seeded by hand before this file existed; the literal below only
      -- applies on a fresh database.
      ('sophia_collins@admin.com',        'Sophia Collins', 'TempPass123!'),
      ('steven.tan.admin@emservices.sg',  'Steven Tan',     'ChocoPizza_54')
    ) AS t(login, full_name, password)
  LOOP
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
         crypt(rec.password, gen_salt('bf')),
         NOW(), '{"provider":"email","providers":["email"]}', '{}',
         NOW(), NOW(), '', '', '', '', '')
      RETURNING id INTO uid;
    END IF;

    -- Identity row, checked independently of whether the auth user was just
    -- created: Supabase refuses email/password sign-in without it.
    IF NOT EXISTS (SELECT 1 FROM auth.identities WHERE user_id = uid) THEN
      INSERT INTO auth.identities
        (id, user_id, provider_id, provider, identity_data,
         last_sign_in_at, created_at, updated_at)
      VALUES
        (gen_random_uuid(), uid, uid::text, 'email',
         jsonb_build_object('sub', uid::text, 'email', rec.login, 'email_verified', true),
         NOW(), NOW(), NOW());
    END IF;

    -- Profile row. role='admin' is what routes the login to the admin layout;
    -- block/unit are resident-only and contractor_id is vendor-only.
    INSERT INTO users (id, email, full_name, role)
    VALUES (uid, rec.login, rec.full_name, 'admin')
    ON CONFLICT (id) DO NOTHING;
  END LOOP;
END $$;
