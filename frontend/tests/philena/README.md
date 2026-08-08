# Philena Wu — unit tests

**203 tests across 10 files. All passing.**

The project runs two test runners with incompatible setups — `jest` in a Node
environment for the Express API, `vitest` in jsdom for the React app — and
neither can execute the other's files. They are split into two folders for that
reason alone; both are unit tests of my own code.

| | Folder | Files | Tests |
|---|---|---|---|
| Backend (jest) | [`backend/tests/philena/`](../../../backend/tests/philena/) | 7 | 168 |
| Frontend (vitest) | [`frontend/tests/philena/`](.) (this folder) | 3 | 35 |

## Running them

From `backend/`:

```
npx jest tests/philena
```

From `frontend/`:

```
npx vitest run tests/philena
```

## What the frontend files cover

The three chosen are the files with real logic behind them rather than display
code — a form that decides what to send, a screen that gates a terminal action,
and a canvas component with an imperative contract other screens depend on.

### `ReportIssuePage.test.jsx` (12)

UC-001, the resident's entry point to the whole system. Covers the validation
that stops an incomplete report reaching the API (including that a title of
only spaces is not a title, and that category is required now that residents
categorise their own reports), what actually goes into the multipart body, that
an optional unit is omitted rather than sent blank, and that each backend error
code produces its own message. One case exists specifically because losing a
resident's typing is the worst failure this page has: a failed submit must not
reset the form.

### `InspectionDetailPage.test.jsx` (12)

UC-002 triage and UC-004 close, the manager's working screen. Three behaviours
worth pinning, each of which was a real defect:

- triage sends **only** the fields that changed, so the audit trail records real
  actions rather than a re-save of everything;
- status is **read-only** — it moves when work moves, and a dropdown once let a
  manager mark something Resolved that no inspector had seen;
- closing is **refused until an inspector has reviewed** the work, and the panel
  says so up front instead of failing on submit.

Also covers the inspector's read-only view, including that it never calls the
manager-only endpoints (which would 403).

### `SignaturePad.test.jsx` (11)

The shared canvas e-signature pad. Its imperative contract is what every caller
depends on: `isEmpty()` gates submission, `toBlob()` produces the PNG that gets
uploaded, and `clear()` has to return the pad to genuinely empty. A pad that
reported ink it did not have would let an unsigned close through. Includes the
deliberate hairline on tap, so a signature made of dots still counts.

## Notes on the mocks

The API, the photo compressor and the browser speech API are mocked; the forms,
guards and DOM are real. jsdom implements no canvas, so the pad's 2D context is
stubbed and the assertions are about the component's own state machine and the
calls it makes, not about pixels.
