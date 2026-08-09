# Lift Inspection & Estate Defect Management System — Backend

REST API and real-time server. Node.js + Express + Socket.IO, backed by Supabase
(PostgreSQL) and integrated with Cloudinary, Roboflow, OpenAI and SMTP. Deployed
on Render.

For the system-wide picture see the root [README](../README.md); for the schema
and full endpoint reference see [HIGH_LEVEL_DESIGN.md](../HIGH_LEVEL_DESIGN.md).

---

## Authentication

**Authentication is Supabase Auth.** Sign-up, login, logout, password hashing and
session refresh all happen on the client via `@supabase/supabase-js`. This service
has **no** `/api/auth/*` endpoints, no `jsonwebtoken`, no `bcrypt`, no
`JWT_SECRET`, and no `password_hash` column — credentials live in Supabase's own
`auth.users` table and never in ours.

The request flow is:

1. The frontend obtains a Supabase access token and sends
   `Authorization: Bearer <token>`.
2. `middleware/auth.js` → `requireAuth` verifies that token against Supabase.
3. It then loads the caller's profile row from `users` (keyed by the Supabase auth
   user id) and reads `role` from it.
4. `requireRole('manager', 'admin', …)` gates the route on that role.

`GET /api/users/me` returns the caller's profile row. Roles are `resident`,
`inspector`, `manager`, `contractor`, `admin`, enforced by a CHECK constraint in
migration `001`.

Scheduled-job endpoints are not user-authenticated: `middleware/cronGuard.js`
requires `Authorization: Bearer <CRON_SECRET>` instead.

---

## Getting started

**Prerequisites:** Node.js 20+, a Supabase project, and — for the feature-gated
integrations — Cloudinary, Roboflow, OpenAI and SMTP credentials.

```bash
npm install
cp .env.example .env    # fill in your values
npm run migrate         # apply migrations/*.sql in order
npm run dev             # node --watch server.js
```

| Script | Does |
|---|---|
| `npm run dev` | Local development (`node --watch server.js`) |
| `npm start` | Production (`node server.js`) |
| `npm run migrate` | Apply every `migrations/*.sql` in filename order |
| `npm test` | Jest — every file under `tests/` (`unit`, `integration`, and the per-student folders) |

### Environment variables

`src/config/env.js` validates the required set on boot and exits with the missing
names if any are absent. Every variable, required and optional, is documented in
[`.env.example`](./.env.example).

| Variable | Status | Purpose |
|---|---|---|
| `FRONTEND_URL` | required | Allowed origin for CORS + Socket.IO |
| `DATABASE_URL` | required | Supabase PostgreSQL connection string (pooler, SSL) |
| `SUPABASE_URL` | required | Supabase project URL, for access-token verification |
| `SUPABASE_PUBLISHABLE_KEY` | required | Publishable key (`sb_publishable_…`). Never put the secret key in this project |
| `CLOUDINARY_CLOUD_NAME` / `_API_KEY` / `_API_SECRET` | required | Photo + PDF storage |
| `PORT` / `NODE_ENV` | optional | Default `5000` / `development` |
| `CRON_SECRET` | optional | Bearer token guarding scheduled endpoints |
| `OPENAI_API_KEY` | optional | Real risk-alert text; falls back to a template when unset |
| `SMTP_HOST` / `_PORT` / `_USER` / `_PASS` | optional | Report + defect-alert email. A missing transport fails only the email, not the operation |
| `DEFECT_ALERT_RECIPIENTS` | optional | Comma-separated addresses CC'd on every defect-assignment alert |
| `ROBOFLOW_API_KEY` / `ROBOFLOW_WORKFLOW_URL` | optional | CV defect detection (UC-007) |

---

## Project structure

```
backend/
├── src/
│   ├── routes/       # one file per mounted resource (see the table below)
│   ├── controllers/  # request handlers per resource
│   ├── services/     # cloudinary, roboflow, openai, pdf, pptx, email,
│   │                 # socket, notification
│   ├── middleware/   # auth (requireAuth/requireRole), cronGuard,
│   │                 # rateLimiter, errorHandler
│   ├── models/       # DB query layer per table — raw parameterised SQL
│   ├── config/       # db pool, env validation, cloudinary, socket
│   ├── utils/        # notificationDispatcher, velocityCalculator,
│   │                 # slaHelpers, priorityFromScore, csvExporter
│   └── app.js        # Express app, middleware chain, route mounting
├── migrations/       # numbered .sql files — the schema source of truth
├── scripts/          # migrate.js
├── tests/            # unit + integration (Jest)
├── server.js         # HTTP server + Socket.IO attach + listen
└── SEED_ADMIN.md     # seeded admin logins
```

---

## API surface

Mounted in `src/app.js`. All user routes take `Authorization: Bearer <Supabase
access token>`; scheduled routes take `Authorization: Bearer <CRON_SECRET>`.
Responses are JSON. The per-endpoint reference lives in
[HIGH_LEVEL_DESIGN.md](../HIGH_LEVEL_DESIGN.md); the routers are the authority.

