# Test case record — Philena Wu (backend)

Every test in `backend/tests/philena/`, by name, as reported by the runner
itself. Generated from `jest --json` on 2026-08-09, so this list cannot drift
from what actually runs.

**168 tests, 168 passing, 0 failing.**

Frontend cases are listed separately in
[`frontend/tests/philena/TEST_CASES.md`](../../../frontend/tests/philena/TEST_CASES.md)
— 35 tests across 3 files, run with `npx vitest run tests/philena`.

See [README.md](README.md) for what each file covers and how the seams are
mocked.

## Backend (jest)

`backend/tests/philena/` — 7 files, 168 tests, run with `npx jest tests/philena`
(from `backend/`).

### inspections.integration.test.js (102)

**POST /api/inspections**

- 401 when no token is provided
- 403 when the user is not a resident
- 400 when title is missing
- 400 when category is missing
- 400 when category is not one the schema allows
- 201 creates the complaint with the resident's category and stores the photo
- 409 on a duplicate title within 2 minutes

**POST /api/inspections/lift**

- 201 inspector creates a lift inspection with checklist results and a defect photo
- emails the servicing contractor the UC-014 defect alert
- records the send in defect_email_log, stamps G12, and audits it
- a zero-defect spot-check sends no defect alert
- a failed defect alert never fails the submission
- pushes status_update to manager-room on submit
- the zero-defect emit reports Closed, not Open
- 201 with no defects files straight to Closed, unassigned
- 201 with a defect lands as Pending Assignment, awaiting triage
- 400 SIGNATURE_REQUIRED when the inspector signature is missing
- 400 when serviced_at is blank
- 400 INCOMPLETE_CHECKLIST naming the unanswered item numbers
- 400 when the checklist references an item outside the active template
- 400 SEVERITY_REQUIRED when a Defect has no severity
- 400 PHOTO_REQUIRED_FOR_SEVERITY when a Major defect has no photo
- 400 PHOTO_NOT_ALLOWED_FOR_MINOR when a Minor defect carries a photo
- 400 PHOTO_TOO_LARGE when a photo part exceeds the 100 KB cap
- 403 when the user is not an inspector
- 400 when lift_id is missing
- 400 when checklist is not valid JSON
- 404 when the lift does not exist

**POST /api/inspections/ocr-prefill**

- OCR-T01: 200 maps a clean scan onto the active template, in display_order
- OCR-T02: 200 flags unreadable items by their display_order
- 422 OCR_UNREADABLE when the photo can't be parsed (no silent fallback)
- 503 OCR_SERVICE_UNAVAILABLE when the service itself is down (A4)
- 400 VALIDATION_ERROR when form_photo is missing
- 403 when the caller is not an inspector

**GET /api/inspections/my**

- 200 returns only the caller's own reports, wrapped in { data }
- 200 still lists a zero-defect spot-check after it auto-files as Closed
- 403 for a manager (originators only)

**GET /api/inspections/status-board**

- 200 returns privacy-safe complaint rows only (no lift inspections)
- 200 for other authenticated roles (e.g. manager)
- 401 without a token

**PATCH /api/inspections/:id**

- 200 manager assigns a contractor — status, deadline, history, socket
- a contractor change logs Assigned first, then Reassigned
- a reassignment tells the outgoing contractor and mails the new one as a reassignment
- re-saving the same contractor stays Assigned
- 200 a non-assigning update pushes no contractor room
- 200 blank target_deadline falls back to the 14-day rule
- 200 priority-only change writes a Priority Escalated history row
- 403 when the caller is not a manager
- 404 for an unknown inspection id
- 400 for an invalid status value
- 400 when no updatable field is provided
- 200 a manager can recategorise a resident's report
- 400 for an invalid category value

**GET /api/inspections (manager queue)**

- 200 lists all records with filters applied
- 403 for non-managers
- 200 ?status= accepts a comma-separated group
- 200 ?archived=true returns closed records, and only those
- 200 ?contractor= & ?overdue=true narrow to that contractor's overdue work
- 200 for an inspector

**GET /api/inspections/:id (manager detail)**

- 200 returns the record with its audit history
- 200 includes checklist results with template text and both photos
- 200 includes the linked cv_detection (bounding box etc.) when cv_detection_id is set
- 200 cv_detection is null when the record has no cv_detection_id
- 404 for an unknown id
- 200 for an inspector

**GET /api/contractors**

- 200 for a manager
- 403 for a resident

**POST /api/inspections/:id/close**

- a closed record is still readable via GET /:id, with its full payload
- 409/404 — an already-closed record cannot be closed again
- 409 — a Rectified record no inspector has reviewed cannot be closed
- 200 once an inspector reviews it, the same record closes
- a waiver note does not buy past the inspector check
- 200 closes with remark + manager signature, computes fields, archives
- 400 when the closing remark is too short
- 400 SIGNATURE_REQUIRED when the manager signature image is missing
- 403 when the caller is not a manager
- 404 for an unknown inspection id
- 409 INVALID_STATE when the record has not been rectified yet
- 409 UNRECTIFIED_DEFECTS naming the item numbers still outstanding
- 200 closes once the defect carries a completion photo
- 200 closes unrectified with a waiver note, recorded in the remark
- 409 when the waiver note is too short to count as a justification
- queues an ai_jobs row on the 3rd close of a block+category in 30 days

