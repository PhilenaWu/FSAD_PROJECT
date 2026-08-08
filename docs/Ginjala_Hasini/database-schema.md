# Database schema — Ginjala Hasini

Tables my features read from or write to: UC-005 analytics, UC-011 cost
analytics UI, UC-012 vendor lifecycle, and role contacts.

The schema is raw SQL with no ORM. The numbered files in `backend/migrations/`
are the source of truth; everything below is taken from them, with the
migration named against each table. Types are the PostgreSQL declarations as
written.

## Entity relationships

```
                    ┌──────────────────┐
                    │ auth.users       │  Supabase Auth (managed)
                    └────────┬─────────┘
                             │ 1:1  (users.id references it)
                    ┌────────▼─────────┐
          ┌─────────┤ users            ├──────────┐
          │         └────────┬─────────┘          │
          │ inspector_id /   │ contractor_id      │ actor_id
          │ resident_id      │ (contractors only) │
          │                  │                    │
┌─────────▼────────┐   ┌─────▼────────┐   ┌───────▼────────┐
│ inspections      ├──►│ contractors  │◄──┤ vendor_history │
└───┬──────────┬───┘   └──────┬───────┘   └────────────────┘
    │ lift_id  │              │ contractor_id
    │          │       ┌──────▼───────┐
┌───▼──────┐   │       │ lifts        │
│ lifts    │   │       └──────────────┘
└──────────┘   │ inspection_id
        ┌──────▼─────────────┐        ┌──────────────────┐
        │ checklist_results  ├───────►│ checklist_items  │
        └────────────────────┘        └──────────────────┘

  Standalone (no FK into the workflow):
    ai_predictions      keyed by (location_block, category) as plain values
    contact_directory   organisations, not accounts — no user FK by design
```

`ai_predictions` and `contact_directory` are deliberately unjoined. A prediction
is about a block-and-category pair rather than any one record, and a directory
row is an organisation (the managing office, the national emergency lines), not
a person with a login.

---

## `inspections` — migration `004`, extended by `017`, `025`, `027`, `031`

The core table. Every analytics figure and every cost figure is an aggregate
over it. UC-005 and UC-011 only ever read it.

| Column | Type | Notes |
|---|---|---|
| `id` | `UUID` | **PK**, `gen_random_uuid()` |
| `source_type` | `VARCHAR(20)` NOT NULL | `lift_inspection` \| `resident_complaint` \| `cv_auto_detected` — the discriminator that lets spot-checks and complaints share one table |
| `resident_id` | `UUID` | **FK** → `users(id)` ON DELETE CASCADE |
| `inspector_id` | `UUID` | **FK** → `users(id)` |
| `lift_id` | `UUID` | **FK** → `lifts(id)`; NULL for estate defects not tied to a lift |
| `contractor_id` | `UUID` | **FK** → `contractors(id)`; NULL when closed without an assignment |
| `title` | `VARCHAR(255)` NOT NULL | |
| `description` | `TEXT` | |
| `location_block` | `VARCHAR(20)` NOT NULL | Heatmap X axis, `?block=` filter |
| `location_unit` | `VARCHAR(20)` | |
| `status` | `VARCHAR(30)` NOT NULL | CHECK: `Open`, `Pending Assignment`, `Assigned`, `Acknowledged`, `On Hold`, `Rectified`, `Resolved`, `Closed` |
| `category` | `VARCHAR(50)` NOT NULL | CHECK over 12 values; heatmap Y axis, `?category=` filter |
| `priority` | `VARCHAR(20)` NOT NULL | CHECK: `Critical`, `High`, `Medium`, `Low` |
| `ai_priority_score` | `INTEGER` | CHECK 1–100; the 0.5-weighted term in the priority queue score |
| `target_deadline` | `TIMESTAMP` | Past-deadline open work is the scorecard's overdue count |
| `acknowledged_at` | `TIMESTAMP` | |
| `rectified_at` | `TIMESTAMP` | |
| `hold_reason` | `VARCHAR(100)` | Set with `status = 'On Hold'`; those records are excluded from overdue counts (G11) |
| `closed_at` | `TIMESTAMP` | Dates every cost figure — when the money was settled |
| `resolution_time_hours` | `NUMERIC(8,2)` | Averaged for the KPI row; compared against the 72-hour SLA |
| `actual_cost` | `NUMERIC(10,2)` | Entered at close (UC-004). **The whole of UC-011 aggregates this column** |
| `reopen_count` | `INTEGER` NOT NULL DEFAULT 0 | Migration `031`; averaged per contractor on the scorecard |
| `serviced_at` | `DATE` | Migration `027` |
| `is_deleted` | `BOOLEAN` NOT NULL DEFAULT FALSE | Soft delete — excluded from every analytics query |
| `satisfaction_rating` | `INTEGER` | CHECK 1–5 |
| `gps_lat` / `gps_lng` / `gps_accuracy_m` | `NUMERIC` | Migration `017` |

