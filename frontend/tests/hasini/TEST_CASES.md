# Test case record — Ginjala Hasini

Every test in my two folders, by name, as reported by the test runners themselves. Generated from `jest --json` and `vitest --reporter=json` on 2026-08-12, so this list cannot drift from what actually runs.

**431 tests, 431 passing, 0 failing, 0 todo.**

The last `todo` — `auth.integration.test.js › token verification against protected routes` — is now implemented (34 tests). It turned out not to need a live Supabase project after all: mocking `getClaims` exercises the real `requireAuth` → `requireRole` chain, which is the part that belongs to us, and the token signature check itself is Supabase's code, not ours to test.

See [README.md](README.md) for what each file covers and how to run it.

## Backend (jest)

`backend/tests/hasini/` — 10 files, 164 tests, run with `npx jest tests/hasini` (from `backend/`).

### analytics.test.js (27)

**GET /api/analytics/issues-by-block**

- ANA-T01: 200 with array of { block, category, count } for a manager
- ANA-T02: ?block=44A returns only rows for that block
- ANA-T06: 401 without a token
- ANA-T06: 403 for a non-manager role

**GET /api/analytics/filter-options**

- ANA-T07: 200 with data-derived blocks, categories and paper-form sections
- ANA-T08: sections come from checklist_items, so the paper re-seed needs no code change

**GET /api/analytics/summary**

- 200 with KPI values and the vs-prior-period movement

**GET /api/analytics/sla-compliance**

- ANA-T03: sla_percentage is between 0 and 100

**GET /api/analytics/trends**

- 200 with daily counts

**GET /api/analytics/contractor-scorecard**

- ANA-T09: 200 with per-contractor metrics including overdue and re-opens
- ANA-T10: averages reopen_count when the column exists

**overdue counts respect the On Hold pause (G11)**

- ANA-T11: KPI summary excludes On Hold and soft-deleted records
- ANA-T12: contractor scorecard excludes On Hold

**priority queue frequency term counts open records only**

- ANA-T13: the LATERAL subquery filters out Resolved/Closed

**?section filter**

- adds an EXISTS over checklist_results scoped to Defect rows
- is absent from the SQL when no section is requested
- the KPI summary honours the section filter like every other panel
- joins against the prefixed alias on the scorecard query

**GET /api/analytics/priority-queue**

- 200 with composite-scored rows
- ?priority and ?status are passed into the SQL as parameters

**ANA-T14: filter validation rejects bad input before any SQL runs**

- 400 VALIDATION_ERROR for ?from=hello
- 400 VALIDATION_ERROR for ?to=2026-13-45 (out of range)
- 400 VALIDATION_ERROR for ?from=2026-02-30 (not a real date)
- a repeated filter is rejected rather than silently half-applied
- from after to is refused
- the guard is mounted on every analytics route, not just one
- valid dates still pass through and reach the query

### auth.integration.test.js (34)

**no token reaches no protected route**

- get /api/analytics/filter-options → 401 UNAUTHENTICATED
- get /api/analytics/summary → 401 UNAUTHENTICATED
- get /api/analytics/issues-by-block → 401 UNAUTHENTICATED
- get /api/analytics/trends → 401 UNAUTHENTICATED
- get /api/analytics/sla-compliance → 401 UNAUTHENTICATED
- get /api/analytics/contractor-scorecard → 401 UNAUTHENTICATED
- get /api/analytics/priority-queue → 401 UNAUTHENTICATED
- get /api/admin/costs/summary → 401 UNAUTHENTICATED
- get /api/admin/costs/filter-options → 401 UNAUTHENTICATED
- get /api/admin/costs/jobs → 401 UNAUTHENTICATED
- get /api/admin/costs/breakdown → 401 UNAUTHENTICATED
- get /api/admin/costs/trends → 401 UNAUTHENTICATED
- post /api/export/pptx → 401 UNAUTHENTICATED
- post /api/export/admin-costs-pptx → 401 UNAUTHENTICATED
- the profile lookup never runs when there is no token

**how the token must be presented**

