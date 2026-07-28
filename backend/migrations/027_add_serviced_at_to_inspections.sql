-- Migration: Add the paper form's "Servicing Date" header field to inspections.
-- This is the date the lift contractor performed the servicing that the
-- spot-check audits — distinct from the spot-check date itself (created_at).
-- Nullable: existing lift inspections predate the field, and resident complaints
-- never have one.
ALTER TABLE inspections ADD COLUMN IF NOT EXISTS serviced_at DATE;