**A "costed row"** — the single definition shared by every UC-011 query
(`inspectionWhere` in `adminController.js`) — is a row with
`status = 'Closed'`, `actual_cost IS NOT NULL`, and `is_deleted = FALSE`.
Centralising it is what keeps the dashboard, the job-level drill-down and the
exported deck reporting the same money.

---

## `contractors` — migration `002`, extended by `019`, `020`

The vendor record behind UC-012. One row is both a maintenance company and,
through `user_id`, its login account.

| Column | Type | Notes |
|---|---|---|
| `id` | `UUID` | **PK** |
| `name` | `VARCHAR(255)` NOT NULL | Displayed on the scorecard and every cost breakdown |
| `brands_serviced` | `TEXT` | Comma-separated (Otis, Schindler, KONE) |
| `contact_email` | `VARCHAR(255)` NOT NULL | |
| `user_id` | `UUID` | **FK** → `users(id)` — the linked login |
| `contract_start` | `DATE` | Migration `019` |
| `contract_end` | `DATE` | Migration `019`. Drives the expiry check and the list's sort order |
| `contract_doc_url` | `VARCHAR(500)` | Migration `019`; Cloudinary raw upload |
| `access_reason` | `VARCHAR(500)` | Migration `020` |
| `created_at` | `TIMESTAMP` NOT NULL | |

Suspension is **not** a column here — it is `users.status = 'suspended'` on the
linked account, so revoking access and ending a contract are one action.

---

## `vendor_history` — migration `021`

Append-only audit trail. UC-012 writes one row per lifecycle action; nothing
updates or deletes.

| Column | Type | Notes |
|---|---|---|
| `id` | `UUID` | **PK** |
| `contractor_id` | `UUID` NOT NULL | **FK** → `contractors(id)` ON DELETE CASCADE |
| `actor_id` | `UUID` | **FK** → `users(id)`. **NULL for system actions** — the nightly expiry job has no acting admin |
| `action` | `VARCHAR(50)` NOT NULL | `Onboarded`, `Renewed`, `Suspended`, `Auto-suspended`, `Details updated` |
| `note` | `TEXT` | |
| `created_at` | `TIMESTAMP` NOT NULL | |

Index: `idx_vendor_history_contractor (contractor_id)` — every read is "the
history of one vendor".

---

## `users` — migration `001`, extended by `020`, `037`, `038`

| Column | Type | Notes |
|---|---|---|
| `id` | `UUID` | **PK**, and **FK** → `auth.users(id)` ON DELETE CASCADE. Supabase Auth owns identity; this table holds the profile |
| `email` | `VARCHAR(255)` NOT NULL UNIQUE | |
| `full_name` | `VARCHAR(255)` NOT NULL | |
| `role` | `VARCHAR(20)` NOT NULL | CHECK: `resident`, `inspector`, `manager`, `contractor`, `admin` |
| `status` | `VARCHAR(20)` NOT NULL DEFAULT `active` | CHECK `active` \| `suspended`, plus `pending`/`rejected` from `037` |
| `phone` | `VARCHAR(30)` | Migration `038`. **Nullable on purpose** — residents and contractors have no reason to publish one, and pre-`038` accounts have none. The contacts UI omits a contact without a number rather than rendering a dead `tel:` link |
| `contractor_id` | `UUID` | **FK** → `contractors(id)` (added in `002`); contractors only |
| `job_title` | `VARCHAR(100)` | Migration `020` |
| `block_number` / `unit_number` | `VARCHAR(20)` | Residents only |

