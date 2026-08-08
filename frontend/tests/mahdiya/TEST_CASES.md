# Test case record — Mahdiya (frontend)

Every test in this folder, by name, as reported by Vitest itself. Generated
from `npx vitest run tests/mahdiya --reporter=json` on 2026-08-09, so this
list cannot drift from what actually runs.

**25 tests, 25 passing, 0 failing.**

See [README.md](README.md) for what each file covers and how to run it.

## BoundingBoxOverlay.test.jsx (4)

**BoundingBoxOverlay**

- renders the image and no box before the image has loaded
- renders no box at all when boundingBox is not provided
- scales the box to match the rendered image size vs. its natural size
- does not render a label chip when no label is given, even with a box

## ManualReviewQueue.test.jsx (8)

**ManualReviewQueue — loading and empty states**

- shows nothing needing review once an empty queue resolves
- shows an error alert when the queue fails to load

**ManualReviewQueue — listing detections**

- renders each detection with its class, confidence, and source

**ManualReviewQueue — create ticket flow**

- pre-fills the block when the detection captured one
- requires category, priority, and block before submitting
- submits the form and removes the card from the queue on success
- shows the server error message when creating the ticket fails

**ManualReviewQueue — dismiss flow**

- dismissing removes the card without requiring the form to be filled

## ReportCard.test.jsx (13)

**ReportCard — summary**

- shows the title, category, block, unit, and status
- toggling the details button calls onToggle and reflects expanded state

**ReportCard — expanded detail**

- shows a spinner while the detail is loading
- shows a retry alert on error, and Retry calls onRetryDetail
- renders description, checklist (grouped by section), and progress history
- shows the "no updates yet" placeholder when history is empty

**ReportCard — edit gating (30-minute window)**

- hides the Edit report button when not editable
- shows Edit report when editable, and clicking it calls onEditToggle

**ReportCard — edit form**

- prefills the form fields from editDraft
- typing in the title field reports the change via onEditChange
- Save changes calls onEditSave, and shows "Saving…" while busy
- Cancel calls onEditCancel
- shows the edit error message when present
