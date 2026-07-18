-- Migration: Add UC-012 vendor-lifecycle contract fields to contractors.
-- contract_end drives the daily expiry check that suspends the linked user
-- account; contract_doc_url stores the Cloudinary /contracts file (reference
-- only — details are entered manually, no contract parsing).
ALTER TABLE contractors
  ADD COLUMN IF NOT EXISTS contract_start   DATE,
  ADD COLUMN IF NOT EXISTS contract_end     DATE,
  ADD COLUMN IF NOT EXISTS contract_doc_url VARCHAR(500);
