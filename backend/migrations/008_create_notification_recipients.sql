-- Migration: Create notification_recipients table
CREATE TABLE IF NOT EXISTS notification_recipients (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_id  UUID NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
  resident_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  delivered        BOOLEAN NOT NULL DEFAULT FALSE,
  read             BOOLEAN NOT NULL DEFAULT FALSE,
  read_at          TIMESTAMP,
  UNIQUE (notification_id, resident_id)
);

CREATE INDEX IF NOT EXISTS idx_notif_recipients_notification ON notification_recipients(notification_id);
CREATE INDEX IF NOT EXISTS idx_notif_recipients_resident     ON notification_recipients(resident_id);