- 401 when the token is sent without the Bearer prefix
- 401 for a different auth scheme carrying the same token
- 401 for the Bearer prefix with an empty token
- 401 for a lowercase bearer prefix
- 401 when a valid token is passed as a query parameter instead
- 401 when the signature does not verify

**the token identifies, the profile row authorises**

- a manager reaches the analytics dashboard
- an admin reaches the cost dashboard
- 403 FORBIDDEN: a resident holding a valid token cannot read analytics
- 403 FORBIDDEN: a manager cannot read the admin cost figures
- 403 FORBIDDEN: an admin cannot read the manager analytics
- 403 FORBIDDEN: the manager cost deck is refused to a manager
- 403 FORBIDDEN: a role claim inside the token grants nothing
- 403 FORBIDDEN: naming another user in the request does not switch identity
- 403 FORBIDDEN when the verified token has no profile row at all

**account status is checked behind a valid token**

- suspended-token → 403 ACCOUNT_SUSPENDED even with the manager role
- pending-token → 403 ACCOUNT_PENDING even with the manager role
- rejected-token → 403 ACCOUNT_REJECTED even with the manager role
- a blocked account is refused on every protected route, not just one

### auth.test.js (5)

**requireRole**

- 403 ACCOUNT_SUSPENDED for a suspended account, not FORBIDDEN
- 403 FORBIDDEN for an active account with the wrong role
- passes an active account holding an allowed role
- 403 FORBIDDEN when the caller has no profile row at all
- 401 when there is no authenticated user

### contactDirectory.test.js (3)

**GET /api/contacts**

- a resident gets the directory in display order
- exactly one row is flagged as the sidebar help line
- no token is refused

### export.test.js (4)

**POST /api/export/pptx**

- PPT-T01: 200 with a Cloudinary pptx_url for a manager
- PPT-T02: 500 EXPORT_FAILED when deck generation throws
- 400 VALIDATION_ERROR when views is missing or invalid
- 403 for a non-manager role

### pptxExport.test.js (44)

**pptxService.buildAdminCostDeck — deck structure**

- builds exactly five slides
- slide 1: the required title and the date range
- slide 2: KPI labels and money-formatted values
- slide 3: a native bar chart with Actual and Projected series by category
- slide 4: the same chart shape keyed by block
- slide 5: a contractor table with a header row and derived columns
- the deck carries no chart on the KPI slide and no table on the chart slides

**pptxService.buildAdminCostDeck — data edge cases**

- an unfiltered deck says so instead of leaving the range blank
- a one-sided date range reads as { startDate: '2026-01-01' }
- a one-sided date range reads as { endDate: '2026-03-31' }
- a null variance renders as a dash, not 0%
- a negative variance keeps its sign and drops the plus
- empty data still produces five slides, each with an explicit empty state
- called with no argument at all it still builds a deck
- the contractor table is capped at five rows and reports the remainder
- a zero-job contractor shows a dash rather than dividing by zero
- charts are capped at ten bars and the caption reports the truncation
- a suppressed projected series is captioned so zero is not read as no risk
- no truncation caption appears when nothing was truncated

**pptxService.generateAdminCostPptx — file output**

- is exported as a function alongside the deck builder
- the deck it writes is a writable presentation with all five slides
- the UC-005 dashboard deck builder is untouched

**POST /api/export/admin-costs-pptx — access control**

- 401 without a token
- 401 with an invalid token
- 403 for a manager — cost figures are admin-only here
- 403 for a resident
- 403 for a suspended admin
- a manager is refused before any deck is built
- the UC-005 deck still admits a manager (unchanged)

**POST /api/export/admin-costs-pptx — behaviour**

- 200 with a Cloudinary .pptx URL for an admin
- the buffer is uploaded as a raw .pptx into the reports folder
- the deck is built from the live cost fetchers, not canned data
- body filters are validated and passed through to the fetchers
- query-string filters work too
- a body filter overrides the same query param
- projections_suppressed is set when a lift filter is applied
- projections_suppressed is false for a plain block filter
- 400 VALIDATION_ERROR for a bad startDate
- 400 VALIDATION_ERROR for a bad liftId
- 400 VALIDATION_ERROR for a bad range
- an empty body is fine — it means "no filters"
- 500 EXPORT_FAILED when the deck build throws
- 500 EXPORT_FAILED when the Cloudinary upload throws
- 500 EXPORT_FAILED when a cost query fails, and no upload is attempted

