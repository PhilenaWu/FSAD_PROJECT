-- Migration: Clean up all demo data.
-- Migrations 018 and 023 are now disabled (deprecated). This migration
-- deletes any existing demo records from old/upgraded databases. Idempotent.

DELETE FROM inspections
 WHERE title LIKE 'Demo:%'
    OR title LIKE 'Demo PQ:%';
