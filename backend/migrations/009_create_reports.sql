-- Migration: Create reports table
CREATE TABLE IF NOT EXISTS reports (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_url      VARCHAR(500),                  -- Cloudinary /reports URL
  period_start    DATE NOT NULL,
  period_end      DATE NOT NULL,
  generated_at    TIMESTAMP NOT NULL DEFAULT NOW(),
  triggered_by    VARCHAR(20) NOT NULL
                  CHECK (triggered_by IN ('github_actions','manual')),
  report_status   VARCHAR(20) NOT NULL DEFAULT 'Ready'
                  CHECK (report_status IN ('Ready','Upload failed')),
  email_delivered BOOLEAN NOT NULL DEFAULT FALSE
);