### profile.test.js (7)

**PATCH /api/users/me**

- 200: updates full_name and phone and returns the updated row
- 200: omitted fields are left unchanged (COALESCE path)
- 200: empty-string phone clears the stored number
- 400 VALIDATION_ERROR: blank full_name
- 400 VALIDATION_ERROR: phone over 30 characters
- 401 without a token
- 404 NOT_FOUND when the caller has no profile row

### recommendations.test.js (4)

**GET /api/recommendations**

- 200 with active alerts by default for a manager
- ?status=Dismissed filters accordingly
- 401 without a token
- 403 for a non-manager role

### userContacts.test.js (6)

**GET /api/users/contacts**

- a manager gets the admins — the number behind their "Need help?" card
- an admin gets the managers, including one with no phone
- an inspector gets the managers — the number their contacts page shows
- a contractor gets the managers — the number behind their "Need help?" card
- a resident is refused — staff numbers are not readable by other roles
- no token is refused

### vendors.test.js (30)

**POST /api/admin/vendors (onboard)**

- 201 with valid data — contractors + users rows created, status active
- 201 with neither inbox nor brands — both default off the other fields
- 201 with both supplied — the given values are kept, not overwritten
- 400 VALIDATION_ERROR when account-holder fields are missing
- 400 VALIDATION_ERROR for a malformed login email
- 400 INVALID_CONTRACT_DATES when contract_end < contract_start
- 409 EMAIL_ALREADY_EXISTS for a taken login email — no rows created
- 403 FORBIDDEN for a non-admin role

**onboard rollback + audit trail**

- deletes the auth user when a DB step fails after signUp (no orphan)
- successful onboard writes an "Onboarded" history entry

**PATCH /api/admin/vendors/:id (edit details)**

- 200 — updates contact/holder fields and records history
- 400 when no fields are supplied

**GET /api/admin/vendors/:id/history**

- 200 — returns the audit trail with actor names

**GET /api/admin/vendors/expiry-check (daily job)**

- suspends vendors past contract_end and notifies admin room
- admin can trigger the same check on demand via POST /run-expiry-check
- non-admin cannot trigger the on-demand check
- 401 UNAUTHORIZED with a wrong cron secret

**suspended vendor access (VND-T05)**

- GET /api/users/me returns 403 ACCOUNT_SUSPENDED after login
- role-gated routes stay 403 for suspended users

**POST /api/admin/vendors/:id/renew (VND-T06)**

- 200 — suspended vendor reactivated with new contract_end
- renew accepts an optional replacement contract document
- 404 for an unknown vendor id
- 400 INVALID_CONTRACT_DATES — a date on or before the current contract_end is not a renewal

**POST /api/admin/vendors/:id/suspend (early termination)**

- 200 — linked account suspended immediately

**malformed :id is a miss, not a server error**

- get /api/admin/vendors/not-a-uuid/history → 404, never 500
- post /api/admin/vendors/not-a-uuid/suspend → 404, never 500
- post /api/admin/vendors/not-a-uuid/renew → 404, never 500
- patch /api/admin/vendors/not-a-uuid → 404, never 500
- no Postgres error code or message reaches the client
- a malformed id is not a way around the admin role gate

## Frontend (vitest)

`frontend/tests/hasini/` — 23 files, 267 tests, run with `npx vitest run tests/hasini` (from `frontend/`).

### AdminCostPage.test.jsx (17)

**AdminCostPage**

