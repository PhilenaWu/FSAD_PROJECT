// UC-007 (phase task 4.8) — "Needs Manual Review" panel listing low-confidence
// CV detections. Self-fetches (unlike the analytics panels, which share one
// page-level fetch across several components) so it's a true drop-in: render
// <ManualReviewQueue /> anywhere with no data-fetching wiring required from
// the parent page. Intended for IncidentListPage.jsx once UC-002 lands.
import { useEffect, useState } from 'react';
import { Alert, Box, Chip, Grid2 as Grid, Paper, Skeleton, Stack, Typography } from '@mui/material';
import ImageSearchOutlinedIcon from '@mui/icons-material/ImageSearchOutlined';
import BoundingBoxOverlay from './BoundingBoxOverlay';
import { getManualReviewQueue } from '../../services/cvService';

function formatConfidence(confidence) {
  return `${Math.round(Number(confidence) * 100)}%`;
}

function formatDate(iso) {
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export default function ManualReviewQueue() {
  const [detections, setDetections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    getManualReviewQueue()
      .then(({ data }) => {
        if (!cancelled) setDetections(data);
      })
      .catch(() => {
        if (!cancelled) setError('Could not load the manual review queue.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return (
      <Stack spacing={2}>
        <Skeleton variant="rounded" height={180} />
        <Skeleton variant="rounded" height={180} />
      </Stack>
    );
  }

  if (error) {
    return <Alert severity="error">{error}</Alert>;
  }

  if (detections.length === 0) {
    return (
      <Box sx={{ py: 6, textAlign: 'center' }}>
        <ImageSearchOutlinedIcon sx={{ fontSize: 40, color: 'text.secondary', mb: 1 }} />
        <Typography color="text.secondary">No detections need manual review right now.</Typography>
      </Box>
    );
  }

  return (
    <Grid container spacing={2}>
      {detections.map((d) => (
        <Grid key={d.id} size={{ xs: 12, sm: 6, md: 4 }}>
          <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 2 }}>
            <BoundingBoxOverlay
              imageUrl={d.image_url}
              boundingBox={d.bounding_box}
              label={d.defect_class ?? 'unclassified'}
              alt={`Possible ${d.defect_class ?? 'defect'}`}
            />
            <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mt: 1 }}>
              <Typography variant="body2" fontWeight={600} textTransform="capitalize">
                {d.defect_class ?? 'Unclassified'}
              </Typography>
              <Chip label={formatConfidence(d.confidence)} size="small" color="warning" variant="outlined" />
            </Stack>
            <Typography variant="caption" color="text.secondary">
              {formatDate(d.detected_at)} · {d.source === 'resident_upload' ? 'Resident upload' : 'Scheduled scan'}
            </Typography>
          </Paper>
        </Grid>
      ))}
    </Grid>
  );
}
