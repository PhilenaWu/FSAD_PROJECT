// DB inspection status (migration 004 CHECK) → resident-friendly label + MUI
// chip colour. Residents shouldn't see internal ops terms like "Open".
// Shared by MyReportsPage and StatusBoardPage.
// Colour keys are theme palette tokens (Chip `color` prop) — "default" is
// reserved for genuinely inactive/archived states (Closed) so live states
// don't read as flat grey.
export const STATUS_DISPLAY = {
  Open: { label: 'Submitted', color: 'info' },
  'Pending Assignment': { label: 'Being reviewed', color: 'secondary' },
  Assigned: { label: 'Contractor assigned', color: 'primary' },
  Acknowledged: { label: 'In progress', color: 'primary' },
  'On Hold': { label: 'On hold', color: 'warning' },
  Rectified: { label: 'Work completed', color: 'success' },
  Resolved: { label: 'Resolved', color: 'success' },
  Closed: { label: 'Closed', color: 'default' },
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
    statuses: ['Assigned', 'Acknowledged', 'On Hold'],
  },
  done: {
    label: 'Completed',
    color: 'success',
    statuses: ['Rectified', 'Resolved', 'Closed'],
  },
};

// Group key for a DB status; unknown statuses count as still under review.
export function statusGroup(status) {
  for (const [key, group] of Object.entries(STATUS_GROUPS)) {
    if (group.statuses.includes(status)) return key;
  }
  return 'review';
}
