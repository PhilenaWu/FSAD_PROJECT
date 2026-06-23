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
