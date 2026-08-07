-- Migration: allow 'pending' and 'rejected' account statuses on users.
-- Resident self-registration creates the profile row as 'pending'; a manager
-- then approves it ('active') or rejects it ('rejected'). Rejected rows are
-- kept rather than deleted — the Supabase auth.users row survives either way,
-- so keeping the profile lets login explain why access is refused.
-- Existing rows are untouched: 'active' and 'suspended' remain valid and the
-- column default stays 'active' (staff/vendor accounts are still created live).
ALTER TABLE users
  DROP CONSTRAINT IF EXISTS users_status_check;

ALTER TABLE users
  ADD CONSTRAINT users_status_check
  CHECK (status IN ('active', 'suspended', 'pending', 'rejected'));
