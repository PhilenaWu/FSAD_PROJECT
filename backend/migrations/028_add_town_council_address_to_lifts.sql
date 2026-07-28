-- Migration: Add the paper form's "Town Council" and "Address" header fields.
-- Both are properties of the lift/estate (constant per block), not per-inspection
-- input, so they live on `lifts` and are shown read-only on the inspector form,
-- auto-filled from the selected lift.
--
-- Nullable: lifts created before this migration have no values until backfilled
-- by the statement below.
ALTER TABLE lifts
  ADD COLUMN IF NOT EXISTS town_council VARCHAR(255),
  ADD COLUMN IF NOT EXISTS address      VARCHAR(255);

-- Backfill the lifts seeded in migration 016 so the form doesn't show blank
-- fields for them. Matched by block_number (all lifts in a block share a town
-- council and address). Only fills NULLs, so re-running this file — which
-- migrate.js does on every run — never overwrites a value edited later.
UPDATE lifts l
SET town_council = v.town_council,
    address      = v.address
FROM (
  VALUES
    ('44A', 'Marsiling-Yew Tee Town Council', 'Blk 44A Woodlands Dr 44, Singapore 730044'),
    ('44B', 'Marsiling-Yew Tee Town Council', 'Blk 44B Woodlands Dr 44, Singapore 730045'),
    ('44C', 'Marsiling-Yew Tee Town Council', 'Blk 44C Woodlands Dr 44, Singapore 730046'),
    ('45A', 'Marsiling-Yew Tee Town Council', 'Blk 45A Woodlands Dr 45, Singapore 730047'),
    ('45B', 'Marsiling-Yew Tee Town Council', 'Blk 45B Woodlands Dr 45, Singapore 730048')
) AS v(block_number, town_council, address)
WHERE l.block_number = v.block_number
  AND (l.town_council IS NULL OR l.address IS NULL);
