-- Migration: UC-012 onboarding accountability fields.
-- job_title: the account holder's position at the vendor company (e.g. "VP
-- Operations") — lives on users since it describes the person, not the company.
-- access_reason: why this person was given login credentials — recorded on the
-- vendor row for the audit trail.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS job_title VARCHAR(100);

ALTER TABLE contractors
  ADD COLUMN IF NOT EXISTS access_reason VARCHAR(500);