- renders the KPI figures the API returned, formatted as money
- shows a dash, not a zero, when there is no prior window to compare
- a contractor filter blanks projected exposure with an explanation, not a silent $0
- an empty result renders empty states and disables the exports
- a failed load shows the retry banner and keeps no figures on screen
- Retry refetches — the click event must not be taken for a stale-check
- the watchlist grades each lift against the review threshold
- a job with no recent spend shows a dash, never a fabricated date
- a superseded response cannot repaint the page (stale-request race)
- the jobs table shows the latest 10, and All reveals the rest
- sorting runs over every row, not just the ten on screen
- a job with no lift renders a dash in the Lift column
- the outlier filter narrows to jobs over twice their category average
- the outlier filter is disabled when nothing qualifies
- the table category and contractor filters narrow the rows, not the charts
- the Order control and the column headers drive one shared sort
- a non-admin is refused the page outright

### AdminVendorPage.test.jsx (9)

**AdminVendorPage — filters**

- status chips carry live counts drawn from the vendor rows
- a chip filters the table, and clicking it again clears the filter
- a status with nothing to show is disabled rather than a dead end
- the search box narrows the rows and the chip counts with them
- defaults to soonest-expiring first, as the use case specifies
- the Order control re-sorts, and a column click keeps it honest
- a renewal date on or before the current contract end is rejected inline
- each row links to the cost dashboard filtered to that vendor
- the row cap shows the first 10 until All is chosen

### AIAlertCard.test.jsx (14)

**AIAlertCard — content**

- heads the card with the block and category the cluster sits in
- shows the alert text the model produced
- the velocity chip is a whole per cent over the 30-day window
- the cost chip is thousands-separated
- renders as a warning alert, so it reads as amber next to the other panels

**AIAlertCard — the cost chip is optional**

- a null cost drops the chip rather than printing "Est. $null"
- a zero cost is still a figure and keeps its chip

**AIAlertCard — actions**

- offers exactly Accept and Dismiss
- Accept reports this prediction id and does not also dismiss it
- Dismiss reports this prediction id and does not also accept it
- each card reports its own id, not the first one rendered

**AIAlertCard — busy**

- busy disables both actions so the request cannot be fired twice
- a click while busy reaches neither handler
- both actions are live when not busy

### analyticsService.test.js (17)

**analyticsService — endpoints**

- getFilterOptions calls async function getFilterOptions() {
	const res = await __vite_ssr_import_0__.default.get("/api/analytics/filter-options");
	return res.data;
}
- getSummary calls async function getSummary(filters = {}) {
	const res = await __vite_ssr_import_0__.default.get("/api/analytics/summary", { params: filters });
	return res.data;
}
- getHeatmap calls async function getHeatmap(filters = {}) {
	const res = await __vite_ssr_import_0__.default.get("/api/analytics/issues-by-block", { params: filters });
	return res.data;
}
- getTrends calls async function getTrends(filters = {}) {
	const res = await __vite_ssr_import_0__.default.get("/api/analytics/trends", { params: filters });
	return res.data;
}
- getSlaCompliance calls async function getSlaCompliance(filters = {}) {
	const res = await __vite_ssr_import_0__.default.get("/api/analytics/sla-compliance", { params: filters });
	return res.data;
}
- getContractorScorecard calls async function getContractorScorecard(filters = {}) {
	const res = await __vite_ssr_import_0__.default.get("/api/analytics/contractor-scorecard", { params: filters });
	return res.data;
}
- getPriorityQueue calls async function getPriorityQueue(filters = {}) {
	const res = await __vite_ssr_import_0__.default.get("/api/analytics/priority-queue", { params: filters });
	return res.data;
}
- filter-options is the one endpoint that takes no parameters
- filters are sent as query parameters, not baked into the path
- an unfiltered call still sends an empty params object
- the response body is unwrapped, so pages never see the axios envelope
- a request failure propagates so the page can show its error state

**analyticsService — recommendations (HLD §6.4)**

- the alert list asks only for Active alerts
- accept and dismiss post to the id they were given
- the manual analysis run is a GET, matching the cron route it shares

**analyticsService — PowerPoint export**

- sends the chosen views and the current filters in the body

**analyticsService — SLA threshold**

- mirrors the backend SLA_THRESHOLD_HRS of 72

### CategoryBarChart.test.jsx (8)

**CategoryBarChart — series**

- one bar per category, in the order the server ranked them
- no categories renders an empty chart rather than throwing

