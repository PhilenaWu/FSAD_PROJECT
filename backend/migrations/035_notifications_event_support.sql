-- Migration: Let notifications carry system-generated lifecycle events (UC-008).
--
-- Until now the only thing that ever created a notification was a manager typing
-- a broadcast, so `manager_id` was safely NOT NULL. Lifecycle events (a defect
-- flagged, a rectification rejected, a vendor contract expired) have no manager
-- behind them, so the column becomes nullable — NULL means "the system".
--
-- The recipient/read-receipt machinery in notification_recipients is unchanged
-- and reused as-is; only the parent row grows.
ALTER TABLE notifications
  ALTER COLUMN manager_id DROP NOT NULL,
  -- Which lifecycle event produced this row. NULL = manager broadcast, so the
  -- existing UC-008 rows stay correct without a backfill.
  ADD COLUMN IF NOT EXISTS event_type VARCHAR(40),
  -- Where the bell should navigate on click, e.g. '/inspections/{id}'.
  ADD COLUMN IF NOT EXISTS link       VARCHAR(255);

-- notificationDispatcher.js polls for due scheduled sends every 60 s.
CREATE INDEX IF NOT EXISTS idx_notifications_due
  ON notifications(status, send_time);

-- GET /api/notifications reads a recipient's own rows, unread first.
CREATE INDEX IF NOT EXISTS idx_notification_recipients_unread
  ON notification_recipients(resident_id, read);