**POST /api/inspections/:id/reject**

- 200 sends the record back to Assigned with a fresh deadline
- 400 when the reason is shorter than 10 characters
- 409 INVALID_STATE when the record is not awaiting endorsement
- 403 when the caller is not a manager
- 404 for an unknown inspection id
- pushes the rejection to the contractor room as well as the manager
- emails the assigned contractor the UC-014 rejection variant
- no email when the record has no contractor to notify
- a failed rejection email never fails the rejection

**POST /api/inspections/:id/review**

- 200 resolves the record and records the audit row
- 409 INVALID_STATE when the record is not Rectified
- 403 when the caller is not an inspector
- 404 for an unknown inspection id

**GET /api/checklist-items**

- 200 returns active template items sorted by display_order

**GET /api/lifts**

- 200 returns lifts with contractor names for an inspector
- 403 for a non-inspector

### registration.integration.test.js (20)

**POST /api/users/register-profile**

- 401 without a token — the caller must hold the session they signed up with
- 201 creates a pending resident
- ignores role, status, id and email supplied in the body
- 400 for a block that is not on the estate list
- 400 when full_name is missing, even though the client checks it too
- 409 when the account already has a profile
- 429 once the per-IP registration limit is used up

**a pending account is locked out everywhere**

- 403 ACCOUNT_PENDING on its own profile
- 403 ACCOUNT_PENDING on a requireAuth-only route with no role guard
- 403 on a role-guarded route
- cannot file a report

**manager approval queue**

- lists pending residents only
- 403 for a resident
- approve activates the account, and the resident can then sign in
- approve emails the resident that they can now sign in
- a failed send still approves the account, and says so
- reject sends no email
- reject marks the account rejected and keeps it locked out
- 404 when the id is not a pending resident, so no other account can be flipped
- 403 when a pending resident tries to approve themselves

### defectEmail.test.js (9)

**spot-check defect alert (D.2)**

- subject names the block, lift and defect count
- lists every failed checkpoint with section, item number and severity
- photos travel as Cloudinary links, never as attachments
- states the 2-week rule and deep-links to the contractor inbox
- a checkpoint with no remark or photo still renders

**assignment alert without a defect list**

- falls back to the generic subject and omits the checkpoint table

**overdue chase (D.7)**

- past the deadline reads as overdue, with the day count
- three days out reads as due soon, not overdue
- a chase never renders the spot-check 2-week note

### emailService.test.js (9)

**sendDefectAlert — assignment variant (D.2)**

- defaults to the defect_alert variant and states the deadline
- omits the unit from the location when there is none
- a missing deadline reads as "not set", not as a bad date

**sendDefectAlert — rejection variant (D.4)**

- quotes the reason and the new deadline (UC-014 A2)
- still carries the defect facts the contractor needs to act
- an unrecognised email_type falls back to the assignment wording

**sendResidentApprovedEmail**

- tells the approved resident they can now sign in, and where
- never includes a password — Supabase holds it and we never see it
- omits the unit when the resident did not give one

### overdueChase.test.js (8)

**GET /api/inspections/overdue-chase**

- a record due in 3 days gets one chase email and an audit row
- a record already chased today is skipped
- an overdue record is chased with a negative day count
- a contractor with no contact email is logged as failed, not emailed
- an SMTP failure is logged and the remaining records still go out
- nothing due is a clean no-op
- 401 without the cron secret
- only Assigned/Acknowledged records are selected, never a held one

### users.integration.test.js (8)

**GET /api/users/me**

- 401 when no token is provided
- 200 returns the caller's own profile row
- 404 when the authenticated user has no profile row
- 403 ACCOUNT_SUSPENDED for a suspended account

**suspended accounts on requireAuth-only routes**

- 403 ACCOUNT_SUSPENDED on the status board, which has no role guard
- an active account still reaches the same route

**GET /api/users/inspectors**

- 200 returns active inspectors only
- 403 for a non-manager

### inspections.test.js (12)

Unit level, below the HTTP layer: the SQL and the bound parameters, where the
defaults for the NOT NULL columns are actually decided.

**inspectionModel.create — the resident complaint path (UC-001)**

- inserts into inspections and returns the created row
- binds the report fields it was given, in the column order of the INSERT
- applies the JS-side defaults the NOT NULL columns depend on
- a caller-supplied category wins over the default
- a CV-detected ticket overrides source_type and source_flag
- omitted optional fields bind as undefined, never as a string
- stores a GPS fix when the resident captured one

**inspectionModel.hasInspectorReview — the UC-004 close gate**

- asks the audit trail for the inspector review row
- no such row means not reviewed — the close is refused

**onHoldSql — the held-record predicate**

- reads the latest hold/resume row for the given table alias
- defaults to the bare inspections table when no alias is given
- coalesces the empty case so NOT over it stays true
