# HIGH_LEVEL_DESIGN.md
# Lift Inspection & Estate Defect Management System — High-Level Design

> Problem statement: **4C-1 (Lift Inspection Digitalisation)** primary · **4C-2 (Interactive Dashboard)** secondary · **4D (Data-Driven Decision Making)** thematic
>
> **Requirements document of record:** Daniel Koh's *"Digitalise the Form on Spot-Check of Lift Servicing"* (10 Jun 2026) — the six-step current workflow (slide 2), the digitalisation advantages and design considerations (slide 3), and the two sample paper forms (slides 4–5). Where this design and that deck disagree, **the deck wins**.

---

## Table of Contents

1. [Client Requirement Traceability](#1-client-requirement-traceability)
2. [The Six-Step Workflow → System States](#2-the-six-step-workflow--system-states)
3. [System Overview & Roles](#3-system-overview--roles)
4. [Portal-to-Portal Flow](#4-portal-to-portal-flow)
5. [Architecture](#5-architecture)
6. [Tech Stack](#6-tech-stack)
7. [The Paper Form → Data Model Mapping](#7-the-paper-form--data-model-mapping)
8. [Database Schema](#8-database-schema)
9. [API Endpoints](#9-api-endpoints)
10. [Notification & Email Matrix](#10-notification--email-matrix)
11. [State Machine & Guard Rails](#11-state-machine--guard-rails)
12. [Auth & Security](#12-auth--security)
13. [Environment Variables](#13-environment-variables)
14. [Limitations & Deliberate Scope Boundaries](#14-limitations--deliberate-scope-boundaries)

---

## 1. Client Requirement Traceability

Every sentence of the client brief mapped to a use case, an owner, and its current build state. This table is the contract; §14 lists everything deliberately excluded.

| # | Client requirement (verbatim intent) | Use case | Owner | State |
|---|---|---|---|---|
| R1 | "A digital version of the spot-check form that works on mobile" | UC-001 | Philena | **Built** — `NewInspectionPage.jsx`; responsive pass in Phase 4 |
| R2 | "GPS auto-fill for location" | UC-001 | Philena | **Built** — `LocationCapture.jsx`, migration `017` |
| R3 | "a structured checklist **matching the existing paper form**" | UC-001 | Philena | **Built** — migration `026` seeds the real 25 items as Motor Room / Lift Car / Hoistway & Lift Pit; the form renders by section |
| R4 | "photo upload with automatic compression" | UC-001 | Philena | **Built** — `imageCompress.js` ≤100 KB client-side, **and** enforced server-side (`PHOTO_TOO_LARGE`, G4) |
| R5 | "severity tagging for each defect" | UC-001 | Philena | **Built** — `checklist_results.severity` ∈ Minor/Major/Critical |
| R6 | "**auto-email to the lift company when defects are flagged**" | UC-014 | Davian | **Built** — `emailService.sendDefectAlert` fires from the spot-check submit path, not just UC-009. Recipient resolved by `COALESCE(u.email, c.contact_email)` (§10); every send writes a `defect_email_log` row and stamps `inspections.defect_email_sent_at`. Covered by `tests/unit/defectEmail.test.js` |
| R7 | "The lift company should be able to acknowledge the defect on the same platform" | UC-010 | Zoe | **Built** — `POST /api/contractor/:id/acknowledge` |
| R8 | "submit completion photos" | UC-010 | Zoe | **Built** — `submitWork()`, `checklist_results.completion_photo_url` |
| R9 | "get a **digital sign-off from the EM Services inspector**" | UC-004 | Philena | **Built** — dual e-sign, endorser constrained to an inspector and verified against `users.role` (§11 G7); picker fed by `GET /api/users/inspectors` |
| R10 | "The entire paper trail should be replaced with a timestamped digital audit log" | UC-015 | Philena | **Partial** — `inspection_history` exists; must cover every transition incl. email + reject (§11) |
| R11 | Six-step workflow honoured end to end | §2 | All | **Partial** — steps 1 and 6-reject are the gaps |
| R12 | "Lift technician rectify the defects **within 2 weeks**" (form note 2) | UC-010 / UC-014 | Davian | **Partial** — 14-day default in migration `025`; overdue chase is new |
| R13 | "Spot-Checks shall be performed during contractor's **scheduled servicing date**" (form note 1) | UC-001 | Philena | **Built** — `inspections.serviced_at` (migration `027`), mandatory at submit (G1). The A1 "more than one day before" warning is still outstanding |
| R14 | "Option to attach photo (limit to 100k per photo)" + "No photos on minor issue" | UC-001 | Philena | **Built** — 100 KB enforced client- and server-side; Minor defects reject a photo (`PHOTO_NOT_ALLOWED_FOR_MINOR`), Major/Critical require one |
| R15 | "Lesser travelling time · save time on paperwork · use less paper" | outcome | — | Emergent from R1–R10 |
| R16 | "Proper record, audit" · "Download as file every year" | UC-009 | Davian | **Partial** — monthly PDF built; annual export is new |
| R17 | "Statistic / report" | UC-005 / UC-011 | Hasini / Davian | **Built** — both dashboards read live endpoints (`/api/analytics/*`, `/api/admin/costs/*`) |
| R18 | "Admin / user control · add new equipment and users with rights" | UC-012 | Hasini | **Built** — vendor API, cron-guarded expiry job and daily workflow, `AdminVendorPage`, audit trail in `vendor_history`; covered by `tests/Ginjala_Hasini/backend/vendors.test.js` |
| R19 | "Mimic data and stress test are required" | UC-016 | All | **Partial** — seed migrations `018`–`024` exist; stress test is new |
| R20 | Paper-preferring inspectors can photograph a completed form instead of tapping | UC-013 | Mahdiya | **New** — not requested by the client; a deliberate adoption aid (§14) |

---

## 2. The Six-Step Workflow → System States

Daniel Koh's slide 2 is the spine of the system. Nothing in the product exists outside this spine except the resident-complaint and analytics side-channels.

| Step (client's words) | Actor | Portal | System effect | `inspections.status` |
|---|---|---|---|---|
| **1.** "LMS staff plan the schedule according to monthly lift servicing schedule" | Inspector | Inspector | Inspector picks the lift and records the contractor's **`serviced_at`** on the form header | *(pre-record)* |
| **2.** "Lift technician completed servicing" | Contractor | *(off-system)* | Captured as the `serviced_at` the inspector enters — we do not schedule the LC's work | *(pre-record)* |
| **3.** "LMS staff inspect the site on next/following day and fill the inspection report" | Inspector | Inspector | UC-001: 25-item checklist, per-item Pass/Defect + severity + remark + photo, GPS, inspector e-signature | `Open` → `Pending Assignment` (≥1 defect) or `Closed` (0 defects, auto-filed) |
| **4.** "Finding on report (defect) will be informed to lift servicing supervisor for rectification" | System → Contractor | — | **UC-014 auto-email** to the vendor's **account holder** (`COALESCE(users.email, contractors.contact_email)` — see §10) + Socket.IO to `contractor-{user_id}`; manager confirms/reassigns in UC-002; 14-day deadline starts | `Pending Assignment` → `Assigned` |
| **5.** "Lift technician rectify the defects within 2 weeks" | Contractor | Contractor | UC-010: acknowledge → per-item completion photo + remark → contractor e-signature. Partial saves allowed; `On Hold` pauses the clock | `Assigned` → `Acknowledged` → `Rectified` |
| **6.** "LMS staff does joint inspection with lift companies · Lift technician will endorse on the clearing of defects" | Inspector + Manager | Manager | UC-004: inspector reviews completion proof. **Accept** → dual e-signature (manager + inspector) + `actual_cost` → closed. **Reject** → back to `Assigned` with a fresh deadline and a re-notify email | `Rectified` → `Closed`, or `Rectified` → `Assigned` |
| **7.** "File the document" | System | — | UC-015 immutable audit trail + UC-009 monthly PDF + annual export; record enters the 5-year archive | `Closed` |

**Why this ordering matters:** the auto-email fires at step 4, *before* manager triage, because the client's step 4 is an automatic consequence of a defect being found — not a management decision. Manager triage (UC-002) then adjusts priority, reassigns if the brand-derived contractor is wrong, or overrides the deadline. This keeps the digital flow faithful to the paper flow while still giving the manager control.

---

## 3. System Overview & Roles

A full-stack web application that digitises the paper-based lift spot-check workflow (4C-1) and, as a secondary channel, general resident estate-defect reports. Inspectors complete structured digital spot-checks on mobile; the lift company is emailed automatically and works the defect on the same platform; the inspector signs off the rectification jointly with the manager; every transition is written to a timestamped audit log. Analytics, cost intelligence, CV assistance, and automated reporting sit on top of that data.

| Role | Portal | Responsibility |
|---|---|---|
| `inspector` | Inspector | LMS staff. Performs spot-checks (UC-001), signs the form on submit, co-signs the joint endorsement at close (UC-004), may reject an inadequate rectification |
| `contractor` | Contractor | Lift company staff. Acknowledges (UC-010), rectifies, uploads completion photos, e-signs, may place a defect `On Hold` |
| `manager` | Manager | Triages and assigns (UC-002), closes with dual e-signature + actual cost (UC-004), sends notifications (UC-008), owns the analytics dashboard (UC-005) |
| `resident` | Resident | Secondary channel — reports general estate defects by text or voice (UC-001b), tracks own reports live, rates resolution (UC-003) |
| `admin` | Admin | Operational cost analytics (UC-011); external vendor account lifecycle (UC-012) |
| `system` | — | Automated actor: UC-014 emails, UC-007 CV, UC-006 AI, UC-009 reports, expiry + overdue cron jobs |

**Core data-model note:** a single `inspections` table stores all record types via a `source_type` discriminator (`lift_inspection`, `resident_complaint`, `cv_auto_detected`). All three share the same downstream lifecycle (triage → assign → rectify → endorse → close → audit), so one normalised table with type-specific nullable fields keeps the schema clean.

---

## 4. Portal-to-Portal Flow

The single most important property of this system is that a record **hands off cleanly between four portals with no dead ends and no manual re-keying**. Every arrow below is a state transition backed by an audit row, a socket event, and (where the recipient is off-platform) an email.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ INSPECTOR PORTAL                    /inspections/new                         │
│  pick lift → serviced_at → GPS → 25-item checklist (A/B/C)               │
│  per defect: severity + remark + photo(≤100KB, Major/Critical only)          │
│  sign form  ─────────────────────────────────────────────► SUBMIT            │
└───────────────┬──────────────────────────────────┬──────────────────────────┘
                │ 0 defects                        │ ≥1 defect
                ▼                                  ▼
        status = Closed                    status = Pending Assignment
        audit "Filed — no defects"         contractor auto-derived from lift.brand
        (no email, no LC involvement)      │
                                           ├──► UC-014 EMAIL to the vendor's account holder
                                           │      (defect table, severities, deadline, deep link)
                                           ├──► socket → contractor-{user_id}
                                           └──► socket → manager-room
                                                          │
┌─────────────────────────────────────────────────────────▼──────────────────┐
│ MANAGER PORTAL                      /inspections , /inspections/:id         │
│  triage queue sorted by severity/AI score → open record → confirm or        │
│  reassign contractor · set priority · override 14-day deadline              │
│  (reassign re-fires UC-014 email to the new LC)                             │
└───────────────────────────────┬─────────────────────────────────────────────┘
                                │ status = Assigned  (deadline clock running)
                                ▼
┌────────────────────────────────────────────────────────────────────────────┐
│ CONTRACTOR PORTAL                   /contractor-inbox                       │
│  inbox sorted by deadline, days-remaining countdown                         │
│  ACKNOWLEDGE ──────────────────────────────► status = Acknowledged          │
│  per defect: completion photo + remark  (save progress any number of times) │
│  ON HOLD (access denied / part on order / out of scope) → clock pauses      │
│  e-sign + SUBMIT WORK DONE ────────────────► status = Rectified             │
└───────────────────────────────┬─────────────────────────────────────────────┘
                                │ socket → manager-room + inspector-team
                                │ email → the inspector who raised it
                                ▼
┌────────────────────────────────────────────────────────────────────────────┐
│ MANAGER + INSPECTOR (joint endorsement, step 6)   /inspections/:id          │
│  side-by-side defect photo vs completion photo per item                     │
│                                                                             │
│  ACCEPT → manager e-sign + inspector e-sign + actual_cost ──► status Closed │
│           audit "Jointly endorsed & closed" · 5-year archive                │
│                                                                             │
│  REJECT → reason (mandatory ≥10 chars) ────────────────────► status Assigned│
│           new 14-day deadline · UC-014 re-notify email · audit "Rejected"   │
└───────────────────────────────┬─────────────────────────────────────────────┘
                                ▼
┌────────────────────────────────────────────────────────────────────────────┐
│ AUDIT + REPORTING (step 7 "File the document")                              │
│  inspection_history (append-only) · monthly PDF (UC-009) · annual export     │
│  analytics + contractor scorecard (UC-005) · cost dashboard (UC-011)        │
└────────────────────────────────────────────────────────────────────────────┘
```

**Resident side-channel (secondary):** `/report` → text or voice complaint → OpenAI categorisation → same `inspections` table → identical triage/assign/close path → resident tracks it live at `/my-reports` and rates it on resolution (UC-003).

---

## 5. Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        CLIENT LAYER (Vercel)                         │
│   Vite + React 18 · React Router v7 · MUI v6 · axios                │
│   @supabase/supabase-js  ── auth (signup/login/refresh) ─► Supabase │
│   Socket.IO client       ── WSS + access token ──────────► backend  │
└──────────────────────────────┬──────────────────────────────────────┘
                               │ HTTPS + WSS · Authorization: Bearer <supabase access token>
┌──────────────────────────────▼──────────────────────────────────────┐
│                       BACKEND LAYER (Render)                         │
│   Node 20 / Express 4                                                │
│   ├── REST routes: inspections, contractor, lifts, checklist-items,  │
│   │    contractors, users, analytics, recommendations, export, cv,   │
│   │    notifications, admin/vendors, reports                         │
│   ├── Socket.IO server — rooms: manager-room · admin-room ·          │
│   │    inspector-team · contractor-{user_id} · block-{n}             │
│   ├── middleware/auth.js — verifies the Supabase token via JWKS,     │
│   │    loads the users profile row, requireRole(...)                 │
│   ├── cronGuard.js — CRON_SECRET on scheduled endpoints              │
│   └── notificationDispatcher.js — 60 s setInterval                   │
└───────┬──────────────┬──────────────┬───────────────┬───────────────┘
        ▼              ▼              ▼               ▼
  ┌──────────┐  ┌────────────┐ ┌──────────┐  ┌────────────┐  ┌──────────┐
  │ Supabase │  │ Cloudinary │ │ Roboflow │  │ OpenAI     │  │Nodemailer│
  │PostgreSQL│  │ /defects   │ │ CV model │  │ gpt-4o-mini│  │  SMTP    │
  │ + Auth   │  │ /completed │ │          │  │ (+ vision  │  │ UC-014 + │
  │          │  │ /signatures│ │          │  │  for OCR)  │  │  UC-009  │
  │          │  │ /reports   │ │          │  │            │  │          │
  └──────────┘  └────────────┘ └──────────┘  └────────────┘  └──────────┘

┌─────────────────────────────────────────────────────────────────────┐
│                    SCHEDULED LAYER (GitHub Actions)                  │
│   nightly-recommendations.yml   → GET /api/recommendations/run      │
│   monthly-report.yml            → GET /api/reports/generate         │
│   contract-expiry-check.yml     → GET /api/admin/vendors/expiry-check│
│   overdue-defect-chase.yml      → GET /api/inspections/overdue-chase │
│   (all authenticated via CRON_SECRET header)                        │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│   UPTIME (UptimeRobot) — pings GET /health every 5 min              │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 6. Tech Stack

| Layer | Technology | Purpose |
|---|---|---|
| Frontend | Vite + React 18, React Router v7, MUI v6, axios | UI |
| Frontend deploy | Vercel | Static hosting |
| Backend | Node 20 + Express 4 | REST + Socket.IO |
| Backend deploy | Render | Web service |
| Database | Supabase PostgreSQL 15, `pg` Pool, **raw SQL only — no ORM** | Relational data |
| Migrations | numbered `.sql` under `backend/migrations`, applied by `scripts/migrate.js` | Schema source of truth |
| **Auth** | **Supabase Auth (client-side `@supabase/supabase-js`)** | Sign-up / login / logout / session refresh. **No custom auth endpoints, no `jsonwebtoken`, no `bcrypt`, no `JWT_SECRET`, no `password_hash` column.** Backend verifies the Supabase token against the project JWKS and reads the role from the `users` profile row |
| Image storage | Cloudinary | Defect photos, completion photos, signatures, PDF/PPTX reports |
| Real-time | Socket.IO 4 | Room-scoped live updates |
| Email | Nodemailer 6 | **UC-014 defect alerts to lift companies** + UC-009 report delivery + overdue chase |
| CV | Roboflow Inference API | Defect detection, 0.70 confidence threshold |
| AI / NLP | OpenAI `gpt-4o-mini` (+ vision for UC-013) | Categorisation, risk alerts, report summaries, form OCR |
| PDF | pdfkit | Monthly report + annual export |
| PowerPoint | PptxGenJS | Dashboard deck export |
| Charts | Chart.js 4 | Analytics |
| Voice | Web Speech API | Resident complaints, inspector remarks |
| Uploads | multer (memory storage) | Multipart → Cloudinary buffers |
| Validation | joi | Request bodies |
| Rate limiting | express-rate-limit | Abuse control |
| Scheduling | GitHub Actions (4 workflows) + in-process `setInterval` | Cron |

---

## 7. The Paper Form → Data Model Mapping

This section exists so that a marker can hold the sample form next to the app and see a 1:1 correspondence. **Nothing on the paper form may be unmapped.**

### 7.1 Form header

| Paper field | System field |
|---|---|
| TOWN COUNCIL | `lifts.town_council` — auto-filled from the selected lift, read-only |
| LIFT COMPANY | derived: `lifts.contractor_id → contractors.name` (read-only on the form) |
| BLOCK/LIFT | `inspections.lift_id → lifts.block_number + lifts.lift_code` (e.g. "44A / 44A-L1") |
| ADDRESS | `lifts.address` — auto-filled from the selected lift, read-only |

### 7.2 Checklist body — 25 items, three sections

`checklist_items` is re-seeded to the exact paper items. `section` becomes the paper's section letter + name; `display_order` preserves the paper's numbering.

| Section | # | `item_text` |
|---|---|---|
| **A — Motor Room** | 1 | Motor room cleanliness – Any debris? |
| | 2 | Cleanliness of traction machine – Any leakage? |
| | 3 | Controller contactors & relays – Any humming? |
| | 4 | Bearings – Any abnormal noise? |
| | 5 | Wire ropes (main rope & governor rope) and sheaves – Any wear or red dust? |
| | 6 | Brake drum & lining – Sign of worn off? Oily? |
| | 7 | Governor Machine – Any abnormal noise? |
| | 8 | Anti Crime device – Functioning? |
| | 9 | ARD & EBOPS – Functioning? Replacement date? |
| **B — Lift Car** | 1 | COB buttons & CPI – Functioning? |
| | 2 | Car Fan & Grille – Any abnormalities? |
| | 3 | Car lights & diffuser – Lighted up and clear? |
| | 4 | Car door operation – Any noise? |
| | 5 | Door side gaps – Less than 10mm? |
| | 6 | Sill to sill clearance – Less than 35mm? |
| | 7 | Safety edge & sensor – Functioning? |
| | 8 | Travelling – Any jerkiness? |
| **C — Hoistway & Lift Pit** | 1 | Hall buttons & HPI – Functioning? |
| | 2 | All landing door locks adjustment – Any noise? |
| | 3 | All landing door shoes, tracks and eccentric rollers clearance – Any sign of wear and tear? |
| | 4 | All landing door self-closing devices – Self-closing? |
| | 5 | Levelling at each landings – Level? |
| | 6 | Car top safety and cleanliness – Any safety netting? |
| | 7 | All safety switches – Functioning? |
| | 8 | Lift pit cleanliness – Any debris? |

The paper's **√ / X** column maps to `checklist_results.result` ∈ `Pass` | `Defect`. The paper's free-text **REMARKS** column maps to `checklist_results.remark` (voice-enabled). Severity and photo have **no paper equivalent** — they are the digital improvements the client asked for (R5, R14).

### 7.3 Form footer — the two signature blocks

| Paper field | System field | Written when |
|---|---|---|
| Servicing Date | `inspections.serviced_at` | UC-001 submit (step 1/2) |
| Date of spot checking | `inspections.created_at` | UC-001 submit (step 3) |
| Checked by | `inspections.inspector_id → users.full_name` | UC-001 submit |
| Signature (left block) | `signatures` row, `signer_role = 'inspector'` | **UC-001 submit** |
| Date of Rectification | `inspections.rectified_at` | UC-010 finalize (step 5) |
| Rectified by | `inspections.contractor_id → contractors.name` | UC-010 finalize |
| Signature (right block) | `signatures` row, `signer_role = 'contractor'` | UC-010 finalize |
| *(no paper equivalent)* | `signatures` rows `manager` + `inspector` at close | UC-004 joint endorsement (step 6) |

### 7.4 Form notes → enforced rules

| Paper note | Enforcement |
|---|---|
| "Spot-Checks shall be performed during contractor's scheduled servicing date" | `serviced_at` is **mandatory**; UI warns if `date_of_spot_check − serviced_at > 1 day` (the client's "next/following day"), but does not block — the inspector may override with a remark |
| "lift contractors are required to clear the defects … within 2 weeks" | `target_deadline` defaults to `NOW() + 14 days` (migration `025`); overdue chase emails at D−3 and D+0; SLA compliance measured against it |

---

## 8. Database Schema

> PostgreSQL on Supabase. Migrations `001`–`041` are applied; `backend/migrations/`
> is the source of truth for the schema, not this document. New work lands in `042`+.
> Two numbers are used twice (`025`, `036`, `037`) because parallel branches
> claimed them independently; `migrate.js` sorts lexically, so each pair is
> order-independent and both files apply.

### 8.1 Tables as built

19 tables. The core set below, plus three added after this section was first
written: `defect_email_log` (`036`, UC-014 send audit), `feedback` (`036`,
sidebar feedback form), and `contact_directory` (`039`, §8.4).

`users` · `contractors` · `lifts` · `inspections` · `inspection_history` · `checklist_items` · `checklist_results` · `signatures` · `cv_detections` · `ai_predictions` · `ai_jobs` · `notifications` · `notification_recipients` · `reports` · `retry_queue` · `vendor_history` · `defect_email_log` · `feedback` · `contact_directory`

Key columns already in place and relied on below:

```sql
-- users (Supabase auth user id is the PK; NO password_hash — Supabase Auth owns credentials)
id UUID PK · email · full_name · role CHECK IN
  ('resident','inspector','manager','contractor','admin')
block_number · unit_number · contractor_id
status CHECK IN ('active','suspended','pending','rejected')  -- 'pending'/'rejected'
                                                   -- added by migration 037
job_title    -- vendor account holders (migration 020)
phone        -- staff contact number (migration 038); NULL for roles that
             -- publish none. Read by GET /api/users/contacts

-- inspections (core record)
id · source_type CHECK IN ('lift_inspection','resident_complaint','cv_auto_detected')
resident_id · inspector_id · lift_id · contractor_id
title · description · audio_url · location_block · location_unit
photo_url · photo_pending
status CHECK IN ('Open','Pending Assignment','Assigned','Acknowledged',
                 'On Hold','Rectified','Resolved','Closed')
category · priority · ai_priority_score
target_deadline  DEFAULT (NOW() + INTERVAL '14 days')   -- migration 025
acknowledged_at · rectified_at · hold_reason
gps_lat · gps_lng · gps_accuracy_m · gps_captured_at    -- migration 017
is_deleted · closing_remark · resolution_time_hours · actual_cost
source_flag · cv_detection_id
closed_at · created_at · updated_at

-- checklist_items      section · item_text · display_order · active
-- checklist_results    inspection_id · checklist_item_id · result CHECK IN ('Pass','Defect')
--                      severity CHECK IN ('Minor','Major','Critical') · remark · photo_url
--                      completion_photo_url · completion_remark · rectified
-- signatures           inspection_id · signer_role CHECK IN ('inspector','manager','contractor')
--                      signer_id · image_url · signed_at
-- inspection_history   inspection_id · actor_id · action · previous_status · new_status
--                      note · created_at
```

### 8.2 New migrations required

> **As-built note.** This section was written before implementation and the
> delivered migrations differ — both in numbering and in where two columns
> landed. The authoritative list is below; `backend/migrations/` is the source
> of truth.
>
> | Planned | Delivered | Difference |
> |---|---|---|
> | `026_add_paper_form_fields` | `027_add_serviced_at_to_inspections.sql` | Column is **`inspections.serviced_at`**, not `servicing_date` |
> | (same) | `028_add_town_council_address_to_lifts.sql` | **`lifts.town_council` / `lifts.address`**, not on `inspections` — they are properties of the lift, constant per block, so storing them per inspection would duplicate the same value on every record and let two checks of one lift disagree. Shown read-only on the form, auto-filled from the lift |
> | (same) | `031_add_reopen_count_to_inspections.sql` | Split into its own migration |
> | (same) | **built** | `inspections.defect_email_sent_at` — landed with UC-014 (D.3) alongside `036_create_defect_email_log.sql`; stamped on every successful send |
> | `027_reseed_checklist_paper_form` | `026_seed_spot_check_checklist.sql` | Numbering swapped with the above |
> | `028_create_defect_email_log` | `036_create_defect_email_log.sql` | Same table, later number — UC-014 landed after the `029`–`035` seed/feature migrations |
>
> The `idx_inspections_servicing_date` index was not created: the column is
> queried only via a single record, never ranged over.

**`027_reseed_checklist_paper_form.sql`** — replaces the 10 placeholder items with the 25 real ones.

```sql
-- Retire the placeholder template without breaking historical results
-- (checklist_results.checklist_item_id is a FK — never DELETE, only deactivate).
UPDATE checklist_items SET active = FALSE;

INSERT INTO checklist_items (section, item_text, display_order)
SELECT v.section, v.item_text, v.display_order
FROM (VALUES
  ('A — Motor Room', 'Motor room cleanliness – Any debris?', 1),
  -- … all 25 rows from §7.2 …
  ('C — Hoistway & Lift Pit', 'Lift pit cleanliness – Any debris?', 25)
) AS v(section, item_text, display_order)
WHERE NOT EXISTS (SELECT 1 FROM checklist_items c WHERE c.item_text = v.item_text);
```

> **Loophole closed:** deactivating rather than deleting keeps every historical `checklist_results` row resolvable. `GET /api/checklist-items` returns `active = TRUE` only; the detail view resolves item text by id regardless of `active`.

**`028_create_defect_email_log.sql`** — auditable proof that step 4 happened.

```sql
CREATE TABLE defect_email_log (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inspection_id  UUID NOT NULL REFERENCES inspections(id) ON DELETE CASCADE,
  contractor_id  UUID NOT NULL REFERENCES contractors(id),
  recipient      VARCHAR(255) NOT NULL,
  email_type     VARCHAR(30)  NOT NULL
                 CHECK (email_type IN ('defect_alert','reassignment','overdue_chase','rejection')),
  status         VARCHAR(20)  NOT NULL DEFAULT 'sent'
                 CHECK (status IN ('sent','failed')),
  error_message  TEXT,
  sent_at        TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_defect_email_log_inspection ON defect_email_log(inspection_id);
```

### 8.3 Entity relationships (unchanged core)

`inspections` is the hub. `users` → inspections (as resident / inspector), `lifts` → inspections, `contractors` → inspections and → lifts, `inspections` → {`inspection_history`, `checklist_results`, `signatures`, `defect_email_log`, `retry_queue`} (all cascade on delete), `checklist_items` → `checklist_results`, `cv_detections` ↔ `inspections`, `notifications` → `notification_recipients` → `users`, `contractors` → `vendor_history`. `reports` is standalone.

---

### 8.4 Contact data — `users.phone` + `contact_directory` (migrations `038`, `039`)

Not in the original design. The sidebar "Need help?" card and the emergency
contacts page were showing phone numbers hardcoded in the frontend — a
fabricated `1800-123-4567` in `ResidentLayout`, and a literal `CONTACTS` array
in `EmergencyContactsPage`. Neither could reflect who actually holds a role, and
changing a number meant a redeploy. The numbers are split across two places
because they are two different kinds of thing:

| Kind | Where it lives | Served by |
|---|---|---|
| A **person's** number (admin, manager) | `users.phone` — nullable, beside `full_name`/`email` on the profile row it describes | `GET /api/users/contacts` |
| An **organisation's** number (managing office, Police, Fire & Ambulance) | `contact_directory` — these are not user accounts, so a profile column cannot hold them | `GET /api/contacts` |

```sql
CREATE TABLE contact_directory (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  label        VARCHAR(120) NOT NULL UNIQUE,   -- UNIQUE ⇒ re-seed is idempotent
  description  VARCHAR(255),
  phone        VARCHAR(30)  NOT NULL,
  category     VARCHAR(20)  NOT NULL CHECK (category IN ('estate','emergency')),
  icon_key     VARCHAR(30),      -- stable presentation key, NOT a component name:
                                 -- the frontend maps it to an icon and falls back
                                 -- to a generic phone icon for anything new
  is_help_line BOOLEAN NOT NULL DEFAULT FALSE,  -- the one row the sidebar dials
  sort_order   INT     NOT NULL DEFAULT 0,
  created_at   TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMP NOT NULL DEFAULT NOW()
);
```

`is_help_line` is an explicit flag rather than "whichever `estate` row sorts
first", so changing which number the sidebar dials is a visible one-field edit
and not a side effect of reordering.

**Scope boundary.** `AppShell.jsx` and `EmergencyContactsPage.jsx` are owned by
the shared per-role help/contacts component, which had not merged at the time of
writing. The schema, both endpoints and the layout wiring are built and tested;
`EmergencyContactsPage` still renders its static array and is the one consumer
not yet switched over. See §14.9.

## 9. API Endpoints

> All authenticated routes require `Authorization: Bearer <supabase access token>`.
> All cron routes require `Authorization: Bearer <CRON_SECRET>`.
> All errors use `{ code, message }`.

### 9.1 Built and mounted (do not change signatures)

| Method + path | Role | Purpose |
|---|---|---|
| `GET /health` | — | UptimeRobot liveness |
| `GET /api/users/me` | any | Profile row for the Supabase auth user |
| `GET /api/lifts` | inspector | Lift picker for UC-001 |
| `GET /api/checklist-items` | any | Active checklist template, grouped by section |
| `GET /api/contractors` | manager | Assignment dropdown |
| `POST /api/inspections` | resident | UC-001b resident complaint (`photo` optional). Documented here as `/complaint` until the as-built check below; the mounted path has no suffix |
| `POST /api/inspections/lift` | inspector | UC-001 spot-check (`upload.any()`) |
| `GET /api/inspections/my` | resident, inspector | Own submissions |
| `GET /api/inspections/status-board` | any | Shared status board |
| `GET /api/inspections` | manager | Triage queue |
| `GET /api/inspections/:id` | any (scoped) | Full detail + checklist + history + signatures |
| `PATCH /api/inspections/:id` | manager | UC-002 triage: priority, contractor, deadline, status, hold |
| `POST /api/inspections/:id/close` | manager | UC-004 close: `manager_signature` + `endorser_signature` + cost, plus `waiver_note` when overriding G8 |
| `POST /api/inspections/:id/reject` | manager | UC-004 Alt 4: `{ reason }` (≥10 chars) → back to `Assigned`, `reopen_count++`, fresh 14-day deadline |
| `GET /api/users/inspectors` | manager | Active inspectors, for the close panel's G7 endorser picker |
| `GET /api/contractor/assigned` | contractor | UC-010 inbox with days-remaining |
| `POST /api/contractor/:id/acknowledge` | contractor | UC-010 step 5 start |
| `POST /api/contractor/:id/rectify` | contractor | UC-010 completion photos + e-sign (`upload.any()`) |
| `POST /api/contractor/:id/hold` | contractor | UC-010 Alt A — pause the clock |
| `GET /api/analytics/{filter-options,summary,issues-by-block,trends,sla-compliance,contractor-scorecard,priority-queue}` | manager | UC-005. All accept `?from&to&block&category&section`. `section` selects inspections carrying at least one **Defect** in that section of the paper form, resolved through `checklist_results → checklist_items.section` — so it follows the template rather than a hardcoded list. `filter-options` returns `{ blocks, categories, sections }`; `contractor-scorecard` returns `avg_reopens` (NULL until migration `026`) |
| `GET /api/recommendations` · `GET /run` · `POST /:id/accept` · `POST /:id/dismiss` | manager / cron | UC-006 |
| `POST /api/export/pptx` | manager, admin | UC-005/011 deck |
| `GET /api/cv/detections` · `GET /api/cv/batch-scan` | manager / cron | UC-007 |
| `POST /api/notifications` · `GET /:id/receipts` · `PATCH /:id/read` | manager / any | UC-008 |
| `POST /api/admin/vendors` · `GET /` · `GET /expiry-check` · `POST /run-expiry-check` · `POST /:id/renew` · `POST /:id/suspend` · `PATCH /:id` · `GET /:id/history` | admin / cron | UC-012 |
| `GET /api/reports/generate` · `POST /generate-manual` · `GET /` | cron / manager / admin | UC-009 |

**Also mounted, added after §9.1 was first written.** Verified against
`backend/src/routes/` — roles are the `requireRole(...)` argument on each route.

| Method + path | Role | Purpose |
|---|---|---|
| `POST /api/users/register-profile` | any authed | Resident self-registration. Writes `role='resident', status='pending'` as SQL literals, so no request shape can register another role |
| `GET /api/users/pending-residents` · `POST /:id/approve` · `POST /:id/reject` | manager | Approval queue for the above |
| `GET /api/users/contacts` | manager, admin | Role help/contacts block: a manager gets the admins, an admin gets the managers. The counterpart role is a server-side map keyed off the verified token, never a request parameter — a resident cannot enumerate staff numbers |
| `GET /api/contacts` | any authed | Contact directory (§8.4) — the estate and national emergency numbers behind the sidebar help card and the emergency contacts page |
| `POST /api/feedback` | any authed | Sidebar feedback form |
| `POST /api/cv/detections/:id/create-ticket` | manager | Promote a below-threshold CV detection to a record (UC-007 manual review) |
| `POST /api/export/admin-costs-pptx` | admin | UC-011 cost deck |
| `GET /api/inspections/defect-alert-demo` | cron | Demo trigger for the UC-014 defect email |

### 9.2 New endpoints

#### `POST /api/inspections/:id/reject` — **inspector or manager** (UC-004 Alt Flow, step 6 reject)

Rejects an inadequate rectification. Returns the record to `Assigned` with a fresh 14-day deadline, increments `reopen_count`, writes an audit row, and re-fires the UC-014 email with `email_type = 'rejection'`.

```json
// Request
{ "reason": "Landing door still catches on the sill — photo shows the old part." }
// Response 200
{ "id": "INS-9k2m...", "status": "Assigned", "reopen_count": 1,
  "target_deadline": "2026-08-11T00:00:00Z", "contractor_notified": true }
// Error 400
{ "code": "VALIDATION_ERROR", "message": "Rejection reason must be at least 10 characters." }
// Error 409 — wrong state
{ "code": "INVALID_STATE", "message": "Only a Rectified record can be rejected." }
```

#### `GET /api/inspections/overdue-chase` — **CRON_SECRET** (R12)

Daily. Finds `Assigned`/`Acknowledged` records where `target_deadline` is 3 days out or already past (excluding `On Hold`), emails the contractor, notifies the manager, writes `defect_email_log` + audit rows. Idempotent per record per day.

```json
{ "due_soon": 4, "overdue": 2, "emails_sent": 6, "skipped_on_hold": 1 }
```

#### `POST /api/inspections/ocr-prefill` — **inspector** (UC-013)

Accepts a photo of a completed paper form; returns a **draft** the inspector must confirm. Writes nothing to `inspections`.

```json
// Request: multipart, form_photo = [binary]
// Response 200
{
  "confidence": "medium",
  "header": { "block_lift": "886/A", "serviced_at": "2026-03-22",
              "address": "Woodlands Dr 63" },
  "items": [
    { "checklist_item_id": "…", "section": "A — Motor Room", "display_order": 1,
      "result": "Pass",   "remark": null,                    "field_confidence": 0.94 },
    { "checklist_item_id": "…", "section": "A — Motor Room", "display_order": 2,
      "result": "Defect", "remark": "Unsealed strip to renew","field_confidence": 0.61 }
  ],
  "unreadable_items": [17, 23],
  "disclaimer": "Draft only — every field must be confirmed by the inspector before submit."
}
// Error 422
{ "code": "OCR_UNREADABLE", "message": "Could not read the form. Fill the checklist manually." }
```

#### `GET /api/reports/annual?year=2026` — **manager, admin** (R16)

Generates the client's "download as file every year" archive: a single PDF of every closed spot-check for the year plus a CSV appendix, stored in Cloudinary `/reports`.

---

### 9.3 Analytics API reference (UC-005)

> All seven routes are `requireRole('manager')` and share the same optional query
> string: `?from&to&block&category&section`. Dates are `YYYY-MM-DD`; `from` is
> inclusive from 00:00 and `to` is inclusive to 23:59 of that day.
> **`section`** selects records carrying at least one `Defect` in that section of
> the paper form, resolved through `checklist_results → checklist_items.section`.

**Shared errors (every route below)**

| Code | HTTP | Cause |
|---|---|---|
| `UNAUTHORIZED` | 401 | Missing, malformed or expired Supabase access token |
| `FORBIDDEN` | 403 | Authenticated but `role != 'manager'`, or the profile is suspended — `requireRole` rejects both the same way; the distinct `ACCOUNT_SUSPENDED` code is returned only by `GET /api/users/me`, which the frontend calls at login |
| `SERVER_ERROR` | 500 | Unhandled failure; central `errorHandler` shape |

#### `GET /api/analytics/filter-options`

Populates the filter dropdowns from live data — nothing is hardcoded client-side.

```json
{ "blocks": ["44A", "44B", "88B"],
  "categories": ["Doors", "Electrical", "Lift"],
  "sections": ["A — Motor Room", "B — Lift Car", "C — Hoistway & Lift Pit"] }
```

#### `GET /api/analytics/summary`

KPI row. Ignores `from`/`to` — the movement figure defines its own two 30-day windows.

```json
{ "open_count": 46, "overdue_count": 4, "avg_resolution_hours": 58.3,
  "sla_percentage": 76.36, "new_last_30": 58, "new_prior_30": 41,
  "new_records_change_pct": 41.5, "sla_threshold_hrs": 72 }
```

`overdue_count` excludes `On Hold` (G11) and soft-deleted records.
`new_records_change_pct` is `null` when there is no prior-period data — never a fabricated `0`.

#### `GET /api/analytics/issues-by-block`

Request: `?block=44A&section=A%20—%20Motor%20Room`

```json
{ "data": [ { "block": "44A", "category": "Lift", "count": 5 },
            { "block": "44A", "category": "Electrical", "count": 2 } ] }
```

#### `GET /api/analytics/trends`

```json
{ "data": [ { "date": "2026-06-24", "count": 3 },
            { "date": "2026-06-25", "count": 6 } ] }
```

#### `GET /api/analytics/sla-compliance`

```json
{ "compliant_count": 42, "total_resolved": 55,
  "sla_percentage": 76.36, "sla_threshold_hrs": 72 }
```

With nothing closed yet: `{ "compliant_count": 0, "total_resolved": 0, "sla_percentage": 0, "sla_threshold_hrs": 72 }` — zero, never `NaN`.

#### `GET /api/analytics/contractor-scorecard`

```json
{ "data": [ { "contractor": "Otis Service SG", "jobs": 14,
              "avg_rectification_days": 3.1, "repeat_defect_rate": 21.4,
              "overdue_count": 2, "avg_reopens": 0.27 } ] }
```

`avg_rectification_days` is `null` until a job has been both acknowledged and rectified.
`avg_reopens` is `null` until migration `031` adds `inspections.reopen_count`; the controller probes `information_schema` once and begins averaging automatically.

#### `GET /api/analytics/priority-queue`

Extra params: `?priority=Critical&status=Open`.
Score = `(ai_priority_score × 0.5) + (recency × 0.3) + (frequency × 0.2)`, where recency is 100 at 0 days falling 10/day to a floor of 0, and frequency is 10 points per **open** record sharing block + category, capped at 100.

```json
{ "data": [ { "id": "INS-7f3a…", "title": "Landing door misalignment",
              "block": "44A", "category": "Doors", "priority": "Critical",
              "status": "Assigned", "ai_priority_score": 88,
              "created_at": "2026-06-22T09:15:00Z", "composite_score": 71.4 } ] }
```
**Error 400 — remark too short:**
```json
{ "code": "VALIDATION_ERROR", "message": "Closing remark must be at least 10 characters." }
```

---

---

### 6.2a My Reports (UC-003 — the originator's own view)

> Mounted at `/api/my-reports`, separate from the manager-facing `/api/inspections`
> routes. Every route here is scoped to the caller: a record belonging to someone
> else returns `404 NOT_FOUND`, never `403`, so the endpoint never confirms the
> existence of a record it will not show. The originator's *list* of live records
> stays on `GET /api/inspections/my` (§6.2).

#### GET /api/my-reports/history
**Auth:** `resident` | `inspector`  
The caller's closed records, most recently closed first. Closing soft-deletes a
record (`is_deleted = TRUE`) for the 5-year audit trail, which removes it from
`GET /api/inspections/my`; this is where it goes.

**Response 200:** *(same row shape as `/api/inspections/my`, all with `is_deleted: true`)*

---

#### GET /api/my-reports/:id
**Auth:** `resident` | `inspector`  
Full detail for one of the caller's own records, live or closed: the row plus
`history` (audit trail, newest first, with actor names) and `checklist_results`
(joined to `checklist_items` for section and item text — resolved regardless of
`active`, so a retired template item still renders).

**Error 404:**
```json
{ "code": "NOT_FOUND", "message": "Report not found." }
```

---

#### `POST /api/export/pptx` — **manager, admin**

Re-runs the same `fetch*` functions the dashboard used, so the deck cannot drift from the screen. Always uses database rows — never Data Playground preview rows.


```json
// Request
{ "views": ["heatmap", "trends", "sla_gauge", "contractor_scorecard"],
  "filters": { "block": "44A", "section": "B — Lift Car" } }
// Response 200
{ "pptx_url": "https://res.cloudinary.com/…/reports/dashboard-2026-07.pptx" }
// Error 500
{ "code": "EXPORT_FAILED", "message": "Export failed — please try again or use CSV." }
```

### 9.4 Admin cost API reference (UC-011) — **built**

> Mounted at `/api/admin`, `requireRole('admin')` applied with `router.use` so
> every route in the file is admin-only — a manager receives `403 FORBIDDEN`
> (COST-T02). Shared optional query parameters, validated before any SQL runs:
> `?startDate&endDate&block&category&liftId&contractorId` (dates are inclusive
> `YYYY-MM-DD`; ids are UUIDs). `liftId` and `contractorId` zero the projected
> series — `ai_predictions` carries neither column, and attributing estate-wide
> exposure to one lift would invite the wrong conclusion.

```jsonc
// GET /api/admin/costs/summary
{ "total_actual": 23920.00, "total_projected": 7968.71,
  "variance_pct": -66.7, "jobs": 56 }

// GET /api/admin/costs/breakdown
{ "byCategory":   [ { "category": "Doors", "actual": 4453.00, "projected": 1200.00 } ],
  "byBlock":      [ { "block": "44A", "actual": 6418.00, "projected": 1765.37 } ],
  "byContractor": [ { "name": "Otis Elevator Co.", "total": 7815.00, "count": 18 } ] }

// GET /api/admin/costs/trends?months=12
{ "data": [ { "month": "2026-05", "actual": 6100.00, "projected": 0 } ] }

// GET /api/admin/costs/jobs
{ "data": [ { "id": "660789e7-…", "closed_at": "2026-07-28", "block": "88B",
              "category": "Electrical", "lift": null,
              "contractor": "FPTD Services", "actual_cost": 90.00 } ] }

// GET /api/admin/costs/filter-options
{ "blocks": ["44A","44B"], "categories": ["Doors","Electrical"],
  "contractors": [ { "id": "c0000000-…", "name": "Otis Elevator Co." } ] }
```

`summary.variance_pct` is how far projected exposure sits above (+) or below (−)
actual spend, `null` when there is no actual spend to divide by. The dashboard's
"spend movement vs prior period" tile is a separate figure: the page asks
`/costs/summary` for the preceding window of equal length and compares the two,
showing "—" when the prior window had no spend.

`/costs/jobs` returns `closed_at` pre-formatted as `YYYY-MM-DD` because the
client groups and compares those values as strings; `lift` is `null` for a
record not tied to a lift, and `contractor` reads `"Unassigned"` for a record
closed without one, so no row is silently dropped from a total.

---

## 10. Notification & Email Matrix

Every off-platform party must be reachable, and every on-platform party must see the change without a refresh. This matrix is the completeness check.

| Trigger | Email (Nodemailer) | Socket.IO room(s) | Audit action |
|---|---|---|---|
| Spot-check submitted, ≥1 defect | **→ the vendor's account holder** — `COALESCE(u.email, c.contact_email)` over `LEFT JOIN users u ON u.id = c.user_id AND u.status = 'active'`, i.e. the person who can actually sign in and action it. The company inbox is the fallback only, for a vendor with no linked login or a suspended one (defect table, severities, deadline, deep link) | `manager-room`, `contractor-{user_id}` | `Defect Alert Sent` |
| Spot-check submitted, 0 defects | — | `manager-room` | `Filed — no defects` |
| Manager reassigns to a different contractor | → new contractor (`reassignment`) | `manager-room`, both `contractor-{user_id}` rooms | `Reassigned` |
| Contractor acknowledges | — | `manager-room`, `inspector-team` | `Acknowledged` |
| Contractor saves progress (non-final) | — | `manager-room` | `Work Progress Saved` |
| Contractor places on hold | → manager | `manager-room` | `On Hold — {reason}` |
| Contractor finalizes (e-signed) | → the raising inspector | `manager-room`, `inspector-team` | `Rectified & Signed` |
| Inspector/manager **rejects** | → contractor (`rejection`) | `contractor-{user_id}`, `manager-room` | `Rectification Rejected` |
| Joint endorsement + close | — | `manager-room`, `admin-room`, `block-{n}` | `Jointly Endorsed & Closed` |
| D−3 and D+0 on deadline | → contractor (`overdue_chase`) | `manager-room` | `Overdue Reminder Sent` |
| Resident complaint status change | — | `block-{n}`, `manager-room` | per transition |
| Monthly report ready | → manager | — | — |
| Vendor contract expired | → admin | `admin-room` | `Contract Expired` |

**Delivery guarantees.** Email is best-effort and **never blocks the HTTP response** — every send is wrapped, failures write `defect_email_log.status = 'failed'` with the error, and the UI surfaces an amber "LC not emailed — retry" chip to the manager. Socket emits are likewise wrapped: a socket hiccup must never fail a state transition.

---

## 11. State Machine & Guard Rails

```
                     ┌──────────────────────── reject (≥10 char reason, +14d) ─────────┐
                     ▼                                                                 │
  [new] ──► Pending Assignment ──assign──► Assigned ──ack──► Acknowledged ──finalize──► Rectified ──accept──► Closed
    │              │                          ▲  │               │                                              ▲
    │              │                          │  └──hold──► On Hold ──resume──┘                                 │
    │              └── 0 defects ─────────────┼──────────────────────────────────────────────────────────────────┘
    │                                         │
    └── resident complaint ──► Open ──triage──┘
```

The guard rails below are the "loopholes covered" list. Each is enforced server-side, has a test id, and returns a `{ code, message }` error.

| # | Guard rail | Enforcement |
|---|---|---|
| **G1** | A spot-check cannot be submitted without `serviced_at`, `lift_id`, and a result for **all 25 active items** | 400 `INCOMPLETE_CHECKLIST` listing the missing `display_order` values — ✅ **enforced**; also rejects ids outside the active template |
| **G2** | A `Defect` result must carry a `severity` | 400 `SEVERITY_REQUIRED` — ✅ **enforced** |
| **G3** | `Major`/`Critical` defects require a photo; `Minor` defects **must not** carry one (client: "No photos on minor issue") | 400 `PHOTO_REQUIRED_FOR_SEVERITY` / `PHOTO_NOT_ALLOWED_FOR_MINOR` — ✅ **enforced**, and mirrored in the form (the photo control only appears for Major/Critical) |
| **G4** | Every photo is compressed to ≤100 KB client-side; the server rejects anything larger | 400 `PHOTO_TOO_LARGE` (multer limit) — ✅ **enforced** on both photo routes (spot-check + resident complaint); signature parts are exempt, they are not photos |
| **G5** | The inspector must e-sign before submit ("Checked by / Signature") | 400 `SIGNATURE_REQUIRED` — ✅ **enforced**: the pad's PNG is stored as an `inspector` `signatures` row inside the same transaction as the record and its results |
| **G6** | 0 defects → auto-file to `Closed`, no contractor assignment, **no email** | Controller branch + audit `Filed — no defects` — ✅ **enforced**: `contractor_id` stays NULL, the record is closed and archived (`is_deleted = TRUE`, matching a manual close) with `target_deadline` cleared, inside the same transaction |
| **G7** | At close, the endorser signature **must belong to a user whose role is `inspector`** — the client's "digital sign-off from the EM Services inspector" | 400 `ENDORSER_MUST_BE_INSPECTOR` — ✅ **enforced** on both the claimed role and the nominated user's stored `users.role` |
| **G8** | Close is blocked unless **every** `Defect` row has `rectified = TRUE` and a `completion_photo_url` (or an explicit manager waiver note) | 409 `UNRECTIFIED_DEFECTS` listing item numbers — ✅ **enforced**; a `waiver_note` of ≥10 chars overrides and is appended to the closing remark so the exception stays in the record |
| **G9** | Contractor endpoints only ever touch records whose `contractor_id` maps to the caller's own `users.contractor_id` | 403 `FORBIDDEN` |
| **G10** | Acknowledge/rectify/hold are rejected from a wrong state (e.g. acknowledging a `Closed` record) | 409 `INVALID_STATE` |
| **G11** | `On Hold` pauses the deadline; resuming extends `target_deadline` by the held duration | Computed on resume, audit-logged |
| **G12** | UC-014 email fires **at most once per (inspection, contractor)** — `defect_email_sent_at` + `defect_email_log` guard replays | Idempotency check before send |
| **G13** | Email or socket failure never rolls back a state transition | try/catch around every side effect; failure recorded, not thrown |
| **G14** | Close writes `signatures` + `inspection_history` + status **in one transaction** | `closeInspection()` pg transaction |
| **G15** | `inspection_history` is append-only — no UPDATE or DELETE path exists in any model | Reviewed; no mutating query |
| **G16** | Suspended vendors (UC-012) cannot acknowledge or rectify | 403 `ACCOUNT_SUSPENDED` |
| **G17** | Reassigning away from a contractor with open work writes an audit row and notifies both parties | UC-002 Alt C |
| **G18** | OCR output is a **draft**: `POST /ocr-prefill` never writes to `inspections`; the inspector confirms every field and signs before submit | Separate endpoint, no DB write |
| **G19** | Retiring a checklist item deactivates it; historical `checklist_results` stay resolvable | `active = FALSE`, never DELETE |
| **G20** | A rejected record keeps its full history — `reopen_count` increments, prior signatures are retained, not overwritten | Append-only signatures table |

---

## 12. Auth & Security

| Mechanism | Implementation |
|---|---|
| Identity | **Supabase Auth on the client.** Sign-up, login, logout, password hashing, and session refresh are handled by `@supabase/supabase-js`. **No `/api/auth/*` endpoints are mounted**; `routes/auth.js` is retained but unmounted |
| Token | Frontend obtains the access token via `getAccessToken()` (`lib/auth.js`) and sends `Authorization: Bearer <token>` on REST and on the Socket.IO handshake |
| Verification | `middleware/auth.js` verifies the Supabase token against the project JWKS locally, then loads the `users` profile row (keyed by the Supabase auth user id) to obtain `role`, `block_number`, `status` |
| Authorisation | `requireRole(...)` over five roles. Contractor routes additionally scope to the caller's own `contractor_id` (G9); admin cost/vendor routes are `admin`-only |
| Account status | `users.status = 'suspended'` → 403 on every role-gated route (G16). The distinct `ACCOUNT_SUSPENDED` code comes from `GET /api/users/me` — the login-time profile fetch — so a suspended vendor learns why at sign-in; other routes reject with the generic `FORBIDDEN` |
| Cron protection | `cronGuard.js` validates `Authorization: Bearer <CRON_SECRET>` |
| Headers | `helmet()` |
| CORS | `cors({ origin: FRONTEND_URL, credentials: true })`; Socket.IO CORS configured separately |
| Rate limiting | `express-rate-limit` app-wide |
| Body caps | `express.json({ limit: '1mb' })`; multer memory storage with per-file size + MIME filter |
| Validation | `joi` before every controller |
| Error shape | `{ code, message }` from a central `errorHandler` |

**Error codes:** `UNAUTHORIZED` 401 · `FORBIDDEN` 403 · `ACCOUNT_SUSPENDED` 403 · `VALIDATION_ERROR` 400 · `INCOMPLETE_CHECKLIST` 400 · `SEVERITY_REQUIRED` 400 · `PHOTO_REQUIRED_FOR_SEVERITY` 400 · `PHOTO_NOT_ALLOWED_FOR_MINOR` 400 · `PHOTO_TOO_LARGE` 400 · `SIGNATURE_REQUIRED` 400 · `ENDORSER_MUST_BE_INSPECTOR` 400 · `NOT_FOUND` 404 · `INVALID_STATE` 409 · `UNRECTIFIED_DEFECTS` 409 · `DUPLICATE_SUBMISSION` 409 · `ALREADY_RATED` 409 · `OCR_UNREADABLE` 422 · `EXPORT_FAILED` 500 · `SERVER_ERROR` 500

---

## 13. Environment Variables

### Render (backend)

| Variable | Used by |
|---|---|
| `DATABASE_URL` | `config/db.js` |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_JWKS_URL` | `config/supabase.js`, `middleware/auth.js` |
| `FRONTEND_URL` | CORS + Socket.IO |
| `NODE_ENV` | Express |
| `CLOUDINARY_CLOUD_NAME` / `_API_KEY` / `_API_SECRET` | `cloudinaryService.js` |
| `OPENAI_API_KEY` | `openaiService.js` (categorisation, alerts, summaries, **UC-013 vision**) |
| `ROBOFLOW_API_KEY` | `roboflowService.js` |
| `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS` | `emailService.js` (**UC-014** + UC-009) |
| `MAIL_FROM` | Sender identity on defect alerts |
| `CRON_SECRET` | `cronGuard.js` |
| **`TOWN_COUNCIL_NAME`** | Default for the form header (§7.1) — **new** |
| **`APP_PUBLIC_URL`** | Deep links inside defect-alert emails — **new** |

### Vercel (frontend)

`VITE_API_URL` · `VITE_SUPABASE_URL` · `VITE_SUPABASE_ANON_KEY`

### GitHub Actions secrets

`CRON_SECRET` · `RENDER_BACKEND_URL`

> Never commit secrets. Document names in `.env.example` only.

---

## 14. Limitations & Deliberate Scope Boundaries

1. **UC-013 OCR is an adoption aid, not a requirement.** The client asked for a digital form that *replaces* paper, not one that photographs it. UC-013 exists because older inspectors may prefer to fill paper on site and digitise afterwards. It is therefore **prefill-and-confirm only** — handwriting recognition on ticks and cursive remarks is not reliable enough to submit unattended, and the inspector's e-signature (G5) is what makes the record valid. If UC-013 slips, nothing in the client brief is unmet.

2. **We do not schedule the lift company's servicing.** Step 1 of the workflow ("LMS staff plan the schedule according to monthly lift servicing schedule") stays a Town Council planning activity; we capture its output as `serviced_at`. Building a servicing scheduler is out of scope.

3. **The joint inspection (step 6) is modelled as a co-signature, not a second site visit workflow.** Both signatures are captured on one device at one time, which is what the paper form does.

4. **Cost figures are operational only** — derived from `inspections.actual_cost` and `ai_predictions.estimated_cost`. The system does not ingest EM Services' corporate financials.

5. **Vendor lifecycle (UC-012) covers external contractors only.** EM's own staff accounts are assumed to be handled by existing HR/IT processes. Contract documents are stored for reference; their contents are entered manually, not parsed.

6. **Data Playground (UC-005 extension) is session-only.** Imported CSV rows are a what-if preview merged client-side into the charts; nothing is persisted and exports always use real data. Scope is the fixed `block,category[,date][,resolution_time_hours]` shape — arbitrary spreadsheets are out of scope.

7. **Voice input uses the browser-native Web Speech API** — free, no key, accuracy varies with accent. A type-fallback is always available. Production would use a cloud STT service.

8. **CV (UC-007) is assistive.** Roboflow suggests; a human always confirms. Below 0.70 confidence a detection goes to a manual-review queue rather than creating a record.

9. **Contact data is in the database; one consumer still reads a literal.** `users.phone` and `contact_directory` (§8.4) are built, seeded and served by `GET /api/users/contacts` and `GET /api/contacts`, and all three sidebar help cards read their numbers from them — resident (managing office, via `is_help_line`), manager (the admin's number), admin (the manager's). `EmergencyContactsPage.jsx` is the exception — it still renders its static `CONTACTS` array. That file and `AppShell.jsx` belong to the shared per-role help/contacts component, which is sequenced to merge before anyone else edits them, so switching that page to the endpoint is a follow-up rather than a rewrite. The `helpCaption` this implies (a manager's card currently reads "Call your managing office" while showing the admin's number) is part of the same component's remit.

---

*End of HIGH_LEVEL_DESIGN.md*
