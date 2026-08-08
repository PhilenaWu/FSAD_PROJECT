# Use cases — Ginjala Hasini

The use cases I own, written from the built system. The group's
behaviour-of-record is `USE_CASES.md` at the repo root; this document covers my
four in the detail the submission guide asks for — actor, trigger, main flow,
alternative flows, edge cases.

| # | Use case | Actor | Roles touched |
|---|---|---|---|
| UC-005 | Analytics dashboard and exports | Manager | manager |
| UC-011 | Admin cost analytics (UI) | Admin | admin, manager (refused) |
| UC-012 | Vendor account lifecycle (UI) | Admin | admin, contractor |
| UC-C | Role contacts | All five | resident, inspector, manager, contractor, admin |

UC-C covers every role, including the two my other use cases never serve
(resident and contractor), so all five roles are accounted for below.

---

## UC-005 — Analytics dashboard and exports

**Actor:** Manager
**Trigger:** Manager opens `/dashboard`, or changes a filter on it.
**Preconditions:** Authenticated with `role = 'manager'`; the API is reachable.
**Postcondition:** **None — this use case is read-only.** Nothing it does
writes to `inspections`. The CSV what-if preview is session-only, and every
export reads the database rather than the preview.

### Main flow

1. Manager opens `/dashboard`. Filter state is read from the URL query string,
   so a filtered view is bookmarkable and shareable.
2. Six requests fire in parallel — summary, heatmap, trends, SLA, contractor
   scorecard, AI alerts — plus the priority queue, which carries its own
   priority and status filters.
3. The **KPI row** shows reports filed with percentage movement against the
   prior 30 days, open count, overdue count, and average resolution hours
   against the 72-hour SLA.
4. The **filter bar** offers block, category, paper-form section, and a
   from/to range. Its options come from `GET /api/analytics/filter-options` —
   queried from the data, never hardcoded, so they cannot go stale. Any change
   rewrites the URL and re-fetches every panel.
5. **Charts** render: a block × category heatmap, a daily issue trend, and an
   SLA doughnut against the 72-hour threshold.
6. The **contractor scorecard** lists jobs, average rectification days, repeat
   defect rate, overdue count, and average re-opens per contractor.
7. The **priority queue** ranks open records by
   `(ai_priority_score × 0.5) + (recency × 0.3) + (frequency × 0.2)`,
   defaulting to a Top 10 triage view.
8. The manager acts — drills into a heatmap cell, opens a queue row, accepts or
   dismisses an AI alert, or exports.

### Alternative flows

- **A1 — Drill-through to triage.** Clicking a heatmap cell navigates to
  `/inspections?block=…&category=…`. Both values are URL-encoded, so a block or
  category containing a space or `&` survives the trip. The triage queue's own
  filters are URL-driven, so the browser back button returns to the dashboard
  with its filters intact.
- **A2 — Live refresh.** The page subscribes to `status_update` and `cv_alert`
  on `manager-room`, coalesced on a 1.5-second timer so a burst of transitions
  causes one refresh rather than one per event. The refresh includes the
  priority queue — it is fetched separately from the other panels, and leaving
  it out left a ranked list disagreeing with the charts beside it.
- **A3 — Data Playground (CSV what-if).** Importing a
  `block,category[,date][,resolution_time_hours]` CSV blends hypothetical rows
  into the heatmap, trend and SLA gauge, client-side. A
  Combined / Existing only / Imported only toggle drives all three at once, and
  imported data is always marked: an amber ring on affected heatmap cells, a
  dashed second trend line, and a before → after figure on the gauge. **Nothing
  is written to the database.** The preview survives an accidental refresh via
  `sessionStorage`; Clear preview drops it from both.
- **A4 — PowerPoint export.** `POST /api/export/pptx` renders the current
  filtered view server-side, re-running the same fetchers the dashboard used so
  the deck cannot drift from the screen. It always uses database rows, never
  A3's preview rows.
- **A5 — Run AI analysis on demand.** `GET /api/recommendations/run` instead of
  waiting for the nightly job, then a re-fetch so new alert cards appear.
- **A6 — Export CSV.** The ranked queue is written client-side with a UTF-8
  byte-order mark, without which Excel reads the file as the system codepage and
  turns every em dash and accented name into mojibake.
- **A7 — Scorecard drill-through.** A non-zero overdue count links to
  `/inspections?contractor=…&overdue=true`, using the scorecard's own overdue
  definition so the two screens cannot disagree about who is late.

### Edge cases

