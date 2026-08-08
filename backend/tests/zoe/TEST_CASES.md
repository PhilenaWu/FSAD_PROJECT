# Test case record — Zoe (backend)

Every test in this folder, by name, as reported by Jest itself. Generated from
`npx jest tests/zoe --json` on 2026-08-09, so this list cannot drift from what
actually runs.

**95 tests, 95 passing, 0 failing.**

See [README.md](README.md) for what each file covers and how to run it.

## notifications.test.js (56)

**POST /api/notifications**

- 201 + recipients_count for an immediate manager send
- 201 + Scheduled when send_time is in the future
- 400 when the message exceeds 500 characters
- 403 for a role that may not send at all
- 201 when a contractor sends to the managers and inspectors
- 201 when a contractor addresses the inspectors alone
- 403 when a contractor tries to address residents
- 401 without a token

**POST /api/notifications > validation**

- 400 on an empty message
- 400 on an urgency outside the three levels
- 400 when no scope is given
- 400 on an unknown scope type
- 400 when the blocks scope names no block
- 400 when the contractor scope names no contractor
- a rejected send writes no notification and emits nothing

**POST /api/notifications > the live socket payload**

- names the author of a human send

**PATCH /api/notifications/:id/read**

- 200 when a recipient marks it read
- 404 when the caller is not a recipient
- updates the caller own row — the user id comes from the token
- 401 without a token

**GET /api/notifications/:id/receipts**

- 200 with the totals for the manager who sent it
- everyone has read it — unread_count is 0, not a leftover
- a notification with no recipients answers zeros rather than failing
- counts the notification named in the path
- 403 for a non-manager role
- 403 for a contractor, who may send but not audit
- 401 without a token

**GET /api/notifications**

- 200 with the caller own rows and an unread count
- the inbox query joins the author so the recipient sees a sender
- scopes the query to the caller, not a client-supplied id
- unread_only=true is passed through to the query
- 401 without a token

**GET /api/notifications > paging**

- defaults to 50
- honours a sensible limit
- caps an oversized limit at 100
- falls back to the default on a non-numeric limit
- falls back to the default on a zero or negative limit

**GET /api/notifications/sent**

- 200 with the manager own sends and joined receipt counts
- scopes the query to the calling manager
- 403 for a non-manager role
- is not shadowed by the /:id/receipts route

**GET /api/notifications/sent > paging**

- defaults to 50
- caps an oversized limit at 100

**notificationService.notifyEvent**

- persists the event and emits once, carrying event_type and link
- resolves the admins scope to admin-room
- resolves the users scope to the ids and rooms the caller supplies
- drops empty ids in the users scope rather than inserting null
- managers_and_users unions managers with the named ids, deduped
- managers_and_users with no named ids still reaches the managers
- a lifecycle event has no sender rather than a stale one
- swallows a delivery failure and does not throw (G13)

**notificationService.notifyEvent > the contractor deep link**

- persists the ?defect= link on the notification row
- emits the same link live, to that contractor room only

**dispatchDueNotifications**

- marks a failed send Failed so it leaves the queue
- an empty queue is a no-op, not an error
- marks a successful send Sent

## myReports.integration.test.js (18)

**GET /api/my-reports/history**

- returns only the caller's own closed records, most recently closed first
- excludes live records — those belong to the active list
- is empty for an originator with nothing closed
- 403s for a manager

**GET /api/my-reports/:id**

- returns the record with its audit history for the resident who filed it
- returns the checklist results for the inspector who performed the spot-check
- 404s on another resident's record rather than 403 — no existence leak
- still serves a closed record to its originator, for the history view
- 404s on a record id that does not exist
- 403s for a manager — this route is the originator view
- 401s without a token

**PATCH /api/my-reports/:id**

- edits a report filed within the last 30 minutes
- 409s EDIT_WINDOW_EXPIRED past 30 minutes of submission
- 400s when a required field is missing
- 400s on a category outside the whitelist
- 404s when editing another resident's report
- 403s for an inspector — this route only edits a resident complaint
- 401s without a token

## contractor.test.js (16)

**POST /api/contractor/:id/acknowledge**

- 200 — records the acceptance and notifies the manager room
- 404 when the record is no longer assigned to this contractor
- 403 for a non-contractor role
- 401 without a token

**POST /api/contractor/:id/rectify**

- 400 SIGNATURE_REQUIRED when finalizing without a signature
- 200 finalize with a signature — status Rectified, signature stored
- finalize notifies the managers and tasks the record inspector
- finalize tasks the inspectors even when the record has no inspector
- a partial save raises no notification at all
- 200 partial save (finalize=false) needs no signature — stays in progress

**POST /api/contractor/:id/hold**

- 200 — records the hold reason (pauses the deadline)
- 400 when no reason is supplied

**POST /api/contractor/:id/resume**

- 200 — clears the hold and extends the deadline
- writes a Resumed audit row (UC-015)
- 409 when the record is not on hold
- 404 when the record is no longer this contractor's

## socketRooms.test.js (5)

**canJoinRecordRoom**

- admits the originator of the record
- refuses a record the user did not originate
- refuses a malformed id without reaching the database
- refuses rooms that are not per-record rooms
- refuses non-string room names
