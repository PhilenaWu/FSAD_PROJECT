# Test case record — Mahdiya (backend)

Every test in this folder, by name, as reported by Jest itself. Generated
from `npx jest tests/mahdiya --json` on 2026-08-09, so this list cannot drift
from what actually runs.

**74 tests, 74 passing, 0 failing.**

See [README.md](README.md) for what each file covers and how to run it.

## cv.test.js (25)

**cvDetectionModel.create**

- inserts a detection with the bounding box JSON-stringified for jsonb
- stores location_block/location_unit when supplied
- passes a null bounding_box through as null, not the string "null"
- defaults status to pending when not provided

**cvDetectionModel.findById**

- returns the row for a matching id
- returns undefined when no row matches

**cvDetectionModel.updateStatus**

- updates the row and returns it

**cvDetectionModel.findByStatus**

- returns rows for the given status, newest first

**retryQueueModel**

- create() inserts image_url and inspection_id
- findPending() only selects rows whose backoff window has elapsed
- countPending() returns the total queue depth regardless of backoff
- reschedule() bumps attempts and pushes retry_after back
- markProcessed() and markFailed() update status

**cvController.detect**

- CV-T01: confidence clears the threshold — cv_detections row + a separate cv_auto_detected ticket
- CV-T02: confidence misses the threshold — cv_detections row only, no ticket created
- CV-T03: Roboflow returns 429 — image queued to retry_queue, no ticket, manager not notified
- a category migration 042 retired is refused as a 400, not left to the DB
- a non-429 failure is also queued to retry_queue, not just 429s

**cvController.detect — priority blend (a report with both a human complaint and a photo)**

- blends the human and CV scores into the originating report's priority, no separate ticket
- blends even when confidence misses the 70% ticket-creation threshold
- falls back to a human score of 50 when ai_priority_score is null

**priorityFromScore**

- maps 0-100 scores to the priority label enum in even quartiles

**cvController.batchScan**

- CV-T04: 2 pending rows both succeed — both processed, response { processed: 2 }
- a repeated 429 reschedules the row instead of marking it failed
- a non-429 failure marks the row failed

## openaiService.test.js (20)

**generateRiskAlert**

- returns the deterministic, data-driven fallback when no API key is configured
- fallback tailors the preventive action to the defect category
- fallback omits the cost sentence when estimated_cost is null
- returns the model text when the API key is set and the call succeeds
- falls back gracefully when the OpenAI call throws (UC-006 E1)
- falls back when the model returns empty content

**extractSpotCheckForm (UC-013)**

- OCR-T01: a clean mocked scan maps every item, in order
- OCR-T02: a partial scan keeps readable items and marks the rest unreadable
- sends the live item texts in the prompt and requests strict JSON
- OCR-T03: throws when OPENAI_API_KEY is not configured (no silent fallback)
- marks the no-key error as serviceUnavailable (A4)
- throws when the API call itself fails, marked serviceUnavailable (A4)
- throws when the model response is not valid JSON on every attempt
- throws when the items array length does not match the input and item_number cannot recover it
- a retry prompt names the previous failure
- reconciles an overcount via item_number instead of retrying
- falls through to a retry when item_number leaves a gap
- recovers on retry when the first attempt returns the wrong item count
- does not retry a serviceUnavailable failure
- an invalid per-item result falls back to "unreadable" rather than throwing

## cv.integration.test.js (20)

**GET /api/cv/batch-scan**

- 401 without a valid CRON_SECRET
- 401 with the wrong secret
- CV-T04: 200 with an empty queue — { processed: 0, failed: 0, remaining: 0 }
- a pending row that clears the threshold is processed

**GET /api/cv/detections**

- 401 without a token
- 403 for a non-manager role
- 200 defaults to status=low_confidence for a manager
- 200 respects an explicit ?status filter

**POST /api/cv/detections/:id/create-ticket**

- 401 without a token
- 403 for a non-manager role
- 404 for an unknown detection
- 400 when the detection is not low_confidence
- 400 when category/priority/location are missing and none stored
- 201 creates a ticket and marks the detection processed
- a manager-supplied location overrides the detection's stored location

**POST /api/cv/detections/:id/dismiss**

- 401 without a token
- 403 for a non-manager role
- 404 for an unknown detection
- 400 when the detection is not low_confidence
- 200 marks the detection dismissed, no ticket created

## reportEdit.test.js (5)

**PATCH /api/my-reports/:id (Mahdiya — UC-003 report edit)**

- lets a resident edit a report filed within the last 30 minutes
- rejects an edit once the 30-minute window has passed
- rejects a category outside the shared CATEGORIES whitelist
- 404s rather than 403s on another resident's report — no existence leak
- blocks an inspector from editing their own spot-check through this route

## ocrReliability.test.js (4)

**extractSpotCheckForm — overcount recovery via item_number**

- recovers the correct answers when one item is wrongly split in two, without retrying
- falls back to a retry when item_number leaves a genuine gap instead of guessing

**extractSpotCheckForm — failure-aware retry prompt**

- tells the second attempt what specifically went wrong on the first
- gives up after 3 attempts rather than retrying forever
