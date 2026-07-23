// DB inspection priority (migration 004 CHECK: Critical/High/Medium/Low) →
// display label + chip colours. DISPLAY-ONLY mapping — the DB enum is untouched.
// Mirrors statusDisplay.js. Heat ramp: yellow → orange → red → dark red.
export const PRIORITY_DISPLAY = {
  Low: { label: 'Low', bg: '#fdd835', fg: 'text.primary' }, // yellow
  Medium: { label: 'Medium', bg: '#fb8c00', fg: '#ffffff' }, // orange
  High: { label: 'High', bg: '#e53935', fg: '#ffffff' }, // red
  Critical: { label: 'Critical', bg: '#8b0000', fg: '#ffffff' }, // dark red
};

// Unknown/new values fall through unmapped rather than breaking the UI.
export function priorityDisplay(priority) {
  return (
    PRIORITY_DISPLAY[priority] ?? {
      label: priority,
      bg: 'action.selected',
      fg: 'text.primary',
    }
  );
}
