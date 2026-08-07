# PROJECT_IMPLEMENTATION_PHASES.md
# Lift Inspection & Estate Defect Management System — Phase Plan

> Problem statement: **4C-1** primary · **4C-2** secondary · **4D** thematic
> Requirements document of record: Daniel Koh's *"Digitalise the Form on Spot-Check of Lift Servicing"* (10 Jun 2026).
> Companions: `HIGH_LEVEL_DESIGN.md` (design of record), `USE_CASES.md` (behaviour of record).

---

## Table of Contents

1. [Where We Are](#1-where-we-are)
2. [Revised Ownership](#2-revised-ownership)
3. [Phases 1–4 — Delivered](#3-phases-14--delivered)
4. [Phase 5 — Client Fidelity](#4-phase-5--client-fidelity-the-remaining-gaps)
5. [Phase 6 — Hardening, Stress Test, Demo](#5-phase-6--hardening-stress-test-demo)
6. [Test Matrix](#6-test-matrix)
7. [Definition of Done](#7-definition-of-done)
8. [Risk Register](#8-risk-register)
9. [Demo Narrative](#9-demo-narrative)

---

## 1. Where We Are

Phases 1–4 are built and merged. Against the client brief, **17 of 20 requirements are met or partially met**; the outstanding work is concentrated in three areas, all of which sit on the critical path of the client's own words:

| Gap | Client requirement | Why it matters |
|---|---|---|
| **G-A** The checklist does not match the paper form | R3 — *"a structured checklist matching the existing paper form"* | The brief names the sample form as the requirements document. We currently seed 10 invented items; the form has 25 in three sections. |
| **G-B** No auto-email to the lift company | R6 — *"an auto-email to the lift company when defects are flagged"* | This is the **first** advantage on the client's slide 3 and step 4 of the six-step workflow. `emailService` exists but is wired only to the monthly report. |
| **G-C** Inspector sign-off is not constrained | R9 — *"a digital sign-off from the EM Services inspector"* | Close accepts any endorser; the client specifies the inspector. There is also no path for the inspector to **reject** an inadequate rectification. |

Phase 5 closes these plus the smaller items (servicing date, minor-photo rule, zero-defect filing, overdue chase, annual export, audit-action completeness) and adds UC-013 as an adoption aid.

---

## 2. Revised Ownership

Rebalanced from the original plan. The change: **UC-012 vendor backend and its expiry cron move from Hasini to Davian** (he already writes cron-guarded controllers and the workflow YAMLs, so it is a repeat of a pattern he owns), and the three new deliverables are distributed to the two lightest tracks.

| Member | Owns | Phase 5 load |
|---|---|---|
| **Philena** | Foundation · UC-001 / 001b / 002 / 004 / 015 · integration tests | Paper-form fidelity, inspector signature, zero-defect filing, reject flow, audit completeness |
| **Zoe** | UC-003 · UC-008 · UC-010 | Contractor-room notify on assign, rejection surfacing, hold-clock correctness |
| **Davian** | UC-006 · UC-009 · UC-011 backend · **UC-012 backend + expiry cron** · **all outbound email** | **UC-014 auto-email**, overdue chase, annual export |
| **Hasini** | UC-005 + PPT + Data Playground · UC-011 UI · **UC-012 UI only** | Scorecard overdue/re-open columns, paper-section analytics filter, annual-export entry point |
| **Mahdiya** | UC-007 | **UC-013 OCR prefill** |

> **Boundary — Hasini owns no cron jobs and no email.** Every scheduled workflow
> (`contract-expiry-check`, `overdue-defect-chase`, `nightly-recommendations`,
> `monthly-report`) and every Nodemailer call site belongs to Davian. Hasini owns
> UC-005 end to end — including its analytics endpoints in
> `analyticsController.js` (which is why H.1/H.2 below list that file) — plus
> Chart.js components, the admin/vendor pages, and client-side export controls.
> For UC-011 and UC-012 the backend is Davian's: there, a Hasini page consumes an
> endpoint he owns rather than computing or sending anything.

**Load after rebalance** (volume / difficulty out of 10): Philena 8/8 · Davian 7/7 · Zoe 7/7 · Hasini 7/8 · Mahdiya 6/7. The original spread was 5–10; this is 6–8.

---

## 3. Phases 1–4 — Delivered

Recorded for traceability. **Do not re-open — these features are done.**

| Phase | Weeks | Delivered |
|---|---|---|
| **1 — Foundation** (Philena) | 1–2 | Supabase Auth (client-side; no custom auth endpoints, no JWT/bcrypt), `users` profile + `requireRole` over five roles, migrations `001`–`016`, `pg` Pool, helmet/CORS/rate-limit/error-handler, `/health`, Vite+React+MUI shell, Vercel + Render deploy, UptimeRobot |
| **2 — Core** (Philena · Zoe · Mahdiya) | 3–4 | UC-001 spot-check form with GPS (`017`) + ≤100 KB compression + per-item severity; UC-001b text/voice complaints with OpenAI categorisation; UC-002 triage/assign with the 14-day default (`025`); UC-004 close with dual e-signature in a transaction; UC-003 SocketContext with reconnection + rating; **UC-010 contractor portal** (acknowledge, per-item completion photos, hold, e-sign, partial saves); UC-007 Roboflow pipeline with retry queue and bounding-box overlay |
| **3 — Intelligence** (Hasini · Davian) | 5 | UC-005 analytics (7 endpoints, heatmap/trend/SLA/scorecard/priority queue, filters, drill-down, CSV), PptxGenJS export, Data Playground CSV what-if; UC-006 velocity + cost predictor + `ai_jobs` queue + accept/dismiss; UC-009 pdfkit monthly report + Nodemailer + archive; UC-011 cost dashboard; UC-012 vendor lifecycle (`019`–`022`, `vendor_history`) |
| **4 — Polish** (All) | 6 | UC-008 notifications + 60 s in-process dispatcher + read receipts; toasts, empty states, spinners; mobile pass; 15 unit + 6 integration test files; seed data `018`, `023`, `024` |

---

## 4. Phase 5 — Client Fidelity (the remaining gaps)

**Duration:** Week 7 · **Goal:** every sentence of the client brief demonstrably satisfied, with no dead ends between portals.

### 5.1 Philena — paper-form fidelity, sign-off, audit

| # | Task | File(s) | Notes |
|---|---|---|---|
| P.1 | Migration `026_add_paper_form_fields.sql` | `backend/migrations/` | `servicing_date`, `address`, `town_council`, `defect_email_sent_at`, `reopen_count` |
| P.2 | Migration `027_reseed_checklist_paper_form.sql` | `backend/migrations/` | `UPDATE checklist_items SET active = FALSE` then insert the **25 items** from HLD §7.2. **Never DELETE** — `checklist_results.checklist_item_id` is a FK (G19) |
| P.3 | Return the template grouped by paper section | `checklistItemController.js` | Filter `active = TRUE`; order by `display_order`; group `A — Motor Room` / `B — Lift Car` / `C — Hoistway & Lift Pit` |
| P.4 | Form header + servicing date | `NewInspectionPage.jsx` | Town council (env default), lift company (read-only, derived), block/lift, address (auto-filled, editable), servicing date (**mandatory**), A1 warning when the gap exceeds one day |
| P.5 | Three-section checklist UI with per-section progress | `NewInspectionPage.jsx` | Collapsible accordions; a submit is blocked until all 25 are answered |
| P.6 | Inspector e-signature at submit | `NewInspectionPage.jsx`, `inspections.js`, `inspectionController.js` | Reuse `SignaturePad`; add `inspector_signature` to `upload.any()`; write `signatures` row `signer_role = 'inspector'` inside the existing create transaction |
| P.7 | Enforce G1–G5 server-side | `inspectionController.js`, `validate.js` | `INCOMPLETE_CHECKLIST` (lists missing item numbers) · `SEVERITY_REQUIRED` · `PHOTO_REQUIRED_FOR_SEVERITY` · `PHOTO_NOT_ALLOWED_FOR_MINOR` · `SIGNATURE_REQUIRED` |
| P.8 | Minor-severity photo suppression in the UI | `NewInspectionPage.jsx` | Hide the attach control on Minor with an inline note quoting the client's rationale |
| P.9 | Zero-defect auto-file branch (G6) | `inspectionController.js` | `Closed` + `closed_at`, audit `Filed — no defects`, no contractor, **no email**; stays visible in analytics |
| P.10 | Constrain the endorser to an inspector (G7) | `inspectionController.close()` | Look up `users.role` for `endorser_id`; `400 ENDORSER_MUST_BE_INSPECTOR` otherwise |
| P.11 | Block close on unrectified defects (G8) | `inspectionController.close()` | `409 UNRECTIFIED_DEFECTS` listing item numbers; manager waiver requires a note |
| P.12 | `POST /api/inspections/:id/reject` | `inspections.js`, `inspectionController.js`, `inspectionModel.js` | Reason ≥10 chars; `Rectified → Assigned`; `reopen_count++`; new 14-day deadline; audit `Rectification Rejected`; calls UC-014 with `email_type = 'rejection'`. Retain prior signatures (G20) |
| P.13 | Joint-endorsement UI: before/after per item + Reject | `InspectionDetailPage.jsx` | Defect photo ⟷ completion photo side by side; Accept (dual sign + cost) or Reject (reason dialog) |
| P.14 | Audit-action completeness (UC-015) | `inspectionModel.js` | Add `Defect Alert Sent`, `Filed — no defects`, `Rectification Rejected`, `Overdue Reminder Sent`; assert the full list in tests |
| P.15 | Defect-alert delivery chip on the record | `InspectionDetailPage.jsx` | Green "LC emailed {time}" or amber "LC not emailed — retry" read from `defect_email_log`. Sits with Philena because P.13 already rewrites this file — splitting it across two owners would only create a merge conflict |
| P.16 | Tests | `tests/unit/inspections.test.js`, `tests/integration/inspections.integration.test.js` | See §6 |

### 5.2 Davian — UC-014 auto-email, chase, annual export

| # | Task | File(s) | Notes |
|---|---|---|---|
| D.1 | Migration `028_create_defect_email_log.sql` | `backend/migrations/` | Per HLD §8.2 |
| D.2 | `emailService.sendDefectAlert()` | `services/emailService.js` | Subject `[Spot-Check Defect] Blk {block} Lift {lift_code} — {n} defect(s), due {deadline}`; body = form header + defect table (section, item no., text, severity, remark) + the 2-week note + deep link to `/contractor-inbox`. **Photos as Cloudinary links, never attachments** |
| D.3 | Wire UC-014 into spot-check submit | `inspectionController.js` (with Philena) | Fires after commit, ≥1 defect only; idempotent via `defect_email_sent_at` (G12); wrapped so failure never affects the response (G13) |
| D.4 | Reassignment + rejection variants | `inspectionController.js` | `email_type` `reassignment` / `rejection`; withdraw notice to the previous contractor's room |
| D.5 | Socket emit to the contractor on assign | `inspectionController.js`, `socketService.js` | **Loophole today:** assign emits only to `manager-room` + `block-{n}`. Add `contractor-{user_id}` — note the room is keyed by the contractor's **`users.id`**, resolved via `contractors.user_id` |
| D.6 | "LC not reachable" fallback (A4) | `inspectionController.js`, `InspectionDetailPage.jsx` | No contact email or no linked login → log the failure, amber chip for the manager, assignment still proceeds |
| D.7 | `GET /api/inspections/overdue-chase` + workflow | `routes/inspections.js`, `.github/workflows/overdue-defect-chase.yml` | Daily, `cronGuard`. D−3 and D+0; skip `On Hold`; once per record per day; audit `Overdue Reminder Sent` |
| D.8 | `GET /api/reports/annual?year=` | `routes/reports.js`, `services/pdfService.js` | Yearly PDF of every closed spot-check + CSV appendix → Cloudinary `/reports` |
| D.9 | **UC-012 backend + expiry cron — full handover from Hasini** | `vendorController.js`, `routes/vendors.js`, `.github/workflows/contract-expiry-check.yml` | The controller and routes are already built and green; Davian now **owns** them. He writes the expiry workflow YAML, tests `workflow_dispatch`, and owns the admin expiry notification email. Hasini's involvement ends at `AdminVendorPage.jsx` |
| D.10 | Tests | `tests/unit/defectEmail.test.js`, `tests/unit/overdueChase.test.js` | See §6 |
| Z.1 | Implement `SocketContext.jsx` | `src/context/SocketContext.jsx` | Initialises the Socket.IO client connection using `VITE_API_URL`; exposes `socket`, `joinRoom(roomId)`, `leaveRoom(roomId)` via context |
| Z.2 | Implement manager-room join logic | `src/context/SocketContext.jsx` | On login, if `user.role === 'manager'`, call `socket.emit('join', 'manager-room')` |
| Z.3 | Wire Socket.IO live update into `MyReportsPage.jsx` | `src/pages/MyReportsPage.jsx` | On opening a record detail, `joinRoom('insp-{id}')`; listen for `status_update` → update status + audit log without reload. The server authorises the join (`canJoinRecordRoom`), and `insp-{id}` is added to the emit rooms in `inspectionController` — without it an inspector originator receives nothing, since `inspector-team` carries no status events |
| Z.4 | Handle reconnection on network drop | `src/context/SocketContext.jsx` | Show "Live updates paused — reconnecting…" banner; auto-retry every 5 s |
| Z.5 | Satisfaction rating submission | `src/pages/MyReportsPage.jsx` | 1–5 star rating on a finished report; calls `POST /my-reports/:id/rating`; read-only after submit (UC-003 Alt B). **Ratable on `Resolved` *and* `Closed`** — the workflow closes records without ever passing through `Resolved`, so closed reports stay readable in a "Past reports" section (`GET /my-reports/history`) and can still be rated there |
| Z.6 | Empty state for no records | `src/pages/MyReportsPage.jsx` | Empty `GET /inspections/my` → `<EmptyState>` with shortcut to UC-001 |
| Z.7 | Socket.IO test verification | Browser DevTools | Confirm `status_update` received cross-tab; screenshot as test evidence |

### 5.3 Zoe — contractor-side flow integrity

| # | Task | File(s) | Notes |
|---|---|---|---|
| Z.1 | Surface the rejection in the inbox | `ContractorInboxPage.jsx` | Rejection reason pinned at the top of the record; a "Re-opened ×N" badge from `reopen_count` |
| Z.2 | Verify the hold clock (G11) | `contractorController.js`, `inspectionModel.js` | Confirm resume extends `target_deadline` by the held duration and writes `Resumed`; fix if it does not |
| Z.3 | Contractor live update on assign / reject | `SocketContext.jsx` | Listen for `defect_assigned` and `defect_rejected` on `contractor-{id}`; inbox refreshes without a reload |
| Z.4 | Deadline visuals | `ContractorInboxPage.jsx` | Green > 3 days · amber ≤ 3 days · red overdue; matches the chase email cadence |
| Z.5 | Suspended-vendor guard on contractor routes (G16) | `middleware/auth.js` (with Philena) | `403 ACCOUNT_SUSPENDED` before the role check |
| Z.6 | Tests | `tests/unit/contractor.test.js` | Reject → re-appears as `Assigned`; hold pauses then extends; cross-contractor access is 403 |

### 5.4 Hasini — dashboard alignment

> **Scope note:** no cron jobs, no Nodemailer, no vendor backend. Everything here
> is a chart, a table, or a download control.
>
> **All four tasks are complete, and none stayed blocked.** Each was written to
> work either side of the dependency it was waiting on: `H.1` probes for the
> column at runtime, `H.2` reads section names from `checklist_items` (which
> already has the column — migration `027` only changes the *values*), and `H.3`
> calls `D.8` and handles its 404 explicitly. Each starts working on its own when
> the dependency lands, with no further edit.

| # | Task | File(s) | Notes |
|---|---|---|---|
| H.1 | Overdue + re-open columns on the scorecard | `ContractorScorecard.jsx`, `analyticsController.js` | **Done.** Overdue was already live. `avg_reopens` added — `hasReopenCount()` probes `information_schema` once and emits `NULL::float` until migration `026` exists, so the query is valid before and after it and begins averaging by itself |
| H.2 | Section filter in analytics | `DashboardPage.jsx`, `analyticsController.js` | **Done.** `?section` adds an `EXISTS` over `checklist_results → checklist_items` scoped to `result = 'Defect'`. Correlates on `i.id` for prefixed callers, `inspections.id` otherwise. The dropdown hides itself when no sections are seeded |
| H.3 | Annual export entry point | `ReportsArchivePage.jsx`, `reportService.js` | **Done.** Year picker derived from the listed reports (no extra endpoint), download button → `GET /api/reports/annual`. 404 surfaces as "not available yet"; the page never generates or emails anything |
| H.4 | Tests | `tests/unit/analytics.test.js` | **Done.** 6 new tests: section EXISTS shape + bound param, absent when unfiltered, alias correlation on the scorecard, sections sourced from `checklist_items`, `avg_reopens` returned, `AVG(i.reopen_count)` emitted. Full suite green — 507 backend, 78 frontend |

> **UC-011 is closed.** Davian's `5.19a`/`5.19b` landed `adminController.js` and
> `routes/admin.js`; `costService.js` now calls `/api/admin/costs/*` through
> `api` and `mocks/costMocks.js` has been deleted, along with the unused
> `mocks/analyticsMocks.js` behind UC-005. Two endpoints were added for the
> panels the original three did not cover — `/costs/jobs` (row-level: drill-down
> table, CSV, trend, watchlist, benchmarks) and `/costs/filter-options` — plus a
> `category` filter and a job count on `/costs/summary`. No screen in Hasini's
> area reads a hardcoded dataset any more.
>
> Migration `034_seed_lift_cost_history.sql` supplies the cost history the
> panels need — 199 closed lift rectifications over the trailing 13 months,
> dated relative to `CURRENT_DATE`. This is a slice of the UC-016 mimic-data
> brief (task 6.2) scoped to UC-011; the wider spot-check volume seed is still
> Davian's.

### 5.5 Mahdiya — UC-013 OCR prefill

| # | Task | File(s) | Notes |
|---|---|---|---|
| M.1 | `openaiService.extractSpotCheckForm(imageUrl)` | `services/openaiService.js` | `gpt-4o-mini` vision; prompt names all 25 items in order; strict JSON out with `result`, `remark`, `field_confidence` per item |
| M.2 | `POST /api/inspections/ocr-prefill` | `routes/inspections.js`, `inspectionController.js` | `requireRole('inspector')`, `upload.single('form_photo')`. **Writes nothing to the database** (G18). `422 OCR_UNREADABLE` on failure |
| M.3 | Map OCR output to live checklist ids | `inspectionController.js` | Join by section + `display_order` against `active = TRUE` items; unmatched → `unreadable_items` |
| M.4 | "Scan a paper form" UI | `NewInspectionPage.jsx` (with Philena) | Camera/upload → compress → post → prefill |
| M.5 | Unconfirmed-field treatment | `NewInspectionPage.jsx` | Amber left border on every prefilled field; "please check" below 0.80; blanks for unreadable; banner *"Draft from a scanned form — check every answer. You are signing for this."* |
| M.6 | Never infer severity or photos | `inspectionController.js` | Explicitly excluded from the prompt and the response mapping |
| M.7 | Graceful degradation (A4) | `NewInspectionPage.jsx` | OpenAI down → button disabled with a tooltip; UC-001 unaffected |
| M.8 | Tests | `tests/unit/ocrPrefill.test.js` | Mocked OpenAI: happy path maps 25 items; partial read populates `unreadable_items`; endpoint writes no rows; unreadable → 422 |

---

## 5. Phase 6 — Hardening, Stress Test, Demo

**Duration:** Week 8 · **Owners:** All

| # | Task | Owner | Notes |
|---|---|---|---|
| 6.1 | End-to-end walk of the six-step workflow on one record | Philena | Inspector submit → LC email received → acknowledge → rectify → **reject once** → re-rectify → joint endorsement → closed → appears in the monthly PDF and the cost dashboard |
| 6.2 | Mimic data seed (UC-016, R19) | Davian | Repeatable script: ~500 spot-checks over 12 months, ~2,000 checklist results, mixed severities and outcomes |
| 6.3 | Stress test (UC-016, R19) | Mahdiya | Load the dashboard and triage queue against the seeded volume; record p95 in the README; confirms the client's photo-volume concern |
| 6.4 | Mobile pass at 375 px on the new UI | Hasini | Three-section checklist, signature pad, contractor inbox, scan flow |
| 6.5 | Audit-trail completeness assertion | Philena | An integration test asserting all 14 actions appear across one full lifecycle |
| 6.6 | Email deliverability check | Davian | Real SMTP to a real inbox; confirm the deep link and that no photo is attached |
| 6.7 | Requirement traceability sign-off | All | Walk HLD §1 row by row; every row must be demonstrable |
| 6.8 | Demo dry-run × 2 | All | Time it; rehearse the failure cases |

---

## 6. Test Matrix

### 6.0 UC-005 / UC-011 coverage (Hasini) — all passing

| ID | Test | Verifies |
|---|---|---|
| ANA-T01 | `issues-by-block` as manager | 200, `{ block, category, count }` rows |
| ANA-T02 | `?block=44A` | Only that block returned — the WHERE path |
| ANA-T03 | `sla-compliance` | `sla_percentage` within 0–100, matches `compliant/total` |
| ANA-T04/05 | CSV export | Download fires; disabled with tooltip on an empty result |
| ANA-T06 | 401 without a token · 403 as resident | Role gate on every analytics route |
| ANA-T07 | `filter-options` | Blocks, categories **and** sections returned |
| ANA-T08 | Sections query | Reads `checklist_items … active = TRUE` — survives the paper re-seed |
| ANA-T09 | Scorecard payload | Includes `overdue_count` and `avg_reopens` |
| ANA-T10 | Scorecard SQL | Emits `AVG(i.reopen_count)` when the column exists |
| **ANA-T11** | **Summary overdue** | **Excludes `On Hold` (G11) and soft-deleted** |
| **ANA-T12** | **Scorecard overdue** | **Excludes `On Hold` — matches the chase job** |
| **ANA-T13** | **Priority-queue frequency** | **Counts open records only, not resolved history** |
| **ANA-T14** | **Filter validation** | **`?from=hello`, `?to=2026-13-45`, `?from=2026-02-30`, a repeated `?block`, and `from` after `to` are each `400 VALIDATION_ERROR` before any SQL runs — binding stops injection but not a cast error, which surfaced as a `500` quoting Postgres. Asserted on all seven routes** |
| SEC-T01 | `?section=` | Adds `EXISTS` over `checklist_results`, scoped to `Defect`, param bound |
| SEC-T02 | No section | No `checklist_results` join emitted at all |
| SEC-T03 | Section on scorecard | Correlates on `i.id`, not `inspections.id` (prefixed alias) |
| PPT-T01/02 | `export/pptx` | Cloudinary URL returned; `EXPORT_FAILED` surfaces with CSV fallback |
| PLG-T01…06 | `parseInspectionsCsv` | Valid rows, minimal header, wrong header, header-only, missing field named by row, non-numeric hours named by row |
| PLG-T07…12 | Merge helpers | Heatmap increments without mutating the base; trends sort and skip dateless rows; SLA recomputes only on resolved rows |
| COST-T01…04 | `comparisonWindows` | Prior window is the same length, ends the day before the current one (no double count), trailing 90 days when undated, open-ended `from` |
| COST-T05…11 | `forecastNext` | Flat→flat with zero band, rising→damped, partial month excluded, clamps at zero, band widens with horizon, needs ≥3 months |
| COST-T12…15 | `backtestForecast` | Zero error on flat history, **never peeks at future data**, skips zero-spend months, `null` when untestable |
| COST-T16…18 | `topMover` | Largest month-on-month rise, ignores partial month, `null` when nothing rose |
| COST-T19…21 | `contractorBenchmarks` | Flags above-peer pricing **within category only**, requires ≥2 own + ≥2 peer jobs and ≥15% deviation |
| COST-T22…26 | `buildInsights` | Headline, ≥40% concentration rule, mover folding, watchlist urgency, silent with no jobs |
| COST-T27…29 | `buildLiftWatchlist` | Lifetime spend per lift, `months_to_review` semantics, block filter applies but date filters deliberately do not |
| COST-T30…36 | API wiring | Endpoint called, page filter keys → API parameter names, blanks dropped, one fetch feeds every panel, summary combines current + prior window, `null` movement with no prior spend, watchlist asks for lifetime rows |
| ADM-T01…05 | `/costs/jobs` | Contract keys per row, `YYYY-MM-DD` close date and numeric cost, `null` lift kept, closed + costed only newest first, LEFT joins, every filter bound as a parameter |
| ADM-T06…09 | `/costs/filter-options` | Blocks, categories, contractors **with ids**; options come from costed rows only; binds no parameters; empty tables yield empty arrays |

### 6.0b UC-012 coverage (Hasini) — all passing

`backend/tests/unit/vendors.test.js` (30 tests). VND-T01 – T06 are labelled in
the file; the remaining tests extend the same six areas.

| ID | Test | Verifies |
|---|---|---|
| VND-T01 | Onboard, valid data | 201; `contractors` + `users` rows created, account `active`, `Onboarded` history written |
| VND-T02 | `contract_end` ≤ `contract_start` | `400 INVALID_CONTRACT_DATES` — a zero-length contract counts |
| VND-T03 | Login email already registered | `409 EMAIL_ALREADY_EXISTS`, **no rows created** |
| VND-T04 | Daily expiry job | Suspends vendors past `contract_end`, writes history, emits `vendor_expired` to `admin-room` |
| VND-T05 | Suspended vendor access | `403 ACCOUNT_SUSPENDED` on `/users/me` and on every role-gated route |
| VND-T06 | Renew | 200, suspended account reactivated with the new `contract_end` |

The other 24 tests in the file extend those six areas and are named rather than
numbered: derived-column defaults (`contact_email` falls back to the login email,
`brands_serviced` to the company name, and supplied values are never
overwritten); onboard validation (missing account-holder fields named in the
error, malformed login email); onboard rollback (a DB failure after `signUp`
deletes the auth user, so no orphaned login survives); edit + audit trail
(`PATCH` records history, `400` when no fields are supplied, history returns
actor names); cron guard (on-demand run is admin-only, `401` on a wrong secret);
renew guards (`404` unknown vendor, `400` when the date does not extend the
contract, optional replacement document accepted); suspend; and the `403`
role gate on every vendor route.

**Malformed `:id` (6 tests).** `contractors.id` is a UUID column, so a path id
like `not-a-uuid` made Postgres raise a cast error (SQLSTATE 22P02) that reached
the caller as a `500` quoting the database's own message. All four `:id` routes
now answer `404`, the same as a well-formed id naming no vendor. The tests assert
the status on each route, that no Postgres code or message appears in the body,
and that the guard sits *after* the role gate — so a malformed id is never a way
around admin-only access. Fixture ids are real UUIDs for the same reason: `ctr-1`
could not exist in the live schema.

### 6.0c Role contacts coverage (Hasini) — all passing

16 named tests across three files, covering the two sources every phone number
now comes from:

- `tests/unit/contactDirectory.test.js` (3) — `GET /api/contacts` returns the
  directory in display order, exactly one row is flagged `is_help_line`, and an
  unauthenticated call is refused `401`.
- `tests/unit/userContacts.test.js` (5) — `GET /api/users/contacts` maps the
  caller's verified role to its counterpart (manager → admins, admin and
  inspector → managers), returns a staff row whose `phone` is null, and refuses
  a resident `403` so staff numbers cannot be enumerated.
- `frontend/src/pages/EmergencyContactsPage.test.jsx` (8) — each role's block
  renders from the API, a resident never calls the staff endpoint at all, a
  manager who has published no number is omitted rather than shown unreachable,
  numbers are `tel:` links, an unconfigured role gets a message, and the admin
  role has no contacts block at all (its sidebar card already dials the estate
  manager, so a page repeating that one number would be redundant).

Run: `npx jest` (652 — 650 passing, 2 todo) and `npx vitest run` (125).



| Test ID | Input | Expected |
|---|---|---|
| FORM-T01 | `GET /api/checklist-items` | 25 active items in 3 sections, ordered 1–25 |
| FORM-T02 | Submit with 24 of 25 answered | 400 `INCOMPLETE_CHECKLIST`, missing item number listed |
| FORM-T03 | Defect without severity | 400 `SEVERITY_REQUIRED` |
| FORM-T04 | Critical defect without a photo | 400 `PHOTO_REQUIRED_FOR_SEVERITY` |
| FORM-T05 | Minor defect with a photo | 400 `PHOTO_NOT_ALLOWED_FOR_MINOR` |
| FORM-T06 | Submit without an inspector signature | 400 `SIGNATURE_REQUIRED` |
| FORM-T07 | Submit without `servicing_date` | 400 `VALIDATION_ERROR` |
| FORM-T08 | Valid submit, 25 Pass | Status `Closed`, audit `Filed — no defects`, **no email row** |
| FORM-T09 | Valid submit, 3 defects | Status `Pending Assignment`, contractor derived, 1 `defect_email_log` row, `defect_email_sent_at` set |
| FORM-T10 | Historical result whose item is now `active = FALSE` | Detail view still resolves the item text |
| MAIL-T01 | Defect submit | Email sent to `contractors.contact_email`; body lists every defect with severity; no attachments |
| MAIL-T02 | Same submit replayed | No second email (G12) |
| MAIL-T03 | SMTP throws | `defect_email_log.status = 'failed'`, inspection still `Pending Assignment` (G13) |
| MAIL-T04 | Contractor with no `contact_email` | No send attempted; failure logged; assignment still succeeds |
| MAIL-T05 | Reassignment | Second row `email_type = 'reassignment'` |
| CHASE-T01 | Record due in 3 days | 1 chase email, audit `Overdue Reminder Sent` |
| CHASE-T02 | Record `On Hold` past deadline | Skipped; counted in `skipped_on_hold` |
| CHASE-T03 | Chase run twice in one day | Second run sends nothing |
| SIGN-T01 | Close with a manager as endorser | 400 `ENDORSER_MUST_BE_INSPECTOR` |
| SIGN-T02 | Close with an inspector as endorser | 200; two `signatures` rows; status `Closed` |
| SIGN-T03 | Close with one defect unrectified | 409 `UNRECTIFIED_DEFECTS` listing item numbers |
| REJ-T01 | Reject a `Rectified` record with a 5-char reason | 400 `VALIDATION_ERROR` |
| REJ-T02 | Reject with a valid reason | Status `Assigned`, `reopen_count = 1`, new deadline, rejection email, prior signatures retained |
| REJ-T03 | Reject an `Assigned` record | 409 `INVALID_STATE` |
| HOLD-T01 | Hold 5 days then resume | `target_deadline` extended by 5 days; `Resumed` audit row |
| OCR-T01 | Mocked clean form image | 25 items mapped; no database rows written |
| OCR-T02 | Mocked partial image | Readable items returned; rest in `unreadable_items` |
| OCR-T03 | Non-form image | 422 `OCR_UNREADABLE`; no partial state |
| OCR-T04 | Response inspection | No severity and no photo ever inferred |
| AUD-T01 | Full lifecycle incl. one rejection | All 14 audit actions present, chronologically ordered |
| SEC-T01 | Contractor A opens contractor B's record | 403 `FORBIDDEN` |
| SEC-T02 | Suspended contractor acknowledges | 403 `ACCOUNT_SUSPENDED` |

Existing Phase 1–4 suites (auth, inspections, contractor, analytics, recommendations, cv, notifications, vendors, reports, export) must stay green.

---

## 7. Definition of Done

**Phase 5 is complete when:**

- [ ] `GET /api/checklist-items` returns the 25 paper items in sections A/B/C, and a marker can hold the sample form beside the screen and match them one-to-one
- [ ] A spot-check captures servicing date, town council, address, block/lift, GPS, per-item √/X + severity + remark + photo, and the inspector's signature
- [ ] Minor defects cannot carry photos; Major/Critical cannot be submitted without one
- [ ] A zero-defect check files itself to `Closed` with no email and no contractor involvement
- [ ] **A defect submit emails the lift company automatically**, logs it, and the contractor sees it in their inbox without a reload
- [ ] Email or socket failure never rolls back a transaction, and the manager can see the delivery status on the record
- [ ] The contractor can acknowledge, save partial progress, hold (clock pauses), and finalize with an e-signature
- [ ] The inspector can **reject** an inadequate rectification with a reason; the record returns to the contractor with a new deadline and a re-notify email
- [ ] Close requires an **inspector** endorser and every defect rectified
- [ ] All 14 audit actions appear across one lifecycle, and `inspection_history` has no mutation path
- [ ] Overdue chase fires at D−3 and D+0, skipping held records
- [ ] The annual export downloads a year of closed spot-checks
- [ ] UC-013 prefills from a photographed form, marks every field unconfirmed, writes nothing until the inspector signs, and degrades gracefully
- [ ] All §6 tests pass alongside the existing suites
- [ ] Every page is usable at 375 px

**All-phase gate:** merged to `main` via PR with one peer review · no secrets committed · `.env.example` updated (`TOWN_COUNCIL_NAME`, `APP_PUBLIC_URL`, `MAIL_FROM`) · README updated · deployed build reflects the phase · demonstrated to one other member.

---

## 8. Risk Register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Re-seeding the checklist orphans historical results | Medium | **Critical** | Never DELETE — `active = FALSE` only (G19); FORM-T10 asserts old results still resolve |
| SMTP blocked or rate-limited on the demo network | Medium | **High** | UC-014 is fire-and-forget (G13) — the flow proceeds regardless. Pre-send one alert the evening before; keep a screenshot of a delivered email as demo fallback |
| The auto-email is judged the headline feature and fails live | Low | **High** | Demo the received email from a real inbox, not from logs. Have the `defect_email_log` row and the audit entry ready as corroboration |
| OCR (UC-013) unreliable on handwriting | **High** | Low | Scoped as prefill-and-confirm only (G18); nothing in the client brief depends on it. If it slips entirely, cut it — §14.1 already frames it as optional |
| Roboflow confidence too low on lift photos | High | Medium | Threshold drop to 0.60; static demo image as fallback; CV is assistive by design |
| Phase 5 touches `inspectionController` from three directions at once | **High** | Medium | Philena owns the file. Davian's UC-014 lands as `emailService` + a single call site; Mahdiya's OCR lands as a separate endpoint. Sequence: P.1–P.9 → D.3 → M.2 |
| Render cold start during the demo | Medium | High | UptimeRobot + manual warm-up 10 minutes before |
| Supabase free tier | Low | Critical | Does not expire — verified |

---

## 9. Demo Narrative

One continuous record, followed through all four portals. This mirrors Daniel Koh's six steps in order — say so out loud at each transition.

| # | Segment | Member | Shows | Time |
|---|---|---|---|---|
| 1 | **Step 3 — the spot-check** | Philena | Phone view. Pick lift 44A-L1 → servicing date → GPS tap → the **real 25-item form in sections A/B/C** → mark item B-5 "Door side gaps" a Major defect, dictate the remark, attach a photo (watch it compress to <100 KB) → try to attach a photo to a Minor defect (blocked, explain why) → sign → submit | 4 min |
| 2 | **Step 4 — the auto-email** | Davian | Switch to a real inbox and **open the email that just arrived** — defect table, severities, the 2-week note, deep link. Then the audit row `Defect Alert Sent`. *This is the client's first stated advantage.* | 2 min |
| 3 | Manager triage | Philena → Zoe | Manager sees the record arrive live, confirms the auto-derived lift company, sets priority, deadline countdown starts | 1.5 min |
| 4 | **Step 5 — the contractor portal** | Zoe | Log in as the lift company → inbox with the countdown → **acknowledge on the platform** → upload a completion photo + remark → e-sign → submit work done | 3 min |
| 5 | **Step 6 — joint endorsement, including a rejection** | Philena | Inspector reviews before/after side by side → **rejects** with a reason → contractor's inbox updates live with the reason and a new deadline → contractor re-submits → inspector + manager **dual e-sign** → actual cost → closed | 3.5 min |
| 6 | **Step 7 — the paper trail is gone** | Philena | The full timestamped audit log for that one record, all 14 actions, both signature blocks with timestamps — held up against the paper form | 1.5 min |
| 7 | CV assist + OCR adoption aid | Mahdiya | Roboflow bounding box on a lift defect photo; then **photograph a completed paper form** → fields prefill in amber as unconfirmed → explain why it stops short of auto-submit | 2.5 min |
| 8 | Analytics + PowerPoint | Hasini | Heatmap, SLA gauge, **contractor scorecard with overdue and re-open columns**, section A/B/C filter → accept a cost-aware AI alert → Data Playground what-if → **Export to PowerPoint** | 3 min |
| 9 | Admin: cost, vendors, annual archive | Davian | Cost dashboard actual vs projected → vendor onboarding with expiry countdown → **download the annual archive** ("Download as file every year") | 2 min |
| | **Total** | | | **~23 min** |

**Closing slide:** map the six steps to the six segments, then state coverage — *Primary 4C-1 (the whole journey above) · Secondary 4C-2 (dashboards + PowerPoint) · Thematic 4D (cost-aware predictive alerts)* — and name the Microsoft-ecosystem adoption path (Power Automate / SharePoint) as future work.

**Edge cases to show live** (markers reward these): submit with one item unanswered (blocked, item number named); close with a manager rather than an inspector as endorser (rejected — quote the client's wording); drop the network to show the Socket.IO reconnection banner.

---

*End of PROJECT_IMPLEMENTATION_PHASES.md*
