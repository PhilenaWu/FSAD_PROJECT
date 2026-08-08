# Zoe — backend tests

**95 tests across 4 files. All passing.**

[TEST_CASES.md](TEST_CASES.md) lists every one of them by name, generated from
the test runner's own JSON output rather than typed by hand.

The project runs two test runners with incompatible setups — `jest` in a Node
environment for the Express API, `vitest` in jsdom for the React app — and
neither can execute the other's files. My tests are split into two folders for
that reason alone; both are tests of my own code.

| | Folder | Files | Tests |
|---|---|---|---|
| Backend (jest) | [`backend/tests/zoe/`](.) (this folder) | 4 | 95 |
| Frontend (vitest) | [`frontend/tests/zoe/`](../../../frontend/tests/zoe/) | 4 | 75 |

## Running them

From `backend/`:

```
npx jest tests/zoe
```

Running the whole suite (`npx jest`) picks these up too — no special config
needed, Jest's default `testMatch` already finds anything under `tests/`.

Nothing here needs a database, a Supabase project, or network access. The
Supabase auth client, the `pg` pool, Cloudinary and the Socket.IO emit seam are
all mocked, so the real route → controller → model flow runs in-process under
supertest.

## Files

| File | Tests | Covers |
|---|---|---|
| `notifications.test.js` | 56 | UC-008 — `POST /api/notifications` (manager scopes, the three scopes a contractor may address, message/urgency/scope validation, scheduling), the caller's inbox and mark-read (including the 404 when they are not a recipient), the `/receipts` counts the manager's badge polls, the `/sent` history, `?limit` bounding on both list endpoints, `notifyEvent` scope resolution and the `?defect=` deep link it carries, and the scheduled dispatcher |
| `myReports.integration.test.js` | 18 | UC-003 — `GET /api/my-reports/history`, `GET /api/my-reports/:id` (originator detail + audit history + checklist results), and `PATCH /api/my-reports/:id` (the 30-minute edit window, category whitelist, cross-resident 404) |
| `contractor.test.js` | 16 | UC-010 — acknowledge, rectify (`SIGNATURE_REQUIRED` on finalize, partial save, who gets notified), and hold/resume including the G11 deadline extension and the `Resumed` audit row |
| `socketRooms.test.js` | 5 | Per-record socket room authorisation — only the originator may join, malformed ids are refused before the database is touched |

## Scope

These cover my tracks: UC-003 my-reports, UC-008 notifications, and UC-010 the
contractor portal. Ownership per `PROJECT_IMPLEMENTATION_PHASES.md` §5.3.

`myReports.integration.test.js` drives real HTTP routes end to end but stays
here because the routes are mine; tests that exercise several members' code
through one path live in `backend/tests/integration/`.
