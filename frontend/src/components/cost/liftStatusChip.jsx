// UC-011 watchlist row status from lifetime spend vs the review threshold.
import { Chip } from '@mui/material';

export default function liftStatusChip(pct) {
  if (pct >= 100) return <Chip size="small" color="error" label="Review replacement" />;
  if (pct >= 75) return <Chip size="small" color="warning" label="Approaching review" />;
  return <Chip size="small" color="success" label="Healthy" />;
}
