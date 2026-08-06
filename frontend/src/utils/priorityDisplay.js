// DB inspection priority (migration 004 CHECK: Critical/High/Medium/Low) →
// display label + chip colours. DISPLAY-ONLY mapping — the DB enum is untouched.
// Mirrors statusDisplay.js. Heat ramp: yellow → orange → red → dark red.
export const PRIORITY_DISPLAY = {
  Low: { label: 'Low', bg: '#FACC15', fg: '#1F2937' }, // yellow
  Medium: { label: 'Medium', bg: '#FB923C', fg: '#ffffff' }, // orange
  High: { label: 'High', bg: '#EF4444', fg: '#ffffff' }, // red
  Critical: { label: 'Critical', bg: '#991B1B', fg: '#ffffff' }, // dark red
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
