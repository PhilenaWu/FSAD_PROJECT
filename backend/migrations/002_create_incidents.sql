-- Migration: Create incidents table
-- Note: cv_detection_id references cv_detections, which is created in migration
-- 004. The foreign key is added there (see 004) so this file can run first.
CREATE TABLE IF NOT EXISTS incidents (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  resident_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title                 VARCHAR(255) NOT NULL,
  description           TEXT NOT NULL,
  location_block        VARCHAR(20)  NOT NULL,
  location_unit         VARCHAR(20),
  photo_url             VARCHAR(500),            -- Cloudinary /defects URL
  photo_pending         BOOLEAN NOT NULL DEFAULT FALSE,
  status                VARCHAR(30)  NOT NULL DEFAULT 'Open'
                        CHECK (status IN (
                          'Open','Pending Assignment','In Progress',
                          'Awaiting Parts','Resolved','Closed'
                        )),
  category              VARCHAR(50)  NOT NULL DEFAULT 'Uncategorised'
                        CHECK (category IN (
                          'Structural','Electrical','Plumbing','Cleanliness',
                          'Lift','Landscaping','Pest','Other','Uncategorised'
                        )),
  priority              VARCHAR(20)  NOT NULL DEFAULT 'Medium'
                        CHECK (priority IN ('Critical','High','Medium','Low')),
  ai_priority_score     INTEGER      CHECK (ai_priority_score BETWEEN 1 AND 100),
  assigned_department   VARCHAR(100),
  target_resolution_hrs INTEGER,
  is_deleted            BOOLEAN NOT NULL DEFAULT FALSE,
  closing_remark        TEXT,
  resolution_time_hours NUMERIC(8,2),
  satisfaction_rating   INTEGER      CHECK (satisfaction_rating BETWEEN 1 AND 5),
  satisfaction_comment  TEXT,
  source_flag           VARCHAR(30)  DEFAULT 'Resident'
                        CHECK (source_flag IN ('Resident','Auto-Detected','AI-Generated')),
  cv_detection_id       UUID,                    -- FK added in migration 004
  closed_at             TIMESTAMP,
  created_at            TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_incidents_resident_id ON incidents(resident_id);
CREATE INDEX IF NOT EXISTS idx_incidents_status      ON incidents(status);
CREATE INDEX IF NOT EXISTS idx_incidents_category    ON incidents(category);
CREATE INDEX IF NOT EXISTS idx_incidents_block       ON incidents(location_block);
CREATE INDEX IF NOT EXISTS idx_incidents_created_at  ON incidents(created_at);
