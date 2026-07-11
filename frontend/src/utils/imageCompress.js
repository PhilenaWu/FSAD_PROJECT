// Client-side photo compression (task 3.12). Canvas-based, no dependency.
// Targets <= 100 KB while preserving legibility — photos are defect evidence,
// so we hold dimensions (long edge <= 1600px) and step JPEG quality down first,
// shrinking dimensions only when quality alone can't hit the target.
// Any failure returns the ORIGINAL file: compression must never block submit
// (the backend's 5 MB multer cap remains the safety net).

const DEFAULT_MAX_BYTES = 100 * 1024;
const DEFAULT_MAX_EDGE = 1600;
// Quality ladder tried at each dimension notch (first pass starts higher).
const QUALITY_STEPS = [0.85, 0.75, 0.65, 0.55, 0.45];
const EDGE_STEPS = [1600, 1280, 1024, 800];

// Decode to something drawable. createImageBitmap is fastest; fall back to an
// <img> + object URL for browsers without it.
async function decode(file) {
  if (typeof createImageBitmap === 'function') {
    return createImageBitmap(file);
  }
  const url = URL.createObjectURL(file);
  try {
    return await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

// Draw the source scaled so its long edge is <= maxEdge (never upscale),
// then encode to a JPEG blob at the given quality.
function encode(source, maxEdge, quality) {
  const scale = Math.min(1, maxEdge / Math.max(source.width, source.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(source.width * scale);
  canvas.height = Math.round(source.height * scale);
  canvas.getContext('2d').drawImage(source, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
}

// Compress `file` to <= maxBytes. Resolves to a new JPEG File, or the original
// file when it's already small enough or anything goes wrong.
export async function compressImage(
  file,
  { maxBytes = DEFAULT_MAX_BYTES, maxEdge = DEFAULT_MAX_EDGE } = {}
) {
  if (!file || file.size <= maxBytes) return file;

  try {
    const source = await decode(file);
    let best = null;

    for (const edge of EDGE_STEPS.filter((e) => e <= maxEdge)) {
      for (const quality of QUALITY_STEPS) {
        const blob = await encode(source, edge, quality);
        if (!blob) continue;
        best = blob;
        if (blob.size <= maxBytes) {
          const stem = file.name.replace(/\.[^.]+$/, '');
          return new File([blob], `${stem}.jpg`, {
            type: 'image/jpeg',
            lastModified: file.lastModified,
          });
        }
      }
    }

    // Even 800px @ 0.45 exceeded the target (unusual); ship the smallest
    // attempt rather than the multi-MB original.
    if (best && best.size < file.size) {
      const stem = file.name.replace(/\.[^.]+$/, '');
      return new File([best], `${stem}.jpg`, {
        type: 'image/jpeg',
        lastModified: file.lastModified,
      });
    }
    return file;
  } catch {
    // Undecodable (e.g. HEIC on this browser) or canvas failure — send as-is.
    return file;
  }
}
