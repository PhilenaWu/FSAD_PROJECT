// UC-005 AI risk alert card (phase task 5.12) — amber card with the alert
// text, estimated cost, and Accept / Dismiss actions.
import {
  Alert,
  Button,
  Chip,
  Stack,
  Typography,
} from '@mui/material';
import WarningAmberOutlinedIcon from '@mui/icons-material/WarningAmberOutlined';

export default function AIAlertCard({ alert, onAccept, onDismiss, busy }) {
  return (
    <Alert
      severity="warning"
      icon={<WarningAmberOutlinedIcon />}
      sx={{ alignItems: 'flex-start', '& .MuiAlert-message': { width: '100%' } }}
    >
      <Stack spacing={1}>
        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
          <Typography variant="subtitle2" fontWeight={700}>
            Block {alert.location_block} — {alert.category}
          </Typography>
          <Chip label={`▲ ${alert.velocity_pct.toFixed(0)}% in 30 days`} size="small" color="warning" variant="outlined" />
          {alert.estimated_cost != null && (
            <Chip label={`Est. $${alert.estimated_cost.toLocaleString()}`} size="small" color="warning" />
          )}
        </Stack>
        <Typography variant="body2">{alert.alert_text}</Typography>
        <Stack direction="row" spacing={1}>
          <Button size="small" variant="contained" color="warning" disabled={busy} onClick={() => onAccept(alert.id)}>
            Accept
          </Button>
          <Button size="small" variant="outlined" color="inherit" disabled={busy} onClick={() => onDismiss(alert.id)}>
            Dismiss
          </Button>
        </Stack>
      </Stack>
    </Alert>
  );
}
