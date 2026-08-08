// Integration tests for inspections — POST /api/inspections (UC-001 resident
// complaint) and POST /api/inspections/lift (UC-001 inspector lift spot-check).
// The app runs in-process (supertest). Boundaries are mocked so the test is
// deterministic and hits no network:
//   - config/supabase: fake getClaims to drive auth without real JWTs
//   - config/db:        in-memory store so we exercise the real controller/model
//                       flow without a Postgres/Supabase connection
//   - cloudinaryService: fake uploadImage (no upload)
//   - cvController:     fake detect (no Roboflow call)
'use strict';

// --- Mock: Supabase auth. Token string maps to a set of claims. ---
jest.mock('../../src/config/supabase', () => ({
  auth: {
    getClaims: jest.fn(async (token) => {
      if (token === 'resident-token') {
        return { data: { claims: { sub: 'res-1', email: 'res@example.com' } }, error: null };
      }
      if (token === 'manager-token') {
        return { data: { claims: { sub: 'mgr-1', email: 'mgr@example.com' } }, error: null };
      }
      if (token === 'inspector-token') {
        return { data: { claims: { sub: 'ins-1', email: 'ins@example.com' } }, error: null };
      }
      return { data: null, error: { message: 'invalid token' } };
    }),
  },
}));

// --- Mock: Cloudinary upload. Returns a fixed URL, no network. ---
jest.mock('../../src/services/cloudinaryService', () => ({
  uploadImage: jest.fn(async () => 'https://cloudinary.test/defects/mock.png'),
}));

// --- Mock: OpenAI service, partially. categoriseIncident/etc. keep running
// for real (their own deterministic fallback, no API key in test env) since
// other suites here exercise POST /api/inspections through them. Only
// extractSpotCheckForm (UC-013 OCR) is replaced, so ocr-prefill tests don't
// depend on a live OpenAI call.
jest.mock('../../src/services/openaiService', () => ({
  ...jest.requireActual('../../src/services/openaiService'),
  extractSpotCheckForm: jest.fn(),
}));

// --- Mock: CV detection. detect() is fired fire-and-forget by the controller
// (its resolved value isn't used), so a resolved no-op is enough. batchScan/
// listDetections aren't exercised here but must exist as functions — app.js
// requires this module at load time and cv.js passes listDetections directly
// as a route handler, so an undefined export would blow up require(). No
// Roboflow call happens, and no extra cv_auto_detected row lands in the
// in-memory store.
jest.mock('../../src/controllers/cvController', () => ({
  detect: jest.fn(async () => ({ cvDetection: { id: 'cv-mock-1', status: 'low_confidence' }, inspection: null })),
  batchScan: jest.fn(async () => ({ processed: 0, failed: 0, remaining: 0 })),
  listDetections: jest.fn((req, res) => res.json({ data: [], total: 0 })),
  createTicketFromDetection: jest.fn((req, res) => res.status(201).json({})),
  dismissDetection: jest.fn((req, res) => res.json({})),
}));

// --- Mock: Socket.IO emit seam (no server in tests). ---
jest.mock('../../src/services/socketService', () => ({
  emitToRoom: jest.fn(),
  emitToRooms: jest.fn(),
}));

// --- Mock: outbound mail (UC-014). Keeps the assign and reject paths off SMTP. ---
jest.mock('../../src/services/emailService', () => ({
  sendDefectAlert: jest.fn(),
  sendReportEmail: jest.fn(),
}));
const emailService = require('../../src/services/emailService');

// --- Mock: the pg layer. A tiny in-memory model of the tables we touch. ---
const profiles = {
  'res-1': { role: 'resident', status: 'active' },
  'mgr-1': { role: 'manager', status: 'active' },
  'ins-1': { role: 'inspector', status: 'active' },
  // Endorser-only fixture: never logs in, but must resolve as a real
  // contractor-role user for the close endpoint's role cross-check.
  'con-user-1': { role: 'contractor', status: 'active' },
};
const lifts = {
  'lift-1': {
    id: 'lift-1',
    block_number: '44A',
    lift_code: '44A-L1',
    brand: 'Otis',
    contractor_id: 'con-1',
    contractor_name: 'Otis Service SG',
  },
};
// Deliberately unordered + one inactive item, so the ORDER BY / active filter
// in checklistItemModel.findActive is actually exercised.
const checklistItems = [
  { id: 'item-2', section: 'Doors', item_text: 'Door sensor reopens', display_order: 2, active: true },
  { id: 'item-3', section: 'Safety', item_text: 'Emergency intercom works', display_order: 3, active: false },
  { id: 'item-1', section: 'Structural', item_text: 'Shaft walls free of cracks', display_order: 1, active: true },
];
const store = {
  inspections: [], checklist_results: [], history: [], signatures: [], ai_jobs: [], cv_detections: [],
  // UC-014 defect_email_log rows (migration 036) — D.3's proof of send.
  emailLog: [],
};

