# HIGH_LEVEL_DESIGN.md
# Lift Inspection & Estate Defect Management System — High-Level Design

> Problem statement: **4C-1 (Lift Inspection Digitalisation)** primary · **4C-2 (Interactive Dashboard)** secondary · **4D (Data-Driven Decision Making)** thematic

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Architecture Diagram](#2-architecture-diagram)
3. [Tech Stack](#3-tech-stack)
4. [Folder Structure](#4-folder-structure)
5. [Database Schema](#5-database-schema)
   - [5.11 Entity Relationship Summary](#511-entity-relationship-summary)
6. [API Endpoints](#6-api-endpoints)
   - 6.2 Inspections & Complaints · 6.9 Contractor Portal · 6.10 Admin Cost Analytics · 6.11 Export · 6.12 Vendor Account Lifecycle · 6.13 Data Playground
7. [Auth & Security](#7-auth--security)
8. [Environment Variables Reference](#8-environment-variables-reference)

---

## 1. System Overview

The Lift Inspection & Estate Defect Management System is a full-stack web application that digitises the paper-based lift spot-check workflow (4C-1) while also handling general resident estate-defect reports. Inspectors complete structured digital lift inspections; residents report issues by text or voice; managers triage and assign defects to lift contractors; contractors acknowledge, rectify, upload proof, and e-sign; and managers close records with a dual e-signature and a 5-year audit trail. The system integrates real-time notifications (Socket.IO), computer-vision defect detection (Roboflow), AI categorisation and cost-aware risk analysis (OpenAI), browser-native voice transcription (Web Speech API), automated monthly PDF reporting (pdfkit + Cloudinary), PowerPoint export (PptxGenJS), and analytics dashboards (Chart.js).

**User Roles:**
| Role | Description |
|------|-------------|
| `resident` | Reports general estate defects by text or voice; tracks own reports; rates resolution |
| `inspector` | LMS staff; performs structured digital lift spot-check inspections |
| `manager` | Triages, assigns to contractors, closes with dual e-sign; views analytics; sends notifications |
| `contractor` | Lift company staff; acknowledges defects, rectifies, uploads proof photos, e-signs |
| `admin` | Views operational cost-analytics dashboard (UC-011); manages external vendor (contractor) account lifecycle — onboarding, contract-linked expiry, renewal (UC-012) |
| `system` | Automated actor — CV pipeline, AI recommendations + cost prediction, scheduled reports, auto-chase |

**Core data-model note:** a single `inspections` table stores all records via a `source_type` discriminator (`lift_inspection`, `resident_complaint`, `cv_auto_detected`). All three share the same downstream lifecycle (triage → assign → rectify → close → audit), so one normalised table with type-specific nullable fields keeps the schema clean.

---

## 2. Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                        CLIENT LAYER                                  │
│   React.js (Vercel) ─── VITE_API_URL ──► Render backend             │
│   Socket.IO client   ─── WebSocket  ──► Socket.IO server            │
└──────────────────────────────┬──────────────────────────────────────┘
                               │ HTTPS + WSS
┌──────────────────────────────▼──────────────────────────────────────┐
│                       BACKEND LAYER (Render)                         │
│   Node.js / Express                                                  │
│   ├── REST API routes (auth, inspections, contractor, analytics,     │
│   │                     admin/costs, export, reports…)               │
│   ├── Socket.IO server (manager-room, block-N, contractor-N, insp-N) │
│   ├── JWT middleware (role-based: resident / manager)                │
│   └── CRON_SECRET guard (protects scheduled endpoints)              │
└───────┬──────────────┬──────────────┬───────────────┬───────────────┘
        │              │              │               │
        ▼              ▼              ▼               ▼
  ┌──────────┐  ┌────────────┐ ┌──────────┐  ┌────────────┐
  │ Supabase │  │ Cloudinary │ │ Roboflow │  │ OpenAI API │
  │PostgreSQL│  │ /defects   │ │ CV model │  │ GPT-4o-mini│
  │          │  │ /reports   │ │ inference│  │            │
  └──────────┘  └────────────┘ └──────────┘  └────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│                    SCHEDULED LAYER (GitHub Actions)                  │
│   nightly-recommendations.yml  → GET /api/recommendations/run       │
│   weekly-report.yml            → GET /api/reports/generate          │
│   (both authenticated via CRON_SECRET header)                       │
│                                                                      │
│   Scheduled notifications: handled server-side via setInterval       │
│   (60 s loop in notificationDispatcher.js — no GitHub Actions used) │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│                    UPTIME LAYER (UptimeRobot)                        │
│   Pings GET /health every 5 minutes → keeps Render service warm     │
└─────────────────────────────────────────────────────────────────────┘
```

**Data flow summary:**
- Inspector completes a lift spot-check (structured checklist + photos) → Express stores an `inspections` record (source_type `lift_inspection`) + child checklist_results in Supabase → contractor auto-derived from lift brand → Socket.IO notifies manager
- Resident submits a complaint by text or voice → Web Speech API transcribes in-browser → text + audio stored (audio to Cloudinary /audio) → OpenAI categorises → Socket.IO notifies manager
- Photo triggers Roboflow CV pipeline → if confidence ≥ 70% → `cv_auto_detected` record created → Socket.IO alert to manager
- Manager assigns defect to contractor → contractor acknowledges, rectifies, uploads completion photos, e-signs (UC-010) → manager closes with dual e-signature (UC-004) → 5-year audit trail preserved
- Manager closes a record with an actual_cost → feeds the operational cost analytics on the Admin dashboard (UC-011)
- Manager closes a record (UC-004) → if recurrence threshold met (≥ 3 same lift/block+category in 30 days) → row inserted into `ai_jobs` table
- GitHub Actions calls `/api/recommendations/run` nightly → endpoint drains `ai_jobs` queue first, then runs full velocity scan → OpenAI generates risk alert → stored in `ai_predictions` → surfaced on dashboard
- GitHub Actions calls `/api/reports/generate` weekly → pdfkit renders PDF → Cloudinary stores → Nodemailer emails manager

---

## 3. Tech Stack

| Layer | Technology | Version | Purpose |
|-------|-----------|---------|---------|
| Frontend | React.js | 18.x | UI framework |
| Frontend deploy | Vercel | — | Free static + serverless hosting |
| Backend | Node.js + Express | 20.x / 4.x | REST API + Socket.IO server |
| Backend deploy | Render | — | Free web service (750 hrs/month) |
| Database | Supabase (PostgreSQL) | 15.x | Relational data, no expiry on free tier |
| Image storage | Cloudinary | SDK 2.x | Stores defect photos and PDF reports |
| Real-time | Socket.IO | 4.x | WebSocket rooms for live notifications |
| CV | Roboflow Inference API | — | Defect detection, 70% confidence threshold |
| AI / NLP | OpenAI API (gpt-4o-mini) | — | Categorisation, risk alerts, report summaries |
| PDF | pdfkit | 0.15.x | Server-side weekly report generation |
| Email | Nodemailer | 6.x | SMTP email delivery of weekly reports |
| Charts | Chart.js | 4.x | Analytics dashboard visualisations |
| Voice input | Web Speech API | browser-native | Live speech-to-text for resident complaints and inspector remarks (free, no key) |
| PowerPoint export | PptxGenJS | 3.x | Server-side .pptx generation of dashboards (4C-2 / weekly-meeting pain point) |
| Scheduling | GitHub Actions | — | Free cron trigger for UC-006, UC-008, UC-009 |
| Uptime | UptimeRobot | — | Prevents Render free-tier cold starts |
| Auth | JWT (jsonwebtoken) | 9.x | Stateless auth, stored in memory (not localStorage) |
| Password hashing | bcrypt | 5.x | Salted password hashing |
| File handling | multer | 1.x | Multipart/form-data for photo uploads |

---

## 4. Folder Structure

Two separate repositories — different runtimes, deploy targets, and package.json files. AI agents generate each independently.

### 4.1 Backend Repository

```
backend/
├── src/
│   ├── routes/
│   │   ├── auth.js              # POST /auth/login, /auth/logout, /auth/register
│   │   ├── inspections.js       # CRUD for inspection/complaint records (UC-001–004)
│   │   ├── contractor.js        # contractor portal: acknowledge, rectify, e-sign (UC-010)
│   │   ├── admin.js             # admin cost analytics endpoints (UC-011)
│   │   ├── vendors.js           # UC-012 vendor lifecycle: onboard, list, renew, suspend
│   │   ├── export.js            # PptxGenJS PowerPoint export (UC-005/011)
│   │   ├── analytics.js         # GET /analytics/issues-by-block, /trends, /sla-compliance
│   │   ├── recommendations.js   # GET /recommendations/run (AI engine trigger)
│   │   ├── reports.js           # GET /reports/generate, POST /reports/generate-manual
│   │   ├── notifications.js     # POST /notifications, GET /notifications/:id/receipts, PATCH /notifications/:id/read
│   │   └── cv.js                # POST /cv/detect, GET /cv/batch-scan
│   │
│   ├── controllers/
│   │   ├── authController.js        # register(), login(), logout()
│   │   ├── inspectionController.js  # create(), list(), getById(), assign(), close() + dual e-sign
│   │   ├── contractorController.js  # acknowledge(), submitWork(), eSign() (UC-010)
│   │   ├── adminController.js       # costSummary(), costByCategory(), costPerContractor() (UC-011)
│   │   ├── vendorController.js      # onboard(), list(), renew(), suspend() (UC-012)
│   │   ├── exportController.js      # generatePptx() (UC-005/011)
│   │   ├── analyticsController.js   # getHeatmap(), getTrends(), getSlaCompliance()
│   │   ├── recommendationController.js # runAnalysis(), acceptAlert(), dismissAlert()
│   │   ├── reportController.js      # generateReport(), listReports()
│   │   ├── notificationController.js # send(), dispatchDueNotifications(), markRead(), getReceipts() — dispatch is internal, called by notificationDispatcher.js
│   │   └── cvController.js          # detect(), batchScan()
│   │
│   ├── services/
│   │   ├── openaiService.js         # categoriseIncident(), generateRiskAlert(), generateSummary()
│   │   ├── cloudinaryService.js     # uploadImage(), uploadPdf()
│   │   ├── roboflowService.js       # detectDefect()
│   │   ├── pdfService.js            # buildMonthlyReport()
│   │   ├── pptxService.js           # buildDashboardDeck() via PptxGenJS
│   │   ├── emailService.js          # sendReportEmail() via Nodemailer
│   │   └── socketService.js         # emitToRoom(), broadcastToBlock()
│   │
│   ├── middleware/
│   │   ├── auth.js                  # verifyJWT(), requireRole('manager')
│   │   ├── cronGuard.js             # validateCronSecret() for scheduled endpoints
│   │   ├── rateLimiter.js           # express-rate-limit config
│   │   ├── errorHandler.js          # global error handler, standardised JSON errors
│   │   └── validate.js              # request body validation (joi / zod)
│   │
│   ├── models/
│   │   ├── inspectionModel.js       # DB queries for inspections + checklist_results
│   │   ├── liftModel.js             # DB queries for lifts + contractors
│   │   ├── signatureModel.js        # DB queries for signatures
│   │   ├── userModel.js             # DB queries for users table
│   │   ├── notificationModel.js     # DB queries for notifications + recipients
│   │   ├── aiPredictionModel.js     # DB queries for ai_predictions table
│   │   ├── cvDetectionModel.js      # DB queries for cv_detections table
│   │   └── reportModel.js           # DB queries for reports table
│   │
│   ├── config/
│   │   ├── db.js                    # Supabase PostgreSQL connection pool (pg)
│   │   ├── cloudinary.js            # Cloudinary SDK init
│   │   ├── socket.js                # Socket.IO server init + CORS config
│   │   └── env.js                   # Environment variable validation on startup
│   │
│   ├── utils/
│   │   ├── notificationDispatcher.js  # startNotificationDispatcher() — 60 s setInterval, calls dispatchDueNotifications()
│   │   ├── jwtHelpers.js            # signToken(), verifyToken()
│   │   ├── velocityCalculator.js    # failure velocity formula for UC-006
│   │   ├── slaHelpers.js            # SLA compliance calculation
│   │   └── csvExporter.js           # Client-side CSV generation helper
│   │
│   └── app.js                       # Express app setup, middleware chain, route mounting
│
├── migrations/
│   ├── 001_create_users.sql
│   ├── 002_create_contractors.sql
│   ├── 003_create_lifts.sql
│   ├── 004_create_inspections.sql
│   ├── 005_create_inspection_history.sql
│   ├── 006_create_checklist_items.sql
│   ├── 007_create_checklist_results.sql
│   ├── 008_create_signatures.sql
│   ├── 009_create_cv_detections.sql
│   ├── 010_create_ai_predictions.sql
│   ├── 011_create_ai_jobs.sql
│   ├── 012_create_notifications.sql
│   ├── 013_create_notification_recipients.sql
│   ├── 014_create_reports.sql
│   └── 015_create_retry_queue.sql
│
├── tests/
│   ├── unit/
│   │   ├── auth.test.js
│   │   ├── inspections.test.js
│   │   ├── contractor.test.js
│   │   ├── analytics.test.js
│   │   ├── recommendations.test.js
│   │   └── cv.test.js
│   └── integration/
│       ├── auth.integration.test.js
│       └── inspections.integration.test.js
│
├── server.js                        # HTTP server + Socket.IO attach + port listen
├── package.json
├── .env.example
└── README.md
```

### 4.2 Frontend Repository

```
frontend/
├── src/
│   ├── pages/
│   │   ├── LoginPage.jsx            # UC-auth: login form
│   │   ├── DashboardPage.jsx        # UC-005: analytics + AI alert cards
│   │   ├── InspectionListPage.jsx   # UC-002: manager triage queue
│   │   ├── ContractorInboxPage.jsx   # UC-010: contractor assigned-defects inbox
│   │   ├── AdminCostPage.jsx         # UC-011: admin cost analytics dashboard
│   │   ├── AdminVendorPage.jsx       # UC-012: vendor account lifecycle (onboard / renew / suspend)
│   │   ├── DataPlaygroundPage.jsx    # UC-005 ext: ad-hoc CSV/XLSX import + charting (client-side only)
│   │   ├── IncidentDetailPage.jsx   # UC-002 / UC-005: detail + status update
│   │   ├── ReportIssuePage.jsx      # UC-001: resident submission form
│   │   ├── MyReportsPage.jsx        # UC-003: resident status tracker
│   │   ├── NotificationsPage.jsx    # UC-008: manager notification composer
│   │   └── ReportsArchivePage.jsx   # UC-009: weekly PDF archive list
│   │
│   ├── components/
│   │   ├── auth/
│   │   │   └── LoginForm.jsx
│   │   ├── inspections/
│   │   │   ├── IncidentCard.jsx
│   │   │   ├── IncidentForm.jsx     # photo upload, location picker
│   │   │   ├── StatusBadge.jsx
│   │   │   └── AuditLog.jsx
│   │   ├── analytics/
│   │   │   ├── HeatmapChart.jsx     # Chart.js matrix
│   │   │   ├── TrendLineChart.jsx   # Chart.js line
│   │   │   ├── SlaGauge.jsx         # Chart.js doughnut
│   │   │   ├── PriorityQueue.jsx    # ranked table
│   │   │   └── AIAlertCard.jsx      # amber recommendation card
│   │   ├── cv/
│   │   │   └── BoundingBoxOverlay.jsx  # canvas overlay for Roboflow results
│   │   ├── notifications/
│   │   │   ├── NotificationComposer.jsx
│   │   │   └── ReadReceiptBadge.jsx
│   │   └── common/
│   │       ├── Header.jsx
│   │       ├── Sidebar.jsx
│   │       ├── Toast.jsx
│   │       ├── Modal.jsx
│   │       ├── LoadingSpinner.jsx
│   │       └── EmptyState.jsx
│   │
│   ├── context/
│   │   ├── AuthContext.jsx          # JWT token in memory, user role
│   │   └── SocketContext.jsx        # Socket.IO connection, room management
│   │
│   ├── hooks/
│   │   ├── useAuth.js
│   │   ├── useSocket.js
│   │   ├── useIncidents.js
│   │   └── useAnalytics.js
│   │
│   ├── services/
│   │   ├── api.js                   # axios instance with baseURL = VITE_API_URL
│   │   ├── authService.js           # login(), logout()
│   │   ├── inspectionService.js     # create(), list(), assign(), close()
│   │   ├── contractorService.js     # acknowledge(), submitWork(), eSign()
│   │   ├── voiceService.js          # Web Speech API wrapper (start/stop/transcript)
│   │   ├── analyticsService.js      # getHeatmap(), getTrends(), getSla()
│   │   └── notificationService.js   # send(), getReceipts()
│   │
│   ├── utils/
│   │   ├── csvDownload.js           # client-side CSV export
│   │   └── dateHelpers.js
│   │
│   └── App.jsx                      # Router, AuthContext, SocketContext providers
│
├── public/
├── package.json
├── vite.config.js
├── .env.example
└── README.md
```

---

## 5. Database Schema

> All tables use PostgreSQL on Supabase (free tier, no expiry). Run migration files in order (001 → 015).
>
> **Migration-order note:** `contractors` (002) is created before `lifts` (003) and `inspections` (004) because both reference it. The `users.contractor_id` foreign key to `contractors` is added in migration 013 (after both tables exist) to avoid a circular dependency at create time.

### 5.1 users

```sql
CREATE TABLE users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  full_name     VARCHAR(255) NOT NULL,
  role          VARCHAR(20)  NOT NULL
                CHECK (role IN ('resident','inspector','manager','contractor','admin')),
  block_number  VARCHAR(20),                     -- residents only
  unit_number   VARCHAR(20),                     -- residents only
  contractor_id UUID,                            -- contractors only; FK → contractors(id) added in migration 013
  status        VARCHAR(20)  NOT NULL DEFAULT 'active'
                             CHECK (status IN ('active', 'suspended')),
  created_at    TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMP NOT NULL DEFAULT NOW()
);
```

### 5.2 inspections  *(core record — replaces the old `incidents` table)*

Holds all three record types via `source_type`. Lift-specific columns (`lift_id`)
are nullable and populated only for `lift_inspection`; resident columns
(`resident_id`, `description`, `audio_url`) only for `resident_complaint`.

```sql
CREATE TABLE inspections (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_type           VARCHAR(20)  NOT NULL
                        CHECK (source_type IN
                          ('lift_inspection','resident_complaint','cv_auto_detected')),
  -- originator (one of these is set depending on source_type)
  resident_id           UUID         REFERENCES users(id) ON DELETE CASCADE,
  inspector_id          UUID         REFERENCES users(id),
  lift_id               UUID         REFERENCES lifts(id),          -- lift_inspection only
  -- common content
  title                 VARCHAR(255) NOT NULL,
  description           TEXT,                                        -- complaint text / summary
  audio_url             VARCHAR(500),            -- Cloudinary /audio URL (voice complaints)
  location_block        VARCHAR(20)  NOT NULL,
  location_unit         VARCHAR(20),
  photo_url             VARCHAR(500),            -- Cloudinary /defects URL (primary photo)
  photo_pending         BOOLEAN NOT NULL DEFAULT FALSE,
  status                VARCHAR(30)  NOT NULL DEFAULT 'Open'
                        CHECK (status IN (
                          'Open','Pending Assignment','Assigned','Acknowledged',
                          'On Hold','Rectified','Resolved','Closed'
                        )),
  category              VARCHAR(50)  NOT NULL DEFAULT 'Uncategorised'
                        CHECK (category IN (
                          'Structural','Electrical','Plumbing','Cleanliness',
                          'Lift','Doors','Cabin','Safety','Landscaping','Pest',
                          'Other','Uncategorised'
                        )),
  priority              VARCHAR(20)  NOT NULL DEFAULT 'Medium'
                        CHECK (priority IN ('Critical','High','Medium','Low')),
  ai_priority_score     INTEGER      CHECK (ai_priority_score BETWEEN 1 AND 100),
  -- assignment
  contractor_id         UUID         REFERENCES contractors(id),
  target_deadline       TIMESTAMP,               -- 14-day rule for lift defects
  acknowledged_at       TIMESTAMP,
  rectified_at          TIMESTAMP,
  hold_reason           VARCHAR(100),            -- when status = 'On Hold'
  -- closure / audit
  is_deleted            BOOLEAN NOT NULL DEFAULT FALSE,
  closing_remark        TEXT,
  resolution_time_hours NUMERIC(8,2),
  actual_cost           NUMERIC(10,2),           -- entered at close (UC-004); feeds UC-011
  satisfaction_rating   INTEGER      CHECK (satisfaction_rating BETWEEN 1 AND 5),
  satisfaction_comment  TEXT,
  source_flag           VARCHAR(30)  DEFAULT 'Resident'
                        CHECK (source_flag IN
                          ('Resident','Inspector','Auto-Detected','AI-Generated')),
  cv_detection_id       UUID         REFERENCES cv_detections(id),
  closed_at             TIMESTAMP,
  created_at            TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_inspections_source_type  ON inspections(source_type);
CREATE INDEX idx_inspections_resident_id  ON inspections(resident_id);
CREATE INDEX idx_inspections_inspector_id ON inspections(inspector_id);
CREATE INDEX idx_inspections_lift_id      ON inspections(lift_id);
CREATE INDEX idx_inspections_contractor   ON inspections(contractor_id);
CREATE INDEX idx_inspections_status       ON inspections(status);
CREATE INDEX idx_inspections_category     ON inspections(category);
CREATE INDEX idx_inspections_block        ON inspections(location_block);
CREATE INDEX idx_inspections_created_at   ON inspections(created_at);
```

### 5.2a lifts  *(new)*

```sql
CREATE TABLE lifts (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  block_number     VARCHAR(20)  NOT NULL,
  lift_code        VARCHAR(20)  NOT NULL,        -- e.g. "44A-L1"
  brand            VARCHAR(100) NOT NULL,        -- e.g. Otis, Schindler, KONE
  contractor_id    UUID         REFERENCES contractors(id),  -- responsible LC
  bca_cert_expiry  DATE,                         -- for the BCA expiry tracker quick-win
  created_at       TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (block_number, lift_code)
);
CREATE INDEX idx_lifts_contractor ON lifts(contractor_id);
```

### 5.2b contractors  *(new)*

```sql
CREATE TABLE contractors (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name             VARCHAR(255) NOT NULL,
  brands_serviced  TEXT,                         -- comma-separated brands
  contact_email    VARCHAR(255) NOT NULL,        -- for Nodemailer defect alerts
  user_id          UUID         REFERENCES users(id),  -- linked login account
  contract_start   DATE,                         -- UC-012: vendor engagement start
  contract_end     DATE,                         -- UC-012: drives auto-expiry job
  contract_doc_url VARCHAR(500),                 -- UC-012: contract file, Cloudinary /contracts (reference only)
  created_at       TIMESTAMP NOT NULL DEFAULT NOW()
);
```

### 5.2c checklist_items  *(new — the structured spot-check template)*

```sql
CREATE TABLE checklist_items (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  section       VARCHAR(50)  NOT NULL,           -- Structural / Electrical / Doors / Cabin / Safety
  item_text     VARCHAR(255) NOT NULL,           -- e.g. "Landing door closes flush"
  display_order INTEGER      NOT NULL DEFAULT 0,
  active        BOOLEAN      NOT NULL DEFAULT TRUE
);
```

### 5.2d checklist_results  *(new — per-inspection results)*

```sql
CREATE TABLE checklist_results (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inspection_id     UUID NOT NULL REFERENCES inspections(id) ON DELETE CASCADE,
  checklist_item_id UUID NOT NULL REFERENCES checklist_items(id),
  result            VARCHAR(10) NOT NULL CHECK (result IN ('Pass','Defect')),
  severity          VARCHAR(10) CHECK (severity IN ('Minor','Major','Critical')),
  remark            TEXT,
  photo_url         VARCHAR(500),                -- Cloudinary /defects (per defect item)
  completion_photo_url VARCHAR(500),             -- contractor's proof photo (UC-010)
  completion_remark TEXT,                        -- contractor's remark (UC-010)
  rectified         BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE INDEX idx_checklist_results_inspection ON checklist_results(inspection_id);
```

### 5.2e signatures  *(new — dual e-signature for joint endorsement)*

```sql
CREATE TABLE signatures (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inspection_id UUID NOT NULL REFERENCES inspections(id) ON DELETE CASCADE,
  signer_role   VARCHAR(20) NOT NULL CHECK (signer_role IN ('inspector','manager','contractor')),
  signer_id     UUID NOT NULL REFERENCES users(id),
  image_url     VARCHAR(500) NOT NULL,           -- Cloudinary /signatures
  signed_at     TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_signatures_inspection ON signatures(inspection_id);
```

### 5.3 inspection_history (audit log)

```sql
CREATE TABLE inspection_history (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inspection_id   UUID NOT NULL REFERENCES inspections(id) ON DELETE CASCADE,
  actor_id        UUID NOT NULL REFERENCES users(id),
  action          VARCHAR(50) NOT NULL,          -- 'Assigned','Reassigned','Priority Escalated','Closed','Force-Closed'
  previous_status VARCHAR(30),
  new_status      VARCHAR(30),
  note            TEXT,
  created_at      TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_inspection_history_inspection_id ON inspection_history(inspection_id);
```

### 5.4 cv_detections

```sql
CREATE TABLE cv_detections (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  image_url     VARCHAR(500) NOT NULL,           -- Cloudinary /defects URL
  defect_class  VARCHAR(100) NOT NULL,           -- 'crack','water_stain','debris'…
  confidence    NUMERIC(5,4) NOT NULL,           -- 0.0000 – 1.0000
  bounding_box  JSONB,                           -- { x, y, width, height }
  source        VARCHAR(30)  NOT NULL
                CHECK (source IN ('resident_upload','scheduled_scan')),
  status        VARCHAR(20)  NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','processed','low_confidence')),
  detected_at   TIMESTAMP NOT NULL DEFAULT NOW()
);
```

### 5.5 ai_predictions

```sql
CREATE TABLE ai_predictions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  location_block VARCHAR(20) NOT NULL,
  category      VARCHAR(50)  NOT NULL,
  velocity_pct  NUMERIC(8,2) NOT NULL,
  alert_text    TEXT         NOT NULL,
  status        VARCHAR(20)  NOT NULL DEFAULT 'Active'
                CHECK (status IN ('Active','Accepted','Dismissed')),
  dismissed_by  UUID         REFERENCES users(id),
  dismissed_at  TIMESTAMP,
  created_at    TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_ai_predictions_status ON ai_predictions(status);
```

### 5.6 ai_jobs (recurrence trigger queue)

```sql
CREATE TABLE ai_jobs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  location_block  VARCHAR(20) NOT NULL,
  category        VARCHAR(50) NOT NULL,
  triggered_by    UUID NOT NULL REFERENCES inspections(id),
  status          VARCHAR(20) NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','processed','failed')),
  created_at      TIMESTAMP NOT NULL DEFAULT NOW()
);
```

### 5.7 notifications

```sql
CREATE TABLE notifications (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  manager_id  UUID NOT NULL REFERENCES users(id),
  message     VARCHAR(500) NOT NULL,
  scope       JSONB NOT NULL,                    -- { blocks: ['7','12'], type: 'specific' }
  urgency     VARCHAR(20) NOT NULL
              CHECK (urgency IN ('Informational','Warning','Critical')),
  status      VARCHAR(20) NOT NULL DEFAULT 'Sent'
              CHECK (status IN ('Sent','Scheduled','Cancelled','Failed')),
  send_time   TIMESTAMP,                         -- null = immediate
  sent_at     TIMESTAMP,
  created_at  TIMESTAMP NOT NULL DEFAULT NOW()
);
```

### 5.8 notification_recipients

```sql
CREATE TABLE notification_recipients (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_id  UUID NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
  resident_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  delivered        BOOLEAN NOT NULL DEFAULT FALSE,
  read             BOOLEAN NOT NULL DEFAULT FALSE,
  read_at          TIMESTAMP,
  UNIQUE (notification_id, resident_id)
);

CREATE INDEX idx_notif_recipients_notification ON notification_recipients(notification_id);
CREATE INDEX idx_notif_recipients_resident     ON notification_recipients(resident_id);
```

### 5.9 reports

```sql
CREATE TABLE reports (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_url      VARCHAR(500),                  -- Cloudinary /reports URL
  period_start    DATE NOT NULL,
  period_end      DATE NOT NULL,
  generated_at    TIMESTAMP NOT NULL DEFAULT NOW(),
  triggered_by    VARCHAR(20) NOT NULL
                  CHECK (triggered_by IN ('github_actions','manual')),
  report_status   VARCHAR(20) NOT NULL DEFAULT 'Ready'
                  CHECK (report_status IN ('Ready','Upload failed')),
  email_delivered BOOLEAN NOT NULL DEFAULT FALSE
);
```

### 5.10 retry_queue (CV rate-limit buffer)

```sql
CREATE TABLE retry_queue (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  image_url   VARCHAR(500) NOT NULL,
  inspection_id UUID       REFERENCES inspections(id),
  attempts    INTEGER NOT NULL DEFAULT 0,
  status      VARCHAR(20)  NOT NULL DEFAULT 'pending'
              CHECK (status IN ('pending','processed','failed')),
  created_at  TIMESTAMP NOT NULL DEFAULT NOW(),
  retry_after TIMESTAMP NOT NULL DEFAULT NOW()
);
```

---

### 5.11 Entity Relationship Summary

The diagram below shows every foreign-key relationship across the 15 tables. Read each arrow as "references". `inspections` is the central table (all three record types).

```
                       ┌─────────────┐
                       │ contractors │◄───────────────┐
                       │ id (PK)     │  contractor_id │
                       │ name        │  (FK)          │
                       │ user_id(FK) │                │
                       └──────┬──────┘                │
                     contractor_id (FK)               │
                              ▼                        │
┌──────────┐   ┌──────────────────────────┐   ┌───────┴──────┐   ┌────────────────┐
│  users   │◄──┤        inspections        ├──►│    lifts     │   │  cv_detections │
│          │   │  (core record)            │   │ id (PK)      │◄──┤ id (PK)        │
│ id (PK)  │   │ id (PK)                   │   │ block/code   │   │ defect_class   │
│ role     │   │ source_type               │   │ brand        │   │ confidence     │
│ email    │◄──┤ resident_id (FK)          │   │ contractor_id│   │ bounding_box   │
│ contr._id│   │ inspector_id (FK)         │   │  (FK)        │   └───────▲────────┘
└────▲─────┘   │ lift_id (FK)              │   │ bca_cert_exp │           │
     │         │ contractor_id (FK)        │   └──────────────┘  cv_detection_id (FK)
     │         │ cv_detection_id (FK) ─────┼──────────────────────────────┘
     │         │ status / category / cost  │
     │         └───┬───────────┬───────────┘
     │             │           │ inspection_id (FK)
     │  actor_id   │           ▼
     │  (FK)       │   ┌────────────────────┐   ┌──────────────────────┐
     └─────────────┤   │ inspection_history │   │  checklist_results   │
                   │   │ inspection_id (FK) │   │ inspection_id (FK)    │
                   │   │ actor_id (FK)      │   │ checklist_item_id(FK) │
                   │   │ action / note      │   │ result / severity     │
                   │   └────────────────────┘   │ completion_photo/rem. │
                   │                            └──────────▲───────────┘
                   │   ┌────────────────────┐   checklist_item_id (FK)
                   │   │    signatures      │   ┌──────────┴───────────┐
                   │   │ inspection_id (FK) │   │  checklist_items     │
                   │   │ signer_id (FK)     │   │ id (PK) / section    │
                   │   │ signer_role/image  │   │ item_text            │
                   │   └────────────────────┘   └──────────────────────┘
                   │
                   │   ┌────────────────────┐
                   └──►│    retry_queue     │  inspection_id (FK) → inspections.id
                       │ image_url / status │
                       └────────────────────┘

┌──────────┐   ┌─────────────────────┐        ┌──────────┐   ┌─────────────────────┐
│  users   │◄──┤   ai_predictions    │        │inspection│◄──┤     ai_jobs          │
│dismissed │   │ velocity_pct        │        │triggered │   │ triggered_by (FK)   │
│_by (FK)  │   │ estimated_cost      │        │_by (FK)  │   │ location_block      │
└──────────┘   │ alert_text / status │        └──────────┘   │ category / status   │
               └─────────────────────┘                       └─────────────────────┘

┌──────────┐   ┌─────────────────────┐        ┌──────────────────────────┐
│  users   │◄──┤   notifications     ├───────►│  notification_recipients │
│manager_  │   │ message / scope     │notif._id│ notification_id (FK)     │
│id (FK)   │   │ urgency / status    │(FK)     │ resident_id (FK) ────────┼──► users.id
└──────────┘   └─────────────────────┘        │ delivered / read         │
                                               └──────────────────────────┘

┌──────────────┐
│   reports    │  (no FK relationships — standalone audit archive of generated PDFs)
│ report_url   │
└──────────────┘
```

**Written relationship summary:**

| Relationship | Type | Description |
|---|---|---|
| `users` → `inspections` (resident) | one-to-many | A resident files many complaints (`inspections.resident_id → users.id`); set only for `resident_complaint`. |
| `users` → `inspections` (inspector) | one-to-many | An inspector files many lift inspections (`inspections.inspector_id → users.id`); set only for `lift_inspection`. |
| `lifts` → `inspections` | one-to-many | A lift is the subject of many inspections (`inspections.lift_id → lifts.id`); set only for `lift_inspection`. |
| `contractors` → `inspections` | one-to-many | A contractor is assigned many defects (`inspections.contractor_id → contractors.id`). |
| `contractors` → `lifts` | one-to-many | A contractor services many lifts by brand (`lifts.contractor_id → contractors.id`). |
| `users` → `contractors` | one-to-one | A contractor login account links to a contractor record (`contractors.user_id → users.id`); `users.contractor_id` back-references it. |
| `inspections` → `inspection_history` | one-to-many | One inspection has many audit entries (`inspection_history.inspection_id → inspections.id`). Cascades on delete. |
| `users` → `inspection_history` | one-to-many | Any actor (inspector/manager/contractor) appears on many audit entries (`inspection_history.actor_id → users.id`). |
| `inspections` → `checklist_results` | one-to-many | A lift inspection has many checklist result rows (`checklist_results.inspection_id → inspections.id`). Cascades on delete. |
| `checklist_items` → `checklist_results` | one-to-many | A template item is answered across many inspections (`checklist_results.checklist_item_id → checklist_items.id`). |
| `inspections` → `signatures` | one-to-many | An inspection carries up to two endorsement signatures (`signatures.inspection_id → inspections.id`). Cascades on delete. |
| `contractors` → `users` (lifecycle) | one-to-one | A vendor's contract-bounded access (UC-012): `contractors.contract_end` drives the daily expiry job that flips the linked `users.status` to `suspended`. |
| `users` → `signatures` | one-to-many | A user (inspector/manager/contractor) signs many records (`signatures.signer_id → users.id`). |
| `cv_detections` → `inspections` | one-to-one | An auto-detected defect links to the record it created (`inspections.cv_detection_id → cv_detections.id`). Optional. |
| `users` → `ai_predictions` | one-to-many | A manager can dismiss many predictions (`ai_predictions.dismissed_by → users.id`). Optional. |
| `inspections` → `ai_jobs` | one-to-many | Closing a recurring defect queues a job referencing the triggering inspection (`ai_jobs.triggered_by → inspections.id`). |
| `users` → `notifications` | one-to-many | A manager sends many notifications (`notifications.manager_id → users.id`). |
| `notifications` → `notification_recipients` | one-to-many | One notification fans out to many recipient rows (`notification_recipients.notification_id → notifications.id`). Cascades. |
| `users` → `notification_recipients` | one-to-many | A recipient has many receipt rows (`notification_recipients.resident_id → users.id`). Cascades. |
| `inspections` → `retry_queue` | one-to-many | Images hitting Roboflow rate limits are queued referencing the originating inspection (`retry_queue.inspection_id → inspections.id`). Optional. |
| `reports` | standalone | No foreign keys — self-contained audit archive of generated PDFs. |

---

## 6. API Endpoints

> All authenticated routes require `Authorization: Bearer <JWT>`.  
> All cron routes require `Authorization: Bearer <CRON_SECRET>`.  
> All responses use `Content-Type: application/json`.

### 6.1 Auth

#### POST /api/auth/register
Creates a new resident account.

**Request:**
```json
{
  "email": "ali@example.com",
  "password": "SecurePass123",
  "full_name": "Ali Hassan",
  "role": "resident",
  "block_number": "44A",
  "unit_number": "12-05"
}
```
**Response 201:**
```json
{
  "id": "a1b2c3d4-...",
  "email": "ali@example.com",
  "full_name": "Ali Hassan",
  "role": "resident",
  "created_at": "2026-06-01T08:00:00Z"
}
```
**Error 400 — duplicate email:**
```json
{ "code": "EMAIL_ALREADY_EXISTS", "message": "An account with this email is already registered." }
```

---

#### POST /api/auth/login
Authenticates user and returns JWT.

**Request:**
```json
{ "email": "ali@example.com", "password": "SecurePass123" }
```
**Response 200:**
```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": { "id": "a1b2c3d4-...", "email": "ali@example.com", "role": "resident", "full_name": "Ali Hassan" }
}
```
**Error 401:**
```json
{ "code": "INVALID_CREDENTIALS", "message": "Incorrect email or password." }
```

---

#### POST /api/auth/logout
Invalidates the current session (client drops token).

**Response 200:**
```json
{ "message": "Logged out successfully." }
```

---

### 6.2 Inspections & Complaints

#### POST /api/inspections
**Auth:** `resident` (complaint) or `inspector` (lift spot-check)  
Creates a new inspection/complaint record (multipart/form-data). For voice
complaints, the transcript is sent as `description` and the recorded audio as
the `audio` file part (Web Speech API transcribes client-side before submit).

**Request — resident complaint (form-data):**
```
source_type   = "resident_complaint"
title         = "Lift button broken at Level 3"
description   = "Lift button 3 is stuck and does not respond"   (typed OR voice transcript)
location_block = "44A"
location_unit  = "12-05"
photo         = [binary file]          (optional)
audio         = [binary file]          (optional — raw recording if voice was used)
```

**Request — lift inspection (form-data):**
```
source_type   = "lift_inspection"
lift_id        = "a1b2c3d4-..."
location_block = "44A"
checklist      = [ { checklist_item_id, result, severity, remark, photo } , ... ]
```
**Response 201:**
```json
{
  "id": "INC-7f3a...",
  "title": "Lift button broken at Level 3",
  "status": "Open",
  "category": "Lift",
  "ai_priority_score": 72,
  "photo_url": "https://res.cloudinary.com/.../defects/INC-7f3a.jpg",
  "created_at": "2026-06-01T09:15:00Z"
}
```
**Error 400 — missing fields:**
```json
{ "code": "VALIDATION_ERROR", "fields": ["title", "location_block"] }
```
**Error 409 — duplicate:**
```json
{ "code": "DUPLICATE_SUBMISSION", "existing_id": "INC-7f3a...", "message": "A similar report was submitted 1 minute ago." }
```

---

#### GET /api/inspections
**Auth:** `manager`  
Returns all non-deleted records, sorted by AI priority / defect severity descending.

**Query params:** `?status=Open&category=Lift&block=44A&from=2026-05-01&to=2026-06-01`

**Response 200:**
```json
{
  "data": [
    {
      "id": "INC-7f3a...",
      "title": "Lift button broken at Level 3",
      "location_block": "44A",
      "category": "Lift",
      "priority": "High",
      "ai_priority_score": 72,
      "status": "Open",
      "resident_name": "Ali Hassan",
      "created_at": "2026-06-01T09:15:00Z"
    }
  ],
  "total": 1
}
```

---

#### GET /api/inspections/my
**Auth:** `resident` or `inspector`  
Returns all records submitted by the authenticated originator.

**Response 200:**
```json
{
  "data": [
    {
      "id": "INC-7f3a...",
      "title": "Lift button broken at Level 3",
      "status": "In Progress",
      "category": "Lift",
      "assigned_department": "Lift",
      "created_at": "2026-06-01T09:15:00Z",
      "updated_at": "2026-06-01T11:00:00Z"
    }
  ]
}
```

---

#### GET /api/inspections/:id
**Auth:** `resident` | `inspector` | `manager` | `contractor`  
Returns full record detail including checklist results, audit history, signatures, and (for voice complaints) the `audio_url`.

**Response 200:**
```json
{
  "id": "INC-7f3a...",
  "title": "Lift button broken at Level 3",
  "description": "Lift button 3 is stuck and does not respond",
  "location_block": "44A",
  "location_unit": "12-05",
  "photo_url": "https://res.cloudinary.com/.../defects/INC-7f3a.jpg",
  "status": "In Progress",
  "category": "Lift",
  "priority": "High",
  "ai_priority_score": 72,
  "assigned_department": "Lift",
  "target_resolution_hrs": 48,
  "satisfaction_rating": null,
  "source_flag": "Resident",
  "history": [
    {
      "action": "Assigned",
      "previous_status": "Open",
      "new_status": "In Progress",
      "actor_name": "Mdm Tan (Manager)",
      "created_at": "2026-06-01T11:00:00Z"
    }
  ],
  "created_at": "2026-06-01T09:15:00Z",
  "updated_at": "2026-06-01T11:00:00Z"
}
```
**Error 404:**
```json
{ "code": "NOT_FOUND", "message": "Incident not found or has been closed." }
```

---

#### PATCH /api/inspections/:id
**Auth:** `manager`  
Updates priority, contractor assignment, deadline, or status (UC-002).

**Request:**
```json
{
  "priority": "Critical",
  "assigned_department": "Lift",
  "target_resolution_hrs": 24,
  "status": "In Progress",
  "note": "Technician confirmed visit for 3 Jun"
}
```
**Response 200:**
```json
{
  "id": "INC-7f3a...",
  "status": "In Progress",
  "priority": "Critical",
  "assigned_department": "Lift",
  "updated_at": "2026-06-01T11:00:00Z"
}
```

---

#### POST /api/inspections/:id/close
**Auth:** `manager`  
Closes a record with a mandatory closing remark, dual e-signature, and optional `actual_cost` (UC-004).

**Request:**
```json
{ "closing_remark": "Lift technician replaced faulty button. Verified working." }
```
**Response 200:**
```json
{
  "id": "INC-7f3a...",
  "status": "Closed",
  "is_deleted": true,
  "resolution_time_hours": 25.75,
  "closed_at": "2026-06-02T10:55:00Z"
}
```
**Error 400 — remark too short:**
```json
{ "code": "VALIDATION_ERROR", "message": "Closing remark must be at least 10 characters." }
```

---

#### POST /api/inspections/:id/rating
**Auth:** `resident`  
Submits a satisfaction rating on a resolved complaint (UC-003).

**Request:**
```json
{ "rating": 4, "comment": "Fixed quickly, thank you!" }
```
**Response 200:**
```json
{ "id": "INC-7f3a...", "satisfaction_rating": 4, "satisfaction_comment": "Fixed quickly, thank you!" }
```
**Error 409 — already rated:**
```json
{ "code": "ALREADY_RATED", "message": "You have already submitted a rating for this record." }
```

---

### 6.3 Analytics

#### GET /api/analytics/issues-by-block
**Auth:** `manager`

**Query params:** `?from=2026-05-01&to=2026-06-01&category=Lift`

**Response 200:**
```json
{
  "data": [
    { "block": "44A", "category": "Lift",       "count": 5 },
    { "block": "44A", "category": "Electrical", "count": 2 },
    { "block": "88B", "category": "Plumbing",   "count": 7 }
  ]
}
```

---

#### GET /api/analytics/trends
**Auth:** `manager`

**Response 200:**
```json
{
  "data": [
    { "date": "2026-05-28", "count": 3 },
    { "date": "2026-05-29", "count": 6 },
    { "date": "2026-05-30", "count": 2 }
  ]
}
```

---

#### GET /api/analytics/sla-compliance
**Auth:** `manager`

**Response 200:**
```json
{
  "compliant_count": 42,
  "total_resolved": 55,
  "sla_percentage": 76.36,
  "sla_threshold_hrs": 72
}
```

---

### 6.4 AI Recommendations

> **UC-004 → UC-006 trigger flow:** When `POST /inspections/:id/close` runs (UC-004), the controller checks whether the count of closed incidents for the same `location_block + category` in the last 30 days has reached the recurrence threshold (≥ 3). If so, it inserts a row into the `ai_jobs` table referencing the triggering incident. The nightly `GET /api/recommendations/run` call (triggered by GitHub Actions) reads all `pending` rows from `ai_jobs` first, processes those block+category pairs with elevated priority, then runs the general velocity scan across all pairs. This ensures that any block that just hit the recurrence threshold is guaranteed to be analysed on the next nightly run, even if its velocity would not otherwise have crossed the 40% threshold.

---

#### GET /api/recommendations
**Auth:** `manager`  
Returns all active (non-dismissed, non-accepted) AI risk alerts. Called by the dashboard on page load and after filter changes to populate the amber recommendation cards above the heatmap.

**Query params:** `?status=Active` *(default; also accepts `Accepted`, `Dismissed`, `all`)*

**Response 200:**
```json
{
  "data": [
    {
      "id": "pred-abc123...",
      "location_block": "44A",
      "category": "Lift",
      "velocity_pct": 60.0,
      "alert_text": "Block 44A lift failures have increased 60% in 30 days. Recommend preventive inspection before end of month.",
      "status": "Active",
      "created_at": "2026-06-02T02:05:00Z"
    },
    {
      "id": "pred-def456...",
      "location_block": "88B",
      "category": "Plumbing",
      "velocity_pct": 45.0,
      "alert_text": "Block 88B plumbing complaints up 45% vs prior period. Inspect riser pipes before wet season.",
      "status": "Active",
      "created_at": "2026-06-02T02:06:00Z"
    }
  ],
  "total": 2
}
```
**Error 401:** No JWT or expired token → `{ "code": "UNAUTHORIZED" }`  
**Error 403:** Non-manager role → `{ "code": "FORBIDDEN" }`

---

#### GET /api/recommendations/run
**Auth:** `CRON_SECRET` header  
Runs the nightly AI velocity analysis. Called by GitHub Actions at 02:00 SGT daily. Also callable on-demand by the manager via the "Run Analysis Now" button (which hits the backend, not the browser).

**Internal logic (in order):**
1. Query `ai_jobs` table for all rows with `status = 'pending'` → process these block+category pairs first.
2. Run velocity analysis across all lift/block+category pairs from the `inspections` table.
3. For pairs where velocity ≥ 40%: call OpenAI, insert into `ai_predictions`, mark `ai_jobs` row as `processed`.
4. Return summary.

**Response 200:**
```json
{
  "alerts_generated": 2,
  "skipped": 5,
  "ai_jobs_processed": 1,
  "alerts": [
    {
      "id": "pred-abc123...",
      "location_block": "44A",
      "category": "Lift",
      "velocity_pct": 60.0,
      "alert_text": "Block 44A lift failures have increased 60% in 30 days. Recommend preventive inspection before end of month.",
      "triggered_by_ai_job": true
    }
  ]
}
```

---

#### POST /api/recommendations/:id/accept
**Auth:** `manager`  
Accepts an AI alert and auto-creates a maintenance ticket.

**Response 201:**
```json
{
  "prediction_id": "pred-abc123...",
  "status": "Accepted",
  "maintenance_record_created": {
    "id": "INC-maint-9f2b...",
    "title": "Auto-generated: Block 44A Lift preventive maintenance",
    "priority": "High",
    "source_flag": "AI-Generated",
    "status": "Open"
  }
}
```

---

#### POST /api/recommendations/:id/dismiss
**Auth:** `manager`

**Response 200:**
```json
{ "prediction_id": "pred-abc123...", "status": "Dismissed", "dismissed_at": "2026-06-01T02:15:00Z" }
```

---

### 6.5 Reports

#### GET /api/reports/generate
**Auth:** `CRON_SECRET` header  
Triggered by GitHub Actions weekly. Generates PDF and emails manager.

**Response 200:**
```json
{
  "report_id": "rpt-xyz789...",
  "period_start": "2026-05-26",
  "period_end": "2026-06-01",
  "report_url": "https://res.cloudinary.com/.../reports/weekly-2026-06-01.pdf",
  "email_delivered": true,
  "triggered_by": "github_actions"
}
```

---

#### POST /api/reports/generate-manual
**Auth:** `manager` (JWT)  
Manager-triggered report generation mid-week.

**Response 201:** *(same shape as above, `triggered_by: "manual"`)*

---

#### GET /api/reports
**Auth:** `manager`  
Lists all generated reports.

**Response 200:**
```json
{
  "data": [
    {
      "id": "rpt-xyz789...",
      "report_url": "https://res.cloudinary.com/.../reports/weekly-2026-06-01.pdf",
      "period_start": "2026-05-26",
      "period_end": "2026-06-01",
      "generated_at": "2026-06-02T07:00:00Z",
      "triggered_by": "github_actions"
    }
  ]
}
```

---

### 6.6 Notifications

#### POST /api/notifications
**Auth:** `manager`  
Sends or schedules a block-scoped notification.

**Request:**
```json
{
  "message": "Water supply will be interrupted on 3 Jun 09:00–12:00 for pipe maintenance.",
  "scope": { "blocks": ["44A", "44B"], "type": "specific" },
  "urgency": "Warning",
  "send_time": null
}
```
**Response 201:**
```json
{
  "notification_id": "notif-123...",
  "status": "Sent",
  "recipients_count": 34,
  "sent_at": "2026-06-01T10:00:00Z"
}
```

---

#### Scheduled notification dispatch — server-side

> **Not a REST endpoint.** Scheduled notification dispatch is handled by a `setInterval` loop (`notificationDispatcher.js`) running inside the Express process, polling every 60 seconds. This avoids consuming GitHub Actions free minutes. The `GET /api/notifications/dispatch` endpoint previously documented here has been removed. The `dispatchDueNotifications()` function is called internally on each tick. No external trigger or CRON_SECRET is required.

#### GET /api/notifications/:id/receipts
**Auth:** `manager`

**Response 200:**
```json
{ "notification_id": "notif-123...", "total_recipients": 34, "read_count": 12, "unread_count": 22 }
```

---

#### PATCH /api/notifications/:id/read
**Auth:** `resident`  
Marks a notification as read for the authenticated resident.

**Response 200:**
```json
{ "notification_id": "notif-123...", "read": true, "read_at": "2026-06-01T10:05:00Z" }
```

---

### 6.7 Computer Vision

#### POST /api/cv/detect
**Auth:** Internal (called from `inspectionController` after photo upload)  
Sends an image to Roboflow and returns detection results.

**Request:**
```json
{ "image_url": "https://res.cloudinary.com/.../defects/INS-7f3a.jpg", "inspection_id": "INS-7f3a..." }
```
**Response 200 — high confidence:**
```json
{
  "cv_detection_id": "cv-det-abc...",
  "defect_class": "crack",
  "confidence": 0.87,
  "bounding_box": { "x": 120, "y": 80, "width": 200, "height": 60 },
  "ticket_created": true,
  "inspection_id": "INS-auto-9k2m..."
}
```
**Response 200 — low confidence:**
```json
{
  "cv_detection_id": "cv-det-abc...",
  "defect_class": "water_stain",
  "confidence": 0.54,
  "bounding_box": { "x": 50, "y": 30, "width": 90, "height": 45 },
  "ticket_created": false,
  "status": "low_confidence",
  "flagged_for_review": true
}
```

---

#### GET /api/cv/batch-scan
**Auth:** `CRON_SECRET` header  
Processes images in `retry_queue` that failed earlier.

**Response 200:**
```json
{ "processed": 3, "failed": 1, "remaining": 0 }
```

---

### 6.8 Health Check

#### GET /health
**Auth:** None  
Used by UptimeRobot to keep Render service warm.

**Response 200:**
```json
{ "status": "ok", "timestamp": "2026-06-01T10:00:00Z" }
```

---

### 6.9 Contractor Portal (UC-010)

#### GET /api/contractor/assigned
**Auth:** `contractor`  
Returns records where `contractor_id` matches the authenticated contractor, sorted by `target_deadline` ascending, each with a days-to-deadline countdown.

**Response 200:**
```json
{
  "data": [
    {
      "id": "INS-9k2m...",
      "lift": "44A-L1",
      "location_block": "44A",
      "defect_summary": "Landing door misalignment (Major)",
      "target_deadline": "2026-06-20T00:00:00Z",
      "days_remaining": 6,
      "status": "Assigned"
    }
  ]
}
```

#### POST /api/contractor/:id/acknowledge
**Auth:** `contractor`  
Sets status → "Acknowledged", records `acknowledged_at`, appends audit entry, emits Socket.IO to manager + originator.

**Response 200:**
```json
{ "id": "INS-9k2m...", "status": "Acknowledged", "acknowledged_at": "2026-06-14T09:00:00Z" }
```

#### POST /api/contractor/:id/rectify
**Auth:** `contractor`  
Submits completion photos + remarks per checklist item and the contractor e-signature (multipart/form-data). Sets status → "Rectified", records `rectified_at`, writes a `signatures` row (role `contractor`).

**Request (form-data):**
```
items        = [ { checklist_result_id, completion_remark, completion_photo } , ... ]
signature    = [binary PNG from canvas signature pad]
```
**Response 200:**
```json
{ "id": "INS-9k2m...", "status": "Rectified", "rectified_at": "2026-06-18T15:30:00Z", "signature_stored": true }
```
**Error 400 — signature missing:**
```json
{ "code": "SIGNATURE_REQUIRED", "message": "Signature not captured — please sign again." }
```

#### POST /api/contractor/:id/hold
**Auth:** `contractor`  
Marks a defect "On Hold" with a reason (access denied / part on order / out of scope); pauses the deadline countdown and notifies the manager (UC-010 Alt Flow A).

---

### 6.10 Admin Cost Analytics (UC-011)

> All figures are operational maintenance costs derived from this system's own data (`inspections.actual_cost`, `ai_predictions.estimated_cost`). This dashboard does **not** ingest EM Services' corporate financial statements.

#### GET /api/admin/costs/summary
**Auth:** `admin`  
**Query:** `?period=...&block=...&lift=...&contractor=...`
```json
{
  "total_actual": 18240.50,
  "total_projected": 7600.00,
  "variance_pct": -12.3,
  "period": "2026-06"
}
```

#### GET /api/admin/costs/by-category
**Auth:** `admin` → bar chart data: actual cost grouped by category/lift.
```json
{ "data": [ { "category": "Doors", "actual_cost": 6200.00 }, { "category": "Electrical", "actual_cost": 4100.00 } ] }
```

#### GET /api/admin/costs/by-contractor
**Auth:** `admin` → cost-per-contractor table (pairs with UC-005 scorecard).
```json
{ "data": [ { "contractor": "Otis", "actual_cost": 9800.00, "jobs": 14 } ] }
```

#### GET /api/admin/costs/trend
**Auth:** `admin` → cost over time for the trend line chart.
```json
{ "data": [ { "month": "2026-04", "actual_cost": 5200.00 }, { "month": "2026-05", "actual_cost": 6100.00 } ] }
```

---

### 6.11 Export (UC-005 / UC-011)

#### POST /api/export/pptx
**Auth:** `manager` | `admin`  
Renders the current filtered dashboard (charts + tables) into a PowerPoint deck server-side (PptxGenJS) and returns a download URL. Directly addresses the weekly-meeting PPT-conversion pain point (4C-2 / 4D).

**Request:**
```json
{ "views": ["heatmap","sla_gauge","contractor_scorecard"], "filters": { "block": "44A", "period": "2026-06" } }
```
**Response 200:**
```json
{ "pptx_url": "https://res.cloudinary.com/.../reports/dashboard-2026-06.pptx" }
```
**Error 500 — generation failed:**
```json
{ "code": "EXPORT_FAILED", "message": "Export failed — please try again or use CSV." }
```

---

### 6.12 Vendor Account Lifecycle (UC-012)

> Scoped to external vendor (contractor) accounts only. EM Services' own staff
> (inspector/manager) are long-term employee accounts handled by EM's existing
> HR/IT processes — out of scope (see Limitations).

#### POST /api/admin/vendors
**Auth:** `admin`  
Onboards a new external vendor. Admin manually enters vendor details and
contract duration (no automated contract parsing — deliberate scope decision);
the contract document is uploaded to Cloudinary `/contracts` for record-keeping
only. Creates a `contractors` row and a linked `users` row
(`role = 'contractor'`, `status = 'active'`).

**Request (form-data):**
```
name             = "Otis Elevator Co."
contact_email    = "service@otis.example.com"
brands_serviced  = "Otis"
contract_start   = "2026-07-01"
contract_end     = "2027-06-30"
contract_doc     = [binary PDF/DOCX]
login_email      = "otis.contractor@example.com"
login_password   = [admin-set temporary password]
```
**Response 201:**
```json
{
  "contractor_id": "CTR-4f2a...",
  "user_id": "USR-9b1c...",
  "status": "active",
  "contract_end": "2027-06-30",
  "contract_doc_url": "https://res.cloudinary.com/.../contracts/otis.pdf"
}
```
**Error 400 — invalid dates:**
```json
{ "code": "INVALID_CONTRACT_DATES", "message": "Contract end date must be after start date." }
```
**Error 409 — email exists:**
```json
{ "code": "EMAIL_ALREADY_EXISTS", "message": "An account with this email already exists." }
```

#### GET /api/admin/vendors
**Auth:** `admin`  
Lists all vendor accounts with contract status, sorted by `contract_end`
ascending (soonest-expiring first).

**Response 200:**
```json
{
  "data": [
    {
      "contractor_id": "CTR-4f2a...",
      "name": "Otis Elevator Co.",
      "status": "active",
      "contract_end": "2027-06-30",
      "days_until_expiry": 349
    }
  ]
}
```

#### POST /api/admin/vendors/:id/renew
**Auth:** `admin`  
Extends a vendor's contract with a new `contract_end` (optional new contract
document). If the account was `suspended` due to expiry, reactivates it to
`active`. Appends audit entry `Contract Renewed`.

**Request:**
```json
{ "contract_end": "2028-06-30" }
```
**Response 200:**
```json
{ "contractor_id": "CTR-4f2a...", "status": "active", "contract_end": "2028-06-30" }
```

#### POST /api/admin/vendors/:id/suspend
**Auth:** `admin`  
Manually suspends a vendor before contract end (early termination). Sets
`users.status = 'suspended'` immediately; open records assigned to that
contractor surface in the manager's "Pending Reassignment" queue (UC-002 Alt C).

**Response 200:**
```json
{ "contractor_id": "CTR-4f2a...", "status": "suspended" }
```

**Scheduled job — contract expiry check**
(`.github/workflows/contract-expiry-check.yml`, same pattern as §5.4): runs
daily, finds `contractors` where `contract_end < NOW()` and the linked
`users.status = 'active'`, sets status to `suspended`, and notifies `admin`
(Socket.IO + email) that the vendor has expired and their open records need
renewal or reassignment. Suspended vendors receive `403 ACCOUNT_SUSPENDED` at
login.

### 6.13 Data Playground (UC-005 Extension)

> Client-side only — no persistence, no schema impact. Verify details against
> the actual implementation (built in Claude Code) and amend if they differ.

No new backend endpoints. The playground parses uploaded CSV (PapaParse) or
XLSX (SheetJS) entirely in the browser, holds the dataset in component state
for the session, and renders ad-hoc charts with the shared UC-005 Chart.js
components. Charts built in the playground can be added to the current
PowerPoint export selection, which flows through the existing
`POST /api/export/pptx` (§6.11) — the exported deck simply includes the
playground chart images alongside dashboard charts. Limits: ≤ 5 MB per file;
`.csv`/`.xlsx` only; refresh clears all playground state.

## 7. Auth & Security

| Mechanism | Implementation |
|-----------|---------------|
| Password hashing | `bcrypt` with salt rounds = 12 |
| Authentication | JWT signed with `JWT_SECRET`, expiry 30 minutes, sliding window |
| Token storage | Frontend stores JWT **in memory only** (React context) — never localStorage |
| Role enforcement | `requireRole(...)` middleware — five roles (`resident`, `inspector`, `manager`, `contractor`, `admin`); contractor routes gated to own assignments, admin cost dashboard gated to `admin` only |
| Cron endpoint protection | `cronGuard.js` middleware validates `Authorization: Bearer <CRON_SECRET>` |
| CORS | `cors({ origin: process.env.FRONTEND_URL, credentials: true })` |
| Socket.IO CORS | `new Server(httpServer, { cors: { origin: process.env.FRONTEND_URL } })` |
| Rate limiting | `express-rate-limit`: 100 req/15 min per IP on auth routes |
| Input validation | All request bodies validated with `joi` or `zod` before controller |
| Error format | All errors return `{ code: "ERROR_CODE", message: "Human-readable" }` |

**Standardised Error Codes:**

| Code | HTTP | Meaning |
|------|------|---------|
| `INVALID_CREDENTIALS` | 401 | Wrong email or password |
| `UNAUTHORIZED` | 401 | Missing or expired JWT |
| `FORBIDDEN` | 403 | Role does not have access |
| `VALIDATION_ERROR` | 400 | Request body failed validation |
| `NOT_FOUND` | 404 | Resource does not exist |
| `DUPLICATE_SUBMISSION` | 409 | Duplicate record detected |
| `ALREADY_RATED` | 409 | Satisfaction rating already submitted |
| `EMAIL_ALREADY_EXISTS` | 400 | Registration email conflict |
| `SERVER_ERROR` | 500 | Unhandled internal error |

---

## 8. Environment Variables Reference

### Render (Backend)

| Variable | Example Value | Used By |
|----------|--------------|---------|
| `DATABASE_URL` | `postgresql://user:pass@host.supabase.co:5432/postgres` | All DB queries |
| `JWT_SECRET` | `s3cr3t-256bit-random-string` | `jwtHelpers.js` |
| `FRONTEND_URL` | `https://your-app.vercel.app` | CORS, Socket.IO |
| `NODE_ENV` | `production` | Express config |
| `CLOUDINARY_CLOUD_NAME` | `your-cloud-name` | `cloudinaryService.js` |
| `CLOUDINARY_API_KEY` | `123456789` | `cloudinaryService.js` |
| `CLOUDINARY_API_SECRET` | `abc123xyz` | `cloudinaryService.js` |
| `OPENAI_API_KEY` | `sk-proj-...` | `openaiService.js` |
| `ROBOFLOW_API_KEY` | `rf_abc123...` | `roboflowService.js` |
| `CRON_SECRET` | `cron-secret-32chars` | `cronGuard.js` |
| `SMTP_HOST` | `smtp.gmail.com` | `emailService.js` |
| `SMTP_USER` | `yourapp@gmail.com` | `emailService.js` |
| `SMTP_PASS` | `app-password` | `emailService.js` |

### Vercel (Frontend)

| Variable | Example Value | Used By |
|----------|--------------|---------|
| `VITE_API_URL` | `https://your-app.onrender.com` | `api.js` axios baseURL |

### GitHub Actions Secrets

| Secret | Example Value | Used By |
|--------|--------------|---------|
| `CRON_SECRET` | *(same as Render)* | All 3 workflow YAMLs |
| `RENDER_BACKEND_URL` | `https://your-app.onrender.com` | All 3 workflow YAMLs |

---

*End of HIGH_LEVEL_DESIGN.md*

---

## Limitations & Deliberate Scope Boundaries (UC-012 / Data Playground additions)

**Vendor account lifecycle (UC-012):** Contract detail extraction from the
uploaded document (vendor name, contact, duration) is entered manually by the
admin rather than auto-parsed — automated document parsing was considered and
scoped out as disproportionate effort for this project. The uploaded contract
file is retained for reference only. UC-012 is scoped exclusively to external
vendor (contractor) accounts; EM Services' own employees (inspector / manager)
are standard long-term accounts whose onboarding/offboarding is assumed to be
handled by EM's existing HR/IT processes, outside this system's scope.

**Data Playground (UC-005 extension):** Uploaded datasets are session-only and
never persisted — the playground is an exploration surface, not an ingestion
pipeline. This is deliberate: it lets managers explore external files (e.g.
client-provided exports) visually without any schema change or data-governance
burden, and cleanly separates ad-hoc analysis from the system's operational
data.
