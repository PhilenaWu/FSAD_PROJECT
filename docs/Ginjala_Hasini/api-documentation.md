# API documentation — Ginjala Hasini

Every endpoint my features own or consume: UC-005 analytics and exports,
UC-011 admin cost analytics, UC-012 vendor lifecycle, and role contacts.

## Conventions

**Authentication.** Supabase Auth issues the token on the client; every request
below carries it:

```
Authorization: Bearer <supabase-access-token>
```

The backend verifies the token and reads the caller's role from the `users`
profile row. There are no login/register endpoints on this API — Supabase owns
credentials.

**Errors** use one shape throughout:

```json
{ "code": "VALIDATION_ERROR", "message": "startDate must be YYYY-MM-DD." }
```

**Errors any authenticated route can return:**

| Status | `code` | When |
|---|---|---|
| 401 | `UNAUTHENTICATED` | Missing, malformed or expired bearer token |
| 403 | `FORBIDDEN` | Valid token, wrong role for the route |
| 403 | `ACCOUNT_SUSPENDED` | The caller's account is suspended (a vendor mid-suspension) |
| 403 | `ACCOUNT_PENDING` / `ACCOUNT_REJECTED` | Self-registered resident not yet approved |
| 500 | `INTERNAL_ERROR` | Unhandled failure; the message is generic |

**Shared analytics filters.** Every `/api/analytics/*` route accepts the same
optional query parameters, validated before any SQL runs:

| Parameter | Format | Notes |
|---|---|---|
| `startDate` / `endDate` | `YYYY-MM-DD` | Inclusive |
| `block` | string | e.g. `44A` |
| `category` | string | e.g. `Doors` |
| `section` | string | Paper-form section; matched via `EXISTS` over `Defect` rows |

A malformed date, an impossible date (`2026-02-30`) or a repeated parameter is
rejected `400 VALIDATION_ERROR` — never half-applied.

---

# UC-005 — Analytics

All seven are **manager only**.

### `GET /api/analytics/filter-options`

Dropdown values, derived from the data so they can never go stale. Takes no
parameters — narrowing the options by the current filter would remove the value
needed to undo it.

```json
{ "blocks": ["44A", "44B"], "categories": ["Doors", "Lighting"], "sections": ["A — Motor Room"] }
```

### `GET /api/analytics/summary`

KPI row, including movement against the prior 30-day window.

```json
{
  "open_count": 23,
  "overdue_count": 4,
  "avg_resolution_hours": 41.5,
  "sla_percentage": 76.36,
  "new_last_30": 18,
  "new_prior_30": 12,
  "new_records_change_pct": 50,
  "sla_threshold_hrs": 72
}
```

`new_records_change_pct` is `null` when there is no prior-period data — the UI
shows "no prior data" rather than a fabricated percentage.

### `GET /api/analytics/issues-by-block`

Heatmap cells.

```json
{ "data": [ { "block": "44A", "category": "Doors", "count": 8 } ] }
```

### `GET /api/analytics/trends`

```json
{ "data": [ { "date": "2026-03-01", "count": 2 } ] }
```

Only days with reports are returned; the client buckets and gap-fills so the
axis stays linear in time.

### `GET /api/analytics/sla-compliance`

```json
{ "compliant_count": 42, "total_resolved": 55, "sla_percentage": 76.4, "sla_threshold_hrs": 72 }
```

### `GET /api/analytics/contractor-scorecard`

```json
{ "data": [ { "contractor": "Otis Service SG", "jobs": 12,
              "avg_rectification_days": 3.4, "repeat_defect_rate": 8.3,
              "overdue_count": 1, "avg_reopens": 0.25 } ] }
```

`overdue_count` excludes `On Hold` records — the clock is paused, so counting
them would blame a contractor for a wait someone else caused.

### `GET /api/analytics/priority-queue`

Also accepts `priority` and `status`. Ranked by
`(ai_priority_score × 0.5) + (recency × 0.3) + (frequency × 0.2)`; the frequency
term counts open records only.

```json
{ "data": [ { "id": "…", "title": "Door sensor fault", "block": "44A",
              "category": "Doors", "priority": "High", "status": "Assigned",
              "ai_priority_score": 82, "created_at": "2026-03-14T02:10:00Z",
              "composite_score": 71.4 } ] }
```

