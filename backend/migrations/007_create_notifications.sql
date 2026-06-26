-- Migration: Create notifications table
CREATE TABLE IF NOT EXISTS notifications (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  manager_id  UUID NOT NULL REFERENCES users(id),
  message     VARCHAR(500) NOT NULL,
  scope       JSONB NOT NULL,                    -- { blocks: ['7','12'], type: 'specific' }
  urgency     VARCHAR(20) NOT NULL
              CHECK (urgency IN ('Informational','Warning','Critical')),
  status      VARCHAR(20) NOT NULL DEFAULT 'Sent'
              CHECK (status IN ('Sent','Scheduled','Cancelled','Failed')),
  send_time   TIMESTAMP,                         -- null = immediate
  sent_at     TIMESTAMP,
  created_at  TIMESTAMP NOT NULL DEFAULT NOW()
);
