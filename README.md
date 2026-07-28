# Estate Incident Management System

A full-stack web application that lets estate residents report defects and lets estate managers triage, assign, and resolve them — backed by real-time notifications, computer-vision defect detection, AI categorisation and risk analysis, and automated weekly PDF reporting.

---

## What it does

Residents submit incident reports (with photos); managers track, prioritise, assign, and close them. On top of the basic workflow, the system layers in:

- **Real-time updates** — managers and residents see status changes live via Socket.IO rooms.
- **Computer vision** — uploaded photos are run through a Roboflow model; high-confidence defects (≥ 70%) auto-create tickets.
- **AI categorisation & risk alerts** — OpenAI (`gpt-4o-mini`) categorises incidents and flags recurring failure patterns by block and category.
- **Automated weekly reports** — pdfkit renders a weekly PDF, stored on Cloudinary and emailed to managers.
- **Analytics dashboards** — heatmaps, trend lines, and SLA-compliance gauges built with Chart.js.

## User roles

| Role | What they can do |
|------|------------------|
| `resident` | Submit reports, track status, leave satisfaction ratings |
| `manager` | Review, assign, prioritise, and close incidents; view analytics; send notifications |
| `system` | Automated actor — CV pipeline, AI recommendations, weekly report generation |

---

## Architecture

```
┌──────────────────────── CLIENT (Vercel) ─────────────────────────┐
│  React.js  ──VITE_API_URL──►  REST API                           │
│  Socket.IO client  ──WSS──►   Socket.IO server                   │
└───────────────────────────────┬──────────────────────────────────┘
                                 │ HTTPS + WSS
┌────────────────────────────────▼─────────────── BACKEND (Render) ─┐
│  Node.js / Express                                                │
│  ├── REST routes (auth, incidents, analytics, reports, …)         │
│  ├── Socket.IO server (manager / block-N / incident-N rooms)      │
│  ├── JWT middleware (role-based)                                   │
│  └── CRON_SECRET guard for scheduled endpoints                    │
└──────┬──────────────┬──────────────┬───────────────┬──────────────┘
       ▼              ▼              ▼               ▼
  ┌─────────┐  ┌───────────┐  ┌──────────┐   ┌───────────┐
  │Supabase │  │Cloudinary │  │ Roboflow │   │  OpenAI   │
  │Postgres │  │img + pdf  │  │ CV model │   │gpt-4o-mini│
  └─────────┘  └───────────┘  └──────────┘   └───────────┘

  Scheduled jobs:  GitHub Actions → nightly recommendations + weekly report
  Uptime:          UptimeRobot pings /health every 5 min (keeps Render warm)
```

> Scheduled **notification** dispatch runs in-process via a 60-second `setInterval` loop (no GitHub Actions minutes consumed). Nightly AI recommendations and the weekly report are triggered by GitHub Actions cron, authenticated with `CRON_SECRET`.

---

## Tech stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18, Vite, Chart.js, Socket.IO client — deployed on **Vercel** |
| Backend | Node.js 20, Express 4, Socket.IO 4 — deployed on **Render** |
| Database | Supabase (PostgreSQL 15) |
| Image / PDF storage | Cloudinary |
| Computer vision | Roboflow Inference API |
| AI / NLP | OpenAI API (`gpt-4o-mini`) |
| PDF generation | pdfkit |
| Email | Nodemailer (SMTP) |
| Auth | JWT (`jsonwebtoken`) + bcrypt |
| Scheduling | GitHub Actions (cron) |
| Uptime | UptimeRobot |

---

## Repository layout

This project is split into **two repositories** — different runtimes, deploy targets, and dependencies:

| Repo | Stack | Deploy | README |
|------|-------|--------|--------|
| `backend/` | Node + Express + Socket.IO | Render | [backend/README.md](./backend/README.md) |
| `frontend/` | React + Vite | Vercel | [frontend/README.md](./frontend/README.md) |

---

## Getting started

You'll need accounts/keys for Supabase, Cloudinary, Roboflow, OpenAI, and an SMTP provider before running locally.

### 1. Backend

```bash
cd backend
npm install
cp .env.example .env        # fill in your values
# run the 10 migration files in migrations/ against your Supabase DB, in order
npm run dev
```

### 2. Frontend

```bash
cd frontend
npm install
cp .env.example .env        # set VITE_API_URL to your backend URL
npm run dev
```

