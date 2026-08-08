-- Satisfaction rating feature (UC-003) removed — no longer used.
ALTER TABLE inspections DROP COLUMN IF EXISTS satisfaction_rating;
ALTER TABLE inspections DROP COLUMN IF EXISTS satisfaction_comment;
