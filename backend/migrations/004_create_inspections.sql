-- Migration: Create inspections table (core record — replaces old `incidents`)
-- Holds all three record types via source_type. Lift-specific columns (lift_id)
-- are nullable and populated only for 'lift_inspection'; resident columns
-- (resident_id, description, audio_url) only for 'resident_complaint'.
-- Note: cv_detection_id references cv_detections, which is created in migration
-- 009. The foreign key is added there (see 009) so this file can run first.
CREATE TABLE IF NOT EXISTS inspections (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_type           VARCHAR(20)  NOT NULL
                        CHECK (source_type IN
                          ('lift_inspection','resident_complaint','cv_auto_detected')),
  -- originator (one of these is set depending on source_type)
  resident_id           UUID         REFERENCES users(id) ON DELETE CASCADE,
  inspector_id          UUID         REFERENCES users(id),
  lift_id               UUID         REFERENCES lifts(id),          -- lift_inspection only
  -- common content
  title                 VARCHAR(255) NOT NULL,
  description           TEXT,                                        -- complaint text / summary
  audio_url             VARCHAR(500),            -- Cloudinary /audio URL (voice complaints)
  location_block        VARCHAR(20)  NOT NULL,
  location_unit         VARCHAR(20),
  photo_url             VARCHAR(500),            -- Cloudinary /defects URL (primary photo)
  photo_pending         BOOLEAN NOT NULL DEFAULT FALSE,
  status                VARCHAR(30)  NOT NULL DEFAULT 'Open'
                        CHECK (status IN (
                          'Open','Pending Assignment','Assigned','Acknowledged',
                          'On Hold','Rectified','Resolved','Closed'
                        )),
  category              VARCHAR(50)  NOT NULL DEFAULT 'Uncategorised'
                        CHECK (category IN (
                          'Structural','Electrical','Plumbing','Cleanliness',
                          'Lift','Doors','Cabin','Safety','Landscaping','Pest',
                          'Other','Uncategorised'
                        )),
  priority              VARCHAR(20)  NOT NULL DEFAULT 'Medium'
                        CHECK (priority IN ('Critical','High','Medium','Low')),
  ai_priority_score     INTEGER      CHECK (ai_priority_score BETWEEN 1 AND 100),
  -- assignment
  contractor_id         UUID         REFERENCES contractors(id),
  target_deadline       TIMESTAMP,               -- 14-day rule for lift defects
  acknowledged_at       TIMESTAMP,
  rectified_at          TIMESTAMP,
  hold_reason           VARCHAR(100),            -- when status = 'On Hold'
  -- closure / audit
  is_deleted            BOOLEAN NOT NULL DEFAULT FALSE,
  closing_remark        TEXT,
  resolution_time_hours NUMERIC(8,2),
  actual_cost           NUMERIC(10,2),           -- entered at close (UC-004); feeds UC-011
  satisfaction_rating   INTEGER      CHECK (satisfaction_rating BETWEEN 1 AND 5),
  satisfaction_comment  TEXT,
  source_flag           VARCHAR(30)  DEFAULT 'Resident'
                        CHECK (source_flag IN
                          ('Resident','Inspector','Auto-Detected','AI-Generated')),
  cv_detection_id       UUID,                    -- FK added in migration 009
  closed_at             TIMESTAMP,
  created_at            TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_inspections_source_type  ON inspections(source_type);
CREATE INDEX IF NOT EXISTS idx_inspections_resident_id  ON inspections(resident_id);
CREATE INDEX IF NOT EXISTS idx_inspections_inspector_id ON inspections(inspector_id);
CREATE INDEX IF NOT EXISTS idx_inspections_lift_id      ON inspections(lift_id);
CREATE INDEX IF NOT EXISTS idx_inspections_contractor   ON inspections(contractor_id);
CREATE INDEX IF NOT EXISTS idx_inspections_status       ON inspections(status);
CREATE INDEX IF NOT EXISTS idx_inspections_category     ON inspections(category);
CREATE INDEX IF NOT EXISTS idx_inspections_block        ON inspections(location_block);
CREATE INDEX IF NOT EXISTS idx_inspections_created_at   ON inspections(created_at);