**CategoryBarChart — drill-down**

- clicking a bar reports the category it belongs to
- a click on empty space reports nothing
- a chart rendered without a handler survives a click

**CategoryBarChart — formatting**

- the tooltip gives the money and the job count behind it
- a single job reads singular
- the axis ticks are dollar amounts with thousands separators

### contactService.test.js (3)

**contact data layer**

- the directory comes from /api/contacts
- the staff list asks for no role — the server decides from the token
- both return the axios response, which the hook reads as res.data

### ContractorScorecard.test.jsx (11)

**ContractorScorecard — table shape**

- names the six columns
- renders one row per contractor, in the order supplied
- no contractors renders the head and no data rows

**ContractorScorecard — figures**

- rectification average and repeat rate render to one decimal
- avg re-opens keeps two decimals, since it is usually a fraction of one
- a zero average is a real figure and must not render as a dash

**ContractorScorecard — missing data**

- each nullable column falls back to an em dash
- a null figure never leaks the word null or a NaN

**ContractorScorecard — overdue drill-through**

- a non-zero count links to the triage queue filtered to that contractor
- a contractor name with URL-unsafe characters is encoded, not broken
- a zero count is shown but is not a link — there is nothing to open

### CostPanel.test.jsx (10)

**CostPanel — content**

- renders the title, the period subtitle and the panel body
- the children are the panel body, not a sibling of it
- renders as an outlined Paper, matching the other dashboard cards
- a panel with no children still renders its heading

**CostPanel — the action slot**

- renders an action when one is given
- no action means no empty action box left behind
- the action is hidden from print, since toggles mean nothing on paper

**CostPanel — layout guarantees**

- the title renders as a div so a Chip inside it stays valid HTML
- the caption holds its height so panels without a subtitle still align
- the subtitle is a div too, so the caption never nests a block in a <p>

### costService.test.js (41)

**comparisonWindows**

- the prior window is the same length, ending the day before the current one
- a job closed on the window start date can never land in both windows
- with no date filter the window is the trailing 90 days
- an open-ended "from" still yields a comparable prior window

**groupTotals**

- groups and sorts cost-heaviest first

**buildTrend**

- one point per month, gap months filled with zero

**addMonth / forecastNext**

- addMonth rolls over year boundaries
- a flat history projects flat, with a zero-width band
- a rising history keeps rising, but damped — each step gains less
- excludes the partial current month from the fit but projects past it
- a declining trend clamps at zero, never negative
- the uncertainty band widens with the horizon on noisy data
- needs at least three complete months of history

**backtestForecast**

- a flat history backtests with zero error
- never peeks: each month is predicted from strictly earlier data
- skips zero-spend months and excludes the partial current month
- null when no month has three complete months before it

**topMover**

- finds the biggest month-on-month category increase
- ignores the partial current month — compares the last two complete months
- null when nothing increased or there is only one month
- a category too small to matter cannot win on percentage alone
- the floor is a share of the month, so it scales with the estate
- with one dominant category the guard never blocks the only mover

**contractorBenchmarks**

- flags a contractor charging well above peers within the same category
- compares within categories only — cheap-category specialists are not "cheaper"
- needs ≥2 own jobs and ≥2 peer jobs, and ≥15% deviation

**buildInsights**

- headline states spend, job count, and movement
- concentration sentence only appears at ≥40% share
- mover folds into the top-category sentence when they match
- flags the most urgent watchlist lift
- silent when there are no jobs in view

**buildLiftWatchlist**

- sums lifetime spend per lift, skipping non-lift jobs
- months_to_review: 0 past the threshold, null with no recent spend
- applies the block filter but no date filters (lifetime by design)

**API wiring**

- filter options come from the endpoint, not from the rows
- page filter keys are translated to the API parameter names
- empty filters are dropped rather than sent as blanks
- every panel is derived from one fetch of the job rows
- the summary tile combines the filtered total with the prior window
- spend movement is null when the prior window had no spend
- the watchlist asks for lifetime rows — block only, no dates

### CostTrendChart.test.jsx (13)

**CostTrendChart — actuals only**

