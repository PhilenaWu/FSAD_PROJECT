-- Migration: Contact directory — the phone numbers that are not people.
--
-- Migration 038 put staff numbers on the profile row they belong to, which
-- covers "call this manager". It cannot hold the estate's managing office line
-- or the national emergency numbers: those are organisations, not users, so
-- they had nowhere to live and stayed hardcoded in the frontend —
-- EmergencyContactsPage carried a literal CONTACTS array and ResidentLayout a
-- fabricated '1800-123-4567' that matched nothing else in the app. This table
-- is their home, so every number the UI shows now comes from the database.
--
-- is_help_line marks the single entry the sidebar "Need help?" card dials for
-- residents. A flag rather than "whichever estate row sorts first", so changing
-- the help number is an obvious edit and does not depend on sort_order.
CREATE TABLE IF NOT EXISTS contact_directory (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  label        VARCHAR(120) NOT NULL UNIQUE,
  description  VARCHAR(255),
  phone        VARCHAR(30)  NOT NULL,
  category     VARCHAR(20)  NOT NULL
                            CHECK (category IN ('estate', 'emergency')),
  -- Stable presentation key, not a component name: the frontend maps it to an
  -- icon and colour and falls back to a generic phone icon on anything new.
  icon_key     VARCHAR(30),
  is_help_line BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order   INT     NOT NULL DEFAULT 0,
  created_at   TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Seed the three entries EmergencyContactsPage used to hardcode. The managing
-- office number is the estate's own (6500 0300, the block migration 038's staff
-- numbers extend); Police and Fire & Ambulance are Singapore's national
-- emergency lines, so nothing here is invented.
--
-- Idempotent on label (UNIQUE), so migrate.js replaying this file leaves an
-- edited number alone rather than restoring the seeded one.
INSERT INTO contact_directory
  (label, description, phone, category, icon_key, is_help_line, sort_order)
VALUES
  ('Managing office', 'Estate maintenance, lift faults, general enquiries',
   '6500 0300', 'estate', 'apartment', TRUE, 1),
  ('Police', 'National emergency line', '999', 'emergency', 'police', FALSE, 2),
  ('Fire & Ambulance', 'National emergency line', '995', 'emergency', 'fire', FALSE, 3)
ON CONFLICT (label) DO NOTHING;
