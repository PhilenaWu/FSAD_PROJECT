-- Migration: Contact phone number on user profiles.
--
-- Why this exists: the "Need help?" sidebar card and the role contacts pages
-- (defect list items 4, 27, 28) need a real number to call. Until now the only
-- numbers in the app were hardcoded literals in the frontend — ResidentLayout
-- carried a fabricated '1800-123-4567' and EmergencyContactsPage a static list
-- — so a contacts page could not reflect who actually holds the role. The
-- number belongs with the profile row it describes, next to full_name/email.
--
-- Nullable on purpose: residents, inspectors and contractors have no reason to
-- publish a number, and accounts created before this migration have none. The
-- contacts endpoint returns the row either way and the UI omits a missing
-- number rather than showing a blank field.
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone VARCHAR(30);

-- Seed the staff numbers the contacts pages read. These follow the managing
-- office block already shown on EmergencyContactsPage (6500 0300), so the
-- estate reads as one organisation rather than a set of unrelated lines.
--
-- Idempotent, and `phone IS NULL` guarded rather than a plain UPDATE: once
-- someone edits a number to the real one, migrate.js replaying this file must
-- not put the seeded value back. Matching on email keeps this correct whatever
-- auth id the account was created under.
UPDATE users SET phone = '6500 0311', updated_at = NOW()
 WHERE email = 'steven.tan.admin@emservices.sg' AND phone IS NULL;

UPDATE users SET phone = '6500 0312', updated_at = NOW()
 WHERE email = 'sophia_collins@admin.com' AND phone IS NULL;

UPDATE users SET phone = '6500 0321', updated_at = NOW()
 WHERE email = 'rachel.lim.manager@emservices.sg' AND phone IS NULL;