| Case | Behaviour |
|---|---|
| A panel request fails | Persistent error banner with Retry; the last good data stays on screen rather than blanking |
| Non-manager opens `/dashboard` | `403 FORBIDDEN` from the API. A client-side placeholder renders too, but the UI guard is convenience — enforcement is the server's |
| No token or expired token | `401 UNAUTHENTICATED`; the route guard redirects to `/login` |
| `from` later than `to` | Inline field error and the fetch is suppressed — no request is sent with an impossible range |
| Manager has no records yet | Every panel renders its own empty state rather than an empty axis |
| CSV over 1 MB | Rejected before parsing, with a size message; no partial state |
| CSV over 5,000 rows | Rejected after parse with a row-count message |
| CSV malformed | Field- or row-specific message ("Row 2: date must be YYYY-MM-DD"). "Could not read that file" is reserved for an actual read failure |
| Priority queue matches nothing | Info alert in the panel, and Export CSV disables itself with an explanatory tooltip rather than downloading a header-only file |
| A quiet stretch in the trend | Buckets widen with the range (day ≤ 45 days, week ≤ 180, month beyond) and empty periods are filled, so a three-week silence occupies three weeks of axis instead of collapsing to one step |
| Deck generation throws | `500 EXPORT_FAILED`; the UI surfaces it and CSV export remains available |

---

## UC-011 — Admin cost analytics (UI)

**Actor:** Admin
**Trigger:** Admin opens `/admin/costs`, or changes a filter.
**Preconditions:** Authenticated with `role = 'admin'`.
**Postcondition:** None — read-only. The backend is Davian's; this use case is
the dashboard that consumes it.

### Main flow

1. Admin opens `/admin/costs`; filters are read from the URL, as on UC-005.
2. **KPI tiles** show total actual spend, projected exposure, job count, and
   spend movement against the prior window.
3. A single fetch of `GET /api/admin/costs/jobs` returns the job-level rows, and
   everything else is derived from them client-side: the category and contractor
   breakdowns, the monthly trend, and the drill-down table.
4. The **monthly trend** carries a three-month projection — damped-trend
   exponential smoothing fitted on complete months only, inside a shaded ~80%
   uncertainty band derived from the model's own historical errors.
5. The **repair-vs-replace watchlist** ranks lifts by lifetime spend against a
   $60,000 review threshold, projecting how many months until each crosses it.
6. **Contractor benchmarking** compares a contractor's average cost per job
   against its peers *within each category*, flagging deviations beyond ±15%.
7. An auto-written **executive summary** states the findings in plain English,
   by fixed deterministic rules rather than an LLM.
8. Admin exports — CSV client-side, or `POST /api/export/admin-costs-pptx` for
   the deck.

### Alternative flows

- **A1 — Drill down by category.** Clicking a bar sets that category as the
  active filter, mirroring the manager heatmap's click-to-drill.
- **A2 — Arrive filtered from UC-012.** A vendor row links to
  `/admin/costs?contractorId=…`, so the cost evidence behind a renew-or-suspend
  decision is one click away.
- **A3 — Deck export.** Rendered server-side under the same filters.

### Edge cases

| Case | Behaviour |
|---|---|
| Manager (not admin) opens the page | `403 FORBIDDEN` from every `/api/admin/costs/*` route; an "administrators only" alert renders client-side as well |
| Filter by lift or contractor | The projected series is zeroed — `ai_predictions` has no lift or contractor column. The panel captions this rather than letting a chart imply there is no risk |
| Fewer than three complete months | No projection is drawn. Fitting a trend on two points would produce a confident-looking line with nothing behind it |
| The current, partial month | Excluded from the fit — half a month against full ones would drag the trend down |
| A category near zero last month | Ignored by the top-mover callout unless it was at least 5% of prior-month spend. Without that floor, $512 → $4,520 wins as "up 783%", which is true and worthless |
| A job closed with no contractor | Counted as "Unassigned" rather than dropped, so the breakdown still totals to the headline figure |
| A defect not tied to a lift | Skipped by the watchlist rather than inventing an asset for it |
| A month with no spend | Rendered as a real zero, not a gap the line skips over |

---

## UC-012 — Vendor account lifecycle (UI)

**Actor:** Admin
**Trigger:** Admin opens `/admin/vendors`, or acts on a vendor row.
**Preconditions:** Authenticated with `role = 'admin'`.
**Postcondition:** The vendor's contract dates and account status reflect the
action, and `vendor_history` has gained a row recording it.

### Main flow

1. Admin opens `/admin/vendors`. Vendors are listed soonest-expiring first, so
   the ones needing attention are at the top, each with a contract-status chip.
