// Optional GPS capture button shared by the report/inspection forms.
// Tap-triggered only (never automatic); failure to capture never blocks submit —
// GPS is supplementary and never replaces the required block/lift selection.
// value/onChange: null or { lat, lng, accuracy_m, captured_at (ISO string) }.
import { useState } from 'react';
import { Button, Stack, Typography } from '@mui/material';
import MyLocationIcon from '@mui/icons-material/MyLocation';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';

export default function LocationCapture({ value, onChange }) {
  const [status, setStatus] = useState(null); // 'locating' | 'error' message
  const [errorMsg, setErrorMsg] = useState('');

  function capture() {
    setErrorMsg('');
    if (!navigator.geolocation) {
      setErrorMsg('Location is not supported by this browser — you can still submit.');
      return;
    }
    setStatus('locating');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setStatus(null);
        onChange({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy_m: pos.coords.accuracy,
          captured_at: new Date(pos.timestamp).toISOString(),
        });
      },
      () => {
        // Denied, timed out, or unavailable — same friendly outcome.
        setStatus(null);
        setErrorMsg('Could not get your location — you can still submit.');
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 }
    );
  }

  return (
    <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap">
      <Button
        variant="outlined"
        size="small"
        startIcon={<MyLocationIcon fontSize="small" />}
        onClick={capture}
        disabled={status === 'locating'}
      >
        {status === 'locating'
          ? 'Locating…'
          : value
            ? 'Recapture location'
            : 'Capture location'}
      </Button>
      {value && (
        <Stack direction="row" spacing={0.5} alignItems="center" sx={{ color: 'success.main' }}>
          <CheckCircleOutlineIcon sx={{ fontSize: 16 }} />
          <Typography variant="caption">
            Location captured, accuracy ~{Math.round(value.accuracy_m)}m
          </Typography>
        </Stack>
      )}
      {errorMsg && (
        <Typography variant="caption" color="text.secondary">
          {errorMsg}
        </Typography>
      )}
    </Stack>
  );
}
