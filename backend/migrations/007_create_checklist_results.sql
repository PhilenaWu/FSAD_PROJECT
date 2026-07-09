-- Migration: Create checklist_results table (per-inspection results)
CREATE TABLE IF NOT EXISTS checklist_results (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inspection_id     UUID NOT NULL REFERENCES inspections(id) ON DELETE CASCADE,
  checklist_item_id UUID NOT NULL REFERENCES checklist_items(id),
  result            VARCHAR(10) NOT NULL CHECK (result IN ('Pass','Defect')),
  severity          VARCHAR(10) CHECK (severity IN ('Minor','Major','Critical')),
  remark            TEXT,
  photo_url         VARCHAR(500),                -- Cloudinary /defects (per defect item)
  completion_photo_url VARCHAR(500),             -- contractor's proof photo (UC-010)
  completion_remark TEXT,                        -- contractor's remark (UC-010)
  rectified         BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE INDEX IF NOT EXISTS idx_checklist_results_inspection ON checklist_results(inspection_id);
