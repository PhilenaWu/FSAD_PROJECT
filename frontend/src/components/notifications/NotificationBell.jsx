// UC-008 recipient bell. Loads the persisted inbox on mount, then listens for
// live `notification` Socket.IO events and prepends them. Shows an unread count;
// the menu lists messages with a mark-as-read action, and a message carrying a
// `link` (lifecycle events do) navigates to the record it is about.
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import {
  Badge,
  Box,
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

const URGENCY_COLOR = {
  Informational: 'default',
  Warning: 'warning',
  Critical: 'error',
};

export default function NotificationBell() {
  const { socket } = useSocket();
  const navigate = useNavigate();
  // { id, message, urgency, event_type, link, created_at, read }
  const [items, setItems] = useState([]);
  const [anchor, setAnchor] = useState(null);

  // Seed from the server so anything received while offline is still here. A
  // failure leaves the list empty and the socket path still works.
  useEffect(() => {
    let active = true;
    list()
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

  const unreadCount = items.filter((i) => !i.read).length;

  async function handleMarkRead(id) {
    // Optimistic: flip locally, then persist. A failed PATCH just leaves the
    // server row unread; the next mark retries.
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, read: true } : i)));
    try {
      await markRead(id);
    } catch {
      // no-op — see comment above
    }
  }

  // Clicking a row marks it read and, for a lifecycle event, opens the record it
  // refers to. Broadcasts have no link and stay put.
  function handleClick(n) {
    if (!n.read) handleMarkRead(n.id);
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
        <Box sx={{ px: 2, py: 1 }}>
          <Typography variant="subtitle1" fontWeight={700}>
            Notifications
          </Typography>
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
                sx={{
                  bgcolor: n.read ? 'transparent' : 'action.hover',
                  cursor: !n.read || n.link ? 'pointer' : 'default',
                }}
                onClick={() => handleClick(n)}
              >
                <ListItemText
                  primary={
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <Chip
                        size="small"
                        label={n.urgency}
                        color={URGENCY_COLOR[n.urgency] ?? 'default'}
                      />
                      {n.link ? (
                        <Typography variant="caption" color="primary">
                          Tap to open
                        </Typography>
                      ) : (
                        !n.read && (
                          <Typography variant="caption" color="primary">
                            Tap to mark read
                          </Typography>
                        )
                      )}
                    </Box>
                  }
                  secondary={n.message}
                  secondaryTypographyProps={{ color: 'text.primary', sx: { mt: 0.5 } }}
                />
              </ListItem>
            ))}
          </List>
        )}
      </Menu>
    </>
  );
}
