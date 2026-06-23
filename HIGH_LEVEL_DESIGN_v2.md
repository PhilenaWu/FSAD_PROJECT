# HIGH_LEVEL_DESIGN.md
# Estate Incident Management System — High-Level Design

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Architecture Diagram](#2-architecture-diagram)
3. [Tech Stack](#3-tech-stack)
4. [Folder Structure](#4-folder-structure)
5. [Database Schema](#5-database-schema)
   - [5.11 Entity Relationship Summary](#511-entity-relationship-summary)
6. [API Endpoints](#6-api-endpoints)
7. [Auth & Security](#7-auth--security)
8. [Environment Variables Reference](#8-environment-variables-reference)

---

## 1. System Overview

The Estate Incident Management System is a full-stack web application that enables residents to report estate defects and estate managers to track, assign, and resolve them. The system integrates real-time notifications (Socket.IO), computer vision defect detection (Roboflow), AI categorisation and risk analysis (OpenAI), automated weekly PDF reporting (pdfkit + Cloudinary), and analytics dashboards (Chart.js).

**User Roles:**
| Role | Description |
|------|-------------|
| `resident` | Submits incident reports, tracks status, provides satisfaction ratings |
| `manager` | Reviews, assigns, and closes incidents; views analytics; sends notifications |
| `system` | Automated actor — runs CV pipeline, AI recommendations, weekly report |

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
│   ├── REST API routes (auth, incidents, analytics, reports…)         │
│   ├── Socket.IO server (manager-room, block-N rooms, incident-N)     │
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
- Resident submits report → Express stores in Supabase + uploads photo to Cloudinary → OpenAI categorises → Socket.IO notifies manager
- Photo triggers Roboflow CV pipeline → if confidence ≥ 70% → auto-ticket created → Socket.IO alert to manager
- Manager closes incident (UC-004) → if recurrence threshold met (≥ 3 same block+category in 30 days) → row inserted into `ai_jobs` table
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
│   │   ├── incidents.js         # CRUD for incident records
│   │   ├── analytics.js         # GET /analytics/issues-by-block, /trends, /sla-compliance
│   │   ├── recommendations.js   # GET /recommendations/run (AI engine trigger)
│   │   ├── reports.js           # GET /reports/generate, POST /reports/generate-manual
│   │   ├── notifications.js     # POST /notifications, GET /notifications/:id/receipts, PATCH /notifications/:id/read
│   │   └── cv.js                # POST /cv/detect, GET /cv/batch-scan
│   │
│   ├── controllers/
│   │   ├── authController.js        # register(), login(), logout()
│   │   ├── incidentController.js    # create(), list(), getById(), updateStatus(), close()
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
│   │   ├── pdfService.js            # buildWeeklyReport()
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
│   │   ├── incidentModel.js         # DB queries for incidents table
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
│   ├── 002_create_incidents.sql
│   ├── 003_create_incident_history.sql
│   ├── 004_create_cv_detections.sql
│   ├── 005_create_ai_predictions.sql
│   ├── 006_create_ai_jobs.sql
│   ├── 007_create_notifications.sql
│   ├── 008_create_notification_recipients.sql
│   ├── 009_create_reports.sql
│   └── 010_create_retry_queue.sql
│
├── tests/
│   ├── unit/
│   │   ├── auth.test.js
│   │   ├── incidents.test.js
│   │   ├── analytics.test.js
│   │   ├── recommendations.test.js
│   │   └── cv.test.js
│   └── integration/
│       ├── auth.integration.test.js
│       └── incidents.integration.test.js
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
│   │   ├── IncidentListPage.jsx     # UC-002: manager incident queue
│   │   ├── IncidentDetailPage.jsx   # UC-002 / UC-005: detail + status update
│   │   ├── ReportIssuePage.jsx      # UC-001: resident submission form
│   │   ├── MyReportsPage.jsx        # UC-003: resident status tracker
│   │   ├── NotificationsPage.jsx    # UC-008: manager notification composer
│   │   └── ReportsArchivePage.jsx   # UC-009: weekly PDF archive list
│   │
│   ├── components/
│   │   ├── auth/
│   │   │   └── LoginForm.jsx
│   │   ├── incidents/
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
│   │   ├── incidentService.js       # create(), list(), update(), close()
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

> All tables use PostgreSQL on Supabase (free tier, no expiry). Run migration files in order (001 → 010).

### 5.1 users

```sql
CREATE TABLE users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  full_name     VARCHAR(255) NOT NULL,
  role          VARCHAR(20)  NOT NULL CHECK (role IN ('resident', 'manager')),
  block_number  VARCHAR(20),                     -- residents only
  unit_number   VARCHAR(20),                     -- residents only
  status        VARCHAR(20)  NOT NULL DEFAULT 'active'
                             CHECK (status IN ('active', 'suspended')),
  created_at    TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMP NOT NULL DEFAULT NOW()
);
```

### 5.2 incidents

```sql
CREATE TABLE incidents (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  resident_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title                 VARCHAR(255) NOT NULL,
  description           TEXT NOT NULL,
  location_block        VARCHAR(20)  NOT NULL,
  location_unit         VARCHAR(20),
  photo_url             VARCHAR(500),            -- Cloudinary /defects URL
  photo_pending         BOOLEAN NOT NULL DEFAULT FALSE,
  status                VARCHAR(30)  NOT NULL DEFAULT 'Open'
                        CHECK (status IN (
                          'Open','Pending Assignment','In Progress',
                          'Awaiting Parts','Resolved','Closed'
                        )),
  category              VARCHAR(50)  NOT NULL DEFAULT 'Uncategorised'
                        CHECK (category IN (
                          'Structural','Electrical','Plumbing','Cleanliness',
                          'Lift','Landscaping','Pest','Other','Uncategorised'
                        )),
  priority              VARCHAR(20)  NOT NULL DEFAULT 'Medium'
                        CHECK (priority IN ('Critical','High','Medium','Low')),
  ai_priority_score     INTEGER      CHECK (ai_priority_score BETWEEN 1 AND 100),
  assigned_department   VARCHAR(100),
  target_resolution_hrs INTEGER,
  is_deleted            BOOLEAN NOT NULL DEFAULT FALSE,
  closing_remark        TEXT,
  resolution_time_hours NUMERIC(8,2),
  satisfaction_rating   INTEGER      CHECK (satisfaction_rating BETWEEN 1 AND 5),
  satisfaction_comment  TEXT,
  source_flag           VARCHAR(30)  DEFAULT 'Resident'
                        CHECK (source_flag IN ('Resident','Auto-Detected','AI-Generated')),
  cv_detection_id       UUID         REFERENCES cv_detections(id),
  closed_at             TIMESTAMP,
  created_at            TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_incidents_resident_id ON incidents(resident_id);
CREATE INDEX idx_incidents_status      ON incidents(status);
CREATE INDEX idx_incidents_category    ON incidents(category);
CREATE INDEX idx_incidents_block       ON incidents(location_block);
CREATE INDEX idx_incidents_created_at  ON incidents(created_at);
```

### 5.3 incident_history (audit log)

```sql
CREATE TABLE incident_history (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id     UUID NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  actor_id        UUID NOT NULL REFERENCES users(id),
  action          VARCHAR(50) NOT NULL,          -- 'Assigned','Reassigned','Priority Escalated','Closed','Force-Closed'
  previous_status VARCHAR(30),
  new_status      VARCHAR(30),
  note            TEXT,
  created_at      TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_incident_history_incident_id ON incident_history(incident_id);
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
  triggered_by    UUID NOT NULL REFERENCES incidents(id),
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
  incident_id UUID         REFERENCES incidents(id),
  attempts    INTEGER NOT NULL DEFAULT 0,
  status      VARCHAR(20)  NOT NULL DEFAULT 'pending'
              CHECK (status IN ('pending','processed','failed')),
  created_at  TIMESTAMP NOT NULL DEFAULT NOW(),
  retry_after TIMESTAMP NOT NULL DEFAULT NOW()
);
```

---

### 5.11 Entity Relationship Summary

The diagram below shows every foreign-key relationship across the 10 tables. Read each arrow as "references".

```
┌──────────┐          ┌─────────────────────┐          ┌─────────────────┐
│  users   │◄────────┤     incidents        ├─────────►│  cv_detections  │
│          │  resident│                     │cv_detect. │                 │
│ id (PK)  │  _id(FK) │ id (PK)             │_id (FK)   │ id (PK)         │
│ email    │          │ resident_id (FK)     │           │ image_url       │
│ role     │          │ cv_detection_id (FK) │           │ defect_class    │
│ block_   │◄─────────┤ status / category   │           │ confidence      │
│  number  │  actor_  │ priority            │           │ bounding_box    │
└──────────┘  id (FK) │ is_deleted          │           │ source / status │
     ▲                └──────────┬──────────┘           └─────────────────┘
     │                           │ incident_id (FK)
     │                ┌──────────▼──────────┐
     │                │  incident_history   │
     │  actor_id (FK) │                     │
     └────────────────┤ id (PK)             │
                      │ incident_id (FK)    │
                      │ actor_id (FK)       │
                      │ action / note       │
                      └─────────────────────┘

┌──────────┐          ┌─────────────────────┐
│  users   │◄────────┤   ai_predictions    │
│          │dismissed │                     │
│ id (PK)  │_by (FK)  │ id (PK)             │
└──────────┘          │ location_block      │
                      │ category            │
                      │ velocity_pct        │
                      │ alert_text          │
                      │ status              │
                      └─────────────────────┘

┌──────────┐          ┌─────────────────────┐
│ incidents│◄────────┤     ai_jobs          │
│          │triggered │                     │
│ id (PK)  │_by (FK)  │ id (PK)             │
└──────────┘          │ location_block      │
                      │ category            │
                      │ triggered_by (FK)   │
                      │ status              │
                      └─────────────────────┘

┌──────────┐          ┌─────────────────────┐          ┌──────────────────────────┐
│  users   │◄────────┤   notifications     ├──────────►│  notification_recipients │
│          │manager_  │                     │notif._id  │                          │
│ id (PK)  │id (FK)   │ id (PK)             │(FK)       │ id (PK)                  │
└──────────┘          │ message / scope     │           │ notification_id (FK)     │
     ▲                │ urgency / status    │           │ resident_id (FK)         │
     │                │ send_time / sent_at │           │ delivered / read         │
     └────────────────┴─────────────────────┘           └──────────────────────────┘
       resident_id (FK) ──────────────────────────────────────────► users.id

┌──────────────┐       ┌─────────────────────┐
│  incidents   │◄──── ┤    retry_queue       │
│              │incid. │                     │
│ id (PK)      │_id FK │ id (PK)             │
└──────────────┘       │ image_url           │
                       │ incident_id (FK)    │
                       │ attempts / status   │
                       └─────────────────────┘

┌──────────────┐
│   reports    │
│              │  (no FK relationships — standalone audit record)
│ id (PK)      │
│ report_url   │
│ period_start │
│ triggered_by │
└──────────────┘
```

**Written relationship summary:**

| Relationship | Type | Description |
|---|---|---|
| `users` → `incidents` | one-to-many | One resident submits many incidents (`incidents.resident_id → users.id`) |
| `incidents` → `incident_history` | one-to-many | One incident has many audit log entries (`incident_history.incident_id → incidents.id`). Cascades on delete. |
| `users` → `incident_history` | one-to-many | One manager/resident can be the actor on many audit entries (`incident_history.actor_id → users.id`) |
| `cv_detections` → `incidents` | one-to-one | An auto-detected defect links back to the incident it created (`incidents.cv_detection_id → cv_detections.id`). Optional — resident-submitted incidents have no CV detection. |
| `users` → `ai_predictions` | one-to-many | A manager can dismiss many predictions (`ai_predictions.dismissed_by → users.id`). Optional — active alerts have no dismisser. |
| `incidents` → `ai_jobs` | one-to-many | Closing a recurring incident inserts a job row referencing the triggering incident (`ai_jobs.triggered_by → incidents.id`) |
| `users` → `notifications` | one-to-many | One manager sends many notifications (`notifications.manager_id → users.id`) |
| `notifications` → `notification_recipients` | one-to-many | One notification has many per-resident delivery rows (`notification_recipients.notification_id → notifications.id`). Cascades on delete. |
| `users` → `notification_recipients` | one-to-many | One resident has many receipt rows across notifications (`notification_recipients.resident_id → users.id`). Cascades on delete. |
| `incidents` → `retry_queue` | one-to-many | Images that hit Roboflow rate limits are queued with a reference to the originating incident (`retry_queue.incident_id → incidents.id`). Optional FK. |
| `reports` | standalone | No foreign keys — the reports table is a self-contained audit archive of generated PDFs. |

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

### 6.2 Incidents

#### POST /api/incidents
**Auth:** `resident`  
Creates a new incident report with optional photo upload (multipart/form-data).

**Request (form-data):**
```
title         = "Lift button broken at Level 3"
description   = "Lift button 3 is stuck and does not respond"
location_block = "44A"
location_unit  = "12-05"
photo         = [binary file]
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

#### GET /api/incidents
**Auth:** `manager`  
Returns all non-deleted incidents, sorted by AI priority score descending.

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

#### GET /api/incidents/my
**Auth:** `resident`  
Returns all incidents submitted by the authenticated resident.

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

#### GET /api/incidents/:id
**Auth:** `resident` | `manager`  
Returns full incident details including audit history.

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

#### PATCH /api/incidents/:id
**Auth:** `manager`  
Updates priority, department, or status of an incident.

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

#### POST /api/incidents/:id/close
**Auth:** `manager`  
Soft-deletes an incident with a mandatory closing remark.

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

#### POST /api/incidents/:id/rating
**Auth:** `resident`  
Submits a satisfaction rating on a resolved incident.

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
{ "code": "ALREADY_RATED", "message": "You have already submitted a rating for this incident." }
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

> **UC-004 → UC-006 trigger flow:** When `POST /incidents/:id/close` runs (UC-004), the controller checks whether the count of closed incidents for the same `location_block + category` in the last 30 days has reached the recurrence threshold (≥ 3). If so, it inserts a row into the `ai_jobs` table referencing the triggering incident. The nightly `GET /api/recommendations/run` call (triggered by GitHub Actions) reads all `pending` rows from `ai_jobs` first, processes those block+category pairs with elevated priority, then runs the general velocity scan across all pairs. This ensures that any block that just hit the recurrence threshold is guaranteed to be analysed on the next nightly run, even if its velocity would not otherwise have crossed the 40% threshold.

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
2. Run velocity analysis across all block+category pairs from the `incidents` table.
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
  "incident_created": {
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
**Auth:** Internal (called from `incidentController` after photo upload)  
Sends an image to Roboflow and returns detection results.

**Request:**
```json
{ "image_url": "https://res.cloudinary.com/.../defects/INC-7f3a.jpg", "incident_id": "INC-7f3a..." }
```
**Response 200 — high confidence:**
```json
{
  "cv_detection_id": "cv-det-abc...",
  "defect_class": "crack",
  "confidence": 0.87,
  "bounding_box": { "x": 120, "y": 80, "width": 200, "height": 60 },
  "ticket_created": true,
  "incident_id": "INC-auto-9k2m..."
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

## 7. Auth & Security

| Mechanism | Implementation |
|-----------|---------------|
| Password hashing | `bcrypt` with salt rounds = 12 |
| Authentication | JWT signed with `JWT_SECRET`, expiry 30 minutes, sliding window |
| Token storage | Frontend stores JWT **in memory only** (React context) — never localStorage |
| Role enforcement | `requireRole('manager')` middleware on manager-only routes |
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
