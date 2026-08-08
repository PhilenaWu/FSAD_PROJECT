# Mahdiya — frontend unit tests

**25 tests across 3 files. All passing.**

[TEST_CASES.md](TEST_CASES.md) lists every one of them by name, generated from
the test runner's own JSON output rather than typed by hand.

Run them from `frontend/`:

```
npx vitest run tests/mahdiya
```

Running the whole suite (`npx vitest run`) picks these up too — no special
config needed, Vitest's default `include` already finds anything matching
`*.test.jsx` under the package. No service calls hit a real network: props
drive `ReportCard` directly, and `cvService` is mocked for
`ManualReviewQueue`.

## Files

| File | Tests | Covers |
|---|---|---|
| `ReportCard.test.jsx` | 13 | UC-003 extension — the report-edit UI: summary rendering, expand/collapse, the 30-minute edit-window gate, the edit form (prefill, field changes, save/cancel, error display) |
| `ManualReviewQueue.test.jsx` | 8 | UC-007 — the manual review queue: loading/empty/error states, listing detections, the create-ticket flow (validation, submit, server-error handling), the dismiss flow |
| `BoundingBoxOverlay.test.jsx` | 4 | UC-007 — the Roboflow bounding-box overlay: scaling a box from the original image's pixel space to the rendered size, label rendering |

## Scope

These cover my tracks: UC-007 CV defect detection and the UC-003 report-edit
extension. Ownership per `PROJECT_IMPLEMENTATION_PHASES.md` §5.5.
