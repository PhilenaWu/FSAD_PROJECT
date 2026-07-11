-- Migration: Seed reference data for the inspector lift spot-check (UC-001).
-- Contractors, lifts (linked to their contractor by serviced brand), and the
-- checklist template. Idempotent: contractors/checklist_items are guarded with
-- WHERE NOT EXISTS (no UNIQUE constraint on those tables); lifts use the
-- (block_number, lift_code) UNIQUE via ON CONFLICT DO NOTHING. Safe to re-run.

-- Contractors (one per lift brand we seed).
INSERT INTO contractors (name, brands_serviced, contact_email)
SELECT 'Otis Service SG', 'Otis', 'defects@otis-sg.example.com'
WHERE NOT EXISTS (SELECT 1 FROM contractors WHERE name = 'Otis Service SG');

INSERT INTO contractors (name, brands_serviced, contact_email)
SELECT 'Schindler Care', 'Schindler', 'alerts@schindlercare.example.com'
WHERE NOT EXISTS (SELECT 1 FROM contractors WHERE name = 'Schindler Care');

INSERT INTO contractors (name, brands_serviced, contact_email)
SELECT 'KONE Maintenance', 'KONE', 'service@kone-maint.example.com'
WHERE NOT EXISTS (SELECT 1 FROM contractors WHERE name = 'KONE Maintenance');

-- Lifts, one or two per block; contractor resolved by the brand it services.
INSERT INTO lifts (block_number, lift_code, brand, contractor_id, bca_cert_expiry)
VALUES
  ('44A', '44A-L1', 'Otis',      (SELECT id FROM contractors WHERE name = 'Otis Service SG'),  '2026-11-30'),
  ('44A', '44A-L2', 'Otis',      (SELECT id FROM contractors WHERE name = 'Otis Service SG'),  '2026-11-30'),
  ('44B', '44B-L1', 'Schindler', (SELECT id FROM contractors WHERE name = 'Schindler Care'),   '2027-02-28'),
  ('44C', '44C-L1', 'Schindler', (SELECT id FROM contractors WHERE name = 'Schindler Care'),   '2026-09-15'),
  ('45A', '45A-L1', 'KONE',      (SELECT id FROM contractors WHERE name = 'KONE Maintenance'), '2027-05-31'),
  ('45B', '45B-L1', 'KONE',      (SELECT id FROM contractors WHERE name = 'KONE Maintenance'), '2026-08-31')
ON CONFLICT (block_number, lift_code) DO NOTHING;

-- Structured spot-check template (checklist_items), grouped by section.
INSERT INTO checklist_items (section, item_text, display_order)
SELECT v.section, v.item_text, v.display_order
FROM (
  VALUES
    ('Structural', 'Shaft walls free of cracks and water seepage',        1),
    ('Structural', 'Machine room floor and fixings secure',               2),
    ('Electrical', 'Cabin and landing lighting fully working',            3),
    ('Electrical', 'Control panel indicators and alarm bell functional',  4),
    ('Doors',      'Landing door closes flush without obstruction',      5),
    ('Doors',      'Door sensor reopens on obstruction',                  6),
    ('Cabin',      'Cabin buttons respond and illuminate',                7),
    ('Cabin',      'Cabin free of debris, panels intact',                 8),
    ('Safety',     'Emergency intercom connects to control centre',       9),
    ('Safety',     'Levelling accuracy within tolerance at each floor',  10)
) AS v(section, item_text, display_order)
WHERE NOT EXISTS (
  SELECT 1 FROM checklist_items c WHERE c.item_text = v.item_text
);