`recency_score` is 100 at zero days old, falling 10 a day to a floor of 0;
`frequency_score` is 10 per open record sharing the same block and category,
capped at 100. A record with no `ai_priority_score` is scored as 50.

---

# UC-005 — AI recommendations

### `GET /api/recommendations?status=Active` — manager

```json
{ "data": [ { "id": "…", "location_block": "44A", "category": "Doors",
              "velocity_pct": 45.2, "estimated_cost": 3200,
              "alert_text": "Door faults in 44A rising…", "status": "Active" } ],
  "total": 1 }
```

### `POST /api/recommendations/:id/accept` · `POST /api/recommendations/:id/dismiss`

No body. Returns the updated alert. `404 NOT_FOUND` for an unknown id.

### `GET /api/recommendations/run` — manager **or** cron

Runs the analysis on demand instead of waiting for the nightly job. Accepts
either a manager session or `Authorization: Bearer <CRON_SECRET>`.

---

# UC-005 / UC-011 — Exports

### `POST /api/export/pptx` — manager or admin

```json
{ "views": ["summary", "heatmap", "trend"],
  "filters": { "startDate": "2026-01-01", "endDate": "2026-06-30", "block": "44A" } }
```

```json
{ "pptx_url": "https://res.cloudinary.com/…/admin-costs-1765200000000.pptx" }
```

| Status | `code` | When |
|---|---|---|
| 400 | `VALIDATION_ERROR` | `views` missing or not an array |
| 500 | `EXPORT_FAILED` | Deck generation or upload failed; the UI falls back to CSV |

### `POST /api/export/admin-costs-pptx` — **admin only**

Same response. A manager gets `403` here even though the UC-005 deck admits
them: cost figures are commercially sensitive.

```json
{ "filters": { "startDate": "2026-01-01", "block": "44A" } }
```

---

# UC-011 — Admin cost analytics

All **admin only**. Shared optional filters: `startDate`, `endDate`, `block`,
`category`, `liftId` (UUID), `contractorId` (UUID).

`liftId` and `contractorId` zero the **projected** series — `ai_predictions` has
no lift or contractor column, so there is no honest way to filter it. The UI
captions this rather than implying no risk.

### `GET /api/admin/costs/summary`

```json
{ "total_actual": 48250.75, "total_projected": 9600, "variance_pct": 12.4, "jobs": 37 }
```

### `GET /api/admin/costs/filter-options`

```json
{ "blocks": ["44A"], "categories": ["Doors"],
  "contractors": [ { "id": "…", "name": "Otis Service SG" } ] }
```

### `GET /api/admin/costs/jobs`

The job-level rows behind every aggregate — the drill-down table, the CSV, and
everything the client derives (trend, forecast, watchlist, benchmarks).

```json
{ "data": [ { "id": "…", "closed_at": "2026-03-14", "block": "44A",
              "category": "Doors", "lift": "44A-L1",
              "contractor": "Otis Service SG", "actual_cost": 1840.5 } ] }
```

`closed_at` is formatted `YYYY-MM-DD` in SQL rather than shipped as a timestamp:
the client groups on it as a string, and a raw timestamp would reintroduce
timezone drift through JSON. `contractor` is `"Unassigned"` for an in-house fix
and `lift` is `null` for an estate defect not tied to a lift.

### `GET /api/admin/costs/breakdown`

```json
{ "byCategory": [ { "category": "Doors", "actual": 18240.5, "projected": 0 } ],
  "byBlock":    [ { "block": "44A", "actual": 22100, "projected": 3200 } ],
  "byContractor": [ { "name": "Otis Service SG", "total": 18240.5, "count": 7 } ] }
```

Consumed by the server-rendered cost deck. The dashboard does **not** call it —
it already holds the job rows and groups them client-side rather than paying a
second round-trip.

### `GET /api/admin/costs/trends?months=12`

`months` is an integer and applies only when no date range is given; a bad value
is rejected `400 VALIDATION_ERROR` rather than silently falling back to 12,
which would render a line the admin believes is something else.

```json
{ "data": [ { "month": "2026-03", "actual": 6100, "projected": 800 } ] }
```

---

# UC-012 — Vendor lifecycle

All **admin only** except the cron route. Mounted at `/api/admin/vendors`.

### `POST /api/admin/vendors` — onboard

`multipart/form-data`, optional `contract_doc` (PDF/DOCX, ≤10 MB, single file).

