// UC-008 recipient bell. Listens for live `notification` Socket.IO events and
// shows an unread count; the menu lists received messages with a mark-as-read
// action. In-session only (received while connected) — enough for the real-time
// path; a persisted inbox can layer on later.
import { useEffect, useState } from 'react';
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
import { markRead } from '../../services/notificationService';

const URGENCY_COLOR = {
  Informational: 'default',
  Warning: 'warning',
  Critical: 'error',
};

export default function NotificationBell() {
  const { socket } = useSocket();
  const [items, setItems] = useState([]); // { id, message, urgency, created_at, read }
  const [anchor, setAnchor] = useState(null);

  useEffect(() => {
    if (!socket) return;
    const onNotification = (n) => {
      setItems((prev) => [{ ...n, read: false }, ...prev]);
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
                sx={{ bgcolor: n.read ? 'transparent' : 'action.hover', cursor: n.read ? 'default' : 'pointer' }}
                onClick={() => !n.read && handleMarkRead(n.id)}
              >
                <ListItemText
                  primary={
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <Chip
                        size="small"
                        label={n.urgency}
                        color={URGENCY_COLOR[n.urgency] ?? 'default'}
                      />
                      {!n.read && (
                        <Typography variant="caption" color="primary">
                          Tap to mark read
                        </Typography>
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
