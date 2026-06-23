# PROJECT_IMPLEMENTATION_PHASES.md
# Estate Incident Management System — Phase Plan

---

## Table of Contents

1. [Timeline Overview](#1-timeline-overview)
2. [Phase Dependencies](#2-phase-dependencies)
3. [Phase 1 — Foundation: Auth + Database + DevOps](#3-phase-1--foundation-auth--database--devops)
4. [Phase 2 — Core: Incident CRUD + Real-Time + CV Pipeline](#4-phase-2--core-incident-crud--real-time--cv-pipeline)
5. [Phase 3 — Intelligence: Analytics + AI Engine + Reports](#5-phase-3--intelligence-analytics--ai-engine--reports)
6. [Phase 4 — Polish: Notifications + UX + Testing + Demo Prep](#6-phase-4--polish-notifications--ux--testing--demo-prep)
7. [Definition of Done (All Phases)](#7-definition-of-done-all-phases)
8. [Risk Register](#8-risk-register)

---

## 1. Timeline Overview

```
Week 1         Week 2         Week 3         Week 4         Week 5         Week 6
│──────────────│──────────────│──────────────│──────────────│──────────────│──────────────│
│  PHASE 1     │  PHASE 1     │  PHASE 2     │  PHASE 2     │  PHASE 3     │  PHASE 4     │
│  Foundation  │  Foundation  │  Core        │  Core        │  Intelligence│  Polish      │
│  (Philena)   │  (Philena)   │  (Philena +  │  (Mahdiya +  │  (Hasini +   │  (All)       │
│              │              │   Mahdiya +  │   Zoe)       │   Davian)    │              │
│              │              │   Zoe)       │              │              │              │
│──────────────│──────────────│──────────────│──────────────│──────────────│──────────────│
│  UC-auth     │  UC-auth     │  UC-001      │  UC-007      │  UC-005      │  UC-008      │
│  DB setup    │  done ✓      │  UC-002      │  CV pipeline │  UC-006      │  Final tests │
│  Supabase    │  Vercel +    │  UC-003 (Zoe)│  Roboflow    │  UC-009      │  UptimeRobot │
│  migrations  │  Render      │  UC-004      │              │  Chart.js    │  Demo dry run│
│              │  deployed    │              │              │  GitHub Cron │              │
```

| Phase | Weeks | Owner(s) | Use Cases Covered |
|-------|-------|---------|-------------------|
| 1 — Foundation | 1–2 | Philena | Auth/JWT, DB schema, DevOps setup |
| 2 — Core | 3–4 | Philena (UC-001–004) · Mahdiya (UC-007) · **Zoe (UC-003, parallel)** | UC-001, UC-002, UC-003, UC-004, UC-007 |
| 3 — Intelligence | 5 | Hasini + Davian | UC-005, UC-006, UC-009 |
| 4 — Polish | 6 | All | UC-008, integration testing, demo prep |

---

## 2. Phase Dependencies

```
Phase 1: Foundation (critical path — blocks everything)
├── Phase 2: Core (depends on Phase 1 — needs auth middleware + DB)
│   ├── Phase 3: Intelligence (depends on Phase 2 — needs incident data to analyse)
│   │   └── Phase 4: Polish (depends on Phases 1–3 — integration + notifications)
│   └── UC-007 CV Pipeline (can run parallel with UC-001–004 once Phase 1 done)
└── DevOps (Vercel + Render deploy happens at end of Phase 1 week 2)
```

**Critical path:** Phase 1 Week 1 completion (auth routes + Supabase running) is the gate for everything else. If this slips, the entire team is blocked. Philena must complete the JWT middleware and DB connection before Week 2.

---

## 3. Phase 1 — Foundation: Auth + Database + DevOps

**Owner:** Philena  
**Duration:** Weeks 1–2  
**Goal:** A deployed, authenticated backend that every other team member can build on. No frontend yet — Postman/curl only.

### 3.1 Objectives

- Supabase PostgreSQL connected and all 10 migration files run
- Register, login, and logout endpoints live on Render
- JWT middleware protecting routes by role (`resident` / `manager`)
- React app shell deployed on Vercel (blank, with auth context)
- GitHub repo, branch strategy, `.env.example` documented

### 3.2 Week 1 Tasks

#### Backend (Philena)

| # | Task | File(s) | Notes |
|---|------|---------|-------|
| 1.1 | Set up Node.js + Express project | `server.js`, `src/app.js`, `package.json` | Install: `express`, `pg`, `jsonwebtoken`, `bcrypt`, `cors`, `dotenv`, `multer`, `cloudinary`, `express-rate-limit`, `joi` |
| 1.2 | Configure Supabase connection | `src/config/db.js` | Use `pg` Pool; test with a ping query on startup |
| 1.3 | Run all 10 SQL migrations | `migrations/001–010_*.sql` | Run in order in Supabase SQL editor; verify tables exist |
| 1.4 | Create `users` model | `src/models/userModel.js` | `findByEmail()`, `create()`, `findById()` |
| 1.5 | Implement `authController.js` | `src/controllers/authController.js` | `register()` with bcrypt, `login()` returning JWT, `logout()` |
| 1.6 | Create auth routes | `src/routes/auth.js` | `POST /api/auth/register`, `/login`, `/logout` |
| 1.7 | Build JWT middleware | `src/middleware/auth.js` | `verifyJWT()` — attaches `req.user`; `requireRole('manager')` |
| 1.8 | Build cron guard middleware | `src/middleware/cronGuard.js` | Validates `Authorization: Bearer <CRON_SECRET>` |
| 1.9 | Build global error handler | `src/middleware/errorHandler.js` | Returns `{ code, message }` for all unhandled errors |
| 1.10 | Add `/health` route | `src/routes/health.js` | Returns `{ status: "ok", timestamp }` — needed for UptimeRobot |
| 1.11 | Configure environment variables | `src/config/env.js`, `.env.example` | Validate all required vars on startup; throw if missing |
| 1.12 | Rate limiting on auth routes | `src/middleware/rateLimiter.js` | 100 req / 15 min per IP |

#### Frontend (Philena — Week 1 end)

| # | Task | File(s) | Notes |
|---|------|---------|-------|
| 1.13 | Scaffold React app with Vite | `frontend/` | `npm create vite@latest` with React template |
| 1.14 | Create `AuthContext` | `src/context/AuthContext.jsx` | Stores JWT in memory; provides `login()`, `logout()`, `user` |
| 1.15 | Build `LoginForm.jsx` | `src/components/auth/LoginForm.jsx` | Calls `POST /api/auth/login`; stores token in context |
| 1.16 | Create `api.js` axios instance | `src/services/api.js` | `baseURL = import.meta.env.VITE_API_URL`; attach JWT header |
| 1.17 | Add protected route wrapper | `src/App.jsx` | Redirects to `/login` if no token in context |

### 3.3 Week 2 Tasks — Deploy + Validate

| # | Task | File(s) | Notes |
|---|------|---------|-------|
| 2.1 | Deploy backend to Render | Render dashboard | Set all env vars; `node server.js` start command |
| 2.2 | Deploy frontend to Vercel | Vercel dashboard | Set `VITE_API_URL` to Render backend URL |
| 2.3 | Configure CORS on backend | `src/app.js` | `origin: process.env.FRONTEND_URL` |
| 2.4 | Configure Socket.IO CORS | `src/config/socket.js` | Separate from Express CORS — `new Server(httpServer, { cors: { origin: FRONTEND_URL } })` |
| 2.5 | Set up UptimeRobot monitor | UptimeRobot.com | Monitor type: HTTP(s), URL: `/health`, interval: 5 min |
| 2.6 | Set up GitHub repo + branch strategy | `.github/` | `main` (protected), `dev`, feature branches per member |
| 2.7 | Write Phase 1 unit tests | `tests/unit/auth.test.js` | See test cases below |
| 2.8 | Write `.env.example` | Root of both repos | All vars with placeholder values — no secrets |
| 2.9 | Write Phase 1 section of README | `README.md` | Local setup, deploy steps, public URL |

### 3.4 Phase 1 Test Cases

| Test ID | Input | Expected Output |
|---------|-------|----------------|
| AUTH-T01 | `POST /auth/register` with valid data | 201, user object returned, password not in response |
| AUTH-T02 | `POST /auth/register` with duplicate email | 400, `EMAIL_ALREADY_EXISTS` |
| AUTH-T03 | `POST /auth/login` with correct credentials | 200, JWT token present, `user.role` correct |
| AUTH-T04 | `POST /auth/login` with wrong password | 401, `INVALID_CREDENTIALS` |
| AUTH-T05 | `POST /auth/login` with unknown email | 401, `INVALID_CREDENTIALS` (same code — no enumeration) |
| AUTH-T06 | `GET /api/incidents` with no JWT | 401, `UNAUTHORIZED` |
| AUTH-T07 | `GET /api/incidents` with resident JWT | 403, `FORBIDDEN` (manager-only route) |
| AUTH-T08 | `GET /api/incidents` with valid manager JWT | 200 (even if empty array) |
| AUTH-T09 | `GET /health` with no auth | 200, `{ status: "ok" }` |
| AUTH-T10 | Cron route with wrong secret | 401, `UNAUTHORIZED` |

### 3.5 Phase 1 Definition of Done

- [ ] All 10 migration tables exist in Supabase
- [ ] `POST /auth/register`, `/login`, `/logout` return correct responses
- [ ] JWT middleware blocks unauthenticated requests to protected routes
- [ ] Role middleware blocks residents from manager routes
- [ ] Backend live on Render at `https://your-app.onrender.com`
- [ ] Frontend login form live on Vercel — successful login stores token in memory
- [ ] `/health` endpoint returns 200 (UptimeRobot monitor active)
- [ ] All 10 auth test cases pass
- [ ] `.env.example` committed with all variable names
- [ ] README documents local setup and public URLs

---

## 4. Phase 2 — Core: Incident CRUD + Real-Time + CV Pipeline

**Owners:** Philena (UC-001–004) · Mahdiya (UC-007) · Zoe (UC-003, parallel)  
**Duration:** Weeks 3–4  
**Goal:** The full incident lifecycle works end-to-end: resident reports → manager assigns → status updates pushed in real time → CV auto-detects defects.

> **Zoe's parallel track:** Zoe works on UC-003 (resident real-time status tracker) in parallel during Phase 2. Philena builds the page shell and REST data fetching for `MyReportsPage.jsx` (task 3.11); Zoe owns the entire Socket.IO real-time subscription layer — the `SocketContext`, room-join logic, live status update rendering, and satisfaction rating flow. This split avoids merge conflicts: Philena touches the REST side, Zoe touches the socket side of the same page. They integrate at the end of Week 3.

### 4.1 Objectives

- Resident can submit an incident with photo (Cloudinary) and receive AI categorisation (OpenAI)
- Manager can view, prioritise, assign, and close incidents
- Resident can track status live via Socket.IO (UC-003 — Zoe)
- Roboflow CV pipeline processes uploaded photos and creates auto-detected tickets

### 4.2 Week 3 Tasks — Philena: UC-001 to UC-004

| # | Task | File(s) | Notes |
|---|------|---------|-------|
| 3.1 | Implement Cloudinary service | `src/services/cloudinaryService.js` | `uploadImage(buffer, folder)` — uploads to `/defects` or `/reports` |
| 3.2 | Implement OpenAI categorisation service | `src/services/openaiService.js` | `categoriseIncident(title, description)` — returns `{ category, priority_score }` |
| 3.3 | Implement `incidentModel.js` | `src/models/incidentModel.js` | `create()`, `findAll()`, `findById()`, `findByResident()`, `updateStatus()`, `softDelete()` |
| 3.4 | Implement Socket.IO service | `src/services/socketService.js` | `emitToRoom(room, event, data)` — wraps `io.to(room).emit()` |
| 3.5 | Implement `incidentController.js` | `src/controllers/incidentController.js` | Full CRUD + close + rating — see UC-001 to UC-004 flows |
| 3.6 | Implement duplicate detection | Inside `incidentController.create()` | Same `resident_id + title` within 2 minutes → 409 |
| 3.7 | Create incident routes | `src/routes/incidents.js` | All 7 incident endpoints — see API spec §6.2 |
| 3.8 | Frontend: `ReportIssuePage.jsx` | `src/pages/ReportIssuePage.jsx` | Title, description, location dropdowns, photo picker, inline preview |
| 3.9 | Frontend: `IncidentListPage.jsx` | `src/pages/IncidentListPage.jsx` | Table sorted by `ai_priority_score` desc; filter controls |
| 3.10 | Frontend: `IncidentDetailPage.jsx` | `src/pages/IncidentDetailPage.jsx` | Full detail view; status dropdown; audit log; close with remark |
| 3.11 | Frontend: `MyReportsPage.jsx` — REST layer | `src/pages/MyReportsPage.jsx` | Resident cards fetched from `GET /incidents/my`; displayed as status cards; star rating UI skeleton. **Zoe wires the Socket.IO layer (task Z.3) into this page.** |

### 4.3 Week 3 Tasks — Zoe: UC-003 Real-Time Subscription Layer

> Zoe works from the same Phase 1 base as Philena. She needs the `incidentController.js` and socket service from tasks 3.4–3.5 to exist before she can wire the live subscription — coordinate with Philena at start of Week 3.

| # | Task | File(s) | Notes |
|---|------|---------|-------|
| Z.1 | Implement `SocketContext.jsx` | `src/context/SocketContext.jsx` | Initialises the Socket.IO client connection using `VITE_API_URL`; exposes `socket`, `joinRoom(roomId)`, `leaveRoom(roomId)` via context |
| Z.2 | Implement manager-room join logic | `src/context/SocketContext.jsx` | On login, if `user.role === 'manager'`, call `socket.emit('join', 'manager-room')` |
| Z.3 | Wire Socket.IO live update into `MyReportsPage.jsx` | `src/pages/MyReportsPage.jsx` | When resident opens an incident detail, call `joinRoom('incident-{id}')`. Listen for `status_update` event → update displayed status and audit log without page reload |
| Z.4 | Handle reconnection on network drop | `src/context/SocketContext.jsx` | On disconnect, show subtle "Live updates paused — reconnecting…" banner; auto-retry every 5 s using Socket.IO's built-in reconnection config |
| Z.5 | Satisfaction rating submission | `src/pages/MyReportsPage.jsx` | When status is `Resolved`, render star rating component (1–5); call `POST /incidents/:id/rating`; disable button after successful submission to prevent duplicate (UC-003 Alt Flow B) |
| Z.6 | Empty state for no incidents | `src/pages/MyReportsPage.jsx` | If `GET /incidents/my` returns empty array, show `<EmptyState>` with "Report an Issue" button navigating to UC-001 page |
| Z.7 | Socket.IO test verification | Browser DevTools | Open WebSocket frames tab; confirm `status_update` event received when manager updates incident in another tab; document as screenshot in test evidence |

### 4.4 Week 4 Tasks — Mahdiya: UC-007 CV Pipeline

| # | Task | File(s) | Notes |
|---|------|---------|-------|
| 4.1 | Implement Roboflow service | `src/services/roboflowService.js` | `detectDefect(imageUrl)` — POSTs to Roboflow inference endpoint; returns predictions array |
| 4.2 | Implement `cvDetectionModel.js` | `src/models/cvDetectionModel.js` | `save()`, `findPendingRetry()`, `markProcessed()` |
| 4.3 | Implement `cvController.js` | `src/controllers/cvController.js` | `detect()` — evaluate confidence ≥ 0.70; create ticket; emit Socket.IO alert |
| 4.4 | Wire CV call into incident creation | `src/controllers/incidentController.js` | After Cloudinary upload, call `cvController.detect()` asynchronously |
| 4.5 | Implement retry queue logic | `src/controllers/cvController.js` | On Roboflow 429 → insert `retry_queue` row; on `batchScan()` → process pending rows |
| 4.6 | Create CV routes | `src/routes/cv.js` | `POST /cv/detect`, `GET /cv/batch-scan` |
| 4.7 | Frontend: `BoundingBoxOverlay.jsx` | `src/components/cv/BoundingBoxOverlay.jsx` | Canvas overlay drawn on top of `<img>` using bounding box coords from API |
| 4.8 | Frontend: Manual review queue | `src/pages/IncidentListPage.jsx` | Add "Needs Manual Review" tab showing `cv_detections` with `low_confidence` status |
| 4.9 | Write Phase 2 unit tests | `tests/unit/incidents.test.js`, `cv.test.js` | See test cases below |

### 4.4 Phase 2 Test Cases

| Test ID | Input | Expected Output |
|---------|-------|----------------|
| INC-T01 | `POST /incidents` with valid form-data + photo | 201, incident ID, `category` set by OpenAI, `photo_url` is Cloudinary URL |
| INC-T02 | `POST /incidents` missing `title` | 400, `VALIDATION_ERROR`, `fields: ["title"]` |
| INC-T03 | Duplicate incident same resident within 2 min | 409, `DUPLICATE_SUBMISSION`, existing ID returned |
| INC-T04 | `GET /incidents` as manager | 200, array sorted by `ai_priority_score` desc |
| INC-T05 | `GET /incidents/my` as resident | 200, only resident's own incidents |
| INC-T06 | `PATCH /incidents/:id` as manager — assign | 200, status `In Progress`, audit log entry created |
| INC-T07 | `POST /incidents/:id/close` — remark < 10 chars | 400, `VALIDATION_ERROR` |
| INC-T08 | `POST /incidents/:id/close` — valid remark | 200, `is_deleted: true`, `resolution_time_hours` populated |
| INC-T09 | `POST /incidents/:id/rating` twice | 409, `ALREADY_RATED` |
| INC-T10 | `GET /incidents/:id` after soft-delete (resident view) | 404, `NOT_FOUND` |
| CV-T01 | Roboflow returns confidence 0.87 | cv_detections row created, auto-incident created, Socket.IO emitted |
| CV-T02 | Roboflow returns confidence 0.54 | cv_detections row with `low_confidence`, no ticket created |
| CV-T03 | Roboflow returns 429 | Image queued in `retry_queue`, manager not notified yet |
| CV-T04 | `GET /cv/batch-scan` with 2 pending | Both processed, response `{ processed: 2 }` |

### 4.5 Phase 2 Definition of Done

- [ ] Resident can submit an incident with photo — Cloudinary URL stored, OpenAI category set
- [ ] Manager sees incidents sorted by AI priority, can assign and close
- [ ] Resident sees live status update without page refresh — Socket.IO `status_update` event confirmed in DevTools (Zoe)
- [ ] Satisfaction rating submits successfully on resolved incident; duplicate blocked (Zoe)
- [ ] Roboflow processes uploaded photos — auto-tickets created for confidence ≥ 70%
- [ ] Low-confidence detections appear in manager's manual review queue
- [ ] All 14 test cases in §4.4 plus UC-003 Socket.IO verification (task Z.7) pass
- [ ] Bounding box overlay renders on incident detail photo
- [ ] Philena's REST layer and Zoe's Socket.IO layer are integrated on `main` branch with no merge conflicts

---

## 5. Phase 3 — Intelligence: Analytics + AI Engine + Reports

**Owners:** Hasini (UC-005) · Davian (UC-006, UC-009)  
**Duration:** Week 5  
**Goal:** Managers gain data-driven insights — heatmap, SLA gauge, AI risk alerts, and automated weekly PDF reports.

### 5.1 Objectives

- Analytics dashboard with three Chart.js visualisations and real-time filter controls
- Nightly AI velocity analysis surfacing risk alerts on the dashboard
- Weekly PDF report generated by pdfkit, stored on Cloudinary, emailed via Nodemailer
- All three GitHub Actions workflow YAML files committed and tested

### 5.2 Week 5 Tasks — Hasini: UC-005 Analytics

| # | Task | File(s) | Notes |
|---|------|---------|-------|
| 5.1 | Implement `analyticsController.js` | `src/controllers/analyticsController.js` | `getHeatmap()`, `getTrends()`, `getSlaCompliance()` — all accept `?from&to&block&category` query params |
| 5.2 | Implement SLA compliance query | `src/controllers/analyticsController.js` | Count incidents where `resolution_time_hours ≤ target_resolution_hrs`; express as % |
| 5.3 | Implement priority queue query | `src/controllers/analyticsController.js` | Composite score = `(ai_priority_score × 0.5) + (recency_days × 0.3) + (frequency_score × 0.2)` |
| 5.4 | Create analytics routes | `src/routes/analytics.js` | `GET /analytics/issues-by-block`, `/trends`, `/sla-compliance` |
| 5.5 | Frontend: `DashboardPage.jsx` | `src/pages/DashboardPage.jsx` | Three Chart.js charts + AI alert cards + priority queue table |
| 5.6 | Frontend: `HeatmapChart.jsx` | `src/components/analytics/HeatmapChart.jsx` | Chart.js matrix plugin; colour-coded by count intensity |
| 5.7 | Frontend: `TrendLineChart.jsx` | `src/components/analytics/TrendLineChart.jsx` | Chart.js line chart, X = date, Y = count |
| 5.8 | Frontend: `SlaGauge.jsx` | `src/components/analytics/SlaGauge.jsx` | Chart.js doughnut; percentage label in centre |
| 5.9 | Frontend: Filter controls | `src/pages/DashboardPage.jsx` | Block / date range / category dropdowns; re-fetch all 3 endpoints on change |
| 5.10 | Frontend: CSV export | `src/utils/csvDownload.js` | Client-side — converts priority queue JSON to CSV and triggers download |
| 5.11 | Frontend: Heatmap drill-down | `src/components/analytics/HeatmapChart.jsx` | onClick → navigate to `/incidents?block=X&category=Y` |
| 5.12 | Frontend: `AIAlertCard.jsx` | `src/components/analytics/AIAlertCard.jsx` | Amber card showing alert text, Accept / Dismiss buttons |
| 5.13 | Wire AI alerts to dashboard | `src/pages/DashboardPage.jsx` | Fetch `GET /api/recommendations` (active only) above heatmap |

### 5.3 Week 5 Tasks — Davian: UC-006 + UC-009

| # | Task | File(s) | Notes |
|---|------|---------|-------|
| 5.14 | Implement velocity calculator | `src/utils/velocityCalculator.js` | `calculateVelocity(block, category, db)` → `{ count_last_30, count_prior_30, velocity_pct }` |
| 5.15 | Implement `openaiService.generateRiskAlert()` | `src/services/openaiService.js` | Prompt: given block, category, velocity — return max-60-word plain-language alert |
| 5.16 | Implement `recommendationController.runAnalysis()` | `src/controllers/recommendationController.js` | Step 1: query `ai_jobs` WHERE `status = 'pending'` and process those block+category pairs first. Step 2: run velocity analysis across all pairs. Step 3: generate OpenAI alerts for pairs ≥ 40% velocity. Step 4: mark processed `ai_jobs` rows as `processed`. This ensures blocks that hit the recurrence threshold in UC-004 are always picked up. |
| 5.17 | Implement `recommendationController.listAlerts()` | `src/controllers/recommendationController.js` | `listAlerts()` — queries `ai_predictions` WHERE `status = ?` (default `Active`); used by the dashboard on page load |
| 5.18 | Implement accept / dismiss actions | `src/controllers/recommendationController.js` | `acceptAlert()` creates maintenance ticket; `dismissAlert()` logs timestamp |
| 5.19 | Create recommendation routes | `src/routes/recommendations.js` | `GET /recommendations` (list active alerts — manager JWT), `GET /recommendations/run` (cron secret), `POST /:id/accept` (manager JWT), `POST /:id/dismiss` (manager JWT) |
| 5.20 | Implement `openaiService.generateSummary()` | `src/services/openaiService.js` | For weekly report — max 80 words, key findings + recommendation |
| 5.21 | Implement `pdfService.buildWeeklyReport()` | `src/services/pdfService.js` | pdfkit: title, date range, executive summary, aggregated data tables |
| 5.22 | Implement `emailService.sendReportEmail()` | `src/services/emailService.js` | Nodemailer SMTP; subject = "Weekly Estate Report — [dates]"; body includes Cloudinary PDF URL |
| 5.23 | Implement `reportController.generateReport()` | `src/controllers/reportController.js` | Full pipeline: query → aggregate → OpenAI → pdfkit → Cloudinary → DB row → email |
| 5.24 | Create report routes | `src/routes/reports.js` | `GET /reports/generate` (cron), `POST /reports/generate-manual` (manager JWT), `GET /reports` |
| 5.25 | Frontend: `ReportsArchivePage.jsx` | `src/pages/ReportsArchivePage.jsx` | List of reports with Cloudinary PDF links + generated date |
| 5.26 | Write all 3 GitHub Actions YAMLs | `.github/workflows/` | See YAML specs below |
| 5.27 | Test GitHub Actions manual trigger | GitHub Actions tab | `workflow_dispatch` on each workflow; verify backend receives call |

### 5.4 GitHub Actions YAML Files + Notification Dispatch

> Two GitHub Actions workflows are needed. Scheduled notification dispatch is handled server-side (see File 3 below) to avoid consuming GitHub Actions free minutes.

**File 1: `.github/workflows/nightly-recommendations.yml`**
```yaml
name: Nightly AI Recommendations
on:
  schedule:
    - cron: '0 18 * * *'     # 02:00 SGT = 18:00 UTC
  workflow_dispatch:
jobs:
  trigger:
    runs-on: ubuntu-latest
    steps:
      - name: Call recommendation endpoint
        run: |
          curl -X GET "${{ secrets.RENDER_BACKEND_URL }}/api/recommendations/run" \
            -H "Authorization: Bearer ${{ secrets.CRON_SECRET }}" \
            --fail --max-time 30
```

**File 2: `.github/workflows/weekly-report.yml`**
```yaml
name: Weekly PDF Report
on:
  schedule:
    - cron: '0 23 * * 0'     # 07:00 SGT Monday = 23:00 UTC Sunday
  workflow_dispatch:
jobs:
  trigger:
    runs-on: ubuntu-latest
    steps:
      - name: Generate weekly report
        run: |
          curl -X GET "${{ secrets.RENDER_BACKEND_URL }}/api/reports/generate" \
            -H "Authorization: Bearer ${{ secrets.CRON_SECRET }}" \
            --fail --max-time 60
```

**File 3: Backend self-dispatch — `src/utils/notificationDispatcher.js`**

> **Revised approach — do not use GitHub Actions for scheduled notifications.**  
> A GitHub Actions workflow running every 5 minutes would fire ~288 times/day, consuming approximately 576–1,440 free minutes/month on a private repo (each run takes 1–2 minutes of runner time, accounting for startup overhead). This leaves almost no headroom against GitHub's 2,000 free-minute limit, and the budget would be entirely consumed if the run takes slightly longer than average. Instead, the backend dispatches notifications internally using a lightweight `setInterval` loop that runs inside the Express process itself. Since UptimeRobot already keeps the Render service warm 24/7, the interval fires reliably without any external scheduler.

```javascript
// src/utils/notificationDispatcher.js
// Called once on server startup from server.js

const { dispatchDueNotifications } = require('../controllers/notificationController');

function startNotificationDispatcher() {
  const INTERVAL_MS = 60 * 1000; // check every 60 seconds
  setInterval(async () => {
    try {
      await dispatchDueNotifications();
    } catch (err) {
      console.error('[notificationDispatcher] Error:', err.message);
    }
  }, INTERVAL_MS);
  console.log('[notificationDispatcher] Started — checking every 60 s');
}

module.exports = { startNotificationDispatcher };
```

```javascript
// server.js — add after socket.io setup
const { startNotificationDispatcher } = require('./src/utils/notificationDispatcher');
startNotificationDispatcher();
```

**`notificationController.dispatchDueNotifications()`** queries `notifications` WHERE `status = 'Scheduled'` AND `send_time <= NOW()`, emits the Socket.IO broadcast for each, and sets `status = 'Sent'`. This is identical logic to the old dispatch endpoint — only the trigger changes from GitHub Actions to `setInterval`.

> **Note for task 5.26:** Remove `scheduled-notifications.yml` from the GitHub Actions workflows to be written. Only two YAML files are needed: `nightly-recommendations.yml` and `weekly-report.yml`. The notification dispatch is handled server-side.

> **Latency expectation:** Scheduled notifications may fire up to 60 seconds late (the `setInterval` polling window). Display this in the UI: "Scheduled notifications are sent within 1 minute of the selected time." This is significantly better than the 5-minute GitHub Actions approach.

> **Note:** Inform users that scheduled notifications may fire up to 60 seconds late. Display this on the scheduled send confirmation dialog.

> **GitHub Actions minutes budget (private repo):**  
> With only the two remaining workflows (nightly at 02:00 SGT + weekly Monday at 07:00 SGT), total monthly runs = 30 (nightly) + 4 (weekly) = 34 runs. At ~1–2 minutes each, that is 34–68 minutes/month — well within the 2,000 free-minute limit. Budget is safe.

### 5.5 Phase 3 Test Cases

| Test ID | Input | Expected Output |
|---------|-------|----------------|
| ANA-T01 | `GET /analytics/issues-by-block` manager auth | 200, array of `{ block, category, count }` |
| ANA-T02 | Same endpoint with `?block=44A` filter | 200, only rows where `block = "44A"` |
| ANA-T03 | `GET /analytics/sla-compliance` | 200, `sla_percentage` between 0 and 100 |
| ANA-T04 | CSV export button with data | CSV file download triggered; first row = column headers |
| ANA-T05 | CSV export with empty filter result | Button disabled, tooltip shown |
| REC-T01 | `GET /recommendations/run` with valid cron secret | 200, `alerts_generated` ≥ 0 |
| REC-T02 | Same endpoint with wrong secret | 401, `UNAUTHORIZED` |
| REC-T03 | Block+category with < 3 incidents in last 30 days | Skipped, not included in response alerts |
| REC-T04 | `POST /recommendations/:id/accept` | 201, maintenance incident created with `source_flag: "AI-Generated"` |
| REC-T05 | `POST /recommendations/:id/dismiss` | 200, `dismissed_at` timestamp set |
| RPT-T01 | `GET /reports/generate` with valid cron secret | 200, `report_url` is Cloudinary URL, `email_delivered: true` |
| RPT-T02 | OpenAI fails during report generation | 200, fallback template summary used, report still delivered |
| RPT-T03 | `POST /reports/generate-manual` with manager JWT | 201, `triggered_by: "manual"` |
| RPT-T04 | `GET /reports` | 200, array of report records with `report_url` links |

### 5.6 Phase 3 Definition of Done

- [ ] Three Chart.js charts render on dashboard with real data
- [ ] Filter controls (block/date/category) update all charts without page reload
- [ ] AI alert cards appear on dashboard, Accept and Dismiss work
- [ ] Velocity analysis correctly skips pairs with < 3 incidents
- [ ] Weekly PDF contains: title, date range, executive summary, data tables
- [ ] PDF stored in Cloudinary `/reports`, URL in `reports` table
- [ ] Manager receives email with PDF link (test with real SMTP)
- [ ] All 3 GitHub Actions workflows fire successfully on `workflow_dispatch`
- [ ] All 14 test cases above pass

---

## 6. Phase 4 — Polish: Notifications + UX + Testing + Demo Prep

**Owners:** All members  
**Duration:** Week 6  
**Goal:** UC-008 complete, all error states handled, mobile-responsive, all tests passing, demo rehearsed.

### 6.1 Objectives

- Manager can send and schedule block-scoped Socket.IO notifications (UC-008)
- All error states handled gracefully with user-friendly messages
- Mobile-responsive layouts (Bootstrap / Tailwind utility classes)
- Full end-to-end integration test run
- Demo narrative prepared and dry-run completed

### 6.2 Week 6 Tasks

| # | Task | Owner | File(s) | Notes |
|---|------|-------|---------|-------|
| 6.1 | Implement `notificationController.js` | Zoe | `src/controllers/notificationController.js` | `send()`, `dispatchDueNotifications()` (called by server-side setInterval, not a cron endpoint), `markRead()`, `getReceipts()` |
| 6.2 | Implement `notificationDispatcher.js` | Zoe | `src/utils/notificationDispatcher.js` | `startNotificationDispatcher()` — setInterval 60 s loop calling `dispatchDueNotifications()`. Start it in `server.js` on boot. See Phase 3 §5.4 for full code. |
| 6.3 | Create notification routes | Zoe | `src/routes/notifications.js` | `POST /notifications`, `GET /notifications/:id/receipts`, `PATCH /notifications/:id/read` — note: no `/dispatch` route needed (server-side now) |
| 6.4 | Frontend: `NotificationsPage.jsx` | Zoe | `src/pages/NotificationsPage.jsx` | Scope selector, message composer, urgency dropdown, datetime picker |
| 6.5 | Frontend: `ReadReceiptBadge.jsx` | Zoe | `src/components/notifications/ReadReceiptBadge.jsx` | Polls `GET /api/notifications/:id/receipts` every 30 s |
| 6.6 | Frontend: resident notification banner | Zoe | `src/components/common/Header.jsx` | Bell icon; Socket.IO event on notification arrival; mark-as-read button |
| 6.7 | Add Toast component for all errors | All | `src/components/common/Toast.jsx` | Display all E1–E4 error cases from use cases as dismissable toasts |
| 6.8 | Add EmptyState component | All | `src/components/common/EmptyState.jsx` | Used by MyReports, IncidentList, Analytics when no data |
| 6.9 | Add loading spinners | All | `src/components/common/LoadingSpinner.jsx` | All data-fetching routes show spinner before first data arrives |
| 6.10 | Mobile responsiveness pass | All | All page components | Ensure all pages usable on 375px width; test in DevTools |
| 6.11 | Integration test run | Philena | `tests/integration/` | Full flow: register → login → submit incident → assign → close → report |
| 6.12 | Fix all failing tests | All | Various | Zero test failures before demo |
| 6.13 | Verify UptimeRobot active | Philena | UptimeRobot dashboard | Confirm monitor is green; no cold starts in last 24 hrs |
| 6.14 | Update README with final URLs | Philena | `README.md` | Live Vercel URL, live Render URL, local setup steps |
| 6.15 | Demo script + slide narrative | All | — | See demo flow below |
| 6.16 | Demo dry-run × 2 | All | — | Full end-to-end in front of tutor or peer; time the demo |

### 6.3 Phase 4 Test Cases

| Test ID | Input | Expected Output |
|---------|-------|----------------|
| NOT-T01 | `POST /notifications` — immediate send | 201, Socket.IO broadcast received by resident browser |
| NOT-T02 | `POST /notifications` — scheduled future time | 201, status `Scheduled`; not broadcast immediately |
| NOT-T03 | Scheduled notification — wait 60 s after `send_time` | Server-side dispatcher fires; resident browser receives Socket.IO broadcast without any manual trigger |
| NOT-T04 | `PATCH /notifications/:id/read` as resident | 200, `read: true` returned |
| NOT-T05 | `GET /notifications/:id/receipts` | 200, `read_count` increments after resident marks read |
| INT-T01 | Full resident flow: register → login → submit → track live update | Status updates without page reload when manager assigns |
| INT-T02 | Full manager flow: login → view dashboard → assign → close with remark | Incident disappears from active queue after close |
| INT-T03 | CV flow: submit photo → bounding box visible on detail page | Overlay rendered within 5 s of submission |
| INT-T04 | AI flow: dashboard loads with active alert card | Accept creates maintenance ticket visible in incident list |

### 6.4 Demo Narrative (Final Review)

The demo should follow a **continuous user journey** — not a disconnected feature sequence. Assign each segment to one team member.

| Segment | Member | What to show | Duration |
|---------|--------|-------------|---------|
| 1. Resident reports issue | Philena | Login as resident → fill form → upload photo → submit → confirm CV bounding box visible | 3 min |
| 2. Manager receives and assigns | Philena | Login as manager → see real-time notification → open incident → override priority to Critical → assign to Electrical dept | 3 min |
| 3. Resident tracks live | Zoe | Resident view shows "In Progress" update without refresh → manager sends block advisory notification → resident receives it | 2 min |
| 4. CV auto-detection | Mahdiya | Upload a second photo → show Roboflow prediction → auto-ticket created → manager receives Socket.IO alert | 2 min |
| 5. Analytics dashboard | Hasini | Manager views heatmap → filters by Block 44A → drills into Lift category → accepts AI risk alert → maintenance ticket created | 3 min |
| 6. Weekly report | Davian | Trigger manual report → show PDF in Cloudinary → open PDF → show executive summary + data tables | 2 min |
| **Total** | | | **~15 min** |

---

## 7. Definition of Done (All Phases)

A phase is not complete until **all** of the following are true:

- [ ] All tasks in the phase task list are ticked off
- [ ] All test cases for that phase pass (`npm test` green)
- [ ] Code is merged to `main` via pull request with at least one peer review
- [ ] No credentials committed — `.env` in `.gitignore`, `.env.example` updated
- [ ] Relevant README section updated with any new setup steps
- [ ] Deployed version on Render / Vercel reflects the completed phase
- [ ] Feature demonstrated to at least one other team member before phase close

---

## 8. Risk Register

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| Phase 1 slips — whole team blocked | Medium | Critical | Philena prioritises JWT middleware and DB connection above all else in Week 1. Other members prepare their local environment and read API specs. |
| Roboflow confidence too low on demo photos | High | Medium | Pre-test with actual estate photos before Week 4 ends. Adjust confidence threshold to 0.60 if needed. Keep static demo image as fallback. |
| GitHub Actions workflow paused (60-day inactivity rule) | Low | Medium | Add a comment commit to the repo every 45 days. Document the `workflow_dispatch` manual trigger fallback in the README. |
| Render cold start during demo | Medium | High | UptimeRobot + `/health` ping prevents sleep. On demo day, manually load the app 10 min before the presentation to ensure it is warm. |
| Supabase free DB expiry | Low | Critical | Supabase free tier does **not** expire (unlike Render PostgreSQL). No action needed, but verify at project start. |
| OpenAI API rate limit during live demo | Low | Medium | Pre-run the AI endpoints the evening before to warm any caches. Have a seeded `ai_predictions` row ready in DB as a fallback for the dashboard demo. |
| Socket.IO connection drops during demo | Low | High | UptimeRobot keeps Render warm. Prepare a browser reload as immediate fallback — the REST API still shows correct data even without real-time push. |
| GitHub Actions scheduled notifications fire 5 min late | N/A — resolved | N/A | Notification dispatch moved to server-side `setInterval` (60 s interval). GitHub Actions no longer used for notifications. Only 2 workflows remain (nightly + weekly), consuming ~34–68 minutes/month — well within free limits. |
| GitHub Actions free-minute budget exhausted | Low | Medium | With 2 workflows (nightly + weekly), monthly usage is ~34–68 minutes vs 2,000 free. Even with retries, headroom is large. Monitor via GitHub's billing tab. If repo ever moves to private, verify the minute count monthly. |

---

*End of PROJECT_IMPLEMENTATION_PHASES.md*
