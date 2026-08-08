# Mahdiya — backend unit tests

**74 tests across 5 files. All passing.**

[TEST_CASES.md](TEST_CASES.md) lists every one of them by name, generated from
the test runner's own JSON output rather than typed by hand.

Run them from `backend/`:

```
npx jest tests/mahdiya
```

Running the whole suite (`npx jest`) picks these up too — no special config
needed, Jest's default `testMatch` already finds anything under `tests/`.
Nothing here needs a database, a Supabase project, or network access — the
`pg` pool, Supabase client, Cloudinary and OpenAI seams are all mocked.

## Files

| File | Tests | Covers |
|---|---|---|
| `cv.test.js` | 25 | UC-007 — the CV detection pipeline: `cvDetectionModel`, `retryQueueModel`, `cvController.detect` (threshold routing, priority blending, Roboflow 429 retry queueing), `cvController.batchScan` |
| `openaiService.test.js` | 20 | `generateRiskAlert` (UC-006, deterministic fallback vs. live model) and `extractSpotCheckForm` (UC-013 OCR prefill) — clean/partial scans, retry behaviour, service-unavailable handling |
| `cv.integration.test.js` | 20 | UC-007 routes end to end: `GET /api/cv/batch-scan`, `GET /api/cv/detections`, `POST /api/cv/detections/:id/create-ticket`, `POST /api/cv/detections/:id/dismiss` — auth, role gating, status transitions |
| `reportEdit.test.js` | 5 | UC-003 extension — `PATCH /api/my-reports/:id`, the resident report-edit feature: the 30-minute window, category validation, cross-resident 404, inspector 403 |
| `ocrReliability.test.js` | 4 | UC-013 reliability work — `item_number` overcount recovery (a wrongly-split checklist item recovered without discarding the scan) and the failure-aware retry prompt |

## Scope

These cover my tracks: UC-007 CV defect detection, UC-013 paper-form OCR
prefill, and the UC-003 report-edit extension. Ownership per
`PROJECT_IMPLEMENTATION_PHASES.md` §5.5.

Integration tests that exercise other members' code through the same HTTP
path (e.g. the rest of `/api/inspections`) are not here — they stay in
whichever folder owns that route.
