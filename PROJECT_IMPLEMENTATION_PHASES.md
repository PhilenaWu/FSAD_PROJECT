# PROJECT_IMPLEMENTATION_PHASES.md
# Lift Inspection & Estate Defect Management System — Phase Plan

> Problem statement: **4C-1** primary · **4C-2** secondary · **4D** thematic
> New in this revision: UC-010 (contractor portal), UC-011 (admin cost dashboard), UC-012 (vendor account lifecycle), UC-005 Data Playground extension, voice complaints, PowerPoint export, lift/contractor/checklist/signature domain.

---

## Table of Contents

1. [Timeline Overview](#1-timeline-overview)
2. [Phase Dependencies](#2-phase-dependencies)
3. [Phase 1 — Foundation: Auth + Database + DevOps](#3-phase-1--foundation-auth--database--devops)
4. [Phase 2 — Core: Inspection/Complaint capture + Real-Time + Contractor Portal + CV](#4-phase-2)
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
│  UC-auth     │  UC-auth     │  UC-001 voice│  UC-007      │  UC-005 +PPT │  UC-008      │
│  5 roles     │  done ✓      │  UC-002      │  CV re-tune  │  UC-006 +cost│  Final tests │
│  lifts/contr.│  Vercel +    │  UC-003 (Zoe)│  UC-010 (Zoe)│  UC-009      │  UptimeRobot │
│  DB migrations│ Render      │  UC-004 e-sign│  contractor  │  UC-011 admin│  Demo dry run│
│              │  deployed    │              │              │  GitHub Cron │              │
```

| Phase | Weeks | Owner(s) | Use Cases Covered |
|-------|-------|---------|-------------------|
| 1 — Foundation | 1–2 | Philena | Auth/JWT, DB schema, DevOps setup |
| 2 — Core | 3–4 | Philena (UC-001 incl. voice, 002, 004 e-sign) · Zoe (UC-003 + UC-010 contractor portal) · Mahdiya (UC-007) | UC-001, 002, 003, 004, 007, 010 |
| 3 — Intelligence | 5 | Hasini (UC-005 + PPT export + Data Playground + UC-011 UI + UC-012) · Davian (UC-006 + cost + UC-009 + UC-011 backend) | UC-005, 006, 009, 011, 012 |
| 4 — Polish | 6 | All | UC-008, integration testing, demo prep |

---

## 2. Phase Dependencies

```
Phase 1: Foundation (critical path — blocks everything)
├── Phase 2: Core (depends on Phase 1 — needs auth middleware + DB)
│   ├── Phase 3: Intelligence (depends on Phase 2 — needs inspection data to analyse)
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

> **Pivot additions for Phase 1:** the `users.role` CHECK now spans five roles (`resident`, `inspector`, `manager`, `contractor`, `admin`); migrations create `contractors`, `lifts`, `checklist_items` (seeded template), `inspections` (replaces `incidents`), `checklist_results`, and `signatures` in dependency order (see HLD §5 migration-order note). Seed a plausible set of lifts + contractors for the demo.


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
| AUTH-T06 | `GET /api/inspections` with no JWT | 401, `UNAUTHORIZED` |
| AUTH-T07 | `GET /api/inspections` with resident JWT | 403, `FORBIDDEN` (manager-only route) |
| AUTH-T08 | `GET /api/inspections` with valid manager JWT | 200 (even if empty array) |
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

## 4. Phase 2 — Core: Inspection/Complaint Capture + Real-Time + Contractor Portal + CV

**Owners:** Philena (UC-001–004) · Mahdiya (UC-007) · Zoe (UC-003, parallel)  
**Duration:** Weeks 3–4  
**Goal:** The full lifecycle works end-to-end: inspector spot-check / resident voice complaint → manager assigns to contractor → contractor rectifies + e-signs → manager closes with dual e-sign → CV auto-detects defects.

> **Zoe's expanded track:** Zoe owns two things in Phase 2 — (1) the UC-003 real-time subscription layer (`SocketContext`, room joins, live status updates, satisfaction rating) built in parallel with Philena's REST layer on the same page to avoid merge conflicts; and (2) **UC-010, the contractor portal — the single most differentiating 4C-1 deliverable.** UC-010 starts in Week 3 (skeleton + acknowledge flow) and completes in Week 4 (completion photos, remarks, e-signature). Mahdiya's UC-007 CV work runs alongside; if UC-010 slips, Mahdiya pairs with Zoe (CV is stretch, contractor portal is non-negotiable).

### 4.1 Objectives

- Resident can submit a complaint with photo or voice (Cloudinary + Web Speech API) and receive AI categorisation (OpenAI)
- Manager can view, prioritise, assign to a contractor, and close records with dual e-signature
- Resident can track status live via Socket.IO (UC-003 — Zoe)
- Residents can submit complaints by voice (Web Speech API live transcription); manager can replay audio (UC-001)
- Inspectors can complete a structured lift spot-check with per-item severity + photos (UC-001)
- Contractors can acknowledge, rectify, upload proof photos, and e-sign (UC-010 — Zoe)
- Manager closes with dual e-signature + optional actual_cost (UC-004)
- Roboflow CV pipeline processes uploaded photos and creates auto-detected tickets

### 4.2 Week 3 Tasks — Philena: UC-001 to UC-004

| # | Task | File(s) | Notes |
|---|------|---------|-------|
| 3.1 | Implement Cloudinary service | `src/services/cloudinaryService.js` | `uploadImage/uploadAudio/uploadPdf(buffer, folder)` — `/defects`, `/audio`, `/signatures`, `/reports` |
| 3.2 | Implement OpenAI categorisation service | `src/services/openaiService.js` | `categoriseComplaint(title, description)` → `{ category, priority_score }` (resident complaints only) |
| 3.3 | Implement `inspectionModel.js` + `liftModel.js` | `src/models/` | CRUD on inspections + checklist_results; lookups on lifts/contractors; `findByOriginator()`, `assign()`, `close()`, `softDelete()` |
| 3.4 | Implement Socket.IO service | `src/services/socketService.js` | `emitToRoom(room, event, data)`; rooms: `manager-room`, `block-N`, `contractor-N`, `insp-N` |
| 3.5 | Implement `inspectionController.js` | `src/controllers/inspectionController.js` | Handles all three `source_type` values; create / list / assign (UC-002) / close with dual e-sign + actual_cost (UC-004) / rating |
| 3.6 | Implement duplicate detection | inside `inspectionController.create()` | Same originator + title/lift within 2 min → 409 |
| 3.7 | Create inspection routes | `src/routes/inspections.js` | Endpoints per API spec §6.2 |
| 3.8 | Frontend: `ReportIssuePage.jsx` (resident) + **voice input** | `src/pages/ReportIssuePage.jsx`, `src/services/voiceService.js` | Text + location + photo; **mic button using Web Speech API** with live transcription, language picker, and disabled-fallback (UC-001 Voice Sub-Flow + Alt Flow D) |
| 3.9 | Frontend: `NewInspectionPage.jsx` (inspector) | `src/pages/NewInspectionPage.jsx` | Lift dropdown → loads structured checklist; per-item Pass/Defect + severity + remark (voice-enabled) + ≤100 KB photo |
| 3.10 | Frontend: `InspectionListPage.jsx` + `InspectionDetailPage.jsx` | `src/pages/` | Manager triage queue sorted by priority; detail view with checklist results, **audio playback for voice complaints**, assign controls, close-with-dual-e-sign (canvas signature pad) |
| 3.11 | Frontend: `MyReportsPage.jsx` — REST layer | `src/pages/MyReportsPage.jsx` | Originator cards from `GET /inspections/my`; status cards; rating UI skeleton. **Zoe wires the Socket.IO layer (Z.3).** |
| 3.12 | Client-side photo compression | `src/utils/imageCompress.js` | Compress to ≤100 KB before upload (Daniel Koh design note) |

### 4.3 Week 3 Tasks — Zoe: UC-003 Real-Time Subscription Layer

> Zoe works from the same Phase 1 base as Philena. She needs the `inspectionController.js` and socket service from tasks 3.4–3.5 to exist before she can wire the live subscription — coordinate with Philena at start of Week 3.

| # | Task | File(s) | Notes |
|---|------|---------|-------|
| Z.1 | Implement `SocketContext.jsx` | `src/context/SocketContext.jsx` | Initialises the Socket.IO client connection using `VITE_API_URL`; exposes `socket`, `joinRoom(roomId)`, `leaveRoom(roomId)` via context |
| Z.2 | Implement manager-room join logic | `src/context/SocketContext.jsx` | On login, if `user.role === 'manager'`, call `socket.emit('join', 'manager-room')` |
| Z.3 | Wire Socket.IO live update into `MyReportsPage.jsx` | `src/pages/MyReportsPage.jsx` | On opening a record detail, `joinRoom('insp-{id}')`; listen for `status_update` → update status + audit log without reload |
| Z.4 | Handle reconnection on network drop | `src/context/SocketContext.jsx` | Show "Live updates paused — reconnecting…" banner; auto-retry every 5 s |
| Z.5 | Satisfaction rating submission | `src/pages/MyReportsPage.jsx` | On `Resolved`, render 1–5 star rating; call `POST /inspections/:id/rating`; disable after submit (UC-003 Alt B) |
| Z.6 | Empty state for no records | `src/pages/MyReportsPage.jsx` | Empty `GET /inspections/my` → `<EmptyState>` with shortcut to UC-001 |
| Z.7 | Socket.IO test verification | Browser DevTools | Confirm `status_update` received cross-tab; screenshot as test evidence |

### 4.3b Week 3–4 Tasks — Zoe: UC-010 Contractor Portal (the 4C-1 differentiator)

> This is the single most important NEW deliverable for 4C-1. Steps 5–6 of Daniel Koh's paper workflow (contractor acknowledges → rectifies → uploads proof → e-signs) are what no paper process can do. Skeleton in Week 3; complete in Week 4.

| # | Task | File(s) | Notes |
|---|------|---------|-------|
| Z.8 | Add `contractor` role gate + contractor room join | `src/context/SocketContext.jsx`, `src/middleware/auth.js` (with Philena) | On login, `role === 'contractor'` → join `contractor-{id}` room |
| Z.9 | Backend: `contractorController.js` | `src/controllers/contractorController.js` | `getAssigned()`, `acknowledge()`, `submitWork()` (photos+remarks), `eSign()`, `hold()` — API spec §6.9 |
| Z.10 | Backend: contractor routes | `src/routes/contractor.js` | `GET /contractor/assigned`, `POST /contractor/:id/acknowledge|rectify|hold` |
| Z.11 | Frontend: `ContractorInboxPage.jsx` | `src/pages/ContractorInboxPage.jsx` | Assigned-defects list sorted by deadline with a days-remaining countdown per item |
| Z.12 | Frontend: acknowledge + rectify flow | `src/pages/ContractorInboxPage.jsx` | Acknowledge button → status update; per-item completion photo (≤100 KB) + remark; "Submit Work Done" |
| Z.13 | Frontend: contractor e-signature pad | `src/components/common/SignaturePad.jsx` | Canvas signature → upload to `/signatures`; write `signatures` row (role `contractor`); shared with UC-004 manager sign |
| Z.14 | UC-010 tests | `tests/unit/contractor.test.js` | Acknowledge sets status; rectify without signature → 400 SIGNATURE_REQUIRED; hold pauses deadline |

### 4.4 Week 4 Tasks — Mahdiya: UC-007 CV Pipeline

| # | Task | File(s) | Notes |
|---|------|---------|-------|
| 4.0 | Re-tune Roboflow model classes for lift defects | Roboflow project | Add classes: rust, oil_leak, wear (alongside crack, water_stain, debris). Demo-fidelity acceptable |
| 4.1 | Implement Roboflow service | `src/services/roboflowService.js` | `detectDefect(imageUrl)` — POSTs to Roboflow inference endpoint; returns predictions array |
| 4.2 | Implement `cvDetectionModel.js` | `src/models/cvDetectionModel.js` | `save()`, `findPendingRetry()`, `markProcessed()` |
| 4.3 | Implement `cvController.js` | `src/controllers/cvController.js` | `detect()` — evaluate confidence ≥ 0.70; create `cv_auto_detected` record; emit Socket.IO alert |
| 4.4 | Wire CV call into inspection creation | `src/controllers/inspectionController.js` | After Cloudinary upload, call `cvController.detect()` asynchronously |
| 4.5 | Implement retry queue logic | `src/controllers/cvController.js` | On Roboflow 429 → insert `retry_queue` row; on `batchScan()` → process pending rows |
| 4.6 | Create CV routes | `src/routes/cv.js` | `POST /cv/detect`, `GET /cv/batch-scan` |
| 4.7 | Frontend: `BoundingBoxOverlay.jsx` | `src/components/cv/BoundingBoxOverlay.jsx` | Canvas overlay drawn on top of `<img>` using bounding box coords from API |
| 4.8 | Frontend: Manual review queue | `src/pages/InspectionListPage.jsx` | "Needs Manual Review" tab: `cv_detections` with `low_confidence` status |
| 4.9 | Write Phase 2 unit tests | `tests/unit/inspections.test.js`, `contractor.test.js`, `cv.test.js` | See test cases below |

### 4.4 Phase 2 Test Cases

| Test ID | Input | Expected Output |
|---------|-------|----------------|
| INC-T01 | `POST /inspections` with valid form-data + photo | 201, record ID, `category` set by OpenAI, `photo_url` is Cloudinary URL |
| INC-T02 | `POST /inspections` missing `title` | 400, `VALIDATION_ERROR`, `fields: ["title"]` |
| INC-T03 | Duplicate record same originator within 2 min | 409, `DUPLICATE_SUBMISSION`, existing ID returned |
| INC-T04 | `GET /inspections` as manager | 200, array sorted by `ai_priority_score` desc |
| INC-T05 | `GET /inspections/my` as resident | 200, only that resident's own records |
| INC-T06 | `PATCH /inspections/:id` as manager — assign | 200, status `In Progress`, audit log entry created |
| INC-T07 | `POST /inspections/:id/close` — remark < 10 chars | 400, `VALIDATION_ERROR` |
| INC-T08 | `POST /inspections/:id/close` — valid remark | 200, `is_deleted: true`, `resolution_time_hours` populated |
| INC-T09 | `POST /inspections/:id/rating` twice | 409, `ALREADY_RATED` |
| INC-T10 | `GET /inspections/:id` after soft-delete (resident view) | 404, `NOT_FOUND` |
| CV-T01 | Roboflow returns confidence 0.87 | cv_detections row created, auto-record created, Socket.IO emitted |
| CV-T02 | Roboflow returns confidence 0.54 | cv_detections row with `low_confidence`, no ticket created |
| CV-T03 | Roboflow returns 429 | Image queued in `retry_queue`, manager not notified yet |
| CV-T04 | `GET /cv/batch-scan` with 2 pending | Both processed, response `{ processed: 2 }` |

### 4.5 Phase 2 Definition of Done

- [ ] Resident can submit a complaint by **text or voice** — transcript + audio stored (audio in Cloudinary /audio), OpenAI category set
- [ ] Inspector can complete a structured lift spot-check — checklist_results written, per-item severity + ≤100 KB photos
- [ ] Manager sees all records sorted by priority, can assign to a contractor, and close with **dual e-signature** + optional actual_cost
- [ ] Manager can replay the original audio on a voice complaint
- [ ] **Contractor can log in, see assigned defects, acknowledge, upload completion photos + remarks, and e-sign (UC-010)** — the 4C-1 differentiator, demoable end-to-end
- [ ] Originator sees live status update without page refresh — Socket.IO `status_update` confirmed in DevTools (Zoe)
- [ ] Satisfaction rating submits on resolved complaint; duplicate blocked (Zoe)
- [ ] Roboflow processes uploaded photos — `cv_auto_detected` records created for confidence ≥ 70% (lift defect classes re-tuned)
- [ ] Low-confidence detections appear in manager's manual review queue
- [ ] All Phase 2 test cases (§4.4) + UC-003 Socket.IO verification (Z.7) + UC-010 contractor tests (Z.14) pass
- [ ] Bounding box overlay renders on the record detail photo
- [ ] Philena's REST layer, Zoe's Socket.IO + contractor portal, and Mahdiya's CV are integrated on `main` with no merge conflicts

---

## 5. Phase 3 — Intelligence: Analytics + AI Engine + Cost Dashboard + Reports

**Owners:** Hasini (UC-005 + PowerPoint export + UC-011 UI) · Davian (UC-006 + cost prediction + UC-009 + UC-011 backend)  
**Duration:** Week 5  
**Goal:** Managers gain data-driven insight — heatmap, SLA gauge, contractor scorecard, cost-aware AI risk alerts, one-click PowerPoint export, an admin cost dashboard (UC-011), and an automated monthly PDF report.

### 5.1 Objectives

- Analytics dashboard (UC-005) with Chart.js visualisations, contractor scorecard, and real-time filter controls (4C-2)
- **One-click PowerPoint export** on every dashboard view (PptxGenJS) — the weekly-meeting pain point (4C-2 / 4D)
- Nightly AI velocity analysis surfacing risk alerts **with an estimated cost** on the dashboard (UC-006)
- **Admin cost analytics dashboard (UC-011)** — actual vs projected maintenance cost from the system's own data (4D thematic)
- Monthly PDF report generated by pdfkit, stored on Cloudinary, emailed via Nodemailer (UC-009)
- Two GitHub Actions workflows committed and tested (notification dispatch is server-side)

### 5.2 Week 5 Tasks — Hasini: UC-005 Analytics

| # | Task | File(s) | Notes |
|---|------|---------|-------|
| 5.1 | Implement `analyticsController.js` | `src/controllers/analyticsController.js` | `getHeatmap()`, `getTrends()`, `getSlaCompliance()` — all accept `?from&to&block&category` query params |
| 5.2 | Implement SLA compliance + contractor scorecard queries | `src/controllers/analyticsController.js` | SLA: `resolution_time_hours ≤ target`; scorecard: avg rectification days, repeat-defect rate, overdue count per contractor |
| 5.3 | Implement priority queue query | `src/controllers/analyticsController.js` | Composite score = `(ai_priority_score × 0.5) + (recency_days × 0.3) + (frequency_score × 0.2)` |
| 5.4 | Create analytics routes | `src/routes/analytics.js` | `GET /analytics/issues-by-block`, `/trends`, `/sla-compliance`, `/contractor-scorecard` |
| 5.5 | Frontend: `DashboardPage.jsx` | `src/pages/DashboardPage.jsx` | Three Chart.js charts + AI alert cards + priority queue table |
| 5.6 | Frontend: `HeatmapChart.jsx` | `src/components/analytics/HeatmapChart.jsx` | Chart.js matrix plugin; colour-coded by count intensity |
| 5.7 | Frontend: `TrendLineChart.jsx` | `src/components/analytics/TrendLineChart.jsx` | Chart.js line chart, X = date, Y = count |
| 5.8 | Frontend: `SlaGauge.jsx` | `src/components/analytics/SlaGauge.jsx` | Chart.js doughnut; percentage label in centre |
| 5.9 | Frontend: Filter controls | `src/pages/DashboardPage.jsx` | Block / date range / category dropdowns; re-fetch all 3 endpoints on change |
| 5.10 | Frontend: CSV export | `src/utils/csvDownload.js` | Client-side — converts priority queue JSON to CSV and triggers download |
| 5.11 | Frontend: Heatmap drill-down | `src/components/analytics/HeatmapChart.jsx` | onClick → navigate to `/inspections?block=X&category=Y` |
| 5.12 | Frontend: `AIAlertCard.jsx` | `src/components/analytics/AIAlertCard.jsx` | Amber card showing alert text, Accept / Dismiss buttons |
| 5.13 | Wire AI alerts to dashboard | `src/pages/DashboardPage.jsx` | Fetch `GET /api/recommendations` (active only) above heatmap; each card shows estimated cost |
| 5.13a | Frontend: Contractor scorecard table | `src/components/analytics/ContractorScorecard.jsx` | Renders `/analytics/contractor-scorecard` — beyond the Sembawang baseline |
| 5.13b | Backend + Frontend: PowerPoint export | `src/services/pptxService.js`, `src/routes/export.js`, export button on dashboard | `POST /api/export/pptx` (PptxGenJS) renders current filtered charts/tables into a .pptx; download link returned (4C-2 / 4D pain point) |
| 5.13c | Frontend: UC-011 Admin Cost Dashboard page | `src/pages/AdminCostPage.jsx` | Role-gated to `admin`; KPI tiles, cost-by-category bar, cost-per-contractor table, cost trend line; reuses Chart.js components with cost data |
| 5.13d | Frontend: Data Playground page (UC-005 ext) | `src/pages/DataPlaygroundPage.jsx` | Client-side CSV/XLSX parse (PapaParse / SheetJS); column preview + type inference; map columns to axes; render via shared Chart.js components; session-only (no DB writes); ≤ 5 MB; charts addable to PPT export selection. **Verify spec against actual Claude Code implementation** |
| 5.13e | Backend: UC-012 vendor lifecycle controller + routes | `src/controllers/vendorController.js`, `src/routes/vendors.js` | `onboard()` (creates contractors + users rows, validates dates, Cloudinary /contracts upload), `list()` (sorted by contract_end), `renew()`, `suspend()` — all `requireRole('admin')`. **Coordinate with Philena — touches users table + auth (403 ACCOUNT_SUSPENDED on suspended login)** |
| 5.13f | Frontend: UC-012 Vendor Accounts page | `src/pages/AdminVendorPage.jsx` | Onboard form (manual entry — no contract parsing), vendor list with days-until-expiry, Renew + Suspend actions with confirm dialogs |
| 5.13g | Scheduled job: contract expiry check | `.github/workflows/contract-expiry-check.yml` + `GET /api/admin/vendors/expiry-check` (cron-guarded) | Daily; suspends contractors past `contract_end`; notifies admin (Socket.IO + email); same cron-secret pattern as §5.4 |

### 5.3 Week 5 Tasks — Davian: UC-006 + UC-009

| # | Task | File(s) | Notes |
|---|------|---------|-------|
| 5.14 | Implement velocity calculator | `src/utils/velocityCalculator.js` | `calculateVelocity(block, category, db)` → `{ count_last_30, count_prior_30, velocity_pct }` |
| 5.14a | Implement cost predictor | `src/utils/costPredictor.js` | `estimateCost(defectType, db)` = avg `actual_cost` of last N closed records of that type × predicted occurrences → `estimated_cost` on the prediction |
| 5.15 | Implement `openaiService.generateRiskAlert()` | `src/services/openaiService.js` | Prompt: given lift/block, category, velocity, estimated_cost — return ≤60-word alert naming trend, action, and projected cost impact |
| 5.16 | Implement `recommendationController.runAnalysis()` | `src/controllers/recommendationController.js` | Step 1: query `ai_jobs` WHERE `status = 'pending'` and process those block+category pairs first. Step 2: run velocity analysis across all pairs. Step 3: generate OpenAI alerts for pairs ≥ 40% velocity. Step 4: mark processed `ai_jobs` rows as `processed`. This ensures blocks that hit the recurrence threshold in UC-004 are always picked up. |
| 5.17 | Implement `recommendationController.listAlerts()` | `src/controllers/recommendationController.js` | `listAlerts()` — queries `ai_predictions` WHERE `status = ?` (default `Active`); used by the dashboard on page load |
| 5.18 | Implement accept / dismiss actions | `src/controllers/recommendationController.js` | `acceptAlert()` creates a costed maintenance record (estimated_cost attached); `dismissAlert()` logs timestamp |
| 5.19 | Create recommendation routes | `src/routes/recommendations.js` | `GET /recommendations`, `GET /recommendations/run` (cron), `POST /:id/accept`, `POST /:id/dismiss` |
| 5.19a | Backend: UC-011 admin cost controller | `src/controllers/adminController.js` | `costSummary()`, `costByCategory()`, `costByContractor()`, `costTrend()` — aggregates `inspections.actual_cost` + open `ai_predictions.estimated_cost`. **Operational data only — NOT EM corporate financials.** |
| 5.19b | Backend: admin routes (role-gated) | `src/routes/admin.js` | `GET /admin/costs/summary|by-category|by-contractor|trend` — `requireRole('admin')` |
| 5.20 | Implement `openaiService.generateSummary()` | `src/services/openaiService.js` | For monthly report — ≤80 words, key findings + one recommendation |
| 5.21 | Implement `pdfService.buildMonthlyReport()` | `src/services/pdfService.js` | pdfkit: title, period, executive summary, data tables, **cost summary section** (actuals + projected) |
| 5.22 | Implement `emailService.sendReportEmail()` | `src/services/emailService.js` | Nodemailer SMTP; subject = "Monthly Estate Report — [period]"; body includes Cloudinary PDF URL |
| 5.23 | Implement `reportController.generateReport()` | `src/controllers/reportController.js` | Full pipeline: query → aggregate → OpenAI → pdfkit → Cloudinary → DB row → email |
| 5.24 | Create report routes | `src/routes/reports.js` | `GET /reports/generate` (cron), `POST /reports/generate-manual` (manager JWT), `GET /reports` |
| 5.25 | Frontend: `ReportsArchivePage.jsx` | `src/pages/ReportsArchivePage.jsx` | List of reports with Cloudinary PDF links + generated date |
| 5.26 | Write both GitHub Actions YAMLs | `.github/workflows/` | `nightly-recommendations.yml` + `monthly-report.yml` (notification dispatch is server-side) |
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

**File 2: `.github/workflows/monthly-report.yml`**
```yaml
name: Monthly PDF Report
on:
  schedule:
    - cron: '0 23 1 * *'     # 1st of month, 07:00 SGT = 23:00 UTC prev day
  workflow_dispatch:
jobs:
  trigger:
    runs-on: ubuntu-latest
    steps:
      - name: Generate monthly report
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

> **Note for task 5.26:** Only two YAML files are needed: `nightly-recommendations.yml` and `monthly-report.yml`. The notification dispatch is handled server-side (no `scheduled-notifications.yml`).

> **Latency expectation:** Scheduled notifications may fire up to 60 seconds late (the `setInterval` polling window). Display this in the UI: "Scheduled notifications are sent within 1 minute of the selected time." This is significantly better than the 5-minute GitHub Actions approach.

> **Note:** Inform users that scheduled notifications may fire up to 60 seconds late. Display this on the scheduled send confirmation dialog.

> **GitHub Actions minutes budget (private repo):**  
> With only the two workflows (nightly at 02:00 SGT + monthly on the 1st), total monthly runs ≈ 30 (nightly) + 1 (monthly) = 31 runs. At ~1–2 minutes each, that is ~31–62 minutes/month — well within the 2,000 free-minute limit. Budget is safe.

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
| REC-T03 | Lift/block+category with < 3 records in last 30 days | Skipped, not in response alerts |
| REC-T04 | `POST /recommendations/:id/accept` | 201, costed maintenance record created with `source_flag: "AI-Generated"` + `estimated_cost` |
| REC-T05 | `POST /recommendations/:id/dismiss` | 200, `dismissed_at` timestamp set |
| COST-T01 | `GET /admin/costs/summary` as admin | 200, `total_actual`, `total_projected`, `variance_pct` present |
| COST-T02 | `GET /admin/costs/summary` as manager (not admin) | 403, `FORBIDDEN` (role-gated) |
| COST-T03 | `GET /admin/costs/by-contractor` | 200, array of `{ contractor, actual_cost, jobs }` |
| PPT-T01 | `POST /export/pptx` with valid views | 200, `pptx_url` is a Cloudinary URL |
| PPT-T02 | `POST /export/pptx` when PptxGenJS throws | 500, `EXPORT_FAILED`; UI offers CSV fallback |
| RPT-T01 | `GET /reports/generate` with valid cron secret | 200, `report_url` is Cloudinary URL, `email_delivered: true` |
| RPT-T02 | OpenAI fails during report generation | 200, fallback template summary used, report still delivered |
| RPT-T03 | `POST /reports/generate-manual` with manager JWT | 201, `triggered_by: "manual"` |
| RPT-T04 | `GET /reports` | 200, array of report records with `report_url` links |
| PLG-T01 | Upload valid CSV to playground | Column preview shown; chart renders from selected columns; nothing written to DB |
| PLG-T02 | Upload 6 MB file | Rejected client-side with size message; no parse attempted |
| PLG-T03 | Upload .txt file | "Could not be read" error; no partial state |
| VND-T01 | POST /admin/vendors with valid data | 201; contractors + users rows created; status active |
| VND-T02 | POST /admin/vendors, contract_end < contract_start | 400 INVALID_CONTRACT_DATES |
| VND-T03 | POST /admin/vendors with existing login email | 409 EMAIL_ALREADY_EXISTS; no rows created |
| VND-T04 | Expiry job runs with 1 vendor past contract_end | users.status → suspended; admin notified |
| VND-T05 | Suspended vendor attempts login | 403 ACCOUNT_SUSPENDED |
| VND-T06 | POST /admin/vendors/:id/renew on suspended vendor | 200; status active; new contract_end stored |

### 5.6 Phase 3 Definition of Done

- [ ] Chart.js charts (heatmap, trend, SLA gauge) + contractor scorecard render with real data
- [ ] Filter controls (block/date/lift/category) update all charts without page reload
- [ ] AI alert cards appear on dashboard **with estimated cost**; Accept (creates costed record) and Dismiss work
- [ ] Velocity analysis correctly skips pairs with < 3 records
- [ ] **PowerPoint export** produces a downloadable .pptx of the current dashboard view (PptxGenJS)
- [ ] **Admin cost dashboard (UC-011)** renders KPI tiles, cost-by-category, cost-per-contractor, and trend — role-gated to `admin`
- [ ] **Data Playground (UC-005 ext)** parses a CSV and an XLSX client-side, renders an ad-hoc chart, rejects >5 MB and malformed files gracefully, persists nothing
- [ ] **Vendor lifecycle (UC-012)**: onboard creates linked contractors + users rows; expiry job suspends past-contract vendors; suspended vendor login returns 403 ACCOUNT_SUSPENDED; renew reactivates
- [ ] Cost figures derive only from the system's own data (actual_cost + estimated_cost); no EM corporate financials
- [ ] Monthly PDF contains: title, period, executive summary, data tables, cost summary
- [ ] PDF stored in Cloudinary `/reports`, URL in `reports` table; manager receives email (real SMTP)
- [ ] Both GitHub Actions workflows fire successfully on `workflow_dispatch`
- [ ] All Phase 3 test cases above pass (analytics, recommendations, cost, PPT, reports)

---

## 6. Phase 4 — Polish: Notifications + UX + Testing + Demo Prep

**Owners:** All members  
**Duration:** Week 6  
**Goal:** UC-008 complete, all error states handled, mobile-responsive, all tests passing, demo rehearsed.

### 6.1 Objectives

- Manager can send and schedule scoped Socket.IO notifications to residents, contractors, or inspectors (UC-008)
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
| 6.8 | Add EmptyState component | All | `src/components/common/EmptyState.jsx` | Used by MyReports, InspectionList, ContractorInbox, Analytics, AdminCost when no data |
| 6.9 | Add loading spinners | All | `src/components/common/LoadingSpinner.jsx` | All data-fetching routes show spinner before first data arrives |
| 6.10 | Mobile responsiveness pass | All | All page components | Ensure all pages usable on 375px width; test in DevTools |
| 6.11 | Integration test run | Philena | `tests/integration/` | Full flow: inspector submits inspection → manager assigns contractor → contractor acknowledges + rectifies + e-signs → manager closes with dual e-sign → appears in report + cost dashboard |
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
| INT-T01 | Resident voice flow: speak complaint → transcript appears → submit → manager replays audio | Transcript + audio_url stored; manager hears original recording |
| INT-T02 | Inspector flow: new lift inspection → checklist + severities + photo → submit | inspections row (lift_inspection) + checklist_results written |
| INT-T03 | Contractor flow (UC-010): acknowledge → upload completion photos → e-sign | Status Assigned→Acknowledged→Rectified; contractor signature stored |
| INT-T04 | Manager close (UC-004): dual e-sign + actual_cost → close | Status Closed, is_deleted true, both signatures stored, cost recorded |
| INT-T05 | CV flow: submit photo → bounding box visible on detail page | Overlay rendered within 5 s of submission |
| INT-T06 | AI + cost flow: dashboard alert with estimated cost → Accept | Costed maintenance record created, visible in list and cost dashboard |

### 6.4 Demo Narrative (Final Review)

The demo should follow a **continuous user journey** — not a disconnected feature sequence. Assign each segment to one team member.

The demo follows one **continuous user journey** through the lift-inspection lifecycle — not a disconnected feature list. Each member owns one segment; transitions should be smooth (the next presenter picks up the same record).

| Segment | Member | What to show | Duration |
|---------|--------|-------------|---------|
| 1. Inspector spot-check + resident voice | Philena | Login as inspector → new lift inspection on Lift 44A-L1 → complete structured checklist, mark a door defect Major, attach photo → submit. Then login as resident → **report a complaint by voice** (speak, watch live transcription) → submit | 3 min |
| 2. Manager triages & assigns to contractor | Philena → Zoe | Login as manager → real-time notification of the new inspection → open it → **replay the resident's voice recording** → set priority → assign to the lift contractor (auto-derived from brand) with a 14-day deadline | 2 min |
| 3. Contractor portal (the 4C-1 differentiator) | Zoe | Login as contractor → assigned-defects inbox with deadline countdown → acknowledge → upload completion photo + remark → **e-sign on the signature pad** → submit work done | 3 min |
| 4. Manager joint endorsement + close | Zoe → Philena | Manager sees "Rectified — awaiting endorsement" → opens record → reviews completion proof → **dual e-signature** → enters actual_cost → close (record enters 5-year audit trail) | 2 min |
| 5. CV auto-detection | Mahdiya | Upload a lift defect photo → Roboflow detects rust/crack with bounding box → auto-record created → manager receives Socket.IO alert | 2 min |
| 6. Analytics + PowerPoint export | Hasini | Manager dashboard → heatmap + SLA gauge + **contractor scorecard** → filter Block 44A → **accept a cost-aware AI alert** ("$800 now vs $3,200 later") → **Data Playground: upload a client CSV, chart it live** → **click Export to PowerPoint** (deck includes the playground chart) | 3.5 min |
| 6b. Vendor lifecycle (UC-012) | Hasini | Admin portal → onboard a vendor with contract dates → show expiry countdown on vendor list → suspend + renew flow | 1.5 min |
| 7. Admin cost dashboard + monthly report | Davian | Login as admin → **operational cost dashboard** (actual vs projected, cost-per-contractor) → then trigger the monthly PDF report → open it → show executive summary + cost section | 2 min |
| **Total** | | | **~17 min** |

> **Framing slide at the end:** state the problem-statement coverage explicitly — "Primary: 4C-1 Lift Inspection Digitalisation. Secondary: 4C-2 via dashboards + PowerPoint export. Thematic: 4D via cost-aware predictive decisions." Note the Microsoft-ecosystem adoption path (Power Automate / SharePoint) as future work.
> **Edge cases to show live** (B2 rewards this): try to close with a <10-char remark (rejected); drop the network to show the Socket.IO reconnection banner; submit a lift inspection with a missing required field (inline validation).

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
| Roboflow confidence too low on lift defect photos | High | Medium | Re-tune classes early (task 4.0); pre-test with actual lift photos before Week 4 ends; drop threshold to 0.60 if needed; keep a static demo image as fallback. |
| Contractor portal (UC-010) slips — 4C-1 core missing | Medium | Critical | It is the differentiating deliverable. If behind at end of Week 2, pull Mahdiya (CV is stretch) to pair with Zoe. Skeleton must be demoable by end of Week 3. |
| Web Speech API voice accuracy poor on Singlish/accents | Medium | Low | Rehearse the demo phrase through it in advance; provide the type-fallback; frame as "browser-native free STT; production would use cloud STT" — turns a limitation into a design-decision talking point. |
| PowerPoint export (PptxGenJS) rendering issues | Low | Low | Fallback to CSV export (already built); pre-generate one deck before the demo as backup. |
| GitHub Actions workflow paused (60-day inactivity rule) | Low | Medium | Add a comment commit to the repo every 45 days. Document the `workflow_dispatch` manual trigger fallback in the README. |
| Render cold start during demo | Medium | High | UptimeRobot + `/health` ping prevents sleep. On demo day, manually load the app 10 min before the presentation to ensure it is warm. |
| Supabase free DB expiry | Low | Critical | Supabase free tier does **not** expire (unlike Render PostgreSQL). No action needed, but verify at project start. |
| OpenAI API rate limit during live demo | Low | Medium | Pre-run the AI endpoints the evening before to warm any caches. Have a seeded `ai_predictions` row ready in DB as a fallback for the dashboard demo. |
| Socket.IO connection drops during demo | Low | High | UptimeRobot keeps Render warm. Prepare a browser reload as immediate fallback — the REST API still shows correct data even without real-time push. |
| GitHub Actions scheduled notifications fire 5 min late | N/A — resolved | N/A | Notification dispatch moved to server-side `setInterval` (60 s interval). GitHub Actions no longer used for notifications. Only 2 workflows remain (nightly + monthly), consuming ~31–62 minutes/month — well within free limits. |
| GitHub Actions free-minute budget exhausted | Low | Medium | With 2 workflows (nightly + monthly), monthly usage is ~31–62 minutes vs 2,000 free. Even with retries, headroom is large. Monitor via GitHub's billing tab. If repo ever moves to private, verify the minute count monthly. |

---

*End of PROJECT_IMPLEMENTATION_PHASES.md*
