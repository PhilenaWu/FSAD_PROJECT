// Pure helpers behind the UC-003 "My reports" page. Kept out of the component
// so the rules that actually break — which live updates apply to me, what a
// closure does to the lists, when a rating may be offered — are unit-testable
// without rendering anything.

// A rating is offered once the work is done. 'Closed' is included because the
// workflow runs Assigned → Acknowledged → Rectified → Closed and only reaches
// 'Resolved' if a manager sets it by hand — gating on 'Resolved' alone would
// mean most reports could never be rated. The server enforces the same list.
export const RATABLE_STATUSES = ['Resolved', 'Closed'];

export function isRatable(report) {
  return RATABLE_STATUSES.includes(report.status);
}

// How many closed reports are still waiting for the originator's rating.
export function countAwaitingRating(reports) {
  return reports.filter((r) => isRatable(r) && !r.satisfaction_rating).length;
}

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

// Write a submitted rating onto whichever list holds the record.
export function applyRating(reports, id, rating, comment) {
  return reports.map((r) =>
    r.id === id ? { ...r, satisfaction_rating: rating, satisfaction_comment: comment } : r
  );
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
