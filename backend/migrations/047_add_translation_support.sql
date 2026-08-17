-- Migration: display-language preference + a cache for translated report text.
--
-- Residents can already dictate a report in English, Mandarin, Malay or Tamil
-- (frontend/src/services/voiceService.js) — but whatever language a report
-- lands in is exactly what every viewer sees, staff included. A manager who
-- doesn't read Chinese has no way to understand a Chinese-written report.
--
-- preferred_language: which of those four a person wants OTHERS' free text
-- translated into for them. Nullable — unset means "show me the original,
-- untranslated" (today's behaviour), not a forced default. Every role can set
-- it, not just managers: it is a reading preference, not a manager-only tool.
ALTER TABLE users ADD COLUMN IF NOT EXISTS preferred_language VARCHAR(5);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'users_preferred_language_check'
  ) THEN
    ALTER TABLE users
      ADD CONSTRAINT users_preferred_language_check
      CHECK (preferred_language IN ('en', 'zh', 'ms', 'ta'));
  END IF;
END $$;

-- inspection_translations: a cache, not a source of truth. The resident's own
-- title/description in `inspections` is never edited or overwritten — this
-- table only ever holds a *derived* copy for one (inspection, target
-- language) pair, so the same report read by two Chinese-preferring managers
-- costs one OpenAI call, not two, and the original always stays recoverable.
CREATE TABLE IF NOT EXISTS inspection_translations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inspection_id   UUID NOT NULL REFERENCES inspections(id) ON DELETE CASCADE,
  target_language VARCHAR(5) NOT NULL CHECK (target_language IN ('en', 'zh', 'ms', 'ta')),
  title           TEXT,
  description     TEXT,
  -- The model is asked to say so explicitly rather than the caller diffing
  -- strings — a translation that happens to come back identical (a title
  -- that's just a block number, say) is not the same claim as "this was
  -- already in the target language", and only the model actually knows which.
  was_translated  BOOLEAN NOT NULL,
  created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (inspection_id, target_language)
);
CREATE INDEX IF NOT EXISTS idx_inspection_translations_inspection
  ON inspection_translations(inspection_id);
