-- Migration: UC-014 outbound defect email — audit log (D.1, HLD §8.2) plus the
-- G12 replay guard column.
--
-- Numbered 036, not the 028 the HLD names: that number is already taken by
-- 028_add_town_council_address_to_lifts.sql.
--
-- defect_email_sent_at was listed in P.1's column set but never actually added
-- to any migration. G12 ("the alert fires at most once per inspection") reads it
-- before every send, so D.3 cannot be idempotent without it.
--
-- Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS defect_email_log (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inspection_id  UUID NOT NULL REFERENCES inspections(id) ON DELETE CASCADE,
  contractor_id  UUID NOT NULL REFERENCES contractors(id),
  recipient      VARCHAR(255) NOT NULL,
  email_type     VARCHAR(30)  NOT NULL
                 CHECK (email_type IN ('defect_alert','reassignment','overdue_chase','rejection')),
  status         VARCHAR(20)  NOT NULL DEFAULT 'sent'
                 CHECK (status IN ('sent','failed')),
  error_message  TEXT,
  sent_at        TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_defect_email_log_inspection
  ON defect_email_log(inspection_id);

-- The overdue chase (D.7) runs daily and must send at most once per record per
-- day, which it checks by looking for an existing row of the same type dated
-- today. This index serves that lookup.
CREATE INDEX IF NOT EXISTS idx_defect_email_log_type_sent
  ON defect_email_log(inspection_id, email_type, sent_at);

ALTER TABLE inspections ADD COLUMN IF NOT EXISTS defect_email_sent_at TIMESTAMP;
