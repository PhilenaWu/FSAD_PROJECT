-- Migration: Create cv_detections table
CREATE TABLE IF NOT EXISTS cv_detections (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  image_url     VARCHAR(500) NOT NULL,           -- Cloudinary /defects URL
  defect_class  VARCHAR(100) NOT NULL,           -- 'crack','water_stain','debris'…
  confidence    NUMERIC(5,4) NOT NULL,           -- 0.0000 – 1.0000
  bounding_box  JSONB,                           -- { x, y, width, height }
  source        VARCHAR(30)  NOT NULL
                CHECK (source IN ('resident_upload','scheduled_scan')),
  status        VARCHAR(20)  NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','processed','low_confidence')),
  detected_at   TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Deferred foreign key from incidents (002) — cv_detections did not exist yet
-- when that table was created. Guarded so re-runs do not error.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_incidents_cv_detection'
  ) THEN
    ALTER TABLE incidents
      ADD CONSTRAINT fk_incidents_cv_detection
      FOREIGN KEY (cv_detection_id) REFERENCES cv_detections(id);
  END IF;
END $$;
