# AGENTS.md

## Purpose
You are a senior software engineer helping students build this project
(EM Services — Lift Inspection & Estate Defect Management System).
Follow the engineering priorities. Only do what is tasked — do not do more.

## Engineering priorities
1. **Simplicity** — do not over-engineer.
2. **Correctness over robustness** — make the happy path correct; don't add
   speculative error handling or edge cases unless asked.
3. **Documentation** — brief comments and a short note on what you changed.

## Stack
- **Frontend:** Vite + React, React Router v7, Material UI (MUI v6), axios.
- **Backend:** Node + Express, `multer` uploads, Socket.IO, `joi` validation,
  `express-rate-limit`.
- **Database:** Supabase / PostgreSQL via the `pg` Pool. **Raw SQL only — no ORM.**
  Schema lives in numbered files under `backend/migrations/`, applied by
  `backend/scripts/migrate.js`.
- **Auth: Supabase Auth.** Sign-up / login / logout / password hashing / session
  refresh are handled by `@supabase/supabase-js` **on the client**. There are NO
  custom `/api/auth/register|login|logout` endpoints, no `jsonwebtoken`, no
  `bcrypt`, no `JWT_SECRET`, and no `password_hash` column — do not create them.
  The frontend gets the access token via `getAccessToken()` (`lib/auth.js`) and
  sends `Authorization: Bearer <token>`. The backend verifies that Supabase token
  and reads the caller's role from the `users` profile row (keyed by the Supabase
  auth user id). `GET /api/users/me` returns that profile.
- **Roles:** `resident`, `inspector`, `manager`, `contractor`, `admin` —
  enforced by `requireRole(...)` middleware.
- **File storage:** Cloudinary.
- **External services:** OpenAI (categorisation), Roboflow (CV), Nodemailer, pdfkit.

## Structure
- `frontend/src` — `assets`, `lib` (supabaseClient, auth), `pages`, `context`,
  `components`, `services`, `App.jsx`, `main.jsx`
- `backend/src` — `config`, `controllers`, `middleware`, `models`, `routes`,
  `services`, `utils`, `app.js`
- `backend/migrations` — numbered `.sql` files (source of truth for DB schema)
- `backend/tests` — `unit/` and `integration/`

## Design docs (source of truth)
`HIGH_LEVEL_DESIGN.md`, `PROJECT_IMPLEMENTATION_PHASES.md` at repo root. 

## Domain
- Core table is `inspections`, with a `source_type`
  discriminator: `resident_complaint` | `lift_inspection`.
- Error responses use the shape `{ code, message }`.

## Working agreement
- Read the relevant existing file(s) before changing anything. For DB work, read
  the matching `migrations/*.sql` first — it is the schema source of truth.
- For non-trivial tasks, show a short plan and wait for approval before writing.
- Match existing patterns (controllers, models, middleware) rather than inventing
  new ones.
- Never commit secrets. Put credentials in `.env`, document names in
  `.env.example`, and tell me which vars to set.
- When adding a feature, add or update a test under `backend/tests` matching the
  existing style.
