# Lift Inspection & Estate Defect Management System — Frontend

The React single-page app. Vite + React 19 + MUI v6, talking to the Express API
over REST and to its Socket.IO server for live updates. Deployed on Vercel.

For the system-wide picture — including demo logins and the full local setup —
see the root [README](../README.md). For the API it calls, see
[backend/README.md](../backend/README.md).

**Live:** https://fsad-project-pied.vercel.app

---

## Getting started

**Prerequisites:** Node.js 20+, and the backend running (locally on
`http://localhost:5000`, or deployed).

```bash
npm install
cp .env.example .env    # point VITE_API_URL at your backend
npm run dev             # http://localhost:5173
```

| Script | Does |
|---|---|
| `npm run dev` | Vite dev server with HMR |
| `npm run build` | Production build into `dist/` |
| `npm run preview` | Serve the built `dist/` locally |
| `npm test` | Vitest (jsdom) — every `*.test.jsx` under `src/` and `tests/` |
| `npm run lint` | Oxlint |

### Environment variables

Only `VITE_*` keys reach the browser, and they are baked into the public build —
**never put a secret here.** All three are documented in
[`.env.example`](./.env.example).

| Variable | Value |
|---|---|
| `VITE_API_URL` | Backend base URL — `http://localhost:5000` locally |
| `VITE_SUPABASE_URL` | Supabase project URL |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Supabase **publishable** key (`sb_publishable_…`) |

Authentication is Supabase Auth on the client: sign-in, session refresh and
sign-out all happen here via `@supabase/supabase-js`, and every API call carries
the resulting access token as `Authorization: Bearer <token>`. The backend
verifies that token and reads the caller's role from its own `users` row.

---

## Project structure

```
frontend/
├── src/
│   ├── pages/        # one file per route (see App.jsx)
│   ├── components/   # shared UI + per-feature folders (analytics, cv, …)
│   ├── context/      # AuthContext (session + profile), SocketContext
│   ├── services/     # axios wrappers, one per API area
│   ├── lib/          # supabaseClient, auth helpers, role contacts
│   ├── utils/        # pure helpers — status/priority display, CSV, blocks
│   ├── App.jsx       # routes, wrapped in ProtectedRoute + RoleLayout
│   └── main.jsx      # entry point
├── tests/            # per-student Vitest folders (see below)
└── vercel.json       # SPA rewrite — every path serves index.html
```

Routing is role-based: `ProtectedRoute` admits only a signed-in account the
backend accepts, then `RoleLayout` picks the chrome for that role (resident,
inspector, manager, contractor, admin).

---

## Tests

Vitest in jsdom, with `@testing-library/react`. Services and contexts are mocked;
the DOM is real. No backend or network access is needed.

```bash
npm test                        # everything
npx vitest run tests/philena    # one student's folder
```

Component tests live beside their component under `src/`; the per-student
folders under `tests/` each carry a `README.md` and `TEST_CASES.md` listing
every case by name. Expected result and the known pre-existing failures are
recorded in the root [README](../README.md#running-the-tests).

---

## Deployment (Vercel)

Root directory `frontend`, framework preset **Vite**, build `npm run build`,
output `dist`, plus the three `VITE_*` variables above.

`vercel.json` rewrites every path to `/index.html`. Without it, refreshing on a
deep link such as `/inspections/:id` returns a Vercel 404 instead of the app —
client-side routing never gets the chance to run. Full steps are in the root
[README](../README.md#deployment).