| Mount | Router | Covers |
|---|---|---|
| `/api/inspections` | `inspections.js` | Core records — create, list/filter, status board, assign, close |
| `/api/my-reports` | `myReports.js` | A resident's own submissions |
| `/api/lifts` | `lifts.js` | Lift register (inspector) |
| `/api/checklist-items` | `checklistItems.js` | Spot-check checklist template |
| `/api/contractors` | `contractors.js` | Contractor directory (manager) |
| `/api/contractor` | `contractor.js` | Contractor portal — assigned work, hold/resume |
| `/api/users` | `users.js` | `GET /me`, inspector picker |
| `/api/analytics` | `analytics.js` | Heatmap, trends, SLA, scorecard, priority queue (manager) |
| `/api/recommendations` | `recommendations.js` | AI risk alerts + the analysis run |
| `/api/export` | `export.js` | PPTX export (manager, admin) |
| `/api/cv` | `cv.js` | Roboflow detections, dismissal, batch rescan |
| `/api/notifications` | `notifications.js` | Send, list, mark read |
| `/api/admin/vendors` | `vendors.js` | UC-012 vendor lifecycle (admin) |
| `/api/reports` | `reports.js` | PDF generation + listing |
| `/api/admin` | `admin.js` | UC-011 cost analytics (admin) |
| `/api/contacts` | `contacts.js` | Estate + emergency contact directory |
| `/health` | `app.js` | Liveness check (UptimeRobot) |

`/api/admin/vendors` is mounted **before** `/api/admin` so the more specific
vendor router matches first.

Scheduled notification dispatch is not an HTTP endpoint — it runs in-process via
`utils/notificationDispatcher.js` on a 60-second `setInterval` loop.

### Error format

Every error returns the same shape:

```json
{ "code": "ERROR_CODE", "message": "Human-readable message" }
```

Common codes: `UNAUTHORIZED` (401, missing/invalid token), `FORBIDDEN` (403, role
lacks access), `ACCOUNT_SUSPENDED` (403), `VALIDATION_ERROR` (400),
`NOT_FOUND` (404), `EMAIL_ALREADY_EXISTS` (409), `SERVER_ERROR` (500). Feature
routes add their own — the UC-012 set is tabulated in the root README.

---

## Database

Raw parameterised SQL over the `pg` Pool — **no ORM**. The numbered files in
`migrations/` are the source of truth for the schema; `scripts/migrate.js` applies
every file in filename order, each in its own transaction, and replays them all on
every run (there is no applied-migrations ledger), so **every migration must be
idempotent**.

18 tables: `users`, `contractors`, `lifts`, `inspections`, `inspection_history`,
`checklist_items`, `checklist_results`, `signatures`, `cv_detections`,
`ai_predictions`, `ai_jobs`, `notifications`, `notification_recipients`,
`reports`, `retry_queue`, `vendor_history`, `defect_email_log`,
`contact_directory`.

(`feedback` was created by `036` and dropped again by `044` when the feedback
form was removed; `036` stays because `040` reads the table while deciding
whether a vendor login is safe to delete.)

`inspections` is the core table; a `source_type` discriminator
(`resident_complaint` | `lift_inspection`) separates resident-filed defects from
scheduled lift spot-checks.

Seed accounts and demo data are covered in the root README; admin logins are in
[SEED_ADMIN.md](./SEED_ADMIN.md).

---

## Security

- Supabase Auth token verification on every authenticated route; `requireRole(...)`
  for role gating. Enforcement is server-side — UI role checks are convenience only.
- `cronGuard` validates `CRON_SECRET` on scheduled endpoints.
- `helmet` security headers (also drops `x-powered-by`).
- CORS restricted to `FRONTEND_URL`, for both Express and Socket.IO.
- `express.json` / `urlencoded` capped at 1 MB.
- `express-rate-limit` applied across all routes.
- All SQL is parameterised; request input is validated in the controller before
  any query runs.

---

## Deployment (Render)

**Live:** the deployed frontend at https://fsad-project-pied.vercel.app talks to
this backend on Render.

1. Create a Render Web Service from this repo.
2. Start command: `node server.js`.
3. Add the environment variables above; set `FRONTEND_URL` to the deployed Vercel URL.
4. Point an UptimeRobot HTTP(s) monitor at `/health` (5-minute interval) to avoid
   free-tier cold starts.

### Scheduled jobs

GitHub Actions workflows call the cron-guarded endpoints, with `CRON_SECRET` and
the Render backend URL stored as repo secrets. Each supports `workflow_dispatch`
for manual runs.

| Workflow | Drives |
|---|---|
| `contract-expiry-check.yml` | UC-012 vendor contract expiry sweep |
| `cv-batch-scan.yml` | Reprocess failed images from `retry_queue` |
| `defect-alert.yml` | Defect-assignment email alerts |
| `monthly-report.yml` | UC-009 report generation + delivery |
| `overdue-defect-chase.yml` | Chase-up on overdue defects |