---

## Project structure (high level)

```
.
├── backend/        # Express REST API + Socket.IO + integrations
│   ├── src/        # routes, controllers, services, middleware, models, config
│   ├── migrations/ # 001–010 SQL files (run in order)
│   └── tests/      # unit + integration
│
├── frontend/       # React app (Vite)
│   └── src/        # pages, components, context, hooks, services
│
└── docs/           # high-level design + implementation phases
```

---

## Documentation

- **High-Level Design** — system overview, full database schema (10 tables), API endpoint reference, auth & security model, environment variables.
- **Implementation Phases** — 6-week phase plan, ownership, dependencies, test cases, and risk register.

---

## Security at a glance

- Passwords hashed with bcrypt (12 salt rounds).
- JWTs signed with `JWT_SECRET`, 30-minute sliding expiry, stored **in memory only** on the client (never localStorage).
- Manager-only routes guarded by a `requireRole('manager')` middleware.
- Scheduled endpoints protected by a `CRON_SECRET` bearer token.
- All request bodies validated before reaching controllers; rate limiting on auth routes.

---

## UC-005 — Manager Analytics Dashboard (Hasini)

The `/dashboard` route (manager role) provides estate analytics computed live
from the `inspections` table.

### Features

- **KPI row** — new reports (with % movement vs the prior 30 days), open
  records, average resolution hours + SLA %, overdue contractor jobs.
- **Charts** — block × category heatmap (click a cell to drill down), daily
  issue trend line, SLA compliance gauge (72h target).
- **Contractor scorecard** — jobs, avg rectification days, repeat-defect
  rate, overdue count per contractor.
- **Priority queue** — open records ranked by composite score
  `(ai_priority_score × 0.5) + (recency × 0.3) + (frequency × 0.2)`, with
  priority/status filters and a Top 10 / All toggle. CSV export.
- **AI risk alerts** — active `ai_predictions` rows as amber cards with
  Accept / Dismiss (UC-006 provides the analysis engine).
- **PowerPoint export** — `POST /api/export/pptx` renders the current
  filtered view (charts + scorecard) into a native-chart .pptx via
  PptxGenJS, stored on Cloudinary.
- **CSV what-if preview** — import a CSV (`block,category[,date][,resolution_time_hours]`)
  to blend simulated rows into the charts client-side; a Combined / Existing
  only / Imported only switch compares views; Clear preview reverts. Nothing
  touches the database and exports always use real data.
- Filters (block / category / date range) persist in the URL, so a filtered
  view is bookmarkable.

### Endpoints (all manager-only)

```
GET  /api/analytics/filter-options        dropdown options (from data)
GET  /api/analytics/summary               KPI tiles + movement
GET  /api/analytics/issues-by-block       heatmap
GET  /api/analytics/trends                daily counts
GET  /api/analytics/sla-compliance        SLA summary
GET  /api/analytics/contractor-scorecard  per-contractor metrics
GET  /api/analytics/priority-queue        ranked open records (+ ?priority&status)
GET  /api/recommendations                 active AI alerts
POST /api/export/pptx                     PowerPoint deck  (manager or admin)
```

All accept `?from&to&block&category`.

### Setup / demo data

`npm run migrate` in `backend/` applies `018_seed_demo_data.sql`, which seeds
demo inspections, assigned/closed jobs and two AI alerts (idempotent — skips
if `Demo:` records exist). Contractors come from `016_seed_reference_data.sql`.

### Tests

- Backend: `npx jest tests/unit/analytics.test.js tests/unit/export.test.js tests/unit/recommendations.test.js`
- Frontend: `npm test` in `frontend/` (vitest — CSV import/merge logic)

### Demo script (~3 min)

