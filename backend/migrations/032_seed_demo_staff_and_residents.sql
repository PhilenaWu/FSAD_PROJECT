-- Migration: Presentation-ready manager and resident logins.
--
-- The manager and resident accounts in use were personal developer addresses
-- (a +tag gmail and a student email), which read poorly on screen during a
-- demo. This adds realistic replacements.
--
-- ADDITIVE ONLY — nothing existing is modified or removed:
--   * The old accounts stay active so teammates can keep working with them.
--   * Deleting them would be destructive anyway: inspections.resident_id is
--     ON DELETE CASCADE (migration 004), so removing a resident would delete
--     every complaint they filed.
--   * No inspections, notifications or history rows are created, so every
--     existing page renders exactly as before. The new residents simply start
--     with an empty "My reports" — file a complaint live to populate it.
--
-- Follows the same pattern as 022/029: users.id is REFERENCES auth.users(id)
-- (migration 001), so the Supabase auth row is created alongside the profile.
--
-- Idempotent: auth users are only created when the email doesn't exist yet and
-- profile inserts are ON CONFLICT DO NOTHING, so re-runs are safe — which
-- matters because migrate.js replays every file on every run.
--
-- Demo password for every login below: TempPass123!
DO $$
DECLARE
  rec RECORD;
  uid UUID;
BEGIN
  FOR rec IN
    SELECT * FROM (VALUES
      -- Staff addresses carry the role; residents keep personal-looking ones.
      ('rachel.lim.manager@emservices.sg', 'rachel.lim@emservices.sg',
       'Rachel Lim',   'manager',  NULL,  NULL),
      ('tan.weiming@mail.sg', 'tan.weiming@mail.sg',
       'Tan Wei Ming', 'resident', '44A', '12-05'),
      ('nurul.huda@mail.sg', 'nurul.huda@mail.sg',
       'Nurul Huda',   'resident', '44B', '07-112')
    ) AS t(login, legacy_login, full_name, role, block_number, unit_number)
  LOOP
    -- Match either the current address or the one this file used to seed —
    -- see the note in 029: migrate.js replays every file, so the rename must
    -- live here rather than in a later migration.
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
         crypt('TempPass123!', gen_salt('bf')),
         NOW(), '{"provider":"email","providers":["email"]}', '{}',
         NOW(), NOW(), '', '', '', '', '')
      RETURNING id INTO uid;
    END IF;

    -- Identity row, checked independently of whether the auth user was just
    -- created. Supabase refuses email/password sign-in without it, and nesting
    -- this inside the branch above is what left two UC-012 vendor accounts
    -- (marcus.tan@konemaint.com.sg, priya.nair@kone-sg.com) unable to log in
    -- after a partial run of migration 022.
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
    -- one. No-op once the rename has happened; the account id never changes.
    UPDATE auth.users
       SET email = rec.login, updated_at = NOW()
     WHERE id = uid AND email IS DISTINCT FROM rec.login;
    UPDATE auth.identities
       SET identity_data = jsonb_set(identity_data, '{email}', to_jsonb(rec.login)),
           updated_at = NOW()
     WHERE user_id = uid AND identity_data->>'email' IS DISTINCT FROM rec.login;

    -- Profile row. status defaults to 'active'; block/unit are resident-only
    -- and drive the "Resident · Block 44A #12-05" header subtitle.
    INSERT INTO users (id, email, full_name, role, block_number, unit_number)
    VALUES (uid, rec.login, rec.full_name, rec.role, rec.block_number, rec.unit_number)
    ON CONFLICT (id) DO NOTHING;
    UPDATE users
       SET email = rec.login, updated_at = NOW()
     WHERE id = uid AND email IS DISTINCT FROM rec.login;
  END LOOP;
END $$;
