-- Migration: Add optional GPS capture columns to inspections.
-- Captured client-side on explicit user tap (never automatic); all nullable —
-- GPS is supplementary and never overrides the required block/lift selection.
ALTER TABLE inspections
  ADD COLUMN IF NOT EXISTS gps_lat        NUMERIC,
  ADD COLUMN IF NOT EXISTS gps_lng        NUMERIC,
  ADD COLUMN IF NOT EXISTS gps_accuracy_m NUMERIC,
  ADD COLUMN IF NOT EXISTS gps_captured_at TIMESTAMP;