- plots one point per month with nothing else drawn
- the legend stays hidden when there is only one series to name
- a forecast with no points is treated as no forecast
- no data at all renders an empty chart rather than throwing

**CostTrendChart — projection**

- the axis is extended by the projected months
- the solid line stops at the last actual month
- the dashed curve is anchored on the last actual, so the line continues
- the uncertainty band is drawn as two edges filled against each other
- the band edges are hidden from the legend and the tooltip

**CostTrendChart — tooltip**

- an actual month gives the spend and the jobs behind it
- a month with one job reads singular
- a projected month gives the figure and its likely range
- the projection point sitting on the join reads as an actual, not a forecast

### csvDownload.test.js (6)

**downloadCsv**

- writes a header row from the first object, then one row per record
- opens with a UTF-8 BOM so Excel does not mangle the export
- quotes and escapes the values that would otherwise break the row
- a null or missing value becomes an empty cell, not "null"
- names the file and releases the object URL
- an empty result set downloads nothing at all

### csvImport.test.js (13)

**parseInspectionsCsv**

- parses valid rows with optional fields
- accepts a minimal header (block,category only)
- rejects a wrong header
- rejects a header-only file
- rejects a row missing block or category, naming the row
- rejects non-numeric resolution hours, naming the row
- rejects a malformed date, naming the row

**mergeHeatmap**

- increments existing cells and adds new ones
- does not mutate the base data

**mergeTrends**

- adds counts per date and sorts
- skips rows without a date

**mergeSla**

- recomputes percentage with resolved imported rows
- returns the base unchanged when no imported rows are resolved

### DashboardPage.test.jsx (19)

**DashboardPage — AI risk alerts**

- shows only the three most recent, and says how many are waiting
- "View all" reveals the rest and can be collapsed again
- three or fewer alerts need no toggle at all
- no alerts renders no alert section

**DashboardPage — what-if preview persistence**

- a preview stored in sessionStorage survives a reload of the page
- a corrupt stored preview is ignored rather than crashing the page

**DashboardPage — data and failure states**

- KPI figures come from the API response
- every panel renders its own info state on an empty result — never a bare axis (A6)
- a 0% movement shows a neutral "no change", not a green improvement arrow
- a failed load shows the retry banner, and Retry refetches
- priority-queue rows link to /inspections/:id (not the retired /incidents path)
- ANA-T04: Export CSV downloads the priority queue when there are rows
- ANA-T05: Export CSV is disabled and explains itself on an empty result
- a superseded response cannot repaint the page (stale-request race)

**DashboardPage — profile states**

- a manager sees the dashboard, not a placeholder
- while the profile is loading it shows a spinner, not an empty box
- a failed profile fetch says so and offers a retry
- a genuine non-manager still gets the resident placeholder
- a signed-out render does not claim the profile failed

### EmergencyContactsPage.test.jsx (8)

**EmergencyContactsPage**

- resident sees the managing office and the national lines
- a resident never asks for staff numbers — that endpoint refuses them
- inspector sees the estate line and the managers, not the emergency lines
- inspector sees managers by name, with the number from their own profile row
- a manager who has published no number is left off rather than shown unreachable
- admin sees the managers and the estate line
- numbers are dialable tel: links
- a role with no contacts configured says so

### ErrorBoundary.test.jsx (2)

**ErrorBoundary**

- renders children untouched when nothing throws
- a throwing child yields a message and a reload, not a blank page

### HeatmapChart.test.jsx (11)

**HeatmapChart — the grid it builds**

- each row becomes one cell keyed by block, category and count
- the axes list each block and category once, in the order they appear
- an empty result set renders a chart rather than throwing

**HeatmapChart — drill-down**

- clicking a cell opens the inspection list filtered to it
- block and category are URL-encoded, so a value with a space survives
- a click that lands on no cell navigates nowhere

**HeatmapChart — tooltip wording**

- one issue reads singular, several read plural
- the title names the block and category of the cell

**HeatmapChart — what-if preview**

- a cell carrying imported rows is marked and broken down in the tooltip
- the amber ring is drawn only around cells the import touched
- cells the import did not touch keep an imported count of zero

