// UC-008 recipient bell. Loads the persisted inbox on mount, then listens for
// live `notification` Socket.IO events and prepends them. Shows an unread count;
// the menu lists messages with a mark-as-read action, and a message carrying a
// `link` (lifecycle events do) navigates to the record it is about.
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import {
  Badge,
  Box,
  Button,
  Chip,
  Divider,
  IconButton,
  List,
  ListItem,
  ListItemText,
  Menu,
  Typography,
} from '@mui/material';
import NotificationsNoneOutlinedIcon from '@mui/icons-material/NotificationsNoneOutlined';
import { useSocket } from '../../context/SocketContext';
import { list, markRead } from '../../services/notificationService';

// Chip background per lifecycle event. Every routine event was
// `Informational`, so the whole bell was a column of identical grey chips and
// the label was the only thing separating "Closed" from "Overdue". Colour now
// groups events by what kind of thing they are:
//   blue    — something is now yours to do
//   green   — work moved forward or finished cleanly
//   teal    — neutral status change, nothing owed
//   orange  — stalled or sent back, needs a look
//   red     — failed, overdue, or a vendor is not usable
//   magenta — produced by AI/automation rather than a person
//
// Values are `sx` background tokens, not Chip `color` names, because the whole
// chip is filled (see the Chip below). The theme's `secondary` purple was the
// obvious pick for the automation group but sat too close to `primary` blue to
// tell apart at chip size, so automation gets an explicit magenta instead —
// the one colour here with no palette entry to point at.
const AUTOMATION = '#DB2777';
const EVENT_COLOR = {
  acknowledged: 'info.main',
  rectified: 'success.main',
  review_requested: 'primary.main',
  on_hold: 'warning.main',
  resumed: 'info.main',
  defects_flagged: 'warning.main',
  spot_check_passed: 'success.main',
  complaint_submitted: 'primary.main',
  defect_assigned: 'primary.main',
  defect_reassigned: 'primary.main',
  defect_unassigned: 'info.main',
  priority_changed: 'info.main',
  rectification_rejected: 'warning.main',
  closed: 'success.main',
  overdue_chase: 'error.main',
  defect_email_failed: 'error.main',
  cv_detection: AUTOMATION,
  ai_alerts_generated: AUTOMATION,
  rating_submitted: 'success.main',
  report_ready: AUTOMATION,
  vendor_onboarded: 'success.main',
  vendor_renewed: 'success.main',
  vendor_suspended: 'error.main',
  vendor_expired: 'error.main',
  vendor_expiring_soon: 'warning.main',
};

// What each lifecycle event is called in the bell (D.13). The chip used to print
// the raw `urgency`, so a routine "contractor acknowledged the defect" arrived
// stamped "Warning" alongside a genuine escalation — every row looked like a
// problem and the label carried no information the message didn't already give.
// Now the chip says what happened and only its *colour* carries urgency, so
// Warning/Critical mean something again.
const EVENT_LABEL = {
  acknowledged: 'Acknowledged',
  rectified: 'Work submitted',
  // The inspector's half of a contractor finishing (item 17) — a task, where
  // 'rectified' is a notice to the managers.
  review_requested: 'Check the work',
  on_hold: 'On hold',
  resumed: 'Resumed',
  defects_flagged: 'Defects flagged',
  spot_check_passed: 'Spot check passed',
  complaint_submitted: 'New complaint',
  defect_assigned: 'Assigned to you',
  defect_reassigned: 'Reassigned',
  defect_unassigned: 'Unassigned',
  priority_changed: 'Priority changed',
  rectification_rejected: 'Sent back',
  closed: 'Closed',
  overdue_chase: 'Overdue',
  defect_email_failed: 'Email failed',
  cv_detection: 'AI detection',
  ai_alerts_generated: 'AI alerts',
  rating_submitted: 'Rating received',
  report_ready: 'Report ready',
  vendor_onboarded: 'Vendor onboarded',
  vendor_renewed: 'Vendor renewed',
  vendor_suspended: 'Vendor suspended',
  vendor_expired: 'Contract expired',
  vendor_expiring_soon: 'Contract expiring',
};

// A manager broadcast has no event_type — "Announcement" is the honest label for
// it, and is still distinguishable from a system event by colour + wording.
function labelFor(n) {
  if (n.event_type) return EVENT_LABEL[n.event_type] ?? 'Update';
  return n.urgency === 'Informational' ? 'Announcement' : n.urgency;
}

// Urgency still wins: an escalated event must not be hidden behind its calm
// event colour. Below that, the event type picks the colour. A manager
// broadcast has no event type and stays grey — it is a human talking, not a
// system state, and greying it keeps that distinction readable.
function colorFor(n) {
  if (n.urgency === 'Critical') return 'error.main';
  if (n.urgency === 'Warning') return 'warning.main';
  if (!n.event_type) return 'grey.600';
  return EVENT_COLOR[n.event_type] ?? 'grey.600';
}

