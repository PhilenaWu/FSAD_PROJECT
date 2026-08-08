# Zoe — frontend tests

**75 tests across 4 files. All passing.**

[TEST_CASES.md](TEST_CASES.md) lists every one of them by name, generated from
the test runner's own JSON output rather than typed by hand.

The project runs two test runners with incompatible setups — `jest` in a Node
environment for the Express API, `vitest` in jsdom for the React app — and
neither can execute the other's files. My tests are split into two folders for
that reason alone; both are tests of my own code.

| | Folder | Files | Tests |
|---|---|---|---|
| Backend (jest) | [`backend/tests/zoe/`](../../../backend/tests/zoe/) | 4 | 95 |
| Frontend (vitest) | [`frontend/tests/zoe/`](.) (this folder) | 4 | 75 |

## Running them

From `frontend/`:

```
npx vitest run tests/zoe
```

Running the whole suite (`npx vitest run`) picks these up too — Vitest's
default discovery already finds anything named `*.test.jsx`, and
`src/setupTests.js` applies here as it does to the tests under `src/`.

Nothing here needs a backend, a Supabase project, or network access: the
service modules (`notificationService`, `contractorService`), `AuthContext` and
`SocketContext` are mocked at the module boundary, so each page renders against
data the test supplies. `SignaturePad` is stubbed too — the real one draws on a
canvas jsdom does not implement — while keeping the `isEmpty()` / `clear()` /
`toBlob()` ref contract the page depends on.

## Files

| File | Tests | Covers |
|---|---|---|
| `ContractorInboxPage.test.jsx` | 27 | UC-010 contractor portal — the inbox list and stat-tile/tab/block filtering, the `?defect=` deep link from the bell, acknowledge, hold and resume (including that a hold pauses the deadline, so a held defect is not overdue), and the rectify flow: per-item completion, the all-items-done and signature guards, the finalize confirmation, and Save progress |
| `NotificationsPage.test.jsx` | 24 | UC-008 `/notifications` — the role split that keeps a contractor out of the manager composer's manager-only fetches, the client-side validation guarding the confirm dialog, the scope each form state builds, immediate vs scheduled sends, and the send history with its per-row receipt counts |
| `ContractorNotifyPage.test.jsx` | 17 | UC-008 / UC-010 contractor composer — the audience toggles and the banner that states them, the three staff scopes they map to (a resident is unreachable by construction), the 500-character limit, and the send / confirm / result cycle |
| `ReadReceiptBadge.test.jsx` | 7 | UC-008 read receipts — the 30-second poll, a genuine zero vs. "loading", holding the last count through a failed tick, refetching when the notification changes, and stopping on unmount |

## Scope

These cover my tracks: UC-008 notifications and UC-010 the contractor portal —
the four files that had no frontend tests at all. Ownership per
`PROJECT_IMPLEMENTATION_PHASES.md` §5.3.

`NotificationBell.test.jsx` stays in `src/components/notifications/` alongside
the component, where it was written.

## Two MUI gotchas worth knowing

Both cost real time here, and both will hit anyone adding to these files:

1. **An outlined `TextField` with content matches its label twice.** Once it has
   a value the label is duplicated into the fieldset legend, and a `<legend>`
   labels its fieldset's controls — so `getByLabelText` finds the same input
   twice and throws. Take the first of `getAllByLabelText(...)`. A *required*
   field has a further catch: the asterisk is appended to the accessible name,
   so the lookup needs `{ exact: false }`.
2. **A closing MUI dialog aria-hides the page behind it.** `getByRole` skips
   `aria-hidden` subtrees, so a role query fired right after a dialog closes
   finds nothing until the exit transition ends — use `findByRole` there.
   Separately, a real click on a submit button inside a `<form>` can be stopped
   by the browser's own HTML5 `required` validation before your `onSubmit`
   runs; use `fireEvent.submit(document.querySelector('form'))` when the point
   is to test your own validation rather than the browser's.
