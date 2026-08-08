# Test case record — Philena Wu (frontend)

Every test in `frontend/tests/philena/`, by name, as reported by the runner
itself. Generated from `vitest --reporter=json` on 2026-08-09, so this list
cannot drift from what actually runs.

**35 tests, 35 passing, 0 failing.**

Backend cases are listed separately in
[`backend/tests/philena/`](../../../backend/tests/philena/) — 168 tests across
7 files, run with `npx jest tests/philena`.

See [README.md](README.md) for what each file covers and why these three files
were chosen.

## Frontend (vitest)

`frontend/tests/philena/` — 3 files, 35 tests, run with
`npx vitest run tests/philena` (from `frontend/`).

### ReportIssuePage.test.jsx (12)

**validation**

- refuses an empty form and names the three required fields
- a title of only spaces does not count as a title
- block alone is not enough — category is required too
- description is optional — a report submits without one

**submitting**

- posts the fields the backend expects
- omits the unit when it is left blank
- sends the unit when one is given
- confirms success and clears the form for the next report

**when the backend refuses it**

- keeps what was typed when the submit fails
- shows the backend message on a validation error
- explains an over-size photo rather than blaming the report
- treats a duplicate as a warning, not a failure

### InspectionDetailPage.test.jsx (12)

**triage**

- saving with nothing edited changes nothing and says so
- sends only the field that changed
- a triage note rides along with the change
- surfaces the backend message when the save is refused

**status**

- is read-only, and reads as the friendly label
- offers no status options to pick from

**closing**

- is refused until an inspector has reviewed the work
- is allowed once the review is in the record history
- an archived record offers no triage form or close panel at all

**as an inspector**

- gets a read-only view — no triage, no closing
- can mark the work reviewed, which is what resolves it
- has nothing to review on a record the contractor has not finished

### SignaturePad.test.jsx (11)

- starts empty, and says so through the ref
- a stroke counts as ink
- a tap with no movement still counts
- moving without pressing draws nothing
- a move after release does not keep drawing
- Clear is disabled until there is something to clear
- Clear returns the pad to empty, by the ref and by the button
- clear() through the ref works too — the close flow calls it on reset
- can be signed again after clearing
- toBlob resolves a PNG for upload
- renders the label it is given — the pads are told apart by it
