// DB inspection priority (migration 004 CHECK: Critical/High/Medium/Low) →
// display label + chip colours. DISPLAY-ONLY mapping — the DB enum is untouched.
// Mirrors statusDisplay.js. Colours are theme palette tokens (used via sx), no
// hex: heat ramps amber → orange → red → darkest red (primary.dark, #940000 in
// the brand palette, is the darkest red token available).
export const PRIORITY_DISPLAY = {
  Low: { label: 'Low', bg: 'warning.light', fg: 'text.primary' },
  Medium: { label: 'Medium', bg: 'warning.main', fg: 'warning.contrastText' },
  High: { label: 'High', bg: 'error.main', fg: 'error.contrastText' },
  Critical: { label: 'Critical', bg: 'primary.dark', fg: 'primary.contrastText' },
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
