# Lift Inspection & Estate Defect Management System

A full-stack web application that lets estate residents report defects and lets estate managers triage, assign, and resolve them — backed by real-time notifications, computer-vision defect detection, AI categorisation and risk analysis, and automated weekly PDF reporting.

> ### ▶ Live demo: **https://fsad-project-pied.vercel.app**
>
> Sign in with any account from **[Demo accounts](#demo-accounts)** below — one
> per role, no setup required. The backend is on Render's free tier, so the
> **first request after an idle period takes 30–60 seconds** to wake the
> service; the login page may hang on that first attempt. Give it a minute and
> retry before assuming anything is broken.
>
> Running it yourself instead? See **[Running locally](#running-locally)**.

---

## What it does

Residents submit defect reports (with photos); managers track, prioritise, assign, and close them. Inspectors file scheduled lift spot-checks against the same records — both live in the `inspections` table, told apart by a `source_type` discriminator (`resident_complaint` | `lift_inspection`). On top of that workflow, the system layers in:

- **Real-time updates** — managers and residents see status changes live via Socket.IO rooms.
- **Computer vision** — uploaded photos are run through a Roboflow model; high-confidence defects (≥ 70%) auto-create tickets.
- **AI categorisation & risk alerts** — OpenAI (`gpt-4o-mini`) categorises defects and flags recurring failure patterns by block and category.
- **Automated weekly reports** — pdfkit renders a weekly PDF, stored on Cloudinary and emailed to managers.
- **Analytics dashboards** — heatmaps, trend lines, and SLA-compliance gauges built with Chart.js.

## User roles

The five roles below are the ones enforced by `requireRole(...)` and allowed by the
`users.role` CHECK constraint (migration `001`).

| Role | What they can do |
|------|------------------|
| `resident` | Submit reports, track status, leave satisfaction ratings |
| `inspector` | File lift spot-checks; endorse a close with a signature (UC-004) |
| `manager` | Review, assign, prioritise, and close records; view analytics; send notifications |
| `contractor` | Work assigned defects in the contractor portal and e-sign completions |
| `admin` | Cost analytics (UC-011) and vendor account lifecycle (UC-012) |

Scheduled jobs (CV pipeline, AI recommendations, weekly reports) run as an automated
actor authenticated by `CRON_SECRET` rather than by a role.

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
│  ├── REST routes (inspections, analytics, admin, reports, …)      │
│  ├── Socket.IO server (manager / block-N / inspection-N rooms)    │
│  ├── Supabase token verification + requireRole middleware         │
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
| Auth | Supabase Auth (`@supabase/supabase-js`) — see [Security at a glance](#security-at-a-glance) |
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

## Running locally

`backend/` and `frontend/` are **two separate npm packages**. Each has its own
`package.json`, its own `node_modules`, and its own `.env` — install and run
them separately.

### 1. Prerequisites

- **Node.js 20 or newer** (no `engines` field pins this; 20+ is what the project
  is built and tested against) and npm.
- A **Supabase** project — provides both the PostgreSQL database and Auth.
- A **Cloudinary** account — photo and PDF storage.
- Optional, each gating one feature: SMTP credentials (email), an OpenAI key
  (AI categorisation and risk alerts), a Roboflow key (CV detection). Leave any
  of them unset and that feature degrades on its own; the server still boots.

### 2. Install

```bash
cd backend  && npm install
cd ../frontend && npm install
```

### 3. Environment variables

Copy the example file in **each** package and fill it in. Both `.env` files are
gitignored; the `.env.example` files document every variable and are the source
of truth — nothing below repeats a real value.

```bash
cd backend  && cp .env.example .env
cd ../frontend && cp .env.example .env
```

**`backend/.env`** — the server refuses to boot if any *required* one is missing
(`src/config/env.js` fails fast and names them):

| Group | Variables | Required? |
|---|---|---|
| Server | `PORT` (default 5000), `NODE_ENV` | optional |
| CORS + email links | `FRONTEND_URL` | **required** |
| Database | `DATABASE_URL` — Supabase pooler string, port 6543, `sslmode=require` | **required** |
| Supabase Auth | `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` | **required** |
| Cloudinary | `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` | **required** |
| Email | `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `DEFECT_ALERT_RECIPIENTS` | optional |
| Scheduled jobs | `CRON_SECRET` | optional |
| AI | `OPENAI_API_KEY` | optional |
| Computer vision | `ROBOFLOW_API_KEY`, `ROBOFLOW_WORKFLOW_URL` | optional |

> Use the Supabase **publishable** key (`sb_publishable_…`). The secret key
> (`sb_secret_…`) is not used anywhere in this project and must not be added.

**`frontend/.env`** — only `VITE_*` keys reach the browser, so none of them may
be a secret:

| Variable | Value |
|---|---|
| `VITE_API_URL` | `http://localhost:5000` locally; the Render URL in production |
| `VITE_SUPABASE_URL` | Supabase project URL |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Supabase publishable key |

### 4. Database setup

Create the Supabase project, put its connection string in `DATABASE_URL`, then:

```bash
cd backend
npm run migrate
```

`scripts/migrate.js` applies **all 49 `.sql` files in `backend/migrations/`** in
filename order, each in its own transaction, aborting the run on the first
failure. There is no applied-migrations ledger — **every run replays every
file**, so each migration is written to be idempotent. That is what lets this
one command build the entire schema *and* its seed data from an empty database,
and lets you re-run it safely afterwards to pick up new migrations.

The seed migrations create the demo estate: lifts and contractors, the 25-item
spot-check checklist, sample inspections, and every login in
[Demo accounts](#demo-accounts) — Supabase auth rows included, so there is
nothing to create by hand.

> **Known gotcha — the database port is blocked on some networks.** Supabase's
> pooler uses port 6543, which many school and corporate networks drop. The
> symptom is the backend hanging on start with no `listening` line and no error.
> If that happens, run off a phone hotspot.

### 5. Run

Start the backend **first** — the frontend calls it on load.

```bash
cd backend  && npm run dev     # http://localhost:5000
cd frontend && npm run dev     # http://localhost:5173
```

Open **http://localhost:5173** and sign in with any account below. Check the
backend is alive at **http://localhost:5000/health**.

`npm run dev` in `backend/` runs `node --watch server.js`; a `predev` step frees
port 5000 first, so a stale process from a previous run won't block startup. For
a production-style run use `npm start`.

---

## Running the tests

Two runners, because the two packages have incompatible test environments —
`jest` in Node for the API, `vitest` in jsdom for the React app. Neither can
execute the other's files. No credentials, database or network access are
needed: every external seam (the `pg` pool, Supabase, Cloudinary, Nodemailer,
the sockets) is mocked.

```bash
cd backend  && npm test        # jest
cd frontend && npm test        # vitest run
```

| Suite | Expected | Command |
|---|---|---|
| Backend | **687 passing**, 1 todo, 2 failing — 690 total across 31 suites | `cd backend && npm test` |
| Frontend | **308 passing**, 3 failing — 311 total across 29 files | `cd frontend && npm test` |

**The 5 failing tests are known and pre-existing**, all in shared team code, and
none of them block the app:

| Test | File | Cause |
|---|---|---|
| `acceptAlert › sets status Accepted and opens an AI-Generated inspection` | `backend/tests/unit/recommendations.test.js` | UC-006 alert-acceptance change |
| `POST /api/recommendations/:id/accept › 200 for a manager…` | `backend/tests/integration/recommendations.integration.test.js` | same change |
| `a role nobody has filled in yet resolves to an empty block, not undefined` | `frontend/tests/hasini/roleContacts.test.js` | a `contractor` contacts block was added after the test was written |
| `only the roles the staff endpoint admits ask for staff rows` | `frontend/tests/hasini/roleContacts.test.js` | same |
| `a role with no contacts block fires no requests at all` | `frontend/tests/hasini/useRoleContacts.test.js` | same |

Per-student test folders (`tests/<name>/`) each carry their own `README.md` and
`TEST_CASES.md` listing every case by name, generated from the runners' JSON
output. To run one person's tests only:

```bash
cd backend  && npx jest tests/philena
cd frontend && npx vitest run tests/philena
```

---

## Demo accounts

Seeded by migrations `022`, `029`, `032` and `037` — they exist as soon as
`npm run migrate` has run, on both a local database and the live one. These are
demo fixtures with per-account passwords; no real person's credentials are in
this repo.

| Role | Email | Password | Notes |
|---|---|---|---|
| Admin | `steven.tan.admin@emservices.sg` | `ChocoPizza_54` | Lands on `/admin/costs` |
| Manager | `rachel.lim.manager@emservices.sg` | `Beacon15!Sail` | Rachel Lim — triage, assignment, closing |
| Inspector | `weijie.tan.inspector@emservices.sg` | `Falcon77!Reed` | Wei Jie Tan |
| Inspector | `nurul.aisyah.inspector@emservices.sg` | `Marble46#Dawn` | Nurul Aisyah |
| Resident | `tan.weiming@mail.sg` | `Cedar88#Pine` | Tan Wei Ming — Blk 44A #12-05 |
| Resident | `nurul.huda@mail.sg` | `Lotus52!Brook` | Nurul Huda — Blk 44B #07-112 |
| Contractor | `sarah.chen@otisservice.sg` | `Willow24#Fern` | Sarah Chen — Otis Service SG |
| Contractor | `grace.ho@schindlerlifts.sg` | `Quartz39#Moss` | Grace Ho — Schindler Lifts SG |
| Contractor | `wei.jie.lim@otiselevator.sg` | `Cobalt58!Reef` | Wei Jie Lim — Otis Elevator Co. |
| Contractor | `priya.nair@kone-sg.com` | `Nimbus93#Kite` | Priya Nair — KONE Pte Ltd |
| Contractor | `marcus.tan@konemaint.com.sg` | `Harbor72!Vale` | Marcus Tan — KONE Maintenance |
| Contractor | `ahmad.faizal@schindlercare.sg` | `Ember61!Trail` | **Suspended on purpose** — signing in shows the UC-012 "access revoked" screen instead of the portal. Use it to check the suspension guard |

**Ahmad Faizal is the only suspended account.** Every other login above reaches
its own workspace. If a second one ever refuses to sign in, it was suspended by
hand through the admin vendor screen rather than by the seed — reactivate it
there. Note that `npm run migrate` re-asserts Ahmad's suspension on every run
(migration `043`), so reactivating *him* does not stick; that is deliberate, as
he is the fixture the UC-012 lockout is demonstrated with.

A second admin (`sophia_collins@admin.com`) is documented in
[backend/SEED_ADMIN.md](./backend/SEED_ADMIN.md).

To try the roles against each other: file a report as a resident, triage and
assign it as the manager, complete it as the assigned contractor, review it as
an inspector, then close it as the manager.

---

## Deployment

**Live frontend:** https://fsad-project-pied.vercel.app

Frontend on **Vercel**, backend on **Render**, database and auth on **Supabase**,
file storage on **Cloudinary**. Supabase and Cloudinary are already hosted — no
deploy step of their own. Deploy the backend first so the frontend has a real
`VITE_API_URL` to point at.

### 1. Backend → Render

1. New **Web Service** on [render.com](https://render.com), connect this repo,
   **root directory `backend`**.
2. **Build command** `npm install` · **start command** `npm start`.
3. Add every variable from `backend/.env.example` under Environment. Set
   `FRONTEND_URL` to the Vercel URL — it is what CORS **and the Socket.IO origin
   check** allow, so live updates fail silently if it is wrong or missing. (On a
   first deploy, fill it in after step 2 below and redeploy.)
4. Run the migrations once against the live database: `npm run migrate`, either
   from Render's shell or locally with `DATABASE_URL` pointed at Supabase.
5. Confirm `GET https://<service>.onrender.com/health` returns 200.

> **Free-tier cold start:** Render sleeps the service after ~15 minutes idle, and
> the next request takes 30–60 seconds to wake it. Before a demo, open `/health`
> once to warm it, or keep it awake with an UptimeRobot ping (below).

### 2. Frontend → Vercel

1. New project on [vercel.com](https://vercel.com), connect this repo,
   **root directory `frontend`**.
2. Framework preset **Vite** · **build command** `npm run build` · **output
   directory** `dist`.
3. Add the three browser variables: `VITE_API_URL` (the Render URL from step 1),
   `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`.
4. `frontend/vercel.json` rewrites every path to `/index.html`. That file is what
   makes client-side routing work — without it, refreshing on a deep link such as
   `/inspections/:id` returns a Vercel 404 instead of the app.
5. Deploy, then set `FRONTEND_URL` on Render to the resulting Vercel URL and
   redeploy the backend.

### 3. Scheduled jobs (optional, only for UC-006/UC-009/UC-012)

`.github/workflows/` cron jobs (nightly AI recommendations, weekly report,
vendor contract-expiry check) need repo secrets `RENDER_BACKEND_URL` and
`CRON_SECRET` (matching the backend's `CRON_SECRET`) under **Settings → Secrets
and variables → Actions**.

### 4. Uptime (optional)

A ping every 5 minutes (e.g. [UptimeRobot](https://uptimerobot.com) against
`/health`) keeps the free-tier backend warm.

---

## Project structure (high level)

```
.
├── backend/        # Express REST API + Socket.IO + integrations
│   ├── src/        # routes, controllers, services, middleware, models, config
│   ├── migrations/ # numbered SQL files (schema source of truth)
│   └── tests/      # unit + integration
│
├── frontend/       # React app (Vite)
│   └── src/        # pages, components, context, hooks, services
│
└── docs/           # high-level design + implementation phases
```

---

## Documentation

- **[High-Level Design](./HIGH_LEVEL_DESIGN.md)** — system overview, database schema, API endpoint reference, auth & security model, environment variables.
- **[Use Case Specifications](./USE_CASES.md)** — the numbered UC-0xx specs the features below implement.
- **[Implementation Phases](./PROJECT_IMPLEMENTATION_PHASES.md)** — 6-week phase plan, ownership, dependencies, test cases, and risk register.
- **[Admin accounts](./backend/SEED_ADMIN.md)** — the seeded admin logins and how to add another.

The schema is 18 tables, defined across the numbered files in `backend/migrations/`
— those files, not this README, are the source of truth.

---

## Security at a glance

- Authentication is **Supabase Auth**: sign-up/login/session refresh happen on the
  client via `@supabase/supabase-js`; the backend verifies the Supabase access
  token on every request and reads the caller's role from the `users` profile row.
  There are no custom auth endpoints and no password hashes in our database.
- Role-gated routes guarded by `requireRole(...)` middleware (`resident`,
  `inspector`, `manager`, `contractor`, `admin`) — enforcement is server-side;
  UI role checks are convenience only.
- Scheduled endpoints protected by a `CRON_SECRET` bearer token.
- Request filters/bodies are validated in the controller before any SQL runs, and
  every query is parameterised — no string-built SQL. Errors use the
  `{ code, message }` contract throughout.
- `helmet` security headers, CORS locked to `FRONTEND_URL` (Express and
  Socket.IO), a 1 MB body cap, and `express-rate-limit` across all routes.

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
  touches the database and exports always use real data; the preview survives
  an accidental refresh via sessionStorage only.
- Filters (block / category / paper-form section / date range) persist in the
  URL, so a filtered view is bookmarkable.

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

All accept `?from&to&block&category&section` (`section` narrows to inspections
with a Defect in that part of the paper spot-check form). The scorecard's
overdue count drills through to `/inspections?contractor=<name>&overdue=true`.

**Example** — `GET /api/analytics/summary?block=44A` with
`Authorization: Bearer <supabase-token>`:

```json
{
  "open_count": 46, "overdue_count": 4, "avg_resolution_hours": 58.3,
  "sla_percentage": 63.92, "new_last_30": 58, "new_prior_30": 41,
  "new_records_change_pct": 41.5, "sla_threshold_hrs": 72
}
```

**Error codes** (shape is always `{ code, message }`):

| Status | Code | When |
|---|---|---|
| 401 | `UNAUTHORIZED` | Missing/expired Supabase token |
| 403 | `FORBIDDEN` | Authenticated but not a manager |
| 400 | `VALIDATION_ERROR` | Bad `views` list on the PPTX export |
| 500 | `EXPORT_FAILED` | Deck build/upload failed — UI falls back to CSV |
| 500 | `SERVER_ERROR` | Any unhandled failure, via the central error handler |

### Setup / demo data

`npm run migrate` in `backend/` applies `018_seed_demo_data.sql`, which seeds
demo inspections, assigned/closed jobs and two AI alerts (idempotent — skips
if `Demo:` records exist). Contractors come from `016_seed_reference_data.sql`.

### Tests

- Backend: `npx jest tests/hasini/analytics.test.js tests/hasini/export.test.js tests/hasini/recommendations.test.js`
- Frontend: `npx vitest run tests/hasini` in `frontend/` (dashboard
  panels, cost analytics, CSV import/export, contacts)

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

**Example** — `POST /api/admin/vendors/:id/renew` (multipart) with
`contract_end=2027-08-01` returns the updated vendor row; a reactivated
account also gets a `vendor_history` entry (`Contract Renewed`).

**Error codes** (shape is always `{ code, message }`):

| Status | Code | When |
|---|---|---|
| 400 | `INVALID_CONTRACT_DATES` | `contract_end` before `contract_start` (also caught inline in the form) |
| 400 | `VALIDATION_ERROR` | Required onboarding field missing (names the fields) |
| 409 | `EMAIL_ALREADY_EXISTS` | Login email already registered — no rows created |
| 403 | `ACCOUNT_SUSPENDED` | Suspended vendor attempts any authenticated call |
| 403 | `FORBIDDEN` | Non-admin calls any vendor route |
| 404 | `NOT_FOUND` | Unknown vendor id |

### Setup / demo data

- Migrations `019`–`022` add the contract fields, holder fields
  (`users.job_title`, `contractors.access_reason`), the `vendor_history`
  table, and idempotent demo data: six vendors with staggered contracts and
  named account holders, all with working logins (each with its own password —
  see [Demo accounts](#demo-accounts)).
  One vendor (Schindler Care / Ahmad Faizal) is pre-suspended with an expired
  contract to demo the offboarding state.
- Migration `029` seeds two EM Services inspector logins:
  `weijie.tan.inspector@emservices.sg` (Wei Jie Tan) and
  `nurul.aisyah.inspector@emservices.sg` (Nurul Aisyah). At least one **active** inspector
  must exist or UC-004 close is blocked — the endorsing signature has to belong
  to a user whose role is `inspector` (§11 G7), and the close panel populates
  its picker from `GET /api/users/inspectors`. These accounts also file UC-001
  spot-checks.
- Migration `030` attributes the 12 `Demo:` lift spot-checks from `018` to those
  inspectors (alternating), so the close panel pre-selects an endorser instead
  of asking for one on every demo record. Scoped to `Demo:%` rows with a NULL
  `inspector_id`, so real spot-checks are untouched.
- Migration `032` adds presentation-ready manager and resident logins (each its
  own password). **Additive only** — the pre-existing developer accounts are
  left active and untouched, so teammates keep working; deleting them would be
  destructive anyway, since `inspections.resident_id` is `ON DELETE CASCADE`.
- Migration `037` seeds the admin logins, so a freshly migrated database can
  reach `/admin/costs` and `/admin/vendors` without a manual Supabase step. See
  [backend/SEED_ADMIN.md](./backend/SEED_ADMIN.md).

### Demo logins

Every seeded login, with its own password, is in
**[Demo accounts](#demo-accounts)** near the top of this README — one table, so
the two cannot drift apart. Staff addresses carry the role so the account is
self-describing on screen; residents use personal-looking addresses, as they
would in reality.

For this use case specifically: `ahmad.faizal@schindlercare.sg` is seeded
**suspended** and is the account to sign in as when demonstrating the UC-012
lockout.
- The scheduled job is `.github/workflows/contract-expiry-check.yml` — set
  repo secrets `RENDER_BACKEND_URL` and `CRON_SECRET` (must match the
  backend's `CRON_SECRET` env var). `workflow_dispatch` allows manual runs.

### Tests

- Backend: `npx jest tests/hasini/vendors.test.js` (onboarding validation +
  rollback, role gating, expiry job, suspended-login 403, renew/suspend,
  edit + history)
