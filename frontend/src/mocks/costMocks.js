// UC-011 cost analytics dataset — raw job-level records, mirroring what the
// backend will aggregate server-side (inspections rows with actual_cost set at
// close, plus active ai_predictions with estimated_cost). The service layer
// aggregates these client-side so every filter and chart is genuinely computed,
// not canned — when Davian's /api/admin/costs endpoints land only the data
// source swaps, the aggregation shapes stay identical.

// Closed, costed maintenance jobs (inspections with actual_cost, UC-004).
// closed_at drives the period filters and the monthly trend. `lift` is the
// lift the job belongs to (null for estate defects like cleanliness that
// aren't tied to a lift) — it feeds the repair-vs-replace watchlist.
export const MOCK_COST_JOBS = [
  { id: 101, closed_at: '2026-01-09', block: '44A', category: 'Doors',       lift: 'L44A-01', contractor: 'Otis',                 actual_cost: 780.0 },
  { id: 102, closed_at: '2026-01-14', block: '44B', category: 'Electrical',  lift: 'L44B-01', contractor: 'Dymatics Engineering', actual_cost: 540.0 },
  { id: 103, closed_at: '2026-01-19', block: '45A', category: 'Lighting',    lift: 'L45A-01', contractor: 'EM In-house Team',     actual_cost: 160.0 },
  { id: 104, closed_at: '2026-01-23', block: '44A', category: 'Mechanical',  lift: 'L44A-01', contractor: 'Otis',                 actual_cost: 1250.0 },
  { id: 105, closed_at: '2026-01-28', block: '45B', category: 'Cleanliness', lift: null,      contractor: 'EM In-house Team',     actual_cost: 90.0 },
  { id: 106, closed_at: '2026-02-03', block: '44A', category: 'Doors',       lift: 'L44A-01', contractor: 'Otis',                 actual_cost: 910.0 },
  { id: 107, closed_at: '2026-02-08', block: '44B', category: 'Mechanical',  lift: 'L44B-02', contractor: 'Schindler',            actual_cost: 1480.0 },
  { id: 108, closed_at: '2026-02-13', block: '45A', category: 'Electrical',  lift: 'L45A-01', contractor: 'Dymatics Engineering', actual_cost: 620.0 },
  { id: 109, closed_at: '2026-02-18', block: '44A', category: 'Lighting',    lift: 'L44A-02', contractor: 'EM In-house Team',     actual_cost: 210.0 },
  { id: 110, closed_at: '2026-02-24', block: '45B', category: 'Doors',       lift: 'L45B-01', contractor: 'Otis',                 actual_cost: 830.0 },
  { id: 111, closed_at: '2026-03-04', block: '44B', category: 'Electrical',  lift: 'L44B-01', contractor: 'Dymatics Engineering', actual_cost: 575.0 },
  { id: 112, closed_at: '2026-03-09', block: '44A', category: 'Doors',       lift: 'L44A-01', contractor: 'Otis',                 actual_cost: 1020.0 },
  { id: 113, closed_at: '2026-03-14', block: '45A', category: 'Mechanical',  lift: 'L45A-02', contractor: 'Schindler',            actual_cost: 990.0 },
  { id: 114, closed_at: '2026-03-20', block: '45B', category: 'Cleanliness', lift: null,      contractor: 'EM In-house Team',     actual_cost: 120.0 },
  { id: 115, closed_at: '2026-03-27', block: '44A', category: 'Electrical',  lift: 'L44A-02', contractor: 'Dymatics Engineering', actual_cost: 700.0 },
  { id: 116, closed_at: '2026-04-02', block: '44A', category: 'Doors',       lift: 'L44A-01', contractor: 'Otis',                 actual_cost: 1150.0 },
  { id: 117, closed_at: '2026-04-07', block: '44B', category: 'Mechanical',  lift: 'L44B-02', contractor: 'Schindler',            actual_cost: 1620.0 },
  { id: 118, closed_at: '2026-04-12', block: '45A', category: 'Lighting',    lift: 'L45A-01', contractor: 'EM In-house Team',     actual_cost: 240.0 },
  { id: 119, closed_at: '2026-04-18', block: '44A', category: 'Electrical',  lift: 'L44A-02', contractor: 'Dymatics Engineering', actual_cost: 810.0 },
  { id: 120, closed_at: '2026-04-24', block: '45B', category: 'Doors',       lift: 'L45B-01', contractor: 'Otis',                 actual_cost: 890.0 },
  { id: 121, closed_at: '2026-04-29', block: '44B', category: 'Cleanliness', lift: null,      contractor: 'EM In-house Team',     actual_cost: 110.0 },
  { id: 122, closed_at: '2026-05-05', block: '44A', category: 'Doors',       lift: 'L44A-01', contractor: 'Otis',                 actual_cost: 1340.0 },
  { id: 123, closed_at: '2026-05-10', block: '45A', category: 'Mechanical',  lift: 'L45A-02', contractor: 'Schindler',            actual_cost: 1710.0 },
  { id: 124, closed_at: '2026-05-15', block: '44B', category: 'Electrical',  lift: 'L44B-01', contractor: 'Dymatics Engineering', actual_cost: 655.0 },
  { id: 125, closed_at: '2026-05-21', block: '44A', category: 'Lighting',    lift: 'L44A-02', contractor: 'EM In-house Team',     actual_cost: 195.0 },
  { id: 126, closed_at: '2026-05-27', block: '45B', category: 'Doors',       lift: 'L45B-01', contractor: 'Otis',                 actual_cost: 1005.0 },
  { id: 127, closed_at: '2026-06-02', block: '44A', category: 'Mechanical',  lift: 'L44A-01', contractor: 'Otis',                 actual_cost: 1580.0 },
  { id: 128, closed_at: '2026-06-08', block: '44B', category: 'Doors',       lift: 'L44B-02', contractor: 'Otis',                 actual_cost: 940.0 },
  { id: 129, closed_at: '2026-06-13', block: '45A', category: 'Electrical',  lift: 'L45A-01', contractor: 'Dymatics Engineering', actual_cost: 730.0 },
  { id: 130, closed_at: '2026-06-19', block: '45B', category: 'Lighting',    lift: 'L45B-01', contractor: 'EM In-house Team',     actual_cost: 260.0 },
  { id: 131, closed_at: '2026-06-25', block: '44A', category: 'Cleanliness', lift: null,      contractor: 'EM In-house Team',     actual_cost: 135.0 },
  { id: 132, closed_at: '2026-06-29', block: '44B', category: 'Mechanical',  lift: 'L44B-02', contractor: 'Schindler',            actual_cost: 1450.0 },
  { id: 133, closed_at: '2026-07-03', block: '44A', category: 'Doors',       lift: 'L44A-01', contractor: 'Otis',                 actual_cost: 1210.0 },
  { id: 134, closed_at: '2026-07-08', block: '45A', category: 'Electrical',  lift: 'L45A-01', contractor: 'Dymatics Engineering', actual_cost: 685.0 },
  { id: 135, closed_at: '2026-07-13', block: '44B', category: 'Lighting',    lift: 'L44B-01', contractor: 'EM In-house Team',     actual_cost: 225.0 },
  { id: 136, closed_at: '2026-07-17', block: '45B', category: 'Mechanical',  lift: 'L45B-01', contractor: 'Schindler',            actual_cost: 1385.0 },
];

// Active AI risk alerts with a projected cost impact (ai_predictions rows,
// UC-006) — the "projected" side of the summary tile.
export const MOCK_ACTIVE_PREDICTIONS = [
  { id: 11, block: '44A', category: 'Doors',      estimated_cost: 2400.0 },
  { id: 12, block: '44B', category: 'Mechanical', estimated_cost: 3100.0 },
  { id: 13, block: '45A', category: 'Electrical', estimated_cost: 1450.0 },
  { id: 14, block: '45B', category: 'Doors',      estimated_cost: 650.0 },
];