export default function NotificationBell() {
  const { socket } = useSocket();
  const navigate = useNavigate();
  // { id, message, urgency, event_type, link, created_at, read,
  //   sender_name, sender_role } — the sender pair is null on lifecycle events.
  const [items, setItems] = useState([]);
  const [anchor, setAnchor] = useState(null);

  // Seed from the server so anything received while offline is still here. A
  // failure leaves the list empty and the socket path still works.
  //
  // Unread only: the bell is a to-do list, not an archive. Reading a
  // notification takes it out of the list (below), and fetching only unread
  // keeps it out after a refresh instead of resurrecting everything the user
  // has already dealt with.
  useEffect(() => {
    let active = true;
    list({ unread_only: true })
      .then(({ data }) => {
        if (active) setItems(data.data ?? []);
      })
      .catch(() => {
        // Offline or the request failed — live events still populate the bell.
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!socket) return;
    const onNotification = (n) => {
      // De-dupe by id: a notification can arrive over the socket and also be in
      // the fetched page, and the same socket may deliver it twice if the user
      // is in more than one target room.
      setItems((prev) =>
        prev.some((i) => i.id === n.id) ? prev : [{ ...n, read: false }, ...prev]
      );
    };
    socket.on('notification', onNotification);
    return () => socket.off('notification', onNotification);
  }, [socket]);

  // Everything held here is unread — reading one removes it.
  const unreadCount = items.length;

  // Reading a notification drops it from the list rather than greying it in
  // place. Rows used to stay after being read, so a busy week left the bell
  // holding dozens of already-handled messages and the new ones were the hard
  // part to find. The row is still marked read server-side, so a manager's read
  // receipts (UC-008) are unaffected — it only leaves this list.
  //
  // Optimistic: remove locally, then persist. A failed PATCH leaves the server
  // row unread, so it returns on the next refresh rather than being lost.
  async function handleMarkRead(id) {
    setItems((prev) => prev.filter((i) => i.id !== id));
    try {
      await markRead(id);
    } catch {
      // no-op — see comment above
    }
  }

  // Clear the whole backlog. There is no bulk endpoint, so this fans out one
  // PATCH per row — fine at inbox size, and it keeps the change to the frontend.
  async function handleMarkAllRead() {
    const pending = items;
    setItems([]);
    try {
      await Promise.all(pending.map((i) => markRead(i.id)));
    } catch {
      // no-op — a failed row stays unread server-side and comes back on reload
    }
  }

  // Clicking a row reads it — which removes it — and, for a lifecycle event,
  // opens the record it refers to.
  function handleClick(n) {
    handleMarkRead(n.id);
    if (n.link) {
      setAnchor(null);
      navigate(n.link);
    }
  }

  return (
    <>
      <IconButton
        aria-label="Notifications"
        color="inherit"
        onClick={(e) => setAnchor(e.currentTarget)}
      >
        <Badge color="primary" badgeContent={unreadCount} variant={unreadCount ? 'standard' : 'dot'} invisible={items.length === 0}>
          <NotificationsNoneOutlinedIcon />
        </Badge>
      </IconButton>

      <Menu
        anchorEl={anchor}
        open={Boolean(anchor)}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        slotProps={{ paper: { sx: { width: 320, maxHeight: 400 } } }}
      >
        {/* Clearing a backlog used to mean opening every row one at a time —
            each click navigated away, so it was the slowest possible way to
            do it. */}
        <Box sx={{ px: 2, py: 1, display: 'flex', alignItems: 'center', gap: 1 }}>
          <Typography variant="subtitle1" fontWeight={700} sx={{ flexGrow: 1 }}>
            Notifications
          </Typography>
          {unreadCount > 0 && (
            <Button size="small" onClick={handleMarkAllRead}>
              Mark all read
            </Button>
          )}
        </Box>
        <Divider />

        {items.length === 0 ? (
          <Box sx={{ px: 2, py: 3 }}>
            <Typography variant="body2" color="text.secondary">
              No notifications yet.
            </Typography>
          </Box>
        ) : (
          <List dense disablePadding>
            {items.map((n, idx) => (
              <ListItem
                key={`${n.id}-${idx}`}
                alignItems="flex-start"
                // Every row here is unread — reading one removes it — so the
                // tint and accent bar no longer distinguish rows from each
                // other, they mark the whole list as outstanding work. The
                // accent keeps the row's own event colour.
                sx={{
                  bgcolor: 'action.hover',
                  borderLeft: 3,
                  borderColor: colorFor(n),
                  cursor: 'pointer',
                }}
                onClick={() => handleClick(n)}
              >
                <ListItemText
                  primary={
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      {/* Solid fill on every chip: the outline version put the
                          colour on the text, which was too thin to read as a
                          group at this size. Colour is set through `sx` rather
                          than the `color` prop so the automation magenta —
                          which has no palette entry — works the same way. */}
                      <Chip
                        size="small"
                        label={labelFor(n)}
                        sx={{ bgcolor: colorFor(n), color: 'common.white' }}
                      />
                      {/* Both actions now also clear the row, so say so — "Tap
                          to open" alone left it looking like the message would
                          still be here afterwards. */}
                      <Typography variant="caption" color="primary">
                        {n.link ? 'Tap to open' : 'Tap to dismiss'}
                      </Typography>
                      {/* Unread dot, right-aligned. The accent bar says the
                          same thing, but the bar is easy to miss on the row
                          you are actually looking at. */}
                      <Box
                        sx={{
                          ml: 'auto',
                          width: 8,
                          height: 8,
                          borderRadius: '50%',
                          bgcolor: 'primary.main',
                          flexShrink: 0,
                        }}
                      />
                    </Box>
                  }
                  secondary={
                    <>
                      <Typography variant="body2" color="text.primary" sx={{ mt: 0.5 }}>
                        {n.message}
                      </Typography>
                      {/* Who sent it. Only human-authored messages have a
                          sender; a lifecycle event has no author, and
                          "System" is more honest than a blank line. */}
                      <Typography variant="caption" color="text.secondary">
                        {n.sender_name
                          ? `From ${n.sender_name}${n.sender_role ? ` · ${n.sender_role}` : ''}`
                          : 'System'}
                      </Typography>
                    </>
                  }
                  secondaryTypographyProps={{ component: 'div' }}
                />
              </ListItem>
            ))}
          </List>
        )}
      </Menu>
    </>
  );
}
