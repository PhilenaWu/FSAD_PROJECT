// Minimal canvas e-signature pad (UC-004 close; reusable for UC-010's
// contractor sign — Zoe's Z.13 names a shared pad, none existed yet).
// Ref API: isEmpty(), clear(), toBlob() → Promise<PNG Blob>.
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Box, Button, Stack, Typography } from '@mui/material';
import { useTheme } from '@mui/material/styles';

const SignaturePad = forwardRef(function SignaturePad({ label }, ref) {
  const canvasRef = useRef(null);
  const drawingRef = useRef(false);
  const [hasInk, setHasInk] = useState(false);
  const theme = useTheme();

  // Size the bitmap to the rendered box once, and fill with the paper colour so
  // the exported PNG is opaque (theme-driven — no hardcoded colours).
  useEffect(() => {
    const canvas = canvasRef.current;
    canvas.width = canvas.clientWidth;
    canvas.height = canvas.clientHeight;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = theme.palette.background.paper;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = theme.palette.text.primary;
  }, [theme]);

  function pointFrom(e) {
    const rect = canvasRef.current.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function handlePointerDown(e) {
    drawingRef.current = true;
    canvasRef.current.setPointerCapture(e.pointerId);
    const ctx = canvasRef.current.getContext('2d');
    const { x, y } = pointFrom(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
    // A tap without movement still leaves a dot, and counts as ink.
    ctx.lineTo(x + 0.1, y + 0.1);
    ctx.stroke();
    setHasInk(true);
  }

  function handlePointerMove(e) {
    if (!drawingRef.current) return;
    const ctx = canvasRef.current.getContext('2d');
    const { x, y } = pointFrom(e);
    ctx.lineTo(x, y);
    ctx.stroke();
  }

  function handlePointerUp() {
    drawingRef.current = false;
  }

  function clear() {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = theme.palette.background.paper;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    setHasInk(false);
  }

  useImperativeHandle(ref, () => ({
    isEmpty: () => !hasInk,
    clear,
    toBlob: () =>
      new Promise((resolve) => canvasRef.current.toBlob(resolve, 'image/png')),
  }));

  return (
    <Box>
      <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1} sx={{ mb: 0.5 }}>
        <Typography variant="body2" color="text.secondary">
          {label}
        </Typography>
        <Button size="small" onClick={clear} disabled={!hasInk} sx={{ flexShrink: 0 }}>
          Clear
        </Button>
      </Stack>
      <Box
        component="canvas"
        ref={canvasRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        sx={{
          width: '100%',
          height: 140,
          display: 'block',
          border: '1px dashed',
          borderColor: hasInk ? 'success.main' : 'divider',
          borderRadius: 2,
          bgcolor: 'background.paper',
          touchAction: 'none', // let pointer events draw on touch screens
          cursor: 'crosshair',
        }}
      />
    </Box>
  );
});

export default SignaturePad;
