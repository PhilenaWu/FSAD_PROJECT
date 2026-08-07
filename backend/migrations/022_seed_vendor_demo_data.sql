-- Migration: UC-012 demo data — realistic contracts and named account holders
-- with working logins for the seeded contractors (016/018). Idempotent: auth
-- users are only created when the email doesn't exist yet, identity rows are
-- backfilled for accounts that are missing one, and profile inserts are
-- ON CONFLICT DO NOTHING, so re-runs are safe. Re-running this file repairs any
-- seeded vendor login left without an auth.identities row.
--
-- Each login has its own unique password (below), not a shared demo one.
-- The password is re-synced on every run (not just at creation) — see the
-- UPDATE auth.users step — so editing a password here and re-running
-- migrate.js actually changes it on an already-seeded database.
DO $$
DECLARE
  rec RECORD;
  uid UUID;
  cid UUID;
BEGIN
  FOR rec IN
    SELECT * FROM (VALUES
      ('KONE Maintenance',   'service@konemaint.com.sg',  'Marcus Tan',   'Service Manager',
       'marcus.tan@konemaint.com.sg',   'Harbor72!Vale', DATE '2025-08-01', DATE '2026-07-31', 'active',
       'Coordinates KONE lift servicing and defect rectification for the estate'),
      ('KONE Pte Ltd',       'support@kone-sg.com',       'Priya Nair',   'Account Director',
       'priya.nair@kone-sg.com',        'Nimbus93#Kite', DATE '2026-01-01', DATE '2027-12-31', 'active',
       'Oversees the KONE master servicing agreement and escalations'),
      ('Otis Elevator Co.',  'service@otiselevator.sg',   'Wei Jie Lim',  'Operations Lead',
       'wei.jie.lim@otiselevator.sg',   'Cobalt58!Reef', DATE '2025-01-01', DATE '2026-12-31', 'active',
       'Handles Otis lift defect assignments and completion sign-offs'),
      ('Otis Service SG',    'defects@otisservice.sg',    'Sarah Chen',   'Maintenance Supervisor',
       'sarah.chen@otisservice.sg',     'Willow24#Fern', DATE '2026-03-01', DATE '2027-02-28', 'active',
       'Supervises Otis field technicians on assigned estate defects'),
      ('Schindler Care',     'alerts@schindlercare.sg',   'Ahmad Faizal', 'Service Director',
       'ahmad.faizal@schindlercare.sg', 'Ember61!Trail', DATE '2024-07-01', DATE '2026-06-30', 'suspended',
       'Managed Schindler defect rectification under the 2024–2026 contract'),
      ('Schindler Lifts SG', 'defects@schindlerlifts.sg', 'Grace Ho',     'Regional Manager',
       'grace.ho@schindlerlifts.sg',    'Quartz39#Moss', DATE '2026-06-01', DATE '2028-05-31', 'active',
       'Manages Schindler lift servicing and e-sign completions for the estate')
    ) AS t(company, contact, holder, title, login, password, cstart, cend, ustatus, reason)
  LOOP
    SELECT id INTO cid FROM contractors WHERE name = rec.company;
    IF cid IS NULL THEN CONTINUE; END IF;  -- contractor seeds not present

    UPDATE contractors
    SET contact_email = rec.contact,
        contract_start = rec.cstart,
        contract_end   = rec.cend,
        access_reason  = rec.reason
    WHERE id = cid;

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

    -- Identity row, outside the branch above. GoTrue needs BOTH an auth.users
    -- row and a matching auth.identities row to authenticate an email login;
    -- creating it only alongside a fresh auth.users row meant that any account
    -- surviving from a partial earlier run (auth.users present, identity never
    -- written) could never sign in. Guarded so re-runs stay idempotent.
    INSERT INTO auth.identities
      (id, user_id, provider_id, provider, identity_data,
       last_sign_in_at, created_at, updated_at)
    SELECT gen_random_uuid(), uid, uid::text, 'email',
           jsonb_build_object('sub', uid::text, 'email', rec.login, 'email_verified', true),
           NOW(), NOW(), NOW()
     WHERE NOT EXISTS (
       SELECT 1 FROM auth.identities
        WHERE user_id = uid AND provider = 'email'
     );

    INSERT INTO users (id, email, full_name, role, job_title, status)
    VALUES (uid, rec.login, rec.holder, 'contractor', rec.title, rec.ustatus)
    ON CONFLICT (id) DO NOTHING;

    UPDATE contractors SET user_id = uid WHERE id = cid;
    UPDATE users SET contractor_id = cid WHERE id = uid;
  END LOOP;
END $$;
