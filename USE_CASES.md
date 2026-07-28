# USE_CASES.md
# Lift Inspection & Estate Defect Management System — Use Case Specifications

> Companion to `HIGH_LEVEL_DESIGN.md` and `PROJECT_IMPLEMENTATION_PHASES.md`.
> Requirements document of record: Daniel Koh's *"Digitalise the Form on Spot-Check of Lift Servicing"* (10 Jun 2026).
>
> **Legend —** ✅ Built · 🔶 Partial (extension required) · 🆕 New

---

## Use Case Register

| ID | Name | Primary actor | Workflow step | Owner | State |
|---|---|---|---|---|---|
| UC-001 | Complete a lift spot-check | Inspector | 3 | Philena | 🔶 |
| UC-001b | Report an estate defect (text/voice) | Resident | — | Philena | ✅ |
| UC-002 | Triage and assign a defect | Manager | 4 | Philena | ✅ |
| UC-003 | Track a report live | Resident | — | Zoe | ✅ |
| UC-004 | Joint endorsement and close | Manager + Inspector | 6, 7 | Philena | 🔶 |
| UC-005 | Analytics dashboard + exports | Manager | — | Hasini | ✅ |
| UC-006 | AI risk alerts with cost | System | — | Davian | ✅ |
| UC-007 | CV defect detection | System | — | Mahdiya | ✅ |
| UC-008 | Broadcast notifications | Manager | — | Zoe | ✅ |
| UC-009 | Monthly report + annual archive | System | 7 | Davian | 🔶 |
| UC-010 | Contractor rectification portal | Contractor | 5 | Zoe | ✅ |
| UC-011 | Admin cost analytics | Admin | — | Davian (BE) / Hasini (FE) | 🔶 **FE only — backend never built** |
| UC-012 | Vendor account lifecycle | Admin | — | Davian (BE) / Hasini (FE) | ✅ |
| UC-013 | Paper-form OCR prefill | Inspector | 3 | Mahdiya | 🆕 |
| UC-014 | Auto-notify the lift company | System | 4 | Davian | 🆕 |
| UC-015 | Digital audit trail | System | 7 | Philena | 🔶 |
| UC-016 | Mimic data + stress test | All | — | All | 🔶 |

---

## UC-001 — Complete a lift spot-check 🔶

**Actor:** Inspector · **Workflow step:** 3 · **Owner:** Philena
**Client requirements:** R1 (mobile), R2 (GPS), R3 (paper-matching checklist), R4 (compression), R5 (severity), R13 (servicing date), R14 (no photo on minor)
**Preconditions:** Inspector is authenticated; the lift exists in `lifts`; the contractor has serviced the lift (step 2).
**Postcondition:** An `inspections` row with `source_type = 'lift_inspection'`, 25 `checklist_results` rows, an inspector `signatures` row, and an audit row exist. If any defect was recorded, UC-014 has fired.

### Main flow