const mockQuery = jest.fn(async (sql, params = []) => {
  // requireRole: SELECT role, status FROM users WHERE id = $1
  if (/FROM users/i.test(sql)) {
    const p = profiles[params[0]];
    return { rows: p ? [p] : [] };
  }
  // liftModel.findById: SELECT ... FROM lifts l ... WHERE l.id = $1
  if (/FROM lifts/i.test(sql)) {
    if (/WHERE l\.id/i.test(sql)) {
      const l = lifts[params[0]];
      return { rows: l ? [l] : [] };
    }
    return { rows: Object.values(lifts) };
  }
  // resident create: INSERT INTO inspections (source_type, resident_id, ...)
  if (/INSERT INTO inspections/i.test(sql) && /resident_id/i.test(sql)) {
    const [
      source_type, resident_id, title, description, location_block,
      location_unit, photo_url, category, priority, ai_priority_score, source_flag,
      cv_detection_id, gps_lat, gps_lng, gps_accuracy_m, gps_captured_at,
    ] = params;
    const now = new Date().toISOString();
    const row = {
      id: `insp-${store.inspections.length + 1}`,
      source_type,
      resident_id, title, description, location_block,
      location_unit: location_unit ?? null,
      photo_url: photo_url ?? null,
      cv_detection_id: cv_detection_id ?? null,
      gps_lat: gps_lat ?? null,
      gps_lng: gps_lng ?? null,
      gps_accuracy_m: gps_accuracy_m ?? null,
      gps_captured_at: gps_captured_at ?? null,
      photo_pending: false,
      status: 'Open',
      category,
      priority,
      ai_priority_score,
      is_deleted: false,
      source_flag: source_flag ?? 'Resident',
      created_at: now,
      updated_at: now,
    };
    store.inspections.push(row);
    return { rows: [row] };
  }
  // lift inspection create: INSERT INTO inspections (source_type, inspector_id, ...)
  if (/INSERT INTO inspections/i.test(sql) && /inspector_id/i.test(sql)) {
    const [
      inspector_id, lift_id, title, location_block, contractor_id,
      status, serviced_at, gps_lat, gps_lng, gps_accuracy_m, gps_captured_at,
    ] = params;
    const now = new Date().toISOString();
    const row = {
      id: `insp-${store.inspections.length + 1}`,
      source_type: 'lift_inspection',
      inspector_id, lift_id, title, location_block, contractor_id,
      serviced_at: serviced_at ?? null,
      gps_lat: gps_lat ?? null,
      gps_lng: gps_lng ?? null,
      gps_accuracy_m: gps_accuracy_m ?? null,
      gps_captured_at: gps_captured_at ?? null,
      // Branch A ('Pending Assignment') or Branch B ('Open', then auto-closed).
      status,
      category: 'Miscellaneous',
      priority: 'Medium',
      is_deleted: false,
      source_flag: 'Inspector',
      created_at: now,
      updated_at: now,
    };
    store.inspections.push(row);
    return { rows: [row] };
  }
  // checklist template: SELECT * FROM checklist_items WHERE active ... ORDER BY
  if (/FROM checklist_items/i.test(sql)) {
    const rows = checklistItems
      .filter((i) => i.active)
      .sort((a, b) => a.display_order - b.display_order);
    return { rows };
  }
  // checklist results: INSERT INTO checklist_results (...) RETURNING *
  if (/INSERT INTO checklist_results/i.test(sql)) {
    const [inspection_id, checklist_item_id, result, severity, remark, photo_url] = params;
    const row = {
      id: `chk-${store.checklist_results.length + 1}`,
      inspection_id,
      checklist_item_id,
      result,
      severity: severity ?? null,
      remark: remark ?? null,
      photo_url: photo_url ?? null,
      rectified: false,
    };
    store.checklist_results.push(row);
    return { rows: [row] };
  }
  // manager queue / history: SELECT * FROM inspections WHERE is_deleted = $1 [AND ...]
  // $1 is the archived flag — false for the live queue, true for the history
  // view. `status = ANY($n)` carries the queue tab's status group.
  if (/SELECT \* FROM inspections\s+WHERE is_deleted/i.test(sql)) {
    const archived = params[0] === true;
    let rows = store.inspections.filter((i) => Boolean(i.is_deleted) === archived);
    // Multi-status tab filter.
    const anyMatch = /status = ANY\(\$(\d+)\)/i.exec(sql);
    if (anyMatch) {
      const wanted = params[Number(anyMatch[1]) - 1];
      rows = rows.filter((i) => wanted.includes(i.status));
    }
    // Scorecard drill-through: contractor filter by NAME via a subquery on
    // contractors, and the overdue clause (past deadline, not held/done).
    const conMatch = /contractor_id IN \(SELECT id FROM contractors WHERE name = \$(\d+)\)/i.exec(sql);
    if (conMatch) {
      const wantedName = params[Number(conMatch[1]) - 1];
      const conIds = (wantedName === 'Otis Service SG') ? ['con-1'] : [];
      rows = rows.filter((i) => conIds.includes(i.contractor_id));
    }
    if (/target_deadline < NOW\(\)/i.test(sql)) {
      const done = ['On Hold', 'Rectified', 'Resolved', 'Closed'];
      rows = rows.filter(
        (i) => i.target_deadline && new Date(i.target_deadline) < new Date() && !done.includes(i.status)
      );
    }
    // Remaining scalar filters (category, location_block), in param order.
    for (const [, field, idx] of sql.matchAll(/(\w+) = \$(\d+)/g)) {
      if (field === 'is_deleted') continue; // already applied above
      if (field === 'name') continue; // the contractor subquery, applied above
      rows = rows.filter((i) => i[field] === params[Number(idx) - 1]);
    }
    rows = archived
      ? [...rows].sort((a, b) => String(b.closed_at ?? '').localeCompare(String(a.closed_at ?? '')))
      : [...rows].sort((a, b) => (b.ai_priority_score ?? -1) - (a.ai_priority_score ?? -1));
    return { rows };
  }
  // close gate: SELECT 1 FROM inspection_history WHERE ... AND action = '...'.
  // Must precede the detail-history branch below, which matches the same table
  // but ignores the action filter — without this the gate would read as
  // satisfied by any history row, including the one creation writes.
  if (/SELECT 1 FROM inspection_history/i.test(sql)) {
    const action = sql.match(/action = '([^']+)'/)?.[1];
    const rows = store.history.filter(
      (h) => h.inspection_id === params[0] && h.action === action
    );
    return { rows: rows.slice(0, 1) };
  }
  // detail history: SELECT ... FROM inspection_history h LEFT JOIN users ...
  if (/FROM inspection_history/i.test(sql)) {
    const rows = store.history
      .filter((h) => h.inspection_id === params[0])
      .map((h) => ({ ...h, actor_name: h.actor_id === 'mgr-1' ? 'Mdm Tan' : null }));
    return { rows };
  }
  // contractor dropdown: SELECT * FROM contractors ORDER BY name
  if (/SELECT \* FROM contractors/i.test(sql)) {
    return { rows: [{ id: 'con-1', name: 'Otis Service SG', brands_serviced: 'Otis' }] };
  }
  // --- UC-014 defect email (D.3, migration 036) ----------------------------
  // The email's defect table. Keyed on the item_no alias so it wins over the
  // generic checklist_results + checklist_items branch further down, and returns
  // defects only, in form order.
  if (/display_order AS item_no/i.test(sql)) {
    const rows = store.checklist_results
      .filter((r) => r.inspection_id === params[0] && r.result === 'Defect')
      .map((r) => {
        const tpl = checklistItems.find((i) => i.id === r.checklist_item_id);
        return {
          section: tpl?.section,
          item_no: tpl?.display_order,
          item_text: tpl?.item_text,
          severity: r.severity,
          remark: r.remark ?? null,
          photo_url: r.photo_url ?? null,
        };
      })
      .sort((a, b) => a.item_no - b.item_no);
    return { rows };
  }
  // The addressee lookup and the assign path's existence check both run
  // CONTRACTOR_RECIPIENT_SQL, which COALESCEs the account holder's login over
  // the company alias. The fake mirrors that COALESCE so a regression to the
  // bare `SELECT contact_email FROM contractors` shows up as mail going to the
  // alias. con-3 has no login, and so falls back to its alias.
  if (/COALESCE\(u\.email, c\.contact_email\)/i.test(sql)) {
    const contractors = {
      'con-1': { user_id: 'con-user-1', login: 'lc@example.com', alias: 'alerts@lc.example.com' },
      // con-2 exists so a reassignment has somewhere to go (UC-015 `Reassigned`).
      'con-2': { user_id: 'con-user-2', login: 'lc2@example.com', alias: 'alerts@lc2.example.com' },
      'con-3': { user_id: null, login: null, alias: 'alerts@lc3.example.com' },
    };
    const row = contractors[params[0]];
    if (!row) return { rows: [] };
    return {
      rows: [{
        id: params[0],
        user_id: row.user_id,
        contact_email: row.login ?? row.alias,
      }],
    };
  }
  if (/INSERT INTO defect_email_log/i.test(sql)) {
    const [inspection_id, contractor_id, recipient, email_type, status, error_message] = params;
    const row = {
      id: `log-${store.emailLog.length + 1}`,
      inspection_id, contractor_id, recipient, email_type, status, error_message,
    };
    store.emailLog.push(row);
    return { rows: [row] };
  }
  // G12 stamp — set only after a successful send.
  if (/UPDATE inspections SET defect_email_sent_at/i.test(sql)) {
    const row = store.inspections.find((i) => i.id === params[0]);
    if (row) row.defect_email_sent_at = new Date().toISOString();
    return { rows: [] };
  }
  // G8 gate: unrectified defects joined to the template for their item numbers.
  // Must precede the generic checklist_results branch below.
  if (/FROM checklist_results/i.test(sql) && /rectified = FALSE/i.test(sql)) {
    const rows = store.checklist_results
      .filter(
        (r) =>
          r.inspection_id === params[0] &&
          r.result === 'Defect' &&
          (!r.rectified || !r.completion_photo_url)
      )
      .map((r) => {
        const tpl = checklistItems.find((i) => i.id === r.checklist_item_id);
        return { display_order: tpl?.display_order, item_text: tpl?.item_text };
      })
      .sort((a, b) => a.display_order - b.display_order);
    return { rows };
  }
  // detail view: checklist_results joined to their template rows.
  if (/FROM checklist_results/i.test(sql) && /JOIN checklist_items/i.test(sql)) {
    const rows = store.checklist_results
      .filter((r) => r.inspection_id === params[0])
      .map((r) => {
        const tpl = checklistItems.find((i) => i.id === r.checklist_item_id);
        return { ...r, section: tpl?.section, item_text: tpl?.item_text, display_order: tpl?.display_order };
      })
      .sort((a, b) => a.display_order - b.display_order);
    return { rows };
  }
  // reject (UC-004 Alt 4): clear the contractor's completion proof.
  if (/UPDATE checklist_results/i.test(sql)) {
    for (const r of store.checklist_results) {
      if (r.inspection_id === params[0] && r.result === 'Defect') {
        r.rectified = false;
        r.completion_photo_url = null;
      }
    }
    return { rows: [] };
  }
  // signatures on the detail view: SELECT * FROM signatures WHERE inspection_id
  if (/SELECT \* FROM signatures/i.test(sql)) {
    return { rows: store.signatures.filter((s) => s.inspection_id === params[0]) };
  }
  // cvDetectionModel.findById, joined into findDetailById for the CV overlay.
  if (/SELECT \* FROM cv_detections WHERE id/i.test(sql)) {
    const row = store.cv_detections.find((d) => d.id === params[0]);
    return { rows: row ? [row] : [] };
  }
  // findDetailById's parent-row fetch: no is_deleted predicate, so an archived
  // record is still viewable. Must precede the filtered branch below, which
  // matches the same prefix but backs the mutation guards.
  if (/SELECT \* FROM inspections WHERE id = \$1$/i.test(sql.trim())) {
    const row = store.inspections.find((i) => i.id === params[0]);
    return { rows: row ? [{ ...row }] : [] };
  }
  // findById + updateByManager row lock: ... WHERE id = $1 AND is_deleted = FALSE
  // [FOR UPDATE]. Keeps filtering — these back the close/markReviewed guards.
  // Return a copy — Postgres returns a snapshot, and the UPDATE branch below
  // mutates the stored object in place.
  if (/SELECT \* FROM inspections WHERE id/i.test(sql)) {
    const row = store.inspections.find((i) => i.id === params[0] && !i.is_deleted);
    return { rows: row ? [{ ...row }] : [] };
  }
  // G6 auto-file: UPDATE inspections SET status='Closed', ... target_deadline=NULL
  // Must precede the close branch below — that one also matches is_deleted=TRUE
  // but expects the close flow's (id, remark, cost) params.
  if (/UPDATE inspections[\s\S]*target_deadline = NULL/i.test(sql)) {
    const row = store.inspections.find((i) => i.id === params[0]);
    if (!row) return { rows: [] };
    row.status = 'Closed';
    row.is_deleted = true;
    row.closed_at = new Date().toISOString();
    row.target_deadline = null;
    row.closing_remark = 'Filed automatically — no defects found.';
    row.updated_at = new Date().toISOString();
    return { rows: [{ ...row }] };
  }
  // close (UC-004): UPDATE inspections SET status='Closed', is_deleted=TRUE, ...
  // Intercept before the generic UPDATE branch (status/is_deleted/closed_at are
  // SQL literals/expressions, not $-params, so the generic parser can't set them).
  if (/UPDATE inspections[\s\S]*is_deleted = TRUE/i.test(sql)) {
    const [id, closing_remark, actual_cost] = params;
    const row = store.inspections.find((i) => i.id === id);
    if (!row) return { rows: [] };
    row.status = 'Closed';
    row.is_deleted = true;
    row.closing_remark = closing_remark;
    row.actual_cost = actual_cost ?? null;
    row.closed_at = new Date().toISOString();
    row.resolution_time_hours =
      Math.round(((Date.now() - new Date(row.created_at)) / 3600000) * 100) / 100;
    row.updated_at = new Date().toISOString();
    return { rows: [{ ...row }] };
  }
  // signatures: INSERT INTO signatures (...) RETURNING *
  if (/INSERT INTO signatures/i.test(sql)) {
    const [inspection_id, signer_role, signer_id, image_url] = params;
    const row = {
      id: `sig-${store.signatures.length + 1}`,
      inspection_id, signer_role, signer_id, image_url,
    };
    store.signatures.push(row);
    return { rows: [row] };
  }
  // recurrence count: SELECT COUNT(*)::int AS n FROM inspections WHERE status='Closed'
  if (/COUNT\(\*\)/i.test(sql) && /status = 'Closed'/i.test(sql)) {
    const [block, category] = params;
    const n = store.inspections.filter(
      (i) => i.status === 'Closed' && i.location_block === block && i.category === category
    ).length;
    return { rows: [{ n }] };
  }
  // recurrence queue: INSERT INTO ai_jobs (...)
  if (/INSERT INTO ai_jobs/i.test(sql)) {
    const [location_block, category, triggered_by] = params;
    store.ai_jobs.push({ location_block, category, triggered_by });
    return { rows: [] };
  }
  // reject (UC-004 Alt 4): status/deadline/reopen_count are SQL expressions,
  // not $-params, so the generic branch below can't apply them.
  if (/UPDATE inspections[\s\S]*reopen_count = reopen_count \+ 1/i.test(sql)) {
    const row = store.inspections.find((i) => i.id === params[0]);
    if (!row) return { rows: [] };
    row.status = 'Assigned';
    row.reopen_count = (row.reopen_count ?? 0) + 1;
    row.rectified_at = null;
    row.target_deadline = new Date(Date.now() + 14 * 86400000).toISOString();
    row.updated_at = new Date().toISOString();
    return { rows: [{ ...row }] };
  }
  // updateByManager: UPDATE inspections SET <dynamic fields> WHERE id = $N
  if (/UPDATE inspections SET/i.test(sql)) {
    const row = store.inspections.find((i) => i.id === params[params.length - 1]);
    if (!row) return { rows: [] };
    for (const [, field, idx] of sql.matchAll(/(\w+) = \$(\d+)/g)) {
      if (field !== 'id') row[field] = params[Number(idx) - 1];
    }
    row.updated_at = new Date().toISOString();
    return { rows: [row] };
  }
  // audit trail: INSERT INTO inspection_history (...)
  if (/INSERT INTO inspection_history/i.test(sql)) {
    const [inspection_id, actor_id, action, previous_status, new_status, note] = params;
    store.history.push({ inspection_id, actor_id, action, previous_status, new_status, note });
    return { rows: [] };
  }
  // The assign path's contractor existence check now runs the same
  // CONTRACTOR_RECIPIENT_SQL as the addressee lookup, handled above — con-2 is
  // there so a reassignment has somewhere to go (UC-015 `Reassigned`), and an
  // unknown id returns no rows so the 404 branch still fires.
  // contractorRecipient (UC-008 assignee notifications + the D.5 reject room):
  // SELECT user_id, name FROM contractors WHERE id = $1. Distinct from the branch
  // above — that one starts 'SELECT id', this one 'SELECT user_id'.
  if (/SELECT user_id, name FROM contractors/i.test(sql)) {
    const recipients = {
      'con-1': { user_id: 'con-user-1', name: 'Otis Service SG' },
      'con-2': { user_id: 'con-user-2', name: 'Schindler SG' },
    };
    const row = recipients[params[0]];
    return { rows: row ? [row] : [] };
  }
  // status board: SELECT id, location_block, ... WHERE source_type = 'resident_complaint'
  if (/SELECT id, location_block/i.test(sql)) {
    const rows = store.inspections
      .filter((i) => i.source_type === 'resident_complaint' && !i.is_deleted)
      .map(({ id, location_block, category, status, created_at }) => ({
        id, location_block, category, status, created_at,
      }));
    return { rows };
  }
  // listMine: SELECT * FROM inspections WHERE resident_id = $1 OR inspector_id = $1
  // No is_deleted filter — a person's own history includes archived records.
  if (/SELECT \* FROM inspections/i.test(sql) && /inspector_id = \$1/i.test(sql)) {
    const [userId] = params;
    const rows = store.inspections.filter(
      (i) => i.resident_id === userId || i.inspector_id === userId
    );
    return { rows };
  }
  // duplicate guard: SELECT id FROM inspections WHERE resident_id=$1 AND title=$2 ...
  if (/SELECT id FROM inspections/i.test(sql)) {
    const [resident_id, title] = params;
    const dup = store.inspections.filter(
      (i) => i.resident_id === resident_id && i.title === title && !i.is_deleted
    );
    return { rows: dup.map((i) => ({ id: i.id })) };
  }
  // BEGIN / COMMIT / ROLLBACK and anything else.
  return { rows: [] };
});

