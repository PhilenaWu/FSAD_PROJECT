# Ginjala Hasini — unit tests

**330 tests across 25 files. All passing.**

[TEST_CASES.md](TEST_CASES.md) lists every one of them by name, generated from
the runners' own JSON output rather than typed by hand.

The tests themselves live inside the package they exercise, because this repo
has two test runners with incompatible setups — `jest` in a Node environment
for the Express API, `vitest` in jsdom for the React app. Neither can run the
other's half, so a single folder could not hold both. This file is the index.

| | Folder | Files | Tests |
|---|---|---|---|
| Backend (jest) | [`backend/tests/Ginjala_Hasini/`](../../backend/tests/Ginjala_Hasini/) | 7 | 117 |
| Frontend (vitest) | [`frontend/src/tests/Ginjala_Hasini/`](../../frontend/src/tests/Ginjala_Hasini/) | 18 | 213 |

## Running them

From `backend/`:

```
npx jest tests/Ginjala_Hasini
```

From `frontend/`:

```
npx vitest run src/tests/Ginjala_Hasini
```

Neither needs a database, a Supabase project, or network access — the `pg`
pool, Supabase client, Cloudinary and OpenAI seams are all mocked.

## Backend — `backend/tests/Ginjala_Hasini/`

| File | Tests | Covers |
|---|---|---|
| `analytics.test.js` | 27 | UC-005 — the seven `/api/analytics/*` endpoints: filter validation, the SQL each builds, manager-only gating |
| `pptxExport.test.js` | 44 | The PowerPoint deck itself — slide composition, chart data, long-list truncation, empty-state captions |
| `export.test.js` | 4 | `POST /api/export/pptx` — validation, role gating, the Cloudinary upload seam |
| `vendors.test.js` | 30 | UC-012 lifecycle — onboard, renew, suspend, edit, history, expiry check, malformed-id handling (VND-T01–T06) |
| `contactDirectory.test.js` | 3 | `GET /api/contacts` — display order, exactly one `is_help_line` row, `401` when unauthenticated |
| `userContacts.test.js` | 5 | `GET /api/users/contacts` — role→counterpart mapping from the verified token, null phone, `403` for a resident |
| `recommendations.test.js` | 4 | UC-005 dashboard read of active AI alerts |

## Frontend — `frontend/src/tests/Ginjala_Hasini/`

| File | Tests | Covers |
|---|---|---|
| `costService.test.js` | 41 | UC-011 pure analytics — forecast, walk-forward backtest, top mover, lift watchlist, contractor benchmarks, generated insights |
| `AdminCostPage.test.jsx` | 17 | The cost dashboard — filters, KPI tiles, drill-down, CSV and deck export, error states |
| `DashboardPage.test.jsx` | 14 | The UC-005 manager dashboard — every panel against a mocked API |
| `csvImport.test.js` | 13 | Data Playground CSV parsing and what-if validation |
| `AdminVendorPage.test.jsx` | 9 | UC-012 vendor UI — list, onboard, renew, suspend, history |
| `roleContacts.test.js` | 9 | The per-role contacts recipe — each role's sources, the admin block, icon fallback |
| `useRoleContacts.test.js` | 8 | The sidebar help card's number — `is_help_line` vs first reachable staff, per-role request gating, fallback on failure |
| `analyticsService.test.js` | 17 | UC-005 data layer — the URL and query parameters behind every dashboard panel, recommendations, PPTX export |
| `vendorService.test.js` | 7 | UC-012 data layer — per-id paths, the cron-vs-admin expiry route, the multipart body `renew` builds |
| `contactService.test.js` | 3 | The two contact calls — directory path, and that the staff list sends no role (the server derives it from the token) |
| `HeatmapChart.test.jsx` | 11 | UC-005 heatmap — cell points, one column per block, drill-down URL encoding, imported-row ring and tooltip breakdown |
| `TrendLineChart.test.jsx` | 13 | UC-005 trend — shared gap-filled axis for both series, legend rules, marker thinning, period tooltips |
| `CostTrendChart.test.jsx` | 13 | UC-011 projection — the dashed curve anchored on the last actual, the uncertainty band, band edges hidden from legend and tooltip |
| `CategoryBarChart.test.jsx` | 8 | UC-011 bars — series order, click-to-filter, money formatting |
| `SlaGauge.test.jsx` | 7 | UC-005 gauge — the two segments closing the ring, centre label, what-if delta |
| `trendBuckets.test.js` | 9 | Trend axis bucketing — stays linear in time at every range |
| `EmergencyContactsPage.test.jsx` | 8 | The contacts page per role, every number from the API |
| `csvDownload.test.js` | 6 | CSV export — escaping, null cells, the UTF-8 BOM, empty result set |

## Scope

These cover my tracks: UC-005 analytics + PptxGenJS export + Data Playground,
the UC-011 cost dashboard, the UC-012 vendor UI, and role contacts. Ownership
per `PROJECT_IMPLEMENTATION_PHASES.md` §5.4.

Integration tests are not here — they exercise several members' code through
one HTTP path, so they stay in `backend/tests/integration/`.