### PriorityQueue.test.jsx (12)

**PriorityQueue — table shape**

- names the six columns the manager triages on
- renders one row per record
- an empty queue renders the head and no data rows, not a crash

**PriorityQueue — ordering**

- keeps the server ranking instead of re-sorting by score
- does not re-order by priority either

**PriorityQueue — cells**

- each title links to the record detail page under /inspections
- block, category and status are printed as given
- scores render to exactly one decimal, including whole numbers
- a score is rounded, not truncated

**PriorityQueue — priority chip**

- a known priority carries its heat-ramp colours
- the ramp gets hotter from Low to Critical
- an unmapped priority still shows its own label rather than blanking

### roleContacts.test.js (9)

**getRoleContacts**

- a resident draws on the directory only, never on staff numbers
- an inspector gets the estate line and the managers, not the 999/995 lines
- a manager escalates to the admin
- an admin has a full contacts block, not just a sidebar card
- a role nobody has filled in yet resolves to an empty block, not undefined
- only the roles the staff endpoint admits ask for staff rows

**directoryIcon**

- each known icon_key maps to its own icon and palette colour
- an unrecognised icon_key falls back to the generic phone icon

**STAFF_ICON**

- staff are drawn as a person, distinct from the directory organisations

### SlaGauge.test.jsx (7)

**SlaGauge**

- splits the doughnut into compliant and breached shares
- the centre reads the whole percentage and the counts behind it
- the legend stays off so it cannot squeeze the centre label out of line
- the tooltip states each segment to one decimal

**SlaGauge — what-if preview**

- a baseline that moved shows the before figure and the arrow to the new one
- a baseline identical to the current figure is not a change worth showing
- with no baseline at all the gauge renders its normal face

### trendBuckets.test.js (9)

**bucketTrend**

- a short range stays daily and fills the gaps
- a quiet stretch occupies its real width, not one slot
- a mid-length range switches to weeks, keyed to the Monday
- a year of history collapses to months
- counts inside a bucket are summed, never averaged or dropped
- both series share one axis so the preview line stays comparable
- an empty series yields an empty axis rather than throwing
- tooltips name the period so a monthly point is never read as a day
- a date is bucketed by its UTC day, not the local one

### TrendLineChart.test.jsx (13)

**TrendLineChart — series**

- database counts alone render one solid series
- an import adds a second dashed series on the same axis
- the "imported only" view drops the database line entirely
- silent days between reports are real points, not collapsed away
- both series are bucketed together, so imported rows land on their own day

**TrendLineChart — legend**

- stays hidden with a single line, which needs no key
- appears once there are two lines to tell apart
- legend clicks are disabled so they cannot become a second hidden toggle

**TrendLineChart — dense axes**

- markers disappear past 60 points, where they hide the line they mark
- a year of history stays well inside the limit and keeps its markers
- a short range keeps its markers

**TrendLineChart — tooltip**

- the title names the period, so a bucket is never read as one day
- an index past the end of the axis yields an empty title, not a crash

### useRoleContacts.test.js (8)

**useRoleContacts — helpPhone**

- a resident's card dials the is_help_line row, not whichever came first
- a staff card skips a colleague who has published no number
- an admin card dials a manager (item 28 wiring, admin -> managers)
- no staff has a number yet — the card falls back rather than showing a blank
- a failed fetch leaves the card fallen back instead of throwing

**useRoleContacts — what each role is allowed to ask for**

- a resident never calls the staff endpoint, which would refuse them 403
- a role with no contacts block fires no requests at all

**useRoleContacts — loading**

- starts loading, so the page does not flash "no contacts" before the data lands

### vendorService.test.js (7)

**vendorService — paths**

- the list comes from the collection route
- suspend, history and edit address the vendor by id
- the on-demand expiry check posts to the admin route, not the cron one
- onboarding posts the form data it was handed, untouched

**vendorService — renew builds the multipart body**

- sends contract_end as FormData
- a replacement contract document is appended when one is given
- no document means no contract_doc field, so the stored one survives
