// UC-007 (phase task 4.7) — draws a Roboflow bounding box on top of a photo.
// boundingBox coords (x, y = centre point; width, height) are in the pixel
// space of the *original* image Roboflow ran on (its naturalWidth/Height),
// which can differ from however large the <img> is actually rendered — so
// the box is measured on image load and scaled to match. This is a one-shot
// measurement (no ResizeObserver): demo-fidelity acceptable per the phase
// doc, and a responsive layout resize is a rare edge case for a detail photo.
import { useState } from 'react';
import { Box, Chip } from '@mui/material';

export default function BoundingBoxOverlay({ imageUrl, boundingBox, alt = 'Defect photo', label }) {
  const [scale, setScale] = useState(null);

  function handleLoad(e) {
    const img = e.target;
    setScale({
      x: img.clientWidth / img.naturalWidth,
      y: img.clientHeight / img.naturalHeight,
    });
  }

  const box =
    scale && boundingBox
      ? {
          left: (boundingBox.x - boundingBox.width / 2) * scale.x,
          top: (boundingBox.y - boundingBox.height / 2) * scale.y,
          width: boundingBox.width * scale.x,
          height: boundingBox.height * scale.y,
        }
      : null;

  return (
    <Box sx={{ position: 'relative', display: 'inline-block', maxWidth: '100%' }}>
      <Box
        component="img"
        src={imageUrl}
        alt={alt}
        onLoad={handleLoad}
        sx={{ display: 'block', maxWidth: '100%', height: 'auto', borderRadius: 1 }}
      />
      {box && (
        <Box
          sx={{
            position: 'absolute',
            left: box.left,
            top: box.top,
            width: box.width,
            height: box.height,
            border: '2px solid',
            borderColor: 'error.main',
            boxSizing: 'border-box',
            pointerEvents: 'none',
          }}
        />
      )}
      {/* Sibling of the box, not a child: the box's own width is often tiny
          (sized to the detected region), and Chip's default max-width: 100%
          resolves against its containing block — nesting it inside the box
          would clip the label text down to almost nothing on small boxes. */}
      {box && label && (
        <Chip
          label={label}
          size="small"
          color="error"
          sx={{
            position: 'absolute',
            left: Math.max(box.left - 2, 0),
            top: Math.max(box.top - 28, 0),
            height: 22,
            fontSize: 11,
            maxWidth: 'none',
            pointerEvents: 'none',
          }}
        />
      )}
    </Box>
  );
}
