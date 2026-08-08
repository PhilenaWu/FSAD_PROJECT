# Philena Wu — backend unit tests

**168 tests across 7 files. All passing.**

[TEST_CASES.md](TEST_CASES.md) lists every one of them by name, generated from
the runner's own JSON output rather than typed by hand.

The project runs two test runners with incompatible setups — `jest` in a Node
environment for the Express API, `vitest` in jsdom for the React app — and
neither can execute the other's files. They are split into two folders for that
reason alone; both are unit tests of my own code.

| | Folder | Files | Tests |
|---|---|---|---|
| Backend (jest) | [`backend/tests/philena/`](.) (this folder) | 7 | 168 |
| Frontend (vitest) | [`frontend/tests/philena/`](../../../frontend/tests/philena/) | 3 | 35 |

## Running them

From `backend/`:

```
npx jest tests/philena
```

## What each file covers

Nothing here touches a real database, SMTP server or Cloudinary account. The
`pg` pool, the mailer and the upload service are mocked at the module seam and
the assertions are about the SQL, the payloads and the HTTP contract — so the
suite runs anywhere, including CI, with no credentials.

### `inspections.integration.test.js` (102)

The whole UC-001 → UC-002 → UC-004 record lifecycle end to end through Express,
against an in-memory store that stands in for Postgres. The largest file
because it is the system's spine: a resident files a complaint or an inspector
files a lift spot-check, a manager triages and assigns, a contractor finishes,
an inspector reviews, a manager closes with dual e-signature.

Guard rails covered in detail, each of which is a rule the client asked for:
`INCOMPLETE_CHECKLIST` naming the unanswered item numbers, `SEVERITY_REQUIRED`,
`PHOTO_REQUIRED_FOR_SEVERITY` for Major/Critical, `PHOTO_NOT_ALLOWED_FOR_MINOR`,
the 100 KB photo cap, `ENDORSER_MUST_BE_INSPECTOR`, `UNRECTIFIED_DEFECTS` with
its waiver path, and `NOT_REVIEWED` — closing is refused until an inspector has
checked the work, and a waiver note does not buy past it.

Also covers the zero-defect spot-check auto-filing straight to Closed, the
14-day deadline rule, reassignment writing `Assigned` then `Reassigned`, and
the UC-013 OCR prefill including its unreadable and service-down paths.

### `registration.integration.test.js` (20)

Resident self-registration and the manager approval queue. The security-shaped
cases matter most: a registering client cannot smuggle `role`, `status`, `id`
or `email` through the body; a pending account is locked out of *every* route,
including ones with no role guard; and approve/reject can only ever move a row
that is actually a pending resident, so no other account can be flipped by
passing its id. Includes the per-IP rate limit and the approval email — with
the case where the send fails but the approval still stands.

### `defectEmail.test.js` (9)

The UC-014 outbound defect alert's content: the subject naming block, lift and
defect count; every failed checkpoint listed with its section, item number and
severity; photos travelling as Cloudinary links rather than attachments; and
the overdue chase reading as "due soon" at D−3 but "overdue by N days" past the
deadline.

### `emailService.test.js` (9)

The mailer itself — the assignment and rejection variants, the fallback when an
unrecognised `email_type` arrives, and the resident-approved mail. One case
exists purely as a safety assertion: the approval email must never contain a
password, because Supabase holds credentials and this service never sees them.

### `overdueChase.test.js` (8)

The scheduled D−3/D+0 chase: one email and one audit row per due record, the
per-day guard that stops a re-run duplicating them, a contractor with no
address logged as failed rather than silently skipped, an SMTP failure not
stopping the remaining records, and the cron secret guard. Also pins that a
held record is never chased — a hold pauses the rectification clock.

### `users.integration.test.js` (8)

`GET /api/users/me` and the inspector picker, plus the suspension gate: a
suspended account is refused `ACCOUNT_SUSPENDED` on a `requireAuth`-only route
with no role guard, not just on its own profile.

### `inspections.test.js` (12)

Unit level, below the HTTP layer, where the integration file above drives the
same paths through Express. It pins the SQL and the bound parameters directly,
because the model is where the defaults for the NOT NULL columns are decided:
`source_type`, `category`, `priority` and `source_flag` are named explicitly in
the INSERT, so the column DEFAULT can never apply and an omitted value would
bind as NULL and violate the constraint. Also covers the `hasInspectorReview`
close gate and the `onHoldSql` held-record predicate — including that it
coalesces the never-held case, without which `NOT (NULL = 'On Hold')` is NULL
rather than true and silently drops every never-held record from the overdue
and chase queries.