1. Log in as manager → dashboard: point out the KPI movement ("+X% new
   reports vs last month") and the AI alert cards with estimated cost.
2. Filter to Block 44A → all charts re-query; copy the URL to show the view
   is shareable.
3. Import a what-if CSV (lift-surge scenario) → heatmap cell rings, dashed
   trend line, SLA delta; flick Combined → Imported only → Clear preview.
4. Click **Export to PowerPoint** → open the deck: native editable charts,
   ready for the weekly meeting.
5. Edge cases: filter to an empty result (CSV button disables with a
   tooltip), import a malformed CSV (specific error, nothing breaks).

## UC-012 — Vendor Account Lifecycle (Hasini)

The `/admin/vendors` route (admin role) manages external vendor (contractor)
accounts whose access is tied to their servicing contract: onboarding,
contract-driven auto-suspension, renewal, and a per-vendor audit trail.

### Features

- **Accountable onboarding** — every login is created for a named person
  (name, job title, work email) with a mandatory written reason for access;
  the contract PDF is stored on Cloudinary `/contracts` (record-keeping only,
  dates are entered manually by design). Login email is auto-suggested from
  the holder's name + the company's email domain. Passwords are admin-set and
  admin-managed (a Generate button produces a strong random one) — vendors do
  not choose or rotate their own credential.
- **Contract-driven offboarding** — a daily job (01:00 SGT) suspends any
  vendor past `contract_end`; suspended vendors get `403 ACCOUNT_SUSPENDED`
  at login and are blocked on every role-gated route. Admins can also run the
  check on demand from the page, and the table live-refreshes via Socket.IO
  (`vendor_expired` on `admin-room`) when a suspension happens.
- **Renew / Suspend** — renew sets a new `contract_end` (optionally a new
  contract document) and reactivates a suspended account; suspend is instant
  early termination. Nothing is ever deleted — 5-year audit trail.
- **Audit trail** — `vendor_history` records Onboarded / Contract Renewed /
  Suspended / Auto-Suspended / Details Updated with the acting admin
  ("System" for the scheduled job); viewable per vendor in the UI.
- **Edit details** — company contact/brands and holder name/title are
  editable after onboarding; contract dates only change via Renew and the
  login email is immutable.

### Endpoints (admin-only unless noted)

```
POST  /api/admin/vendors                    onboard (multipart, optional contract_doc)
GET   /api/admin/vendors                    list, soonest-expiring first
POST  /api/admin/vendors/:id/renew          new contract_end (+ optional contract_doc)
POST  /api/admin/vendors/:id/suspend        early termination
PATCH /api/admin/vendors/:id                edit non-contract details
GET   /api/admin/vendors/:id/history        audit trail
POST  /api/admin/vendors/run-expiry-check   on-demand expiry run
GET   /api/admin/vendors/expiry-check       daily job (CRON_SECRET bearer, not JWT)
```

### Setup / demo data

- Migrations `019`–`022` add the contract fields, holder fields
  (`users.job_title`, `contractors.access_reason`), the `vendor_history`
  table, and idempotent demo data: six vendors with staggered contracts and
  named account holders, all with working logins (password `TempPass123!`).
  One vendor (Schindler Care / Ahmad Faizal) is pre-suspended with an expired
  contract to demo the offboarding state.
- Migration `029` seeds two EM Services inspector logins (same password,
  `TempPass123!`): `inspector1@emservices.sg` (Wei Jie Tan) and
  `inspector2@emservices.sg` (Nurul Aisyah). At least one **active** inspector
  must exist or UC-004 close is blocked — the endorsing signature has to belong
  to a user whose role is `inspector` (§11 G7), and the close panel populates
  its picker from `GET /api/users/inspectors`. These accounts also file UC-001
  spot-checks.
- Migration `030` attributes the 12 `Demo:` lift spot-checks from `018` to those
  inspectors (alternating), so the close panel pre-selects an endorser instead
  of asking for one on every demo record. Scoped to `Demo:%` rows with a NULL
  `inspector_id`, so real spot-checks are untouched.
- The scheduled job is `.github/workflows/contract-expiry-check.yml` — set
  repo secrets `RENDER_BACKEND_URL` and `CRON_SECRET` (must match the
  backend's `CRON_SECRET` env var). `workflow_dispatch` allows manual runs.

### Tests

- Backend: `npx jest tests/unit/vendors.test.js` (onboarding validation +
  rollback, role gating, expiry job, suspended-login 403, renew/suspend,
  edit + history)

### Demo script (~2 min)

1. Vendors table: expiry countdown chips (red/amber/green), the 30-day
   warning banner, hover a holder for their access reason.
2. Onboard a vendor live — watch the login email auto-suggest and Generate a
   password; give it a contract that ended last month.
3. Click **Run expiry check** — the new vendor flips to suspended without a
   reload (Socket.IO), and its History shows "Auto-Suspended — System".
4. Try logging in as that vendor → "This account is suspended."
5. **Renew** with next year's date (+ new contract PDF) → active again.
