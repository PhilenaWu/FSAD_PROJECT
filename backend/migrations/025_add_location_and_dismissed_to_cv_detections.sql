-- Migration: cv_detections gains location columns (so a low-confidence
-- detection can still be turned into a ticket later, with the right block/unit)
-- and a 'dismissed' status (manager reviewed it and decided it wasn't real).
ALTER TABLE cv_detections
  ADD COLUMN IF NOT EXISTS location_block VARCHAR(20),
  ADD COLUMN IF NOT EXISTS location_unit  VARCHAR(20);

ALTER TABLE cv_detections DROP CONSTRAINT IF EXISTS cv_detections_status_check;
ALTER TABLE cv_detections
  ADD CONSTRAINT cv_detections_status_check
  CHECK (status IN ('pending','processed','low_confidence','dismissed'));
