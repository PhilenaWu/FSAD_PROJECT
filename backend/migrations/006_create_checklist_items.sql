-- Migration: Create checklist_items table (the structured spot-check template)
CREATE TABLE IF NOT EXISTS checklist_items (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  section       VARCHAR(50)  NOT NULL,           -- Structural / Electrical / Doors / Cabin / Safety
  item_text     VARCHAR(255) NOT NULL,           -- e.g. "Landing door closes flush"
  display_order INTEGER      NOT NULL DEFAULT 0,
  active        BOOLEAN      NOT NULL DEFAULT TRUE
);
