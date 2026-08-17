-- Extends the translation cache (047) to the resident-facing extras: the
-- manager's closing remark, checklist remarks, and audit-history notes shown
-- on MyReportsPage — text other people wrote that the resident may not read.
-- Same cache row/key as the manager-side title/description translation;
-- these columns are filled in independently, by whichever side asks for its
-- half first — so a fresh row may exist with only the extras half present.
-- was_translated (047) was NOT NULL on the assumption every row came from
-- the title/description path; that no longer holds, so it's relaxed here.
-- extras_was_translated is its own column, not a shared boolean, because
-- "was the title already in the target language" and "were the remarks/notes
-- already in it" are independent facts that can legitimately disagree.
ALTER TABLE inspection_translations ALTER COLUMN was_translated DROP NOT NULL;
ALTER TABLE inspection_translations ADD COLUMN IF NOT EXISTS closing_remark TEXT;
ALTER TABLE inspection_translations ADD COLUMN IF NOT EXISTS checklist_remarks JSONB;
ALTER TABLE inspection_translations ADD COLUMN IF NOT EXISTS history_notes JSONB;
ALTER TABLE inspection_translations ADD COLUMN IF NOT EXISTS extras_was_translated BOOLEAN;