2. **Onboard** collects company details, contract dates, an optional contract
   document, and the account holder. On submit the contractor row, the Supabase
   auth user, the profile row and the `Onboarded` history entry are created in
   one transaction.
3. **Renew** extends `contract_end`, optionally replacing the stored document,
   and reactivates a suspended account.
4. **Suspend** ends the contract early and suspends the linked login — the
   vendor's next request is refused `403 ACCOUNT_SUSPENDED`.
5. **Edit details** changes non-contract fields only; omitted fields are left
   alone.
6. **History** shows the full audit trail for one vendor.

### Alternative flows

- **A1 — Run expiry check now.** `POST /api/admin/vendors/run-expiry-check`
  runs the nightly job's logic on demand. The scheduled twin is a GET
  authenticated by `CRON_SECRET`, which a browser session cannot satisfy — the
  page must use the POST.
- **A2 — Automatic expiry.** The daily job suspends vendors whose contract has
  ended and writes `Auto-suspended` history rows with a null actor, since no
  admin performed it.
- **A3 — Cost evidence.** Each row links to `/admin/costs?contractorId=…`, the
  UC-011 dashboard filtered to that vendor.

### Edge cases

| Case | Behaviour |
|---|---|
| `contract_end` ≤ `contract_start` | `400 INVALID_CONTRACT_DATES` — a zero-length contract is rejected too, not just a reversed one |
| Holder email already registered | `409 EMAIL_ALREADY_EXISTS` and **no rows created** — the transaction means there is no half-made vendor to clean up |
| Supabase rejects the signup | `502 AUTH_SIGNUP_FAILED`; the contractor row is rolled back with it |
| Malformed id in the URL (`abc`) | `404 NOT_FOUND`, identical to a well-formed id naming no vendor. Previously this reached Postgres and returned a `500` quoting the database's cast error |
| Malformed id from a non-admin | The role check answers first, so a `404` can never be used to probe for existence without being an admin |
| Renew with no document | The stored contract document is kept — an empty field must not overwrite it |
| Suspend a vendor with no login | `409 NO_LINKED_ACCOUNT` |
| Contract document over 10 MB | Rejected by the upload limit before it reaches the handler |

---

## UC-C — Role contacts

**Actor:** All five roles.
**Trigger:** A user opens the sidebar "Need urgent help?" card, or the Contacts
page from Quick access.
**Preconditions:** Authenticated with any role.
**Postcondition:** None — read-only.

Every number shown comes from the database. Two sources, because the numbers
are two different kinds of thing: `contact_directory` holds organisations (the
managing office, the national emergency lines) and `users.phone` holds a named
member of staff's own number.

### Main flow

1. The signed-in role is resolved to a contacts block naming which sources it
   draws on and the wording around them.
2. Only the requests that role needs are fired — a role with no staff contacts
   never calls the staff endpoint, which would refuse it anyway.
3. The sidebar card shows one number: for a resident the directory row flagged
   `is_help_line`; for staff, the first counterpart who has published one.
4. The Contacts page lists the full set as dialable `tel:` links.

### Per-role behaviour

| Role | Sidebar card | Contacts page |
|---|---|---|
| `resident` | Managing office | Managing office + Police + Fire & Ambulance |
| `inspector` | Estate manager | Estate line + the managers by name |
| `manager` | Estate admin | Estate line + the admins by name |
| `admin` | Estate manager | Estate line + the managers by name |
| `contractor` | Generic support | No block configured — the page says so rather than rendering blank |

A resident reaches the office rather than an individual manager, which is why
`GET /api/users/contacts` refuses the resident role outright.

### Alternative flows

- **A1 — Adding a role.** Filling in that role's block is the whole change; the
  sidebar and the page both render whatever is there.
- **A2 — A number changes.** Editing the `users` row or the directory row is
  enough — nothing is hardcoded in the frontend, so the card follows whoever
  currently holds the role.

### Edge cases

| Case | Behaviour |
|---|---|
| A staff member has published no number | Left off the page rather than shown with a `tel:` link that goes nowhere |
| No staff has a number at all | The card falls back to a plain "Contact support" rather than a dead link |
| The fetch fails | Same fallback; the page says nothing is listed rather than rendering a half-empty list |
| A role nobody has configured | "No contacts have been listed for your role yet" |
| A directory row added by a later migration | Renders with a generic phone icon — an unrecognised `icon_key` must not take the page down |
| A resident reaches the staff endpoint directly | `403 FORBIDDEN`; the role mapping is derived from the verified token, never from the request |