| Field | Notes |
|---|---|
| `name`, `contact_email`, `brands_serviced` | Company details |
| `contract_start`, `contract_end` | `YYYY-MM-DD` |
| `holder_name`, `holder_email`, `job_title`, `access_reason` | The login account holder |

`201` with the created vendor. Creates the `contractors` row, the Supabase auth
user, the `users` profile (`role = 'contractor'`, `status = 'active'`), and an
`Onboarded` row in `vendor_history` — **in one transaction**, so a failure
part-way leaves no half-made vendor.

| Status | `code` | When |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Missing or malformed field |
| 400 | `INVALID_CONTRACT_DATES` | `contract_end` ≤ `contract_start` — a zero-length contract counts |
| 409 | `EMAIL_ALREADY_EXISTS` | Holder email already registered; **no rows created** |
| 400 | `AUTH_SIGNUP_FAILED` | Supabase rejected the account creation |

### `GET /api/admin/vendors`

Soonest-expiring first, so the ones needing attention are at the top.

```json
{ "data": [ { "id": "…", "name": "Otis Service SG", "contact_email": "…",
              "brands_serviced": "Otis", "contract_start": "2025-01-01",
              "contract_end": "2026-12-31", "contract_doc_url": "https://…",
              "status": "active", "account_holder": "Steven Tan",
              "job_title": "Operations Manager", "days_until_expiry": 144 } ] }
```

Contract dates are formatted `YYYY-MM-DD` in SQL for the same reason the cost
rows are — the client compares them as strings, and a timestamp would
reintroduce timezone drift. `days_until_expiry` drives the status chip.

### `POST /api/admin/vendors/:id/renew`

`multipart/form-data`: `contract_end` (required), optional replacement
`contract_doc`. Extends the contract and reactivates a suspended account. Omit
the document and the stored one is kept.

### `POST /api/admin/vendors/:id/suspend`

Early termination. Sets the linked account to `suspended` — the vendor's next
request is refused `403 ACCOUNT_SUSPENDED`. `400 NO_LINKED_ACCOUNT` if the
vendor has no login to suspend.

### `PATCH /api/admin/vendors/:id`

Non-contract details only; sent fields change, omitted fields do not.

```json
{ "contact_email": "ops@otis.example", "brands_serviced": "Otis, KONE" }
```

### `GET /api/admin/vendors/:id/history`

```json
{ "data": [ { "id": "…", "action": "Renewed", "note": "Extended to 2027-12-31",
              "actor_name": "Steven Tan", "created_at": "2026-08-01T09:14:00Z" } ] }
```

`actor_name` is null for system actions — the nightly expiry job has no admin.

**Every `:id` route** answers `404 NOT_FOUND` for a malformed UUID as well as a
well-formed one naming no vendor. Before that guard, `abc` reached Postgres and
came back as a `500` quoting the database's own cast error. The guard sits
*after* the role check, so a malformed id is never a way to probe for existence
without being an admin.

### `GET /api/admin/vendors/expiry-check` — **cron only**

Authenticated by `Authorization: Bearer <CRON_SECRET>`, not a user session.
Suspends vendors whose `contract_end` has passed and writes `Auto-suspended`
history rows.

### `POST /api/admin/vendors/run-expiry-check` — admin

The same logic, on demand from the vendor page. The GET twin above would refuse
a browser session, which is why the page uses this one.

---

# Role contacts

### `GET /api/contacts` — any authenticated role

The contact directory in display order.

```json
[ { "id": "…", "label": "Managing office",
    "description": "Estate maintenance, lift faults, general enquiries",
    "phone": "6500 0300", "category": "estate", "icon_key": "apartment",
    "is_help_line": true, "sort_order": 1 } ]
```

### `GET /api/users/contacts` — manager, admin, inspector

The staff a caller is meant to reach. **Takes no parameters**: the counterpart
role is derived from the verified token —

| Caller | Receives |
|---|---|
| `manager` | the admins |
| `admin` | the managers |
| `inspector` | the managers |

```json
[ { "id": "…", "full_name": "Rachel Lim",
    "email": "rachel.lim.manager@emservices.sg", "phone": "6500 0321" } ]
```

A resident or contractor gets `403 FORBIDDEN`, so staff numbers cannot be
enumerated by a role with no business seeing them. `phone` may be `null` — the
UI omits that contact rather than rendering a `tel:` link to nothing.
