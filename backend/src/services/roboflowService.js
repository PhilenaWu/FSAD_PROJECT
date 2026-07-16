// Computer-vision defect detection via a Roboflow workflow. Used by the CV
// pipeline to classify a defect photo and return one clean, deduplicated result.
'use strict';

const ROBOFLOW_API_KEY = process.env.ROBOFLOW_API_KEY;
const ROBOFLOW_WORKFLOW_URL = process.env.ROBOFLOW_WORKFLOW_URL;
// e.g. https://serverless.roboflow.com/infer/workflows/<your-workspace>/sam-3

const CONFIDENCE_THRESHOLD = 0.7;
const IOU_OVERLAP_THRESHOLD = 0.5; // how much boxes must overlap to be treated as "the same defect"

function boxIoU(a, b) {
  const ax1 = a.x - a.width / 2, ax2 = a.x + a.width / 2;
  const ay1 = a.y - a.height / 2, ay2 = a.y + a.height / 2;
  const bx1 = b.x - b.width / 2, bx2 = b.x + b.width / 2;
  const by1 = b.y - b.height / 2, by2 = b.y + b.height / 2;

  const interX1 = Math.max(ax1, bx1);
  const interY1 = Math.max(ay1, by1);
  const interX2 = Math.min(ax2, bx2);
  const interY2 = Math.min(ay2, by2);

  const interW = Math.max(0, interX2 - interX1);
  const interH = Math.max(0, interY2 - interY1);
  const interArea = interW * interH;

  const areaA = a.width * a.height;
  const areaB = b.width * b.height;
  const unionArea = areaA + areaB - interArea;

  return unionArea === 0 ? 0 : interArea / unionArea;
}

// Roboflow's SAM workflow often returns many overlapping boxes for the same
// physical defect. Sort by confidence and drop anything that overlaps a
// box we've already kept, so one defect region yields one prediction.
function dedupePredictions(predictions) {
  const sorted = [...predictions].sort((a, b) => b.confidence - a.confidence);
  const kept = [];

  for (const pred of sorted) {
    const overlapsKept = kept.some(
      (k) => boxIoU(k, pred) >= IOU_OVERLAP_THRESHOLD
    );
    if (!overlapsKept) kept.push(pred);
  }

  return kept;
}

// Run the configured Roboflow workflow against a hosted image and return the
// single highest-confidence, deduplicated defect prediction.
async function detectDefect(imageUrl) {
  const response = await fetch(ROBOFLOW_WORKFLOW_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: ROBOFLOW_API_KEY,
      inputs: {
        // Must match the input parameter name defined in the deployed
        // Roboflow workflow (Deploy tab > code snippet shows the exact key).
        // Confirmed as `test_image_1` for this workflow's currently deployed
        // version — the builder's input block has been renamed to `image`
        // in the editor, but that rename hasn't reached the deployed
        // endpoint yet (needs a Publish/Deploy step, not just autosave).
        test_image_1: { type: 'url', value: imageUrl },
      },
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    const err = new Error(`Roboflow request failed: ${response.status} — ${body}`);
    err.status = response.status; // lets callers special-case 429 (rate limit)
    throw err;
  }

  const data = await response.json();
  const predictions = data?.outputs?.[0]?.sam?.predictions || [];

  if (predictions.length === 0) {
    return { defect_class: null, confidence: 0, bounding_box: null };
  }

  const deduped = dedupePredictions(predictions);
  const best = deduped[0]; // highest confidence after dedup

  return {
    defect_class: best.class,
    confidence: best.confidence,
    bounding_box: {
      x: best.x,
      y: best.y,
      width: best.width,
      height: best.height,
    },
  };
}

module.exports = { detectDefect, CONFIDENCE_THRESHOLD };