1. Inspector opens `/inspections/new` on a phone.
2. Selects the lift from `GET /api/lifts`. The system fills **Lift Company** (from `lifts.brand → contractors.name`), **Block/Lift**, **Address**, and **Town Council** (from `TOWN_COUNCIL_NAME`).
3. Inspector taps **Use my location** — `LocationCapture` writes `gps_lat/lng/accuracy/captured_at`. *(Explicit tap only — never automatic.)*
4. Inspector enters the **Servicing Date** (the contractor's scheduled servicing date, form note 1).
5. The system loads the 25-item template from `GET /api/checklist-items`, rendered as three collapsible sections — **A — Motor Room** (9), **B — Lift Car** (8), **C — Hoistway & Lift Pit** (8) — with a per-section progress counter.
6. For each item the inspector taps **Pass** or **Defect** (the paper's √ / X column).
7. For each **Defect**: pick severity (Minor / Major / Critical), type or dictate a remark, and — for Major/Critical only — attach a photo, compressed client-side to ≤100 KB.
8. Inspector signs the **Checked by** signature pad.
9. **Submit** → `POST /api/inspections/lift` (multipart, one `photo_<item_id>` part per defect plus `inspector_signature`).
10. Server validates G1–G5, writes the record + results + signature + audit row in one transaction.
11. **Branch A — one or more defects:** status `Pending Assignment`; `contractor_id` derived from `lifts.contractor_id`; **UC-014 fires**; sockets to `manager-room` and `contractor-{user_id}`; the 14-day clock starts.
    **Branch B — zero defects:** status `Closed`, `closed_at` set, audit `Filed — no defects`, no contractor involvement and **no email** (G6). The record still counts in analytics as a completed compliant check.
12. Inspector sees a confirmation naming the lift company that was emailed and the rectification deadline.

### Alternate flows

- **A1 — Servicing date more than one day before the spot-check.** The form warns ("the client's process expects the check on the next/following day") and requires a remark, but does not block.
- **A2 — Photo attached to a Minor defect.** Blocked client-side with an inline explanation; server returns `PHOTO_NOT_ALLOWED_FOR_MINOR` (the client's slowdown/storage concern).
- **A3 — Offline or flaky signal on site.** Answers are held in local component state; submit is retried once and, on failure, the inspector is told nothing was lost and to retry when signal returns. *(No offline queue — see UC-001 limitations.)*
- **A4 — Inspector prefers paper.** UC-013 supplies a draft; the inspector confirms every field, signs, and submits through this same flow.
- **A5 — GPS denied or unavailable.** GPS is skipped silently. Block/lift selection is the authoritative location; GPS is supplementary and never overrides it.

### Exceptions

| Code | Cause |
|---|---|
| `INCOMPLETE_CHECKLIST` | Not all 25 active items answered — response lists the missing item numbers |
| `SEVERITY_REQUIRED` | A `Defect` row without a severity |
| `PHOTO_REQUIRED_FOR_SEVERITY` | A Major/Critical defect without a photo |
| `PHOTO_NOT_ALLOWED_FOR_MINOR` | A Minor defect with a photo |
| `PHOTO_TOO_LARGE` | A part exceeded the multer cap |
| `SIGNATURE_REQUIRED` | Submitted without the inspector signature |
| `VALIDATION_ERROR` | `servicing_date` or `lift_id` missing |

### Extension work (this iteration)

Re-seed the checklist to the 25 paper items (migration `027`); add `servicing_date`, `address`, `town_council` (migration `026`); render by paper section; capture the inspector signature at submit; implement the zero-defect auto-file branch; enforce G1–G5.

---

## UC-001b — Report an estate defect by text or voice ✅

**Actor:** Resident · **Owner:** Philena

Resident opens `/report`, types or dictates a description via the Web Speech API (live transcript, language picker, type-fallback if unsupported), optionally attaches a photo (compressed) and taps for GPS, then submits to `POST /api/inspections/complaint`. OpenAI assigns `category` and `ai_priority_score`; the record enters the same triage → assign → close lifecycle. Duplicate submissions by the same resident within 2 minutes return `409 DUPLICATE_SUBMISSION` with the existing id.

---

## UC-002 — Triage and assign a defect ✅ (step 4)

**Actor:** Manager · **Owner:** Philena

Manager opens `/inspections`, a queue sorted by severity and `ai_priority_score`. Opening a record shows the full checklist with defect photos, GPS, the audit trail, and — for voice complaints — audio playback. `PATCH /api/inspections/:id` sets priority, confirms or changes the contractor, overrides the deadline, or places the record on hold. Assigning moves status to `Assigned` and starts the 14-day clock.

- **Alt A — wrong contractor auto-derived.** Reassignment re-fires UC-014 to the new lift company (`email_type = 'reassignment'`) and notifies both contractor rooms (G17).
- **Alt B — no contractor account or no contact email.** The record surfaces an amber "LC not reachable" chip; the manager is prompted to fix the vendor record in UC-012.
- **Alt C — vendor suspended mid-job.** The record appears in a "Pending Reassignment" queue.

---

## UC-003 — Track a report live ✅

**Actor:** Resident · **Owner:** Zoe

`SocketContext` joins `block-{n}` on login and `insp-{id}` when a detail view opens. `status_update` events refresh the status and audit log without a reload. A dropped connection shows "Live updates paused — reconnecting…" and retries every 5 s. On `Resolved`, a 1–5 star rating is offered once (`409 ALREADY_RATED` on a repeat).

---

## UC-004 — Joint endorsement and close 🔶 (steps 6 and 7)

**Actor:** Manager, co-signed by an Inspector · **Owner:** Philena
**Client requirement:** R9 — "get a digital sign-off from the EM Services inspector"
**Precondition:** status is `Rectified`.

### Main flow

1. Manager (with the inspector present — the client's "joint inspection with lift companies") opens the record.
2. The detail view shows, per defect item: original photo ⟷ completion photo, original remark ⟷ completion remark, severity, and the contractor's signature with its timestamp.
3. Both parties agree the defects are cleared.
4. Manager signs; the inspector signs on the same device.
5. Manager enters `actual_cost` and a closing remark (≥10 characters).
6. `POST /api/inspections/:id/close` (multipart: `manager_signature`, `endorser_signature`).
7. Server validates **G7** (the endorser's `users.role` must be `inspector`) and **G8** (every defect rectified with a completion photo, or an explicit waiver note), then in **one transaction** (G14) writes both `signatures` rows, sets `status = 'Closed'` + `closed_at` + `resolution_time_hours`, archives the record, and appends `Jointly Endorsed & Closed`.
8. Sockets fire to `manager-room`, `admin-room`, `block-{n}`. The record enters the 5-year archive and the cost feeds UC-011.

### Alternate flow — **rejection (new)**

4a. The completion proof is inadequate. The inspector or manager calls `POST /api/inspections/:id/reject` with a reason (≥10 characters).
4b. Status returns to `Assigned`, `reopen_count` increments, a fresh 14-day deadline is set, prior signatures are **retained not overwritten** (G20), audit records `Rectification Rejected`, and UC-014 re-fires with `email_type = 'rejection'`.
4c. The contractor sees the rejection reason at the top of the item in their inbox.

### Exceptions

`ENDORSER_MUST_BE_INSPECTOR` 400 · `UNRECTIFIED_DEFECTS` 409 (lists item numbers) · `SIGNATURE_REQUIRED` 400 · `VALIDATION_ERROR` 400 (remark too short) · `INVALID_STATE` 409

**Implementation status of the above** (as built in `inspectionController.closeInspection`):

| Code | Status |
|---|---|
| `ENDORSER_MUST_BE_INSPECTOR` 400 | **Built.** Enforced twice: the submitted `endorser_role` must be `inspector`, *and* the nominated `endorser_id` is re-read from `users` and its stored `role` must match — so a signature can never record a role its signer doesn't hold. The endorser may be **any active inspector**, not only the record's own; resident complaints have no `inspector_id`, so the manager nominates one from `GET /api/users/inspectors`. |
| `INVALID_STATE` 409 | **Built.** Close requires status `Rectified` or `Resolved`. `Resolved` is accepted alongside `Rectified` because it is also a post-work state in the migration 004 enum. |
| `VALIDATION_ERROR` 400 | **Built** (remark < 10 chars, and non-numeric/negative `actual_cost`). |
| `SIGNATURE_REQUIRED` 400 | **Built.** A missing `manager_signature`/`endorser_signature` part returns this code — the same one UC-010's contractor rectify flow returns for the same condition. |
| `UNRECTIFIED_DEFECTS` 409 | **Not built.** G8 is not enforced — a record can still be closed while `checklist_results` rows remain unrectified or lack a `completion_photo_url`. |

### Extension work

~~Constrain the endorser to `inspector` (G7)~~ — done. Remaining: add the G8 completeness gate; build the reject endpoint, UI, and re-notify path.

---

## UC-005 — Analytics dashboard and exports ✅

**Actor:** Manager · **Owner:** Hasini
**Client requirements:** R17 ("Statistic / report") · 4C-2 interactive dashboard · 4D data-driven decisions
**Preconditions:** Caller is authenticated with `role = 'manager'`. Backend reachable.
**Postcondition:** No state change — UC-005 is read-only. Nothing it does writes to `inspections`; the CSV what-if preview is session-only and exports always read the database.

### Main flow

1. Manager opens `/dashboard`. The page reads its filter state from the URL query string, so a filtered view is bookmarkable and shareable.
2. Six requests fire in parallel — summary, heatmap, trends, SLA, contractor scorecard, AI alerts — plus the priority queue on its own filters.
3. **KPI row** renders open count, overdue count, average resolution hours and SLA %, each with movement against the prior 30-day window.
4. **Filter bar** offers block, category, form section, and a from/to date range. Options are queried from the database (`/analytics/filter-options`), never hardcoded. Any change rewrites the URL and re-fetches every panel.
5. **Charts** render: heatmap (block × category), daily trend line, SLA doughnut against the 72-hour threshold.
6. **Contractor scorecard** lists jobs, average rectification days, repeat-defect rate, overdue count and average re-opens per contractor.
7. **Priority queue** ranks open records by `(ai_priority_score × 0.5) + (recency × 0.3) + (frequency × 0.2)`, defaulting to a Top 10 triage view.
8. Manager acts: clicks a heatmap cell to drill into `/inspections?block=…&category=…`, opens a queue row at `/inspections/:id`, accepts or dismisses an AI alert, or exports.

### Alternate flows

- **A1 — Drill-through to triage.** Clicking a heatmap cell navigates to the triage queue pre-filtered to that block + category. The queue's filters are URL-driven, so back returns to the dashboard with its filters intact. This is the join between analytics and the UC-002 → UC-004 lifecycle.
- **A2 — Live refresh.** The page subscribes to `status_update` on `manager-room`. Assign, rectify and close events (UC-002 / UC-004 / UC-010) trigger a re-fetch coalesced on a 1.5 s timer, so a burst of transitions causes one refresh, not one per event.
- **A3 — CSV what-if preview (Data Playground).** Importing a `block,category[,date][,resolution_time_hours]` CSV blends hypothetical rows into the heatmap, trend and SLA gauge client-side. A Combined / Existing only / Imported only toggle drives all three charts at once; imported data is marked (ring on cells, dashed series, before → after gauge). **Nothing is persisted**, and Clear preview drops the rows.
- **A4 — PowerPoint export.** `POST /api/export/pptx` renders the current filtered view server-side via PptxGenJS. It re-runs the same `fetch*` functions the dashboard used, so the deck cannot drift from the screen — and it always uses database rows, never A3's preview rows.
- **A5 — Run AI analysis on demand.** "Run AI analysis" calls `GET /api/recommendations/run` rather than waiting for the nightly job, then re-fetches so new alert cards appear.
- **A6 — Manager arrives with no records yet.** Every panel renders its own `<Alert severity="info">` empty state rather than an empty axis.

### Exceptions

| Case | Behaviour |
|---|---|
| Any panel request fails | Persistent error banner with a **Retry** button; the last good data stays on screen rather than blanking |
| Non-manager opens `/dashboard` | Resident placeholder rendered client-side; the API returns `403 FORBIDDEN` regardless — the UI guard is convenience, not enforcement |
| No token / expired token | `401 UNAUTHORIZED`; `ProtectedRoute` redirects to `/login` |
| `from` later than `to` | Inline field error, fetch suppressed, last good data retained — no request is sent with an impossible range |
| CSV import > 1 MB | Rejected client-side before parsing, with a size message; no partial state |
| CSV import > 5,000 rows | Rejected after parse with a row-count message |
| CSV malformed / not CSV | "Could not read that file" toast; the preview is not entered |
| Priority-queue filter matches nothing | Info alert in the panel; **Export CSV** disables itself with an explanatory tooltip (ANA-T05) |
| PptxGenJS throws | `500 EXPORT_FAILED`; the UI surfaces the message and CSV export remains available as a fallback |

### Edge cases the queries handle explicitly

- **Overdue excludes `On Hold`** — a hold pauses the rectification clock (G11), and the overdue-chase job skips held records. Counting them would make the dashboard contradict the emails the contractor actually receives. Soft-deleted records are excluded on the same basis as `open_count`.
- **Frequency counts open records only** — including resolved history would rank a block that *used to* have problems as urgently as one that has them now. Long-run recurrence is UC-006's velocity analysis.
- **No prior-period data** → `new_records_change_pct` is `null` and the KPI shows "no prior data" rather than a fabricated 0% or a division by zero.
- **Nothing closed yet** → SLA percentage is 0 with `total_resolved: 0`, not `NaN`.
- **A job acknowledged but never rectified** → `avg_rectification_days` is `NULL`, rendered `—`.
- **`reopen_count` column absent** (pre-migration `026`) → `avg_reopens` is `NULL`, rendered `—`; the controller probes `information_schema` once and begins averaging by itself once the column exists.
- **Trend gap months** → interior months with no data are filled with 0 so the line does not silently skip quiet periods.

Chart.js heatmap (block × category), trend line, SLA gauge, contractor scorecard, and a ranked priority queue — all responding to **block / category / form section / date-range** filters. Heatmap cells drill through to a filtered `/inspections`. Exports: client-side CSV, and `POST /api/export/pptx` for a PowerPoint deck of the current filtered view (the client's weekly-meeting pain point). **Data Playground:** an Import CSV control blends hypothetical rows (`block,category[,date][,resolution_time_hours]`) into the charts client-side with a Combined / Existing only / Imported only toggle; ≤1 MB and ≤5,000 rows; nothing is persisted and exports always use real data.

**Contractor scorecard** reports, per contractor: jobs, average rectification days (acknowledged → rectified), repeat-defect rate, **overdue count**, and **average re-opens** (UC-004 rejections sent back for rework).

**Overdue is measured against the paused clock (G11).** A record counts as overdue only when `target_deadline` has passed *and* its status is not `On Hold`, `Rectified`, `Resolved` or `Closed`. Held work — the contractor is waiting on site access or a part — does not accrue overdue time, matching both G11 and the overdue-chase job, which skips held records. Were the dashboard to count them, it would accuse a contractor of lateness the system never chased them for. Soft-deleted records are excluded on the same basis as `open_count`.

**The priority queue's frequency term counts open records only.** `(ai_priority_score × 0.5) + (recency × 0.3) + (frequency × 0.2)`, where frequency is 10 points per *open* record sharing the same block + category, capped at 100. Counting resolved history would rank a block that used to have problems as urgently as one that has them now; long-run recurrence is UC-006's velocity analysis, not this score's job. `avg_reopens` is NULL — rendered `—` — until migration `026` adds `inspections.reopen_count`; the controller probes `information_schema` once and starts averaging automatically when the column appears, so it needs no code change at that point.

**Form-section filter (R17 — "Statistic / report").** Answers "which part of the lift fails most" by narrowing every chart to inspections carrying at least one **Defect** in a given section of the paper form. Resolved through `checklist_results → checklist_items.section`, and the dropdown is populated from `checklist_items` itself — so the re-seed to the real 25 paper items (migration `027`) changes the options with no frontend or query change. Matching on Pass rows too would select nearly every inspection and say nothing, so the subquery is scoped to `result = 'Defect'`.

**Annual archive entry point (R16).** The Reports Archive page offers a year picker — derived from the periods already listed, so no extra endpoint is needed to populate it — and a **Download annual archive** button calling `GET /api/reports/annual?year=YYYY` (Davian's D.8). Until that endpoint ships it returns 404, which the page reports as *"Annual archive is not available yet"* rather than a generic failure.

**Connection to the workflow.** The dashboard is not a terminal screen — it is a way into the record lifecycle:

- **Heatmap drill-through** — clicking a block × category cell navigates to `/inspections?block=…&category=…`, landing the manager on the triage queue already filtered to those records, from which UC-002 (assign) and UC-004 (close) proceed normally. The queue's filters are URL-driven, so the link is shareable and the browser back button returns to the dashboard with its own filters intact.
- **Live refresh** — the dashboard subscribes to `status_update` on `manager-room`, the same event UC-002/UC-004/UC-010 emit on every assign, rectify and close (HLD §10). Re-fetches are coalesced on a 1.5 s timer so a burst of transitions triggers one refresh, not one per event.
- **Priority queue → record** — each row links to `/inspections/:id`, the joint-endorsement view.
- **Exports carry the current filter state**, and always use database rows, never Data Playground preview rows.

---

## UC-006 — AI risk alerts with estimated cost ✅

**Actor:** System (nightly), Manager (accept/dismiss) · **Owner:** Davian

`GET /api/recommendations/run` drains the `ai_jobs` queue first (pairs that hit the recurrence threshold at close), then runs a velocity scan across every block+category pair. Pairs at ≥40 % velocity go to OpenAI, which returns a ≤60-word alert naming the trend, the action, and the projected cost impact. Alerts render as amber cards; **Accept** creates a costed maintenance record (`source_flag = 'AI-Generated'`), **Dismiss** timestamps the dismissal.

---

## UC-007 — Computer-vision defect detection ✅

**Actor:** System · **Owner:** Mahdiya

After a photo reaches Cloudinary, `cvController.detect()` calls Roboflow. Confidence ≥0.70 creates a `cv_auto_detected` record and alerts the manager; below that it lands in the "Needs Manual Review" tab. A Roboflow `429` queues the image in `retry_queue`, drained by the cron-guarded `GET /api/cv/batch-scan`. `BoundingBoxOverlay` draws the detection on the detail page. CV is **assistive** — a human always confirms.

---

## UC-008 — Broadcast notifications ✅

**Actor:** Manager · **Owner:** Zoe

Scope selector (specific blocks / all residents / inspectors / contractors), message, urgency (Informational / Warning / Critical), and an optional send time. Immediate sends broadcast over Socket.IO at once; scheduled sends are dispatched by the in-process 60-second `setInterval` loop (the UI states sends may be up to 60 s late). Read receipts poll every 30 s.

---

## UC-009 — Monthly report and annual archive 🔶 (step 7)

**Actor:** System · **Owner:** Davian
**Client requirements:** R16 — "Proper record, audit"; "Download as file every year"

Monthly (built): GitHub Actions calls `GET /api/reports/generate`; pdfkit renders title, period, an OpenAI executive summary (≤80 words with a fallback template), data tables, and a cost section; the PDF goes to Cloudinary `/reports`, a `reports` row is written, and Nodemailer emails the manager. Archive listed at `/reports`.

**Extension:** `GET /api/reports/annual?year=YYYY` produces the client's yearly download — every closed spot-check for the year as a single PDF plus a CSV appendix, with a year dropdown on the archive page.

---

## UC-010 — Contractor rectification portal ✅ (step 5)

**Actor:** Contractor · **Owner:** Zoe
**Client requirements:** R7 (acknowledge on the same platform), R8 (submit completion photos), R12 (within 2 weeks)

### Main flow

1. Contractor logs in and lands on `/contractor-inbox` — assigned defects sorted by `target_deadline` with a days-remaining countdown, overdue items flagged red.
2. Opens a record: block/lift, every defect with its severity, remark, photo, and the deadline.
3. **Acknowledge** → `POST /api/contractor/:id/acknowledge` sets status `Acknowledged` and `acknowledged_at`, notifies `manager-room` and `inspector-team`. *(Client requirement: acknowledgement happens on the platform, not by email reply.)*
4. Per defect item: attach a completion photo (compressed ≤100 KB) and a completion remark. **Save progress** may be used any number of times without a signature (`finalize = false` → audit `Work Progress Saved`).
5. When every defect is addressed, the contractor signs the pad and taps **Submit Work Done** → `POST /api/contractor/:id/rectify` with `finalize = true`.
6. Server requires the signature (`SIGNATURE_REQUIRED`), writes a `contractor` `signatures` row, sets `status = 'Rectified'` + `rectified_at`, and notifies the manager and the raising inspector (socket + email). Hand-off to UC-004.

### Alternate flows

- **A1 — On hold.** `POST /api/contractor/:id/hold` with a reason (access denied / part on order / out of scope) sets `On Hold` and **pauses the deadline clock**; resuming extends `target_deadline` by the held duration (G11) and notifies the manager.
- **A2 — Partial rectification.** Progress saves keep the record in the contractor's inbox; the deadline keeps running.
- **A3 — Rejected by the inspector (UC-004 alt).** The record reappears as `Assigned` with the rejection reason pinned at the top and a fresh deadline.
- **A4 — Deadline approaching or passed.** UC-014 chase emails at D−3 and D+0; the manager sees the overdue count on the scorecard.

### Exceptions

`FORBIDDEN` 403 (a record belonging to another contractor — G9) · `ACCOUNT_SUSPENDED` 403 (G16) · `INVALID_STATE` 409 · `SIGNATURE_REQUIRED` 400 · `PHOTO_TOO_LARGE` 400

---

## UC-011 — Admin cost analytics 🔶 **frontend only**

**Actor:** Admin · **Owner:** Davian (backend — **not built**) / Hasini (frontend — built)
**Client requirements:** R17 ("Statistic / report") · 4D data-driven decision making
**Preconditions:** Caller is authenticated with `role = 'admin'`.
**Postcondition:** No state change — read-only.

KPI tiles (total actual, total projected, variance %), cost by category, cost per contractor, and a cost trend line — all filterable by period / block / category / contractor, and exportable. Figures derive **only** from `inspections.actual_cost` and `ai_predictions.estimated_cost`; no corporate financials.

### Main flow

1. Admin opens `/admin/costs`; filters are read from the URL, same pattern as UC-005.
2. **KPI tiles** — total actual spend for the window, projected exposure from active AI predictions, and spend movement against the immediately preceding window of equal length.
3. **Cost by category** (bar) and **cost per contractor** (table) render, cost-heaviest first.
4. **Cost trend** (line) plots one point per calendar month, with a **damped-trend exponential-smoothing projection** for the next 3 months carrying an ~80% confidence band.
5. **Repair-vs-replace watchlist** ranks lifts by *lifetime* spend against a review threshold, projecting how many months until each crosses it.
6. **Contractor price benchmarking** flags a contractor whose average cost per job deviates ≥15% from its peers *within the same category*.
7. **Auto-written executive summary** states up to five findings in plain English, generated by fixed rules — deterministic and unit-tested, no LLM.
8. Admin drills into the job-level table or exports to CSV.

### Alternate flows

- **A1 — Live update prompt.** The page listens on `admin-room`; a UC-004 close carries `actual_cost`, so a "new cost data available" prompt appears rather than silently mutating figures under the reader.
- **A2 — Date filters deliberately ignored by the watchlist.** A replacement decision looks at a lift's whole life, not the filtered window. The block filter still applies. This is intentional, and stated on the panel.
- **A3 — Partial current month excluded from the forecast and the top-mover callout.** Comparing a half-finished month against complete ones would report artificial movement.

### Exceptions

| Case | Behaviour |
|---|---|
| Manager (not admin) opens the page | `403 FORBIDDEN` from the API; UI redirects (COST-T02) |
| Fewer than 3 complete months of history | Forecast returns `null` — too thin to fit; the chart shows history only, no invented projection |
| No prior window to compare | `variance_pct` is `null`; the tile shows "no prior data" |
| A category has no peer contractor with ≥2 jobs | No benchmark flag emitted rather than a misleading comparison against a single job |
| Month with zero actual spend | Skipped in the backtest — percentage error against zero is undefined |
| Filter result empty | Panels render empty states; export disabled |

> **Open gap — the backend does not exist.** There is no `adminController.js`, no
> `routes/admin.js`, and no `/api/admin/costs/*` route mounted anywhere. The page
> is fully functional but reads `frontend/src/mocks/costMocks.js` through
> `costService.js`, which never imports `api` — every figure on the Admin Cost
> Dashboard is hardcoded demo data.
>
> **Rubric impact (A2, "fully integrated React + Node + DB system").** This is the
> only screen in the project that does not touch the database. The aggregation
> logic (`summarize`, `groupTotals`, `buildTrend`, `forecastNext`,
> `buildLiftWatchlist`, `contractorBenchmarks`) is real, pure and unit-tested, so
> the work is not wasted — but until the endpoints exist the page cannot be
> presented as integrated.
>
> **To close:** Davian builds `GET /api/admin/costs/{summary,by-category,by-contractor,trend}`
> per HLD §9, `requireRole('admin')`; Hasini then replaces the seven mock wrappers
> at the bottom of `costService.js` with `api.get` calls — the pure functions above
> them do not change. Until then UC-011 must not be described as built, and the
> demo must either say "demo data" out loud or the backend must land first.

> **Open gap — the backend does not exist.** There is no `adminController.js`, no
> `routes/admin.js`, and no `/api/admin/costs/*` route mounted anywhere. The page
> is fully functional but reads `frontend/src/mocks/costMocks.js` through
> `costService.js`, which never imports `api` — every figure on the Admin Cost
> Dashboard is hardcoded demo data. The aggregation logic (`summarize`,
> `groupTotals`, `buildTrend`, `forecastNext`, `buildLiftWatchlist`,
> `contractorBenchmarks`) is real, pure, and unit-tested (33 tests), so the swap
> is confined to the async wrappers at the bottom of `costService.js`.
>
> **To close:** Davian builds `GET /api/admin/costs/{summary,by-category,by-contractor,trend}`
> per HLD §9, `requireRole('admin')`; Hasini then replaces the seven mock wrappers
> with `api.get` calls. Until then UC-011 must not be described as built, and the
> demo must either say "demo data" out loud or the backend must land first.

---

## UC-012 — Vendor account lifecycle ✅

**Actor:** Admin · **Owner:** Davian (backend, cron, and the expiry notification email) / Hasini (`AdminVendorPage.jsx` only)
**Client requirement:** R18 — "Admin / user control · add new equipment and users with rights"

**Preconditions:** Caller is authenticated with `role = 'admin'`.
**Postcondition:** A `contractors` row and a linked `users` row (`role = 'contractor'`) exist, with a `vendor_history` entry for every lifecycle action.

### Main flow

1. Admin opens `/admin/vendors` — vendors listed **soonest-expiring first**, each with a days-until-expiry chip (red expired, amber ≤30 days).
2. **Onboard:** company details, contact email, account-holder name/title, access reason, contract start/end, and a contract document uploaded to Cloudinary `/contracts` for reference. Creates the `contractors` row plus a linked `contractor` login.
3. **Renew:** extends `contract_end`; reactivates the account if it was auto-suspended.
4. **Suspend:** early termination — sets `users.status = 'suspended'` immediately.
5. **Edit details:** contact email, brands serviced, access reason. The login email is immutable — it is the account's identity.
6. **History:** every action is readable per vendor from `vendor_history`.
7. **Daily expiry job (Davian):** suspends vendors past `contract_end`, writes history, emits `vendor_expired` to `admin-room`.

### Alternate flows

- **A1 — Live suspension.** The page listens for `vendor_expired` and refreshes, so an admin watching the list sees the auto-suspension happen.
- **A2 — Manual run.** "Run expiry check" (`POST /run-expiry-check`) triggers the same logic on demand without waiting for the cron.
- **A3 — Expiring-soon banner.** Contracts inside 30 days surface above the table so renewal is prompted before lapse.
- **A4 — Suspended vendor with open work.** Records assigned to them surface in the manager's Pending Reassignment queue (UC-002 Alt C).

### Exceptions

| Case | Code |
|---|---|
| `contract_end` before `contract_start` | `400 INVALID_CONTRACT_DATES` (VND-T02) |
| Login email already registered | `409 EMAIL_ALREADY_EXISTS`, **no rows created** (VND-T03) |
| Suspended vendor attempts to log in | `403 ACCOUNT_SUSPENDED` (VND-T05) |
| Non-admin calls any vendor route | `403 FORBIDDEN` |
| Required onboarding field missing | `400 VALIDATION_ERROR` naming the fields |

Contract details are entered manually — **no document parsing** (deliberate scope boundary, HLD §14.5).

---

## UC-013 — Paper-form OCR prefill 🆕

**Actor:** Inspector · **Workflow step:** 3 · **Owner:** Mahdiya
**Client requirement:** none — a deliberate adoption aid for inspectors who prefer paper on site (see HLD §14.1).
**Precondition:** A completed paper spot-check form.
**Postcondition:** A **draft** is presented in the UC-001 form. No database write occurs until the inspector confirms and submits through UC-001.

### Main flow

1. On `/inspections/new` the inspector taps **Scan a paper form**.
2. Photographs or uploads the completed form; the image is compressed and posted to `POST /api/inspections/ocr-prefill`.
3. The server sends it to OpenAI `gpt-4o-mini` with vision, using a structured prompt that names all 25 items in order and demands strict JSON: per item a `result` (`Pass` | `Defect` | `unreadable`), a `remark`, and a `field_confidence`.
4. The response maps onto the live checklist by section and `display_order`.
5. The form is prefilled. **Every prefilled field is visually marked as unconfirmed** (amber left border), fields below 0.80 confidence are marked "please check", and unreadable items are left blank with a badge.
6. A banner states: *"Draft from a scanned form — check every answer. You are signing for this."*
7. The inspector corrects anything wrong, adds severities and photos (OCR never supplies these), signs, and submits through the normal UC-001 flow.

### Alternate flows

- **A1 — Unreadable image.** `422 OCR_UNREADABLE`; the inspector is returned to the blank form with no partial state.
- **A2 — Partial read.** Readable items prefill; unreadable ones stay blank and are counted in the banner ("18 of 25 read — 7 need your input").
- **A3 — Header mismatch.** If the OCR block/lift does not match the selected lift, the system warns and keeps the inspector's selection.
- **A4 — OpenAI unavailable or over quota.** The scan button is disabled with a tooltip; UC-001 is entirely unaffected.

### Guard rails

- The endpoint **never writes** to `inspections`, `checklist_results`, or `signatures` (G18).
- Severity and defect photos are never inferred — the client requires deliberate severity tagging.
- The inspector's e-signature is what makes the record valid, exactly as with a manually filled form.

---

## UC-014 — Auto-notify the lift company 🆕

**Actor:** System · **Workflow step:** 4 · **Owner:** Davian
**Client requirement:** R6 — *"an auto-email to the lift company when defects are flagged"* (the first advantage on Daniel Koh's slide 3, and step 4 of the workflow).
**Precondition:** A spot-check has been submitted with at least one defect and a contractor is resolvable.
**Postcondition:** An email is delivered to `contractors.contact_email`, a `defect_email_log` row and an audit row exist, and `defect_email_sent_at` is set.

### Main flow

1. UC-001 commits a record with ≥1 defect. The controller resolves the contractor from `lifts.contractor_id`.
2. The system checks `defect_email_sent_at` — already set means this is a replay and the send is skipped (**G12**).
3. `emailService.sendDefectAlert()` builds the message:
   - Subject: `[Spot-Check Defect] Blk {block} Lift {lift_code} — {n} defect(s), due {deadline}`
   - Body: town council, block/lift, address, servicing date, date of spot-checking, inspector name, and a **table of defects** (section, item number, item text, severity, remark);
   - the 2-week rectification note quoted from the paper form;
   - a deep link to `{APP_PUBLIC_URL}/contractor-inbox` to acknowledge **on the platform**;
   - photos referenced as Cloudinary links, never as attachments (the client's storage/loading concern).
4. On success: write `defect_email_log` (`status = 'sent'`), set `defect_email_sent_at`, append audit `Defect Alert Sent`.
5. Emit `defect_assigned` to `contractor-{user_id}` and `manager-room`.

### Alternate flows

- **A1 — Reassignment.** UC-002 assigns a different contractor → a fresh send with `email_type = 'reassignment'`; the previous contractor's socket room is told the item was withdrawn.
- **A2 — Rejection.** UC-004 reject → `email_type = 'rejection'`, quoting the reason and the new deadline.
- **A3 — Overdue chase.** The daily cron at D−3 and D+0 sends `email_type = 'overdue_chase'`, skipping `On Hold` records, at most once per record per day.
- **A4 — No contact email or no linked login.** No send is attempted; `defect_email_log` records the failure reason, the manager gets an amber "LC not reachable" chip on the record, and the record still assigns normally.

### Exceptions

- **SMTP failure.** The send is retried once; on a second failure the log row is `failed` with the error, the manager is alerted, and **the inspection is unaffected** (G13) — the transaction has already committed and the record is `Pending Assignment` regardless.
- **Zero defects.** No email is sent at all (G6).

---

## UC-015 — Digital audit trail 🔶 (step 7)

**Actor:** System · **Owner:** Philena
**Client requirement:** R10 — *"The entire paper trail should be replaced with a timestamped digital audit log."*

Every state transition appends an `inspection_history` row carrying actor, action, previous status, new status, note, and timestamp. The table is **append-only** — no model exposes an UPDATE or DELETE path (G15). The record detail page renders the trail as a chronological timeline, and the closed record retains all signatures with their signing timestamps for the 5-year retention window.

**Required actions (completeness check):** `Created` · `Defect Alert Sent` · `Filed — no defects` · `Assigned` · `Reassigned` · `Acknowledged` · `Work Progress Saved` · `On Hold — {reason}` · `Resumed` · `Rectified & Signed` · `Rectification Rejected` · `Overdue Reminder Sent` · `Priority Escalated` · `Jointly Endorsed & Closed`.

**Extension:** add the four new actions (`Defect Alert Sent`, `Filed — no defects`, `Rectification Rejected`, `Overdue Reminder Sent`) and assert the full set in tests.

---

## UC-016 — Mimic data and stress test 🔶

**Actor:** All · **Owner:** All (Phase 6)
**Client requirement:** R19 — *"Mimic data and stress test are required."*

Seed migrations `018`–`024` already provide demo lifts, contractors, vendors, inspections, and cost data. The extension is a repeatable seed script producing ~500 spot-checks across 12 months and ~2,000 checklist results, plus a measured load run against the dashboard and triage queue with the p95 response time recorded in the README. Verifies the client's stated concern that photo volume must not slow the platform.

---

## Cross-cutting acceptance criteria

A use case is not done until all of the following hold:

- [ ] Every state transition writes an `inspection_history` row (UC-015).
- [ ] Every off-platform party is emailed and every on-platform party gets a socket event (HLD §10).
- [ ] Every failure path returns `{ code, message }` and surfaces as a dismissable toast.
- [ ] Every list view has an `EmptyState`; every fetch has a `LoadingSpinner`.
- [ ] Every page is usable at 375 px width.
- [ ] Email and socket failures never roll back a database transaction (G13).
- [ ] A backend test exists under `backend/tests` matching the existing style.

---

*End of USE_CASES.md*