jest.mock('../../src/config/db', () => ({
  // The transactional model path uses pool.connect(); hand it the same query fn.
  pool: {
    connect: jest.fn(async () => ({ query: mockQuery, release: jest.fn() })),
  },
  testConnection: jest.fn(),
  query: mockQuery,
}));

const request = require('supertest');
const app = require('../../src/app');

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
);

beforeEach(() => {
  store.inspections.length = 0;
  store.checklist_results.length = 0;
  store.history.length = 0;
  store.signatures.length = 0;
  store.ai_jobs.length = 0;
  store.cv_detections.length = 0;
  store.emailLog.length = 0;
  jest.clearAllMocks();
});

// Seed one resident complaint through the real create path; returns its id.
async function seedComplaint(title = 'Corridor light out', category = 'Electrical') {
  const res = await request(app)
    .post('/api/inspections')
    .set('Authorization', 'Bearer resident-token')
    .field('title', title)
    .field('description', 'Details here')
    .field('location_block', '44A')
    .field('category', category);
  return res.body.id;
}

describe('POST /api/inspections', () => {
  test('401 when no token is provided', async () => {
    const res = await request(app)
      .post('/api/inspections')
      .field('title', 'Leak')
      .field('description', 'Water everywhere')
      .field('location_block', 'A');

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('UNAUTHENTICATED');
  });

  test('403 when the user is not a resident', async () => {
    const res = await request(app)
      .post('/api/inspections')
      .set('Authorization', 'Bearer manager-token')
      .field('title', 'Leak')
      .field('description', 'Water everywhere')
      .field('location_block', 'A');

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN');
  });

  test('400 when title is missing', async () => {
    const res = await request(app)
      .post('/api/inspections')
      .set('Authorization', 'Bearer resident-token')
      .field('description', 'No title here')
      .field('location_block', 'A');

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  // The resident categorises their own report (migration 042), so a submission
  // without one is incomplete rather than something to guess at.
  test('400 when category is missing', async () => {
    const res = await request(app)
      .post('/api/inspections')
      .set('Authorization', 'Bearer resident-token')
      .field('title', 'Cracked step')
      .field('description', 'Chipped concrete')
      .field('location_block', 'A');

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(res.body.message).toMatch(/category/);
  });

  test('400 when category is not one the schema allows', async () => {
    const res = await request(app)
      .post('/api/inspections')
      .set('Authorization', 'Bearer resident-token')
      .field('title', 'Cracked step')
      .field('description', 'Chipped concrete')
      .field('location_block', 'A')
      // Retired by migration 042 — kept as a test to catch a client still
      // sending the old vocabulary, which the CHECK would reject as a 500.
      .field('category', 'Uncategorised');

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  test('201 creates the complaint with the resident\'s category and stores the photo', async () => {
    const res = await request(app)
      .post('/api/inspections')
      .set('Authorization', 'Bearer resident-token')
      .field('title', 'Water leak in stairwell')
      .field('description', 'Dripping from ceiling')
      .field('location_block', 'B')
      .field('category', 'Plumbing')
      .field('gps_lat', '1.3521')
      .field('gps_lng', '103.8198')
      .field('gps_accuracy_m', '12')
      .field('gps_captured_at', '2026-07-11T08:00:00.000Z')
      .attach('photo', PNG, 'test.png');

    expect(res.status).toBe(201);
    expect(res.body.source_type).toBe('resident_complaint');
    // Optional GPS stored verbatim; block stays the authoritative location.
    expect(res.body.gps_lat).toBe('1.3521');
    expect(res.body.gps_accuracy_m).toBe('12');
    expect(res.body.location_block).toBe('B');
    // The resident's pick is stored as-is — the AI stub's own category is
    // discarded, and only its priority score survives.
    expect(res.body.category).toBe('Plumbing');
    expect(res.body.ai_priority_score).toBe(50);
    expect(res.body.status).toBe('Open');
    expect(res.body.photo_url).toBeTruthy();

    const cloudinaryService = require('../../src/services/cloudinaryService');
    expect(cloudinaryService.uploadImage).toHaveBeenCalledTimes(1);
  });

  test('409 on a duplicate title within 2 minutes', async () => {
    const submit = () =>
      request(app)
        .post('/api/inspections')
        .set('Authorization', 'Bearer resident-token')
        .field('title', 'Broken lift on level 3')
        .field('description', 'Lift is stuck')
        .field('location_block', 'C')
        .field('category', 'Lift');

    const first = await submit();
    expect(first.status).toBe(201);

    const second = await submit();
    expect(second.status).toBe(409);
    expect(second.body.code).toBe('DUPLICATE_SUBMISSION');
  });
});

// Multipart: lift_id + serviced_at + checklist (JSON string) fields, photos as
// photo_<checklist_item_id> file parts. Shared with the close suite, which needs
// a real lift inspection carrying a defect to exercise G8.
//
// G1 requires every *active* template item to be answered — the fixture's
// active set is item-1 and item-2 (item-3 is inactive), so a complete checklist
// is exactly these two. The defect is Minor so this baseline needs no photo
// (G3); tests that exercise photos use majorChecklist.
const validChecklist = [
  { checklist_item_id: 'item-1', result: 'Pass' },
  { checklist_item_id: 'item-2', result: 'Defect', severity: 'Minor', remark: 'Door sensor slow' },
];
const majorChecklist = [
  { checklist_item_id: 'item-1', result: 'Pass' },
  { checklist_item_id: 'item-2', result: 'Defect', severity: 'Major', remark: 'Door sensor slow' },
];

// Submit a spot-check with the standard valid header fields. The inspector's
// "Checked by" signature is attached by default (G5); pass omitSignature to
// exercise the rejection.
function submitLift(
  checklist,
  { serviced_at = '2026-03-22', lift_id = 'lift-1', omitSignature = false } = {}
) {
  const req = request(app)
    .post('/api/inspections/lift')
    .set('Authorization', 'Bearer inspector-token')
    .field('lift_id', lift_id)
    .field('serviced_at', serviced_at)
    .field('checklist', JSON.stringify(checklist));
  if (!omitSignature) req.attach('inspector_signature', PNG, 'inspector.png');
  return req;
}

describe('POST /api/inspections/lift', () => {
  test('201 inspector creates a lift inspection with checklist results and a defect photo', async () => {
    const res = await submitLift(majorChecklist).attach('photo_item-2', PNG, 'defect.png');

    expect(res.status).toBe(201);
    expect(res.body.source_type).toBe('lift_inspection');
    // Servicing Date from the paper form header (migration 027).
    expect(res.body.serviced_at).toBe('2026-03-22');
    expect(res.body.inspector_id).toBe('ins-1');
    expect(res.body.lift_id).toBe('lift-1');
    // Derived from the lift row, not the request.
    expect(res.body.contractor_id).toBe('con-1');
    expect(res.body.location_block).toBe('44A');
    expect(res.body.title).toBe('Lift inspection — 44A-L1');
    expect(res.body.checklist_results).toHaveLength(2);
    expect(res.body.checklist_results[1].severity).toBe('Major');
    // Photo landed on the Defect row only.
    expect(res.body.checklist_results[1].photo_url).toBeTruthy();
    expect(res.body.checklist_results[0].photo_url).toBeNull();

    const cloudinaryService = require('../../src/services/cloudinaryService');
    // One defect photo + the inspector's signature (G5).
    expect(cloudinaryService.uploadImage).toHaveBeenCalledTimes(2);
    expect(cloudinaryService.uploadImage).toHaveBeenCalledWith(expect.anything(), 'signatures');

    // G5 + UC-015: the signature and the opening audit row land in the same
    // transaction as the record itself.
    expect(store.signatures).toHaveLength(1);
    expect(store.signatures[0]).toMatchObject({
      inspection_id: res.body.id,
      signer_role: 'inspector',
      signer_id: 'ins-1',
    });
    expect(store.history.some((h) => h.action === 'Created')).toBe(true);
  });

  // D.3 — the client's headline benefit: "finding on report (defect) will be
  // informed to lift servicing supervisor". Only an in-app notification went out
  // before this, so a supervisor who never opened the portal learned nothing.
  test('emails the servicing contractor the UC-014 defect alert', async () => {
    const res = await submitLift(majorChecklist).attach('photo_item-2', PNG, 'defect.png');

    expect(res.status).toBe(201);
    expect(emailService.sendDefectAlert).toHaveBeenCalledTimes(1);

    const [record, to, options] = emailService.sendDefectAlert.mock.calls[0];
    expect(record.id).toBe(res.body.id);
    expect(to).toContain('lc@example.com');
    expect(options.email_type).toBe('defect_alert');
    expect(options.lift_code).toBe('44A-L1');
    // Addressed to the account holder who can sign in and action it, never the
    // company alias — the mail's deep link is useless to an alias inbox.
    expect(to).not.toContain('alerts@lc.example.com');
    // The failed checkpoints travel with it (D.2), not just a bare summary.
    expect(options.defects).toHaveLength(1);
    expect(options.defects[0]).toMatchObject({ severity: 'Major' });
  });

  test('records the send in defect_email_log, stamps G12, and audits it', async () => {
    const res = await submitLift(majorChecklist).attach('photo_item-2', PNG, 'defect.png');

    expect(store.emailLog).toEqual([
      expect.objectContaining({
        inspection_id: res.body.id,
        contractor_id: 'con-1',
        email_type: 'defect_alert',
        status: 'sent',
      }),
    ]);
    // G12: the replay guard is stamped, so a resubmit cannot double-send.
    const row = store.inspections.find((i) => i.id === res.body.id);
    expect(row.defect_email_sent_at).toBeTruthy();
    // UC-015: one of the two audit actions the completeness check was missing.
    expect(store.history.some((h) => h.action === 'Defect Alert Sent')).toBe(true);
  });

  // G6: a clean spot-check involves no contractor, so no alert and no log row.
  test('a zero-defect spot-check sends no defect alert', async () => {
    const res = await submitLift([
      { checklist_item_id: 'item-1', result: 'Pass' },
      { checklist_item_id: 'item-2', result: 'Pass' },
    ]);

    expect(res.status).toBe(201);
    expect(emailService.sendDefectAlert).not.toHaveBeenCalled();
    expect(store.emailLog).toHaveLength(0);
    expect(store.history.some((h) => h.action === 'Defect Alert Sent')).toBe(false);
  });

  // G13: the record is already committed when the mail goes out.
  test('a failed defect alert never fails the submission', async () => {
    emailService.sendDefectAlert.mockRejectedValueOnce(new Error('smtp down'));
    const logged = jest.spyOn(console, 'error').mockImplementation(() => {});

    const res = await submitLift(majorChecklist).attach('photo_item-2', PNG, 'defect.png');

    expect(res.status).toBe(201);
    expect(store.emailLog).toEqual([
      expect.objectContaining({ status: 'failed', error_message: 'smtp down' }),
    ]);
    // Nothing claims an alert was sent.
    expect(store.history.some((h) => h.action === 'Defect Alert Sent')).toBe(false);
    const row = store.inspections.find((i) => i.id === res.body.id);
    expect(row.defect_email_sent_at).toBeUndefined();
    logged.mockRestore();
  });

  // Every other transition pushes status_update; creation was the one that
  // didn't, leaving the manager's queue and dashboard stale until reloaded.
  test('pushes status_update to manager-room on submit', async () => {
    const res = await submitLift(majorChecklist).attach('photo_item-2', PNG, 'defect.png');

    const socketService = require('../../src/services/socketService');
    expect(socketService.emitToRooms).toHaveBeenCalledWith(
      ['manager-room'],
      'status_update',
      expect.objectContaining({ id: res.body.id, status: res.body.status })
    );
  });

  // The zero-defect path reports its final state, not the transient 'Open' the
  // row briefly held inside the transaction.
  test('the zero-defect emit reports Closed, not Open', async () => {
    const allPass = [
      { checklist_item_id: 'item-1', result: 'Pass' },
      { checklist_item_id: 'item-2', result: 'Pass' },
    ];

    const res = await submitLift(allPass);

    const socketService = require('../../src/services/socketService');
    expect(socketService.emitToRooms).toHaveBeenCalledWith(
      ['manager-room'],
      'status_update',
      expect.objectContaining({ id: res.body.id, status: 'Closed' })
    );
    // admin-room is deliberately absent: a compliant check carries no
    // actual_cost, so it can never reach the UC-011 cost figures.
    const rooms = socketService.emitToRooms.mock.calls.flatMap(([r]) => r);
    expect(rooms).not.toContain('admin-room');
  });

  // --- G6: zero defects auto-files as a compliant check -------------------
  test('201 with no defects files straight to Closed, unassigned', async () => {
    const allPass = [
      { checklist_item_id: 'item-1', result: 'Pass' },
      { checklist_item_id: 'item-2', result: 'Pass' },
    ];

    const res = await submitLift(allPass);

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('Closed');
    expect(res.body.is_deleted).toBe(true);
    expect(res.body.closed_at).toBeTruthy();
    // No contractor involvement, and nothing due for rectification.
    expect(res.body.contractor_id).toBeNull();
    expect(res.body.target_deadline).toBeNull();
    // Turnaround is a defect metric — there was no defect to rectify.
    expect(res.body.resolution_time_hours ?? null).toBeNull();

    // Audit trail records both the filing and the auto-close.
    expect(store.history.some((h) => h.action === 'Created')).toBe(true);
    const filed = store.history.find((h) => h.action === 'Filed — no defects');
    expect(filed).toBeTruthy();
    expect(filed.previous_status).toBe('Open');
    expect(filed.new_status).toBe('Closed');

    // The signature is still captured — a clean check is still attested (G5).
    expect(store.signatures).toHaveLength(1);
    expect(store.signatures[0].signer_role).toBe('inspector');
  });

  test('201 with a defect lands as Pending Assignment, awaiting triage', async () => {
    const res = await submitLift(validChecklist);

    expect(res.status).toBe(201);
    // UC-001 step 11 Branch A — not the table's generic 'Open' default.
    expect(res.body.status).toBe('Pending Assignment');
    expect(res.body.is_deleted).toBe(false);
    // Derived from the lift, since there is defect work to assign.
    expect(res.body.contractor_id).toBe('con-1');
    expect(store.history.some((h) => h.action === 'Filed — no defects')).toBe(false);
    // The opening audit row records the status it actually landed in.
    const created = store.history.find((h) => h.action === 'Created');
    expect(created.new_status).toBe('Pending Assignment');
  });

  // --- G5: the "Checked by" signature ------------------------------------
  test('400 SIGNATURE_REQUIRED when the inspector signature is missing', async () => {
    const res = await submitLift(validChecklist, { omitSignature: true });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('SIGNATURE_REQUIRED');

    // Nothing persisted, and no orphaned upload.
    const cloudinaryService = require('../../src/services/cloudinaryService');
    expect(cloudinaryService.uploadImage).not.toHaveBeenCalled();
    expect(store.signatures).toHaveLength(0);
    expect(store.inspections).toHaveLength(0);
  });

  // G1: the paper form's Servicing Date is mandatory, not optional.
  test('400 when serviced_at is blank', async () => {
    const res = await submitLift(validChecklist, { serviced_at: '' });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  // --- G1: complete checklist -------------------------------------------
  test('400 INCOMPLETE_CHECKLIST naming the unanswered item numbers', async () => {
    const res = await submitLift([{ checklist_item_id: 'item-1', result: 'Pass' }]);

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INCOMPLETE_CHECKLIST');
    // item-2 has display_order 2 — the inspector sees the paper form's numbering.
    expect(res.body.message).toContain('2');
  });

  test('400 when the checklist references an item outside the active template', async () => {
    const res = await submitLift([
      ...validChecklist,
      { checklist_item_id: 'item-3', result: 'Pass' }, // inactive in the fixture
    ]);

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  // --- G2: severity on every defect --------------------------------------
  test('400 SEVERITY_REQUIRED when a Defect has no severity', async () => {
    const res = await submitLift([
      { checklist_item_id: 'item-1', result: 'Pass' },
      { checklist_item_id: 'item-2', result: 'Defect', remark: 'No severity given' },
    ]);

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('SEVERITY_REQUIRED');
  });

  // --- G3: photo rules by severity ---------------------------------------
  test('400 PHOTO_REQUIRED_FOR_SEVERITY when a Major defect has no photo', async () => {
    const res = await submitLift(majorChecklist); // no attachment

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('PHOTO_REQUIRED_FOR_SEVERITY');
  });

  test('400 PHOTO_NOT_ALLOWED_FOR_MINOR when a Minor defect carries a photo', async () => {
    const res = await submitLift(validChecklist).attach('photo_item-2', PNG, 'minor.png');

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('PHOTO_NOT_ALLOWED_FOR_MINOR');

    // Rejected before upload — no orphaned image in Cloudinary.
    const cloudinaryService = require('../../src/services/cloudinaryService');
    expect(cloudinaryService.uploadImage).not.toHaveBeenCalled();
  });

  // --- G4: 100 KB server-side cap ----------------------------------------
  test('400 PHOTO_TOO_LARGE when a photo part exceeds the 100 KB cap', async () => {
    const oversized = Buffer.alloc(150 * 1024, 1);
    const res = await submitLift(majorChecklist).attach('photo_item-2', oversized, 'big.png');

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('PHOTO_TOO_LARGE');
  });

  test('403 when the user is not an inspector', async () => {
    const res = await request(app)
      .post('/api/inspections/lift')
      .set('Authorization', 'Bearer resident-token')
      .field('lift_id', 'lift-1')
      .field('checklist', JSON.stringify(validChecklist));

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN');
  });

  test('400 when lift_id is missing', async () => {
    const res = await request(app)
      .post('/api/inspections/lift')
      .set('Authorization', 'Bearer inspector-token')
      .field('checklist', JSON.stringify(validChecklist));

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  test('400 when checklist is not valid JSON', async () => {
    const res = await request(app)
      .post('/api/inspections/lift')
      .set('Authorization', 'Bearer inspector-token')
      .field('lift_id', 'lift-1')
      .field('checklist', 'not-json');

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  test('404 when the lift does not exist', async () => {
    const res = await submitLift(validChecklist, { lift_id: 'lift-nope' });

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NOT_FOUND');
  });
});

// UC-013 M.2/M.3: paper-form OCR prefill. G18 — never touches
// inspections/checklist_results/signatures; the response is a draft only.
describe('POST /api/inspections/ocr-prefill', () => {
  const openaiService = require('../../src/services/openaiService');

  test('OCR-T01: 200 maps a clean scan onto the active template, in display_order', async () => {
    openaiService.extractSpotCheckForm.mockResolvedValueOnce({
      serviced_at: '2026-03-22',
      serviced_at_confidence: 0.92,
      form_lift_code: '44A-L1',
      items: [
        { result: 'Pass', remark: null, field_confidence: 0.95 },
        { result: 'Defect', remark: 'Door sensor slow', field_confidence: 0.81 },
      ],
    });

    const res = await request(app)
      .post('/api/inspections/ocr-prefill')
      .set('Authorization', 'Bearer inspector-token')
      .attach('form_photo', PNG, 'form.png');

    expect(res.status).toBe(200);
    expect(res.body.serviced_at).toBe('2026-03-22');
    expect(res.body.form_lift_code).toBe('44A-L1');
    expect(res.body.items).toHaveLength(2); // item-3 is inactive, excluded
    expect(res.body.items[0]).toMatchObject({
      checklist_item_id: 'item-1',
      display_order: 1,
      result: 'Pass',
    });
    expect(res.body.items[1]).toMatchObject({
      checklist_item_id: 'item-2',
      display_order: 2,
      result: 'Defect',
      remark: 'Door sensor slow',
    });
    expect(res.body.unreadable_items).toEqual([]);
    expect(res.body.disclaimer).toMatch(/must be confirmed/i);

    // G18: nothing written to the DB — no inspection, checklist result, or signature.
    expect(store.inspections).toHaveLength(0);
    expect(store.checklist_results).toHaveLength(0);
    expect(store.signatures).toHaveLength(0);

    expect(openaiService.extractSpotCheckForm).toHaveBeenCalledWith(
      'https://cloudinary.test/defects/mock.png',
      ['Shaft walls free of cracks', 'Door sensor reopens']
    );
  });

  test('OCR-T02: 200 flags unreadable items by their display_order', async () => {
    openaiService.extractSpotCheckForm.mockResolvedValueOnce({
      serviced_at: null,
      serviced_at_confidence: 0,
      items: [
        { result: 'Pass', remark: null, field_confidence: 0.9 },
        { result: 'unreadable', remark: null, field_confidence: 0.1 },
      ],
    });

    const res = await request(app)
      .post('/api/inspections/ocr-prefill')
      .set('Authorization', 'Bearer inspector-token')
      .attach('form_photo', PNG, 'form.png');

    expect(res.status).toBe(200);
    expect(res.body.serviced_at).toBeNull();
    expect(res.body.unreadable_items).toEqual([2]); // item-2's display_order
  });

  test('422 OCR_UNREADABLE when the photo can\'t be parsed (no silent fallback)', async () => {
    openaiService.extractSpotCheckForm.mockRejectedValueOnce(
      new Error('OpenAI response was not valid JSON.')
    );

    const res = await request(app)
      .post('/api/inspections/ocr-prefill')
      .set('Authorization', 'Bearer inspector-token')
      .attach('form_photo', PNG, 'form.png');

    expect(res.status).toBe(422);
    expect(res.body.code).toBe('OCR_UNREADABLE');
    expect(store.inspections).toHaveLength(0);
  });

  // A4: OpenAI down/misconfigured/over quota — distinct code so the client
  // can disable the scan button rather than inviting a retry.
  test('503 OCR_SERVICE_UNAVAILABLE when the service itself is down (A4)', async () => {
    const err = new Error('OPENAI_API_KEY is not configured.');
    err.serviceUnavailable = true;
    openaiService.extractSpotCheckForm.mockRejectedValueOnce(err);

    const res = await request(app)
      .post('/api/inspections/ocr-prefill')
      .set('Authorization', 'Bearer inspector-token')
      .attach('form_photo', PNG, 'form.png');

    expect(res.status).toBe(503);
    expect(res.body.code).toBe('OCR_SERVICE_UNAVAILABLE');
    expect(store.inspections).toHaveLength(0);
  });

  test('400 VALIDATION_ERROR when form_photo is missing', async () => {
    const res = await request(app)
      .post('/api/inspections/ocr-prefill')
      .set('Authorization', 'Bearer inspector-token');

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(openaiService.extractSpotCheckForm).not.toHaveBeenCalled();
  });

  test('403 when the caller is not an inspector', async () => {
    const res = await request(app)
      .post('/api/inspections/ocr-prefill')
      .set('Authorization', 'Bearer manager-token')
      .attach('form_photo', PNG, 'form.png');

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN');
  });
});

describe('GET /api/inspections/my', () => {
  test('200 returns only the caller\'s own reports, wrapped in { data }', async () => {
    // Seed one report belonging to the resident via the real create path.
    await request(app)
      .post('/api/inspections')
      .set('Authorization', 'Bearer resident-token')
      .field('title', 'Cracked tile at void deck')
      .field('description', 'Sharp edge exposed')
      .field('location_block', 'A')
      .field('category', 'Structural');

    const res = await request(app)
      .get('/api/inspections/my')
      .set('Authorization', 'Bearer resident-token');

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].title).toBe('Cracked tile at void deck');
    expect(res.body.data[0].resident_id).toBe('res-1');
  });

  // A person's own history must survive archival. Before this, a G6 zero-defect
  // spot-check vanished from the inspector's list the moment they filed it.
  test('200 still lists a zero-defect spot-check after it auto-files as Closed', async () => {
    const allPass = [
      { checklist_item_id: 'item-1', result: 'Pass' },
      { checklist_item_id: 'item-2', result: 'Pass' },
    ];
    const created = await submitLift(allPass);
    expect(created.body.status).toBe('Closed');
    expect(created.body.is_deleted).toBe(true);

    const res = await request(app)
      .get('/api/inspections/my')
      .set('Authorization', 'Bearer inspector-token');

    expect(res.status).toBe(200);
    expect(res.body.data.map((r) => r.id)).toContain(created.body.id);
  });

  test('403 for a manager (originators only)', async () => {
    const res = await request(app)
      .get('/api/inspections/my')
      .set('Authorization', 'Bearer manager-token');

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN');
  });
});

describe('GET /api/inspections/status-board', () => {
  test('200 returns privacy-safe complaint rows only (no lift inspections)', async () => {
    // Seed one resident complaint and one lift inspection via the real paths.
    await request(app)
      .post('/api/inspections')
      .set('Authorization', 'Bearer resident-token')
      .field('title', 'Void deck light flickering')
      .field('description', 'Near block letterboxes')
      .field('location_block', '44A')
      .field('location_unit', '12-05')
      .field('category', 'Electrical');
    await request(app)
      .post('/api/inspections/lift')
      .set('Authorization', 'Bearer inspector-token')
      .field('lift_id', 'lift-1')
      .field('checklist', JSON.stringify([{ checklist_item_id: 'item-1', result: 'Pass' }]));

    const res = await request(app)
      .get('/api/inspections/status-board')
      .set('Authorization', 'Bearer resident-token');

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1); // lift inspection excluded
    const row = res.body.data[0];
    expect(row.location_block).toBe('44A');
    expect(row.status).toBe('Open');
    // Privacy guard: no identifying fields may ever appear.
    expect(row).not.toHaveProperty('title');
    expect(row).not.toHaveProperty('description');
    expect(row).not.toHaveProperty('resident_id');
    expect(row).not.toHaveProperty('location_unit');
    expect(row).not.toHaveProperty('photo_url');
  });

  test('200 for other authenticated roles (e.g. manager)', async () => {
    const res = await request(app)
      .get('/api/inspections/status-board')
      .set('Authorization', 'Bearer manager-token');

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });

  test('401 without a token', async () => {
    const res = await request(app).get('/api/inspections/status-board');

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('UNAUTHENTICATED');
  });
});

describe('PATCH /api/inspections/:id', () => {
  test('200 manager assigns a contractor — status, deadline, history, socket', async () => {
    const id = await seedComplaint();

    const res = await request(app)
      .patch(`/api/inspections/${id}`)
      .set('Authorization', 'Bearer manager-token')
      .send({ contractor_id: 'con-1', note: 'Lift specialist to attend' });

    expect(res.status).toBe(200);
    expect(res.body.contractor_id).toBe('con-1');
    expect(res.body.status).toBe('Assigned'); // UC-002 default on assign
    expect(res.body.target_deadline).toBeTruthy(); // 14-day rule auto-set

    // Audit row written with the transition.
    expect(store.history).toHaveLength(1);
    expect(store.history[0]).toMatchObject({
      inspection_id: id,
      actor_id: 'mgr-1',
      action: 'Assigned',
      previous_status: 'Open',
      new_status: 'Assigned',
      note: 'Lift specialist to attend',
    });

    // Live update pushed to managers, the block's residents, the record's own
    // room (the originator's live channel, UC-003), and — D.5 — the assigned
    // contractor's room, keyed by their users.id via contractors.user_id.
    const socketService = require('../../src/services/socketService');
    expect(socketService.emitToRooms).toHaveBeenCalledWith(
      ['manager-room', 'block-44A', `insp-${id}`, 'contractor-con-user-1'],
      'status_update',
      expect.objectContaining({ id, status: 'Assigned' })
    );
  });

  // UC-015 requires `Reassigned` as a distinct action; every contractor change
  // used to log `Assigned`, so the audit trail couldn't show that work had moved
  // from one vendor to another.
  test('a contractor change logs Assigned first, then Reassigned', async () => {
    const id = await seedComplaint('Lift juddering between floors');

    await request(app)
      .patch(`/api/inspections/${id}`)
      .set('Authorization', 'Bearer manager-token')
      .send({ contractor_id: 'con-1' });

    const res = await request(app)
      .patch(`/api/inspections/${id}`)
      .set('Authorization', 'Bearer manager-token')
      .send({ contractor_id: 'con-2', note: 'Otis unavailable this week' });

    expect(res.status).toBe(200);
    expect(res.body.contractor_id).toBe('con-2');
    expect(store.history.map((h) => h.action)).toEqual(['Assigned', 'Reassigned']);
    expect(store.history[1].note).toBe('Otis unavailable this week');
  });

  // A reassignment is two contractors' business: the incoming one gets
  // reassignment wording, and the outgoing one has to learn the job left their
  // inbox (both the live room and a persisted notification).
  test('a reassignment tells the outgoing contractor and mails the new one as a reassignment', async () => {
    const id = await seedComplaint('Lift alarm not sounding');

    await request(app)
      .patch(`/api/inspections/${id}`)
      .set('Authorization', 'Bearer manager-token')
      .send({ contractor_id: 'con-1' });

    const socketService = require('../../src/services/socketService');
    socketService.emitToRooms.mockClear();
    emailService.sendDefectAlert.mockClear();
    // Spied rather than asserted through the db mock: notifyEvent persists via
    // SQL this suite's in-memory store doesn't model, and swallows the failure.
    const notificationService = require('../../src/services/notificationService');
    const notify = jest.spyOn(notificationService, 'notifyEvent');

    const res = await request(app)
      .patch(`/api/inspections/${id}`)
      .set('Authorization', 'Bearer manager-token')
      .send({ contractor_id: 'con-2' });

    expect(res.status).toBe(200);

    // Both contractors' rooms are on the status_update — the old one's inbox has
    // to drop the record, not just the new one's pick it up.
    expect(socketService.emitToRooms).toHaveBeenCalledWith(
      ['manager-room', 'block-44A', `insp-${id}`, 'contractor-con-user-2', 'contractor-con-user-1'],
      'status_update',
      expect.objectContaining({ id })
    );

    // The new contractor's mail says reassigned, not "a defect has been assigned".
    const [, , options] = emailService.sendDefectAlert.mock.calls[0];
    expect(options).toMatchObject({ email_type: 'reassignment' });

    // Persisted notifications: one to each side.
    const events = notify.mock.calls.map(([e]) => ({
      event_type: e.event_type,
      rooms: e.scope.rooms,
    }));
    expect(events).toEqual(
      expect.arrayContaining([
        { event_type: 'defect_reassigned', rooms: ['contractor-con-user-2'] },
        { event_type: 'defect_unassigned', rooms: ['contractor-con-user-1'] },
      ])
    );
    notify.mockRestore();
  });

  // Re-saving the same contractor is not a reassignment — it must not invent a
  // transition that never happened.
  test('re-saving the same contractor stays Assigned', async () => {
    const id = await seedComplaint('Lobby door sticking');

    for (let i = 0; i < 2; i += 1) {
      await request(app)
        .patch(`/api/inspections/${id}`)
        .set('Authorization', 'Bearer manager-token')
        .send({ contractor_id: 'con-1' });
    }

    expect(store.history.map((h) => h.action)).toEqual(['Assigned', 'Assigned']);
  });

  // A vendor with no linked login has no room to push to, and the assignment
  // must still go through — an update that assigns nobody adds no contractor room.
  test('200 a non-assigning update pushes no contractor room', async () => {
    const id = await seedComplaint('Jammed rubbish chute');
    const socketService = require('../../src/services/socketService');
    socketService.emitToRooms.mockClear();

    const res = await request(app)
      .patch(`/api/inspections/${id}`)
      .set('Authorization', 'Bearer manager-token')
      .send({ priority: 'High' });

    expect(res.status).toBe(200);
    expect(socketService.emitToRooms).toHaveBeenCalledWith(
      ['manager-room', 'block-44A', `insp-${id}`],
      'status_update',
      expect.objectContaining({ id })
    );
  });

  test('200 blank target_deadline falls back to the 14-day rule', async () => {
    const id = await seedComplaint('Flickering lobby light');

    const res = await request(app)
      .patch(`/api/inspections/${id}`)
      .set('Authorization', 'Bearer manager-token')
      .send({ target_deadline: '' });

    expect(res.status).toBe(200);
    const days = (new Date(res.body.target_deadline) - Date.now()) / 86400000;
    expect(Math.round(days)).toBe(14);
  });

  test('200 priority-only change writes a Priority Escalated history row', async () => {
    const id = await seedComplaint('Loose railing');

    const res = await request(app)
      .patch(`/api/inspections/${id}`)
      .set('Authorization', 'Bearer manager-token')
      .send({ priority: 'Critical' });

    expect(res.status).toBe(200);
    expect(res.body.priority).toBe('Critical');
    expect(store.history[0].action).toBe('Priority Escalated');
  });

  test('403 when the caller is not a manager', async () => {
    const id = await seedComplaint();

    const res = await request(app)
      .patch(`/api/inspections/${id}`)
      .set('Authorization', 'Bearer resident-token')
      .send({ priority: 'High' });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN');
  });

  test('404 for an unknown inspection id', async () => {
    const res = await request(app)
      .patch('/api/inspections/insp-nope')
      .set('Authorization', 'Bearer manager-token')
      .send({ priority: 'High' });

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NOT_FOUND');
  });

  test('400 for an invalid status value', async () => {
    const id = await seedComplaint();

    const res = await request(app)
      .patch(`/api/inspections/${id}`)
      .set('Authorization', 'Bearer manager-token')
      .send({ status: 'Fixed' });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  test('400 when no updatable field is provided', async () => {
    const id = await seedComplaint();

    const res = await request(app)
      .patch(`/api/inspections/${id}`)
      .set('Authorization', 'Bearer manager-token')
      .send({ note: 'just a note' });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  // Triage is where a category the resident got wrong gets corrected.
  test('200 a manager can recategorise a resident\'s report', async () => {
    const id = await seedComplaint('Mislabelled report', 'Landscaping');

    const res = await request(app)
      .patch(`/api/inspections/${id}`)
      .set('Authorization', 'Bearer manager-token')
      .send({ category: 'Plumbing', note: 'Burst pipe, not a grounds issue.' });

    expect(res.status).toBe(200);
    expect(res.body.category).toBe('Plumbing');
  });

  test('400 for an invalid category value', async () => {
    const id = await seedComplaint();

    const res = await request(app)
      .patch(`/api/inspections/${id}`)
      .set('Authorization', 'Bearer manager-token')
      .send({ category: 'Other' });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });
});

describe('GET /api/inspections (manager queue)', () => {
  test('200 lists all records with filters applied', async () => {
    await seedComplaint('Leak at 44A');
    const id2 = (await request(app)
      .post('/api/inspections')
      .set('Authorization', 'Bearer resident-token')
      .field('title', 'Broken bench')
      .field('description', 'Slats missing')
      .field('location_block', '45B')
      .field('category', 'Landscaping')).body.id;

    const all = await request(app)
      .get('/api/inspections')
      .set('Authorization', 'Bearer manager-token');
    expect(all.status).toBe(200);
    expect(all.body.total).toBe(2);

    const filtered = await request(app)
      .get('/api/inspections?block=45B')
      .set('Authorization', 'Bearer manager-token');
    expect(filtered.body.total).toBe(1);
    expect(filtered.body.data[0].id).toBe(id2);
  });

  test('403 for non-managers', async () => {
    const res = await request(app)
      .get('/api/inspections')
      .set('Authorization', 'Bearer resident-token');
    expect(res.status).toBe(403);
  });

  // The queue's status-group tabs send their whole group as one ?status= list.
  test('200 ?status= accepts a comma-separated group', async () => {
    const openId = await seedComplaint('Still open');
    const assignedId = await seedComplaint('Being worked on');
    await request(app)
      .patch(`/api/inspections/${assignedId}`)
      .set('Authorization', 'Bearer manager-token')
      .send({ status: 'Acknowledged' });

    // "Needs action" tab.
    const needsAction = await request(app)
      .get('/api/inspections?status=Open,Pending Assignment')
      .set('Authorization', 'Bearer manager-token');
    expect(needsAction.body.data.map((r) => r.id)).toEqual([openId]);

    // "In progress" tab.
    const inProgress = await request(app)
      .get('/api/inspections?status=Assigned,Acknowledged,On Hold')
      .set('Authorization', 'Bearer manager-token');
    expect(inProgress.body.data.map((r) => r.id)).toEqual([assignedId]);

    // A single status still works — drill-through links are unaffected.
    const single = await request(app)
      .get('/api/inspections?status=Acknowledged')
      .set('Authorization', 'Bearer manager-token');
    expect(single.body.data.map((r) => r.id)).toEqual([assignedId]);
  });

  // Closed records are archived out of the live queue and only reachable via
  // the history view — that separation is the whole point of the two pages.
  test('200 ?archived=true returns closed records, and only those', async () => {
    const openId = await seedComplaint('Stays open');
    const toClose = await seedComplaint('Will be closed');
    await request(app)
      .patch(`/api/inspections/${toClose}`)
      .set('Authorization', 'Bearer manager-token')
      .send({ status: 'Rectified' });
    // An inspector's check is a close precondition (UC-004).
    await request(app)
      .post(`/api/inspections/${toClose}/review`)
      .set('Authorization', 'Bearer inspector-token')
      .send({});
    await request(app)
      .post(`/api/inspections/${toClose}/close`)
      .set('Authorization', 'Bearer manager-token')
      .field('closing_remark', 'Verified fixed on site by the technician.')
      .field('endorser_role', 'inspector')
      .field('endorser_id', 'ins-1')
      .attach('manager_signature', PNG, 'm.png')
      .attach('endorser_signature', PNG, 'e.png');

    const live = await request(app)
      .get('/api/inspections')
      .set('Authorization', 'Bearer manager-token');
    expect(live.body.data.map((r) => r.id)).toEqual([openId]);

    const history = await request(app)
      .get('/api/inspections?archived=true')
      .set('Authorization', 'Bearer manager-token');
    expect(history.body.data.map((r) => r.id)).toEqual([toClose]);
    expect(history.body.data[0].is_deleted).toBe(true);
  });

  // UC-005 scorecard drill-through: ?contractor=<name>&overdue=true narrows the
  // queue to one contractor's past-deadline work. Overdue matches the
  // scorecard's definition — a record On Hold is not late (G11 pauses the clock).
  test("200 ?contractor= & ?overdue=true narrow to that contractor's overdue work", async () => {
    const past = new Date(Date.now() - 86_400_000).toISOString();
    const future = new Date(Date.now() + 86_400_000).toISOString();

    const overdueId = await seedComplaint('Overdue lift door');
    const onTimeId = await seedComplaint('Still within deadline');
    const heldId = await seedComplaint('Held — part on order');
    for (const [id, deadline, status] of [
      [overdueId, past, 'Assigned'],
      [onTimeId, future, 'Assigned'],
      [heldId, past, 'On Hold'],
    ]) {
      await request(app)
        .patch(`/api/inspections/${id}`)
        .set('Authorization', 'Bearer manager-token')
        .send({ status, contractor_id: 'con-1', target_deadline: deadline });
    }

    const res = await request(app)
      .get('/api/inspections?contractor=Otis Service SG&overdue=true')
      .set('Authorization', 'Bearer manager-token');

    expect(res.status).toBe(200);
    expect(res.body.data.map((r) => r.id)).toEqual([overdueId]);

    // An unknown contractor name matches nothing rather than everything.
    const none = await request(app)
      .get('/api/inspections?contractor=No Such Vendor&overdue=true')
      .set('Authorization', 'Bearer manager-token');
    expect(none.body.total).toBe(0);
  });

  // Inspectors read this endpoint (read-only) to review completed work
  // before the manager's joint close.
  test('200 for an inspector', async () => {
    await seedComplaint('Leak at 44A');

    const res = await request(app)
      .get('/api/inspections')
      .set('Authorization', 'Bearer inspector-token');

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
  });
});

describe('GET /api/inspections/:id (manager detail)', () => {
  test('200 returns the record with its audit history', async () => {
    const id = await seedComplaint('Stuck rubbish chute');
    await request(app)
      .patch(`/api/inspections/${id}`)
      .set('Authorization', 'Bearer manager-token')
      .send({ priority: 'High', note: 'Escalating' });

    const res = await request(app)
      .get(`/api/inspections/${id}`)
      .set('Authorization', 'Bearer manager-token');

    expect(res.status).toBe(200);
    expect(res.body.title).toBe('Stuck rubbish chute');
    expect(res.body.history).toHaveLength(1);
    expect(res.body.history[0]).toMatchObject({
      action: 'Priority Escalated',
      actor_name: 'Mdm Tan',
      note: 'Escalating',
    });
  });

  // P.13: the manager must see what they are endorsing, not just the row.
  test('200 includes checklist results with template text and both photos', async () => {
    const create = await submitLift(majorChecklist).attach(
      'photo_item-2',
      PNG,
      'defect.png'
    );
    // Stand in for the contractor's UC-010 completion submission.
    for (const r of store.checklist_results) {
      if (r.result === 'Defect') {
        r.rectified = true;
        r.completion_photo_url = 'https://cloudinary.test/defects/done.png';
        r.completion_remark = 'Sensor replaced.';
      }
    }

    const res = await request(app)
      .get(`/api/inspections/${create.body.id}`)
      .set('Authorization', 'Bearer manager-token');

    expect(res.status).toBe(200);
    expect(res.body.checklist_results).toHaveLength(2);
    // Ordered by the paper form's numbering, with the template text joined in.
    expect(res.body.checklist_results.map((r) => r.display_order)).toEqual([1, 2]);
    expect(res.body.checklist_results[0].item_text).toBe('Shaft walls free of cracks');

    const defect = res.body.checklist_results[1];
    expect(defect.result).toBe('Defect');
    expect(defect.photo_url).toBeTruthy();          // before
    expect(defect.completion_photo_url).toBeTruthy(); // after
    expect(defect.completion_remark).toBe('Sensor replaced.');

    // The inspector's G5 signature travels with the record for the audit trail.
    expect(res.body.signatures).toHaveLength(1);
    expect(res.body.signatures[0].signer_role).toBe('inspector');
  });

  test('200 includes the linked cv_detection (bounding box etc.) when cv_detection_id is set', async () => {
    const id = await seedComplaint('Auto-detected: scratch');
    store.inspections.find((i) => i.id === id).cv_detection_id = 'cv-1';
    store.cv_detections.push({
      id: 'cv-1',
      image_url: 'https://example.com/photo.jpg',
      defect_class: 'scratch',
      confidence: '0.8047',
      bounding_box: { x: 860, y: 329.5, width: 164, height: 67 },
      source: 'resident_upload',
      status: 'processed',
    });

    const res = await request(app)
      .get(`/api/inspections/${id}`)
      .set('Authorization', 'Bearer manager-token');

    expect(res.status).toBe(200);
    expect(res.body.cv_detection).toMatchObject({
      id: 'cv-1',
      defect_class: 'scratch',
      bounding_box: { x: 860, y: 329.5, width: 164, height: 67 },
    });
  });

  test('200 cv_detection is null when the record has no cv_detection_id', async () => {
    const id = await seedComplaint('Plain complaint, no CV');

    const res = await request(app)
      .get(`/api/inspections/${id}`)
      .set('Authorization', 'Bearer manager-token');

    expect(res.status).toBe(200);
    expect(res.body.cv_detection).toBeNull();
  });

  test('404 for an unknown id', async () => {
    const res = await request(app)
      .get('/api/inspections/insp-nope')
      .set('Authorization', 'Bearer manager-token');
    expect(res.status).toBe(404);
  });

  // Inspectors read this endpoint (read-only) to review completed work
  // before the manager's joint close.
  test('200 for an inspector', async () => {
    const id = await seedComplaint('Stuck rubbish chute');

    const res = await request(app)
      .get(`/api/inspections/${id}`)
      .set('Authorization', 'Bearer inspector-token');

    expect(res.status).toBe(200);
    expect(res.body.title).toBe('Stuck rubbish chute');
  });
});

describe('GET /api/contractors', () => {
  test('200 for a manager', async () => {
    const res = await request(app)
      .get('/api/contractors')
      .set('Authorization', 'Bearer manager-token');
    expect(res.status).toBe(200);
    expect(res.body[0].name).toBe('Otis Service SG');
  });

  test('403 for a resident', async () => {
    const res = await request(app)
      .get('/api/contractors')
      .set('Authorization', 'Bearer resident-token');
    expect(res.status).toBe(403);
  });
});

describe('POST /api/inspections/:id/close', () => {
  const REMARK = 'Technician replaced the faulty button; verified working on site.';

  // Move a record to 'Rectified' — the close endpoint's state precondition.
  // Uses the real manager PATCH path rather than poking the store directly.
  async function rectify(id) {
    await request(app)
      .patch(`/api/inspections/${id}`)
      .set('Authorization', 'Bearer manager-token')
      .send({ status: 'Rectified' });
  }

  // An inspector checks the contractor's work — the second half of the close
  // precondition, alongside the record being Rectified.
  async function review(id) {
    await request(app)
      .post(`/api/inspections/${id}/review`)
      .set('Authorization', 'Bearer inspector-token')
      .send({});
  }

  // Seed a complaint and advance it to 'Rectified' + reviewed, ready to close.
  async function seedRectified(title) {
    const id = await seedComplaint(title);
    await rectify(id);
    await review(id);
    return id;
  }

  // Close a record with the two required signature parts + a valid endorser.
  function closeRecord(id, extra = {}) {
    const req = request(app)
      .post(`/api/inspections/${id}/close`)
      .set('Authorization', 'Bearer manager-token')
      .field('closing_remark', extra.remark ?? REMARK)
      .field('endorser_role', extra.endorser_role ?? 'inspector')
      .field('endorser_id', extra.endorser_id ?? 'ins-1');
    if (extra.actual_cost !== undefined) req.field('actual_cost', extra.actual_cost);
    if (extra.waiver_note !== undefined) req.field('waiver_note', extra.waiver_note);
    if (!extra.omitManagerSig) req.attach('manager_signature', PNG, 'mgr.png');
    if (!extra.omitEndorserSig) req.attach('endorser_signature', PNG, 'insp.png');
    return req;
  }

  // An archived record must stay viewable — closing it used to make the detail
  // page 404, leaving no way to see a closed record anywhere in the app.
  test('a closed record is still readable via GET /:id, with its full payload', async () => {
    const create = await submitLift(majorChecklist).attach('photo_item-2', PNG, 'defect.png');
    const id = create.body.id;
    for (const r of store.checklist_results) {
      if (r.inspection_id === id && r.result === 'Defect') {
        r.rectified = true;
        r.completion_photo_url = 'https://cloudinary.test/defects/done.png';
      }
    }
    await rectify(id);
    await review(id);
    expect((await closeRecord(id)).status).toBe(200);

    const res = await request(app)
      .get(`/api/inspections/${id}`)
      .set('Authorization', 'Bearer manager-token');

    expect(res.status).toBe(200);
    expect(res.body.is_deleted).toBe(true);
    expect(res.body.status).toBe('Closed');
    // The audit trail the archive exists to preserve is all still there.
    expect(res.body.checklist_results).toHaveLength(2);
    expect(res.body.signatures.length).toBeGreaterThanOrEqual(2);
    expect(res.body.history.some((h) => h.action === 'Jointly Endorsed & Closed')).toBe(true);
  });

  // findById stays filtered on is_deleted, so the mutation guards are unmoved
  // by the detail-view relaxation above.
  test('409/404 — an already-closed record cannot be closed again', async () => {
    const id = await seedRectified('Double close attempt');
    expect((await closeRecord(id)).status).toBe(200);

    const again = await closeRecord(id);

    expect(again.status).toBe(404);
    expect(again.body.code).toBe('NOT_FOUND');
  });

  // Both halves of the UC-004 precondition are enforced: the contractor
  // finishing the work is not enough on its own. Unlike the unrectified-defect
  // rule below, this one takes no waiver.
  test('409 — a Rectified record no inspector has reviewed cannot be closed', async () => {
    const id = await seedComplaint('Rectified but unchecked');
    await rectify(id); // contractor done, inspector has not looked

    const res = await closeRecord(id);

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('NOT_REVIEWED');
    // Still open: a refused close must not archive the record.
    expect(store.inspections.find((i) => i.id === id).is_deleted).toBe(false);
  });

  test('200 once an inspector reviews it, the same record closes', async () => {
    const id = await seedComplaint('Reviewed then closed');
    await rectify(id);
    expect((await closeRecord(id)).status).toBe(409);

    await review(id);

    expect((await closeRecord(id)).status).toBe(200);
  });

  test('a waiver note does not buy past the inspector check', async () => {
    const id = await seedComplaint('Waiver attempt');
    await rectify(id);

    const res = await closeRecord(id, {
      waiver_note: 'Contractor unreachable and the lift is back in service.',
    });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('NOT_REVIEWED');
  });

  test('200 closes with remark + dual signatures, computes fields, archives', async () => {
    const id = await seedRectified('Lift button stuck at L3');

    const res = await closeRecord(id, { actual_cost: '250.50' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('Closed');
    expect(res.body.is_deleted).toBe(true);
    expect(res.body.closed_at).toBeTruthy();
    expect(res.body.resolution_time_hours).not.toBeNull();

    // Two signatures stored: manager + endorser.
    expect(store.signatures).toHaveLength(2);
    expect(store.signatures.map((s) => s.signer_role).sort()).toEqual(['inspector', 'manager']);
    expect(store.signatures.find((s) => s.signer_role === 'manager').signer_id).toBe('mgr-1');

    // UC-015 audit row written under its documented name.
    expect(store.history.some((h) => h.action === 'Jointly Endorsed & Closed')).toBe(true);

    // Both signatures uploaded to the /signatures folder.
    const cloudinaryService = require('../../src/services/cloudinaryService');
    expect(cloudinaryService.uploadImage).toHaveBeenCalledWith(expect.anything(), 'signatures');
    expect(cloudinaryService.uploadImage).toHaveBeenCalledTimes(2);
  });

  test('400 when the closing remark is too short', async () => {
    const id = await seedComplaint('Short remark case');
    const res = await closeRecord(id, { remark: 'too short' });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(res.body.message).toBe('Closing remark must be at least 10 characters.');
  });

  test('400 SIGNATURE_REQUIRED when a signature image is missing', async () => {
    const id = await seedComplaint('Missing signature case');
    const res = await closeRecord(id, { omitEndorserSig: true });

    expect(res.status).toBe(400);
    // Same code the UC-010 contractor rectify flow uses for the same condition.
    expect(res.body.code).toBe('SIGNATURE_REQUIRED');
  });

  test('403 when the caller is not a manager', async () => {
    const id = await seedComplaint('Wrong role case');
    const res = await request(app)
      .post(`/api/inspections/${id}/close`)
      .set('Authorization', 'Bearer resident-token')
      .field('closing_remark', REMARK)
      .field('endorser_role', 'inspector')
      .field('endorser_id', 'ins-1')
      .attach('manager_signature', PNG, 'm.png')
      .attach('endorser_signature', PNG, 'e.png');

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN');
  });

  test('404 for an unknown inspection id', async () => {
    const res = await closeRecord('insp-nope');
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NOT_FOUND');
  });

  test('404 when the endorser is not a real user', async () => {
    const id = await seedRectified('Bad endorser case');
    const res = await closeRecord(id, { endorser_id: 'ghost-user' });

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NOT_FOUND');
  });

  // G7 / R9: the endorsing signature must belong to a real inspector — both
  // that the claimed role is 'inspector' and that the nominated user actually
  // holds it, so the audit trail can't record a false attestation.
  test('400 ENDORSER_MUST_BE_INSPECTOR when the nominated user is not an inspector', async () => {
    const id = await seedRectified('Role mismatch case');
    // res-1 is a resident being passed off as the inspector endorser.
    const res = await closeRecord(id, { endorser_id: 'res-1' });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('ENDORSER_MUST_BE_INSPECTOR');

    // Rejected before any upload — no orphaned signature images in Cloudinary.
    const cloudinaryService = require('../../src/services/cloudinaryService');
    expect(cloudinaryService.uploadImage).not.toHaveBeenCalled();
    expect(store.signatures).toHaveLength(0);
  });

  // The contractor who did the work may not endorse that it was done.
  test('400 ENDORSER_MUST_BE_INSPECTOR when a contractor is nominated', async () => {
    const id = await seedRectified('Contractor endorsement case');
    const res = await closeRecord(id, {
      endorser_role: 'contractor',
      endorser_id: 'con-user-1',
    });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('ENDORSER_MUST_BE_INSPECTOR');
    expect(store.signatures).toHaveLength(0);
  });

  test('409 INVALID_STATE when the record has not been rectified yet', async () => {
    const id = await seedComplaint('Still open case'); // stays 'Open'
    const res = await closeRecord(id);

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('INVALID_STATE');
  });

  // --- G8: close is gated on rectified defects ---------------------------
  // Seed a lift inspection carrying one Major defect, then advance it to
  // Rectified — the state a real close is reached from.
  async function seedRectifiedWithDefect() {
    const create = await submitLift(majorChecklist).attach(
      'photo_item-2',
      PNG,
      'defect.png'
    );
    await rectify(create.body.id);
    await review(create.body.id);
    return create.body.id;
  }

  test('409 UNRECTIFIED_DEFECTS naming the item numbers still outstanding', async () => {
    const id = await seedRectifiedWithDefect();
    // Seeding uploaded the defect photo + inspector signature; measure only
    // what the close attempt itself does.
    const cloudinaryService = require('../../src/services/cloudinaryService');
    cloudinaryService.uploadImage.mockClear();

    const res = await closeRecord(id);

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('UNRECTIFIED_DEFECTS');
    // item-2 is display_order 2 — the inspector's own numbering.
    expect(res.body.message).toContain('2');

    // Blocked before the signature uploads.
    expect(cloudinaryService.uploadImage).not.toHaveBeenCalled();
  });

  test('200 closes once the defect carries a completion photo', async () => {
    const id = await seedRectifiedWithDefect();
    // Stand in for the contractor's UC-010 submission.
    for (const r of store.checklist_results) {
      if (r.inspection_id === id && r.result === 'Defect') {
        r.rectified = true;
        r.completion_photo_url = 'https://cloudinary.test/defects/done.png';
      }
    }

    const res = await closeRecord(id);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('Closed');
  });

  test('200 closes unrectified with a waiver note, recorded in the remark', async () => {
    const id = await seedRectifiedWithDefect();

    const res = await closeRecord(id, {
      waiver_note: 'Lift decommissioned next month; rectification not economical.',
    });

    expect(res.status).toBe(200);
    const closed = store.inspections.find((i) => i.id === id);
    expect(closed.closing_remark).toContain('Waiver');
    expect(closed.closing_remark).toContain('decommissioned');
  });

  test('409 when the waiver note is too short to count as a justification', async () => {
    const id = await seedRectifiedWithDefect();

    const res = await closeRecord(id, { waiver_note: 'too short' });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('UNRECTIFIED_DEFECTS');
  });

  test('queues an ai_jobs row on the 3rd close of a block+category in 30 days', async () => {
    // Three complaints in the same block+category (seedComplaint's default).
    const ids = [];
    for (let i = 0; i < 3; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      ids.push(await seedRectified(`Recurring defect ${i}`));
    }
    // eslint-disable-next-line no-await-in-loop
    for (const id of ids) await closeRecord(id);

    // Only the 3rd close crosses the threshold → exactly one queued job.
    expect(store.ai_jobs).toHaveLength(1);
    expect(store.ai_jobs[0]).toMatchObject({ location_block: '44A', category: 'Electrical' });
  });
});

// UC-004 Alt 4 (P.12): the manager refuses the contractor's rectification.
describe('POST /api/inspections/:id/reject', () => {
  const REASON = 'Completion photo shows the same defect — sensor still misaligned.';

  // A lift inspection with a defect the contractor claims to have rectified.
  async function seedAwaitingEndorsement() {
    const create = await submitLift(majorChecklist).attach('photo_item-2', PNG, 'defect.png');
    for (const r of store.checklist_results) {
      if (r.inspection_id === create.body.id && r.result === 'Defect') {
        r.rectified = true;
        r.completion_photo_url = 'https://cloudinary.test/defects/done.png';
      }
    }
    await request(app)
      .patch(`/api/inspections/${create.body.id}`)
      .set('Authorization', 'Bearer manager-token')
      .send({ status: 'Rectified' });
    return create.body.id;
  }

  test('200 sends the record back to Assigned with a fresh deadline', async () => {
    const id = await seedAwaitingEndorsement();

    const res = await request(app)
      .post(`/api/inspections/${id}/reject`)
      .set('Authorization', 'Bearer manager-token')
      .send({ reason: REASON });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('Assigned');
    expect(res.body.reopen_count).toBe(1);
    expect(new Date(res.body.target_deadline).getTime()).toBeGreaterThan(Date.now());

    // The completion proof is withdrawn, so G8 blocks a close again.
    const defect = store.checklist_results.find(
      (r) => r.inspection_id === id && r.result === 'Defect'
    );
    expect(defect.rectified).toBe(false);
    expect(defect.completion_photo_url).toBeNull();

    // Audit trail records the rejection with its reason.
    const rejected = store.history.find((h) => h.action === 'Rectification Rejected');
    expect(rejected).toBeTruthy();
    expect(rejected.note).toBe(REASON);
    expect(rejected.new_status).toBe('Assigned');

    // G20: the inspector's original signature is retained, not overwritten.
    expect(store.signatures).toHaveLength(1);
  });

  test('400 when the reason is shorter than 10 characters', async () => {
    const id = await seedAwaitingEndorsement();

    const res = await request(app)
      .post(`/api/inspections/${id}/reject`)
      .set('Authorization', 'Bearer manager-token')
      .send({ reason: 'no' });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  test('409 INVALID_STATE when the record is not awaiting endorsement', async () => {
    const create = await submitLift(majorChecklist).attach('photo_item-2', PNG, 'defect.png');

    const res = await request(app)
      .post(`/api/inspections/${create.body.id}/reject`)
      .set('Authorization', 'Bearer manager-token')
      .send({ reason: REASON });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('INVALID_STATE');
  });

  test('403 when the caller is not a manager', async () => {
    const id = await seedAwaitingEndorsement();

    const res = await request(app)
      .post(`/api/inspections/${id}/reject`)
      .set('Authorization', 'Bearer inspector-token')
      .send({ reason: REASON });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN');
  });

  test('404 for an unknown inspection id', async () => {
    const res = await request(app)
      .post('/api/inspections/insp-nope/reject')
      .set('Authorization', 'Bearer manager-token')
      .send({ reason: REASON });

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NOT_FOUND');
  });

  // D.5 — the rejection has to reach the contractor's own room, or their inbox
  // keeps showing the work as accepted until they reload the page.
  test('pushes the rejection to the contractor room as well as the manager', async () => {
    const id = await seedAwaitingEndorsement();
    const socketService = require('../../src/services/socketService');
    socketService.emitToRooms.mockClear();

    const res = await request(app)
      .post(`/api/inspections/${id}/reject`)
      .set('Authorization', 'Bearer manager-token')
      .send({ reason: REASON });

    expect(res.status).toBe(200);
    expect(socketService.emitToRooms).toHaveBeenCalledWith(
      ['manager-room', 'block-44A', 'contractor-con-user-1'],
      'status_update',
      expect.objectContaining({ id, status: 'Assigned' })
    );
  });

  // D.4 — the contractor is told by email, not just in-app, that the work is
  // back with them. A lift inspection already carries the lift's contractor
  // (con-1), so there is someone to notify without assigning one.
  test('emails the assigned contractor the UC-014 rejection variant', async () => {
    const id = await seedAwaitingEndorsement();
    emailService.sendDefectAlert.mockClear();

    const res = await request(app)
      .post(`/api/inspections/${id}/reject`)
      .set('Authorization', 'Bearer manager-token')
      .send({ reason: REASON });

    expect(res.status).toBe(200);
    expect(emailService.sendDefectAlert).toHaveBeenCalledTimes(1);

    const [defect, to, options] = emailService.sendDefectAlert.mock.calls[0];
    expect(defect.id).toBe(id);
    expect(defect.status).toBe('Assigned'); // carries the fresh deadline
    expect(to).toContain('lc@example.com');
    expect(options).toEqual({ email_type: 'rejection', reason: REASON });
  });

  test('no email when the record has no contractor to notify', async () => {
    const id = await seedAwaitingEndorsement();
    store.inspections.find((i) => i.id === id).contractor_id = null;
    emailService.sendDefectAlert.mockClear();

    const res = await request(app)
      .post(`/api/inspections/${id}/reject`)
      .set('Authorization', 'Bearer manager-token')
      .send({ reason: REASON });

    expect(res.status).toBe(200);
    expect(emailService.sendDefectAlert).not.toHaveBeenCalled();
  });

  // Same policy as the socket push (G13): the rejection is already committed, so
  // a mail failure is logged and swallowed rather than surfaced as a 500.
  test('a failed rejection email never fails the rejection', async () => {
    const id = await seedAwaitingEndorsement();
    emailService.sendDefectAlert.mockClear();
    emailService.sendDefectAlert.mockRejectedValueOnce(new Error('smtp down'));
    const logged = jest.spyOn(console, 'error').mockImplementation(() => {});

    const res = await request(app)
      .post(`/api/inspections/${id}/reject`)
      .set('Authorization', 'Bearer manager-token')
      .send({ reason: REASON });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('Assigned');
    expect(logged).toHaveBeenCalled();
    logged.mockRestore();
  });
});

describe('POST /api/inspections/:id/review', () => {
  async function seedRectified() {
    const id = await seedComplaint('Rectified complaint');
    await request(app)
      .patch(`/api/inspections/${id}`)
      .set('Authorization', 'Bearer manager-token')
      .send({ status: 'Rectified' });
    return id;
  }

  // The inspector's check is what resolves a defect: it used to write an audit
  // row and leave the record sitting in "Pending View By Inspector" even after
  // they had looked at it.
  test('200 resolves the record and records the audit row', async () => {
    const id = await seedRectified();

    const res = await request(app)
      .post(`/api/inspections/${id}/review`)
      .set('Authorization', 'Bearer inspector-token')
      .send({ note: 'Looks good on site.' });

    expect(res.status).toBe(200);
    expect(res.body.code).toBe('OK');

    const reviewed = store.history.find((h) => h.action === 'Reviewed by Inspector');
    expect(reviewed).toBeTruthy();
    expect(reviewed.note).toBe('Looks good on site.');
    expect(reviewed.previous_status).toBe('Rectified');
    expect(reviewed.new_status).toBe('Resolved');

    const inspection = store.inspections.find((i) => i.id === id);
    expect(inspection.status).toBe('Resolved');
  });

  test('409 INVALID_STATE when the record is not Rectified', async () => {
    const id = await seedComplaint('Still open');

    const res = await request(app)
      .post(`/api/inspections/${id}/review`)
      .set('Authorization', 'Bearer inspector-token')
      .send({});

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('INVALID_STATE');
  });

  test('403 when the caller is not an inspector', async () => {
    const id = await seedRectified();

    const res = await request(app)
      .post(`/api/inspections/${id}/review`)
      .set('Authorization', 'Bearer manager-token')
      .send({});

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN');
  });

  test('404 for an unknown inspection id', async () => {
    const res = await request(app)
      .post('/api/inspections/insp-nope/review')
      .set('Authorization', 'Bearer inspector-token')
      .send({});

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NOT_FOUND');
  });
});

describe('GET /api/checklist-items', () => {
  test('200 returns active template items sorted by display_order', async () => {
    const res = await request(app)
      .get('/api/checklist-items')
      .set('Authorization', 'Bearer inspector-token');

    expect(res.status).toBe(200);
    // Inactive item-3 excluded; remaining two in display_order.
    expect(res.body.map((i) => i.id)).toEqual(['item-1', 'item-2']);
  });
});

describe('GET /api/lifts', () => {
  test('200 returns lifts with contractor names for an inspector', async () => {
    const res = await request(app)
      .get('/api/lifts')
      .set('Authorization', 'Bearer inspector-token');

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].lift_code).toBe('44A-L1');
    expect(res.body[0].contractor_name).toBe('Otis Service SG');
  });

  test('403 for a non-inspector', async () => {
    const res = await request(app)
      .get('/api/lifts')
      .set('Authorization', 'Bearer resident-token');

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN');
  });
});
