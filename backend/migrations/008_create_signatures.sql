-- Migration: Create signatures table (dual e-signature for joint endorsement)
CREATE TABLE IF NOT EXISTS signatures (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inspection_id UUID NOT NULL REFERENCES inspections(id) ON DELETE CASCADE,
  signer_role   VARCHAR(20) NOT NULL CHECK (signer_role IN ('inspector','manager','contractor')),
  signer_id     UUID NOT NULL REFERENCES users(id),
  image_url     VARCHAR(500) NOT NULL,           -- Cloudinary /signatures
  signed_at     TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_signatures_inspection ON signatures(inspection_id);
