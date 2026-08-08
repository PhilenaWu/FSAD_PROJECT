// Pure helpers behind the UC-003 "My reports" page. Kept out of the component
// so the rules that actually break — which live updates apply to me, what a
// closure does to the lists, when a rating may be offered — are unit-testable
// without rendering anything.

// Apply an incoming `status_update` to the live list.
//
// The event is broadcast to the block room as well as the record's own room, so
// a resident hears about their neighbours' reports too — anything not in this
// list is 'ignored'. A close archives the record, which moves it out of the live
// list and into the history section, so the caller has to react differently to
// that than to an ordinary status change.
//
// Returns the next list and one of 'ignored' | 'updated' | 'closed'. Never
// mutates the list it is given.
export function applyStatusUpdate(reports, payload) {
  if (!payload?.id || !reports.some((r) => r.id === payload.id)) {
    return { reports, outcome: 'ignored' };
  }

  if (payload.status === 'Closed') {
    return { reports: reports.filter((r) => r.id !== payload.id), outcome: 'closed' };
  }

  return {
    reports: reports.map((r) =>
      r.id === payload.id
        ? {
            ...r,
            status: payload.status ?? r.status,
            priority: payload.priority ?? r.priority,
            updated_at: payload.updated_at ?? r.updated_at,
          }
        : r
    ),
    outcome: 'updated',
  };
}

// A report can be edited for 30 minutes after it was filed — mirrors the
// server-side EDIT_WINDOW_MS in myReportsController.js. Time-only: not also
// gated on status, so this stays true even if a manager has already started
// triaging within the window.
const EDIT_WINDOW_MS = 30 * 60 * 1000;

export function isEditable(report) {
  return Date.now() - new Date(report.created_at).getTime() <= EDIT_WINDOW_MS;
}

// Write a saved edit (PATCH response) onto the list holding the record.
export function applyEdit(reports, id, updated) {
  return reports.map((r) => (r.id === id ? { ...r, ...updated } : r));
}

// Checklist results arrive ordered by section then display_order; fold them into
// [section, items[]] pairs for rendering without re-sorting.
export function groupBySection(results) {
  const sections = new Map();
  for (const item of results) {
    if (!sections.has(item.section)) sections.set(item.section, []);
    sections.get(item.section).push(item);
  }
  return [...sections];
}