There is **no `password_hash` column and no JWT secret** — Supabase Auth holds
credentials, and the backend verifies its token.

---

## `contact_directory` — migration `039`

The numbers that are not people. Written by migration only; the app reads it.

| Column | Type | Notes |
|---|---|---|
| `id` | `UUID` | **PK** |
| `label` | `VARCHAR(120)` NOT NULL **UNIQUE** | The UNIQUE constraint makes the seed idempotent: replaying the migration leaves an edited number alone |
| `description` | `VARCHAR(255)` | |
| `phone` | `VARCHAR(30)` NOT NULL | |
| `category` | `VARCHAR(20)` NOT NULL | CHECK `estate` \| `emergency`. Each role's block names which categories it draws on |
| `icon_key` | `VARCHAR(30)` | A presentation token, not a component name, so a row added by a later migration still renders — the UI falls back to a generic phone icon on an unrecognised key |
| `is_help_line` | `BOOLEAN` NOT NULL DEFAULT FALSE | Marks the single row the sidebar card dials. A flag rather than "whichever estate row sorts first", so changing the help number is an explicit edit |
| `sort_order` | `INT` NOT NULL DEFAULT 0 | |

Seeded with three rows: Managing office (`6500 0300`, `is_help_line`), Police
(`999`), Fire & Ambulance (`995`).

---

## `ai_predictions` — migration `010`

Read by the UC-005 alert cards and by UC-011 as projected cost exposure.

| Column | Type | Notes |
|---|---|---|
| `id` | `UUID` | **PK** |
| `location_block` | `VARCHAR(20)` NOT NULL | Plain value, not an FK |
| `category` | `VARCHAR(50)` NOT NULL | |
| `velocity_pct` | `NUMERIC(8,2)` NOT NULL | |
| `estimated_cost` | `NUMERIC(10,2)` | The projected series on the cost dashboard |
| `alert_text` | `TEXT` NOT NULL | |
| `status` | `VARCHAR(20)` NOT NULL DEFAULT `Active` | CHECK `Active` \| `Accepted` \| `Dismissed` |
| `dismissed_by` | `UUID` | **FK** → `users(id)` |
| `created_at` | `TIMESTAMP` NOT NULL | Dates the projected series — an active alert is exposure *now* and has no historical month of its own |

Index: `idx_ai_predictions_status (status)` — the dashboard reads `Active` only.

Because this table has no `lift_id` or `contractor_id`, filtering the cost
dashboard by lift or contractor zeroes the projected series rather than
silently showing an unfiltered projection beside filtered actuals.

---

## `lifts` — migration `003`, extended by `028`

| Column | Type | Notes |
|---|---|---|
| `id` | `UUID` | **PK** |
| `block_number` | `VARCHAR(20)` NOT NULL | UNIQUE together with `lift_code` |
| `lift_code` | `VARCHAR(20)` NOT NULL | e.g. `44A-L1`; the repair-vs-replace watchlist groups on this |
| `brand` | `VARCHAR(100)` NOT NULL | |
| `contractor_id` | `UUID` | **FK** → `contractors(id)` |
| `bca_cert_expiry` | `DATE` | |
| `town_council` / `address` | `VARCHAR(255)` | Migration `028` |

Index: `idx_lifts_contractor (contractor_id)`.

---

## `checklist_items` / `checklist_results` — migrations `006`, `007`

The analytics **form-section filter** reads these: a section is matched with an
`EXISTS` over `checklist_results` scoped to `Defect` rows, so an inspection
counts for a section only when it actually recorded a defect there.

`checklist_items`: `id` (PK), `section`, `item_text`, `display_order`,
`active` — sections are read from this table rather than hardcoded, so
re-seeding the paper form needs no code change.

`checklist_results`: `id` (PK), `inspection_id` (**FK** → `inspections(id)` ON
DELETE CASCADE), `checklist_item_id` (**FK** → `checklist_items(id)`),
`result` (CHECK `Pass` \| `Defect`), `severity` (CHECK `Minor` \| `Major` \|
`Critical`), `remark`, `photo_url`, `completion_photo_url`, `completion_remark`,
`rectified`.

The FK from results to items is why the paper-form re-seed deactivates old rows
(`active = FALSE`) instead of deleting them — a DELETE would orphan historical
results.
