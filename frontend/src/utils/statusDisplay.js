// DB inspection status (migration 004 CHECK) → resident-friendly label + MUI
// chip colour. Residents shouldn't see internal ops terms like "Open".
// Shared by MyReportsPage and StatusBoardPage.
// Colour keys are theme palette tokens (Chip `color` prop) — "default" is
// reserved for genuinely inactive/archived states (Closed) so live states
// don't read as flat grey.
// A record moves through four states and no more: Open when it arrives,
// Assigned when a manager gives it to a contractor, Pending View By Inspector
// once the contractor finishes, Resolved when the inspector has checked it.
// Closed is the archive, set by the UC-004 close and never chosen by hand.
//
// 'Rectified' is still what the database stores for the third state — renaming
// the value would mean rewriting the CHECK constraint, every row, and the SLA,
// overdue and analytics queries that match on it. Only the wording changed.
//
// 'Pending Assignment', 'Acknowledged' and 'On Hold' are no longer set by
// anything. They stay mapped so records still carrying them from before render
// as something sensible rather than as a raw enum.
export const STATUS_DISPLAY = {
  Open: { label: 'Open', color: 'info' },
  Assigned: { label: 'Assigned', color: 'primary' },
  Rectified: { label: 'Pending View By Inspector', color: 'warning' },
  Resolved: { label: 'Resolved', color: 'success' },
  Closed: { label: 'Closed', color: 'default' },
  // Retired — historical records only.
  'Pending Assignment': { label: 'Open', color: 'info' },
  Acknowledged: { label: 'Assigned', color: 'primary' },
  'On Hold': { label: 'Assigned', color: 'primary' },
};

// Unknown/new statuses fall through unmapped rather than breaking the UI.
export function statusDisplay(status) {
  return STATUS_DISPLAY[status] ?? { label: status, color: 'default' };
}

// Traffic-light progress groups for the status board: red = still under
// review, yellow = being worked on, green = done. Colours are the theme's
// semantic palette tokens (error/warning/success), not hex.
export const STATUS_GROUPS = {
  review: {
    label: 'Under review',
    color: 'error',
    statuses: ['Open', 'Pending Assignment'],
  },
  progress: {
    label: 'In progress',
    color: 'warning',
    // Rectified sits here, not in "done": the work is submitted but nobody has
    // checked it yet, which is exactly what "Pending View By Inspector" says.
    statuses: ['Assigned', 'Acknowledged', 'On Hold', 'Rectified'],
  },
  done: {
    label: 'Completed',
    color: 'success',
    statuses: ['Resolved', 'Closed'],
  },
};

// Group key for a DB status; unknown statuses count as still under review.
export function statusGroup(status) {
  for (const [key, group] of Object.entries(STATUS_GROUPS)) {
    if (group.statuses.includes(status)) return key;
  }
  return 'review';
}
