-- Migration: Replace the placeholder checklist template with the real EM Services
-- "SPOT-CHECK ON LIFT COMPANY SERVICING" paper form (see the requirements doc).
--
-- Migration 016's 10 generic items are already live and are referenced by
-- existing checklist_results rows, so they cannot be deleted. They are retired
-- with active = FALSE instead: checklistItemModel.findActive() filters on
-- active = TRUE, so they drop off the inspector form while past inspections keep
-- their history and their foreign keys.
--
-- display_order is globally sequential (1-25) rather than restarting per
-- section, because findActive() orders by display_order alone — this makes the
-- three sections come out in form order [A] -> [B] -> [C].
--
-- Idempotent: the UPDATE is a no-op once applied and the INSERT is guarded with
-- WHERE NOT EXISTS on item_text (no UNIQUE constraint on the table). Safe to
-- re-run, which matters because migrate.js replays every file on every run.

-- Retire the migration 016 placeholder template.
UPDATE checklist_items
SET active = FALSE
WHERE item_text IN (
  'Shaft walls free of cracks and water seepage',
  'Machine room floor and fixings secure',
  'Cabin and landing lighting fully working',
  'Control panel indicators and alarm bell functional',
  'Landing door closes flush without obstruction',
  'Door sensor reopens on obstruction',
  'Cabin buttons respond and illuminate',
  'Cabin free of debris, panels intact',
  'Emergency intercom connects to control centre',
  'Levelling accuracy within tolerance at each floor'
);

-- The real spot-check form: 3 sections, 25 checkpoints, verbatim wording.
INSERT INTO checklist_items (section, item_text, display_order)
SELECT v.section, v.item_text, v.display_order
FROM (
  VALUES
    -- [A] Motor Room
    ('Motor Room',          'Motor room cleanliness - Any debris?',                                                        1),
    ('Motor Room',          'Cleanliness of traction machine - Any leakage?',                                              2),
    ('Motor Room',          'Controller contactors & relays - Any humming?',                                               3),
    ('Motor Room',          'Bearings - Any abnormal noise?',                                                              4),
    ('Motor Room',          'Wire ropes (main rope & governor rope) and sheaves - Any wear or red dust?',                   5),
    ('Motor Room',          'Brake drum & lining - Sign of worn off? Oily?',                                               6),
    ('Motor Room',          'Governor Machine - Any abnormal noise?',                                                      7),
    ('Motor Room',          'Anti Crime device - Functioning?',                                                            8),
    ('Motor Room',          'ARD & EBOPS - Functioning? Replacement date?',                                                9),
    -- [B] Lift Car
    ('Lift Car',            'COB buttons & CPI - Functioning?',                                                           10),
    ('Lift Car',            'Car Fan & Grille - Any abnormalities?',                                                      11),
    ('Lift Car',            'Car lights & diffuser - Lighted up and clear?',                                              12),
    ('Lift Car',            'Car door operation - Any noise?',                                                            13),
    ('Lift Car',            'Door side gaps - Less than 10mm?',                                                           14),
    ('Lift Car',            'Sill to sill clearance - Less than 35mm?',                                                   15),
    ('Lift Car',            'Safety edge & sensor - Functioning?',                                                        16),
    ('Lift Car',            'Travelling - Any Jerkiness?',                                                                17),
    -- [C] Hoistway & Lift Pit
    ('Hoistway & Lift Pit', 'Hall buttons & HPI - Functioning?',                                                          18),
    ('Hoistway & Lift Pit', 'All landing door locks adjustment - Any noise?',                                             19),
    ('Hoistway & Lift Pit', 'All landing door shoes, tracks and eccentric rollers clearance - Any sign of wear and tear?', 20),
    ('Hoistway & Lift Pit', 'All landing door self-closing devices - Self-closing?',                                       21),
    ('Hoistway & Lift Pit', 'Levelling at each landings - Level?',                                                        22),
    ('Hoistway & Lift Pit', 'Car top safety and cleanliness - Any safety netting?',                                       23),
    ('Hoistway & Lift Pit', 'All safety switches - Functioning?',                                                         24),
    ('Hoistway & Lift Pit', 'Lift pit cleanliness - Any debris?',                                                         25)
) AS v(section, item_text, display_order)
WHERE NOT EXISTS (
  SELECT 1 FROM checklist_items c WHERE c.item_text = v.item_text
);
