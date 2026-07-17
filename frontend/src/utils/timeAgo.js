// "2 days ago" style relative time — small local helper, no date library.
// Shared by StatusBoardPage and HomePage.
const TIME_UNITS = [
  [60, 'minute'], // after 60s
  [3600, 'hour'],
  [86400, 'day'],
  [604800, 'week'],
  [2629800, 'month'],
  [31557600, 'year'],
];

export function timeAgo(iso) {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(iso)) / 1000));
  if (seconds < 60) return 'just now';
  let label = 'minute';
  let value = Math.floor(seconds / 60);
  for (const [size, unit] of TIME_UNITS) {
    if (seconds < size) break;
    label = unit;
    value = Math.floor(seconds / size);
  }
  return `${value} ${label}${value === 1 ? '' : 's'} ago`;
}
