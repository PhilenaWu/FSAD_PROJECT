// Bucketing for the UC-005 issue-trend line.
//
// Why this exists: the chart uses a Chart.js CATEGORY axis, which spaces every
// label evenly, and `/analytics/trends` returns only the days that actually
// have reports. Plotted raw, a three-week quiet stretch occupies exactly the
// same width as one busy day — the line then says something about time that
// isn't true, and over a year of history it reads as noise rather than a trend.
//
// So: fill every period across the whole range, and widen the period as the
// range grows. The axis stays linear in time at every zoom level, and a year
// of data lands as ~13 points instead of ~200.

const DAY_MS = 86_400_000;

// Range thresholds, in days, at which the bucket widens.
export const DAILY_MAX_DAYS = 45;
export const WEEKLY_MAX_DAYS = 180;

// 'YYYY-MM-DD' → Date at UTC midnight. Parsing as UTC (rather than letting the
// engine apply the local zone) keeps a date from sliding into the previous day
// west of Greenwich, which would silently move reports between buckets.
const parseDay = (iso) => new Date(`${iso}T00:00:00Z`);
const toIso = (d) => d.toISOString().slice(0, 10);

// Monday of the week containing `d`. getUTCDay() is 0 for Sunday, so Sunday
// belongs to the week that started six days earlier.
function weekStart(d) {
  const day = d.getUTCDay();
  return new Date(d.getTime() - ((day + 6) % 7) * DAY_MS);
}

const monthStart = (d) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));

// The bucket a date belongs to, as a sortable 'YYYY-MM-DD' / 'YYYY-MM' key.
function bucketKey(date, granularity) {
  if (granularity === 'month') return toIso(monthStart(date)).slice(0, 7);
  if (granularity === 'week') return toIso(weekStart(date));
  return toIso(date);
}

// Every bucket key from `first` to `last` inclusive — including the empty ones,
// which is the whole point: a quiet fortnight should look quiet, not vanish.
function bucketRange(first, last, granularity) {
  const keys = [];
  let cursor =
    granularity === 'month' ? monthStart(first)
      : granularity === 'week' ? weekStart(first)
        : first;

  while (cursor <= last) {
    keys.push(bucketKey(cursor, granularity));
    if (granularity === 'month') {
      cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1));
    } else {
      cursor = new Date(cursor.getTime() + (granularity === 'week' ? 7 : 1) * DAY_MS);
    }
  }
  return keys;
}

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

// Axis label — short enough to sit under a tick without rotating into a mess.
function axisLabel(key, granularity) {
  if (granularity === 'month') {
    const [y, m] = key.split('-');
    return `${MONTHS_SHORT[Number(m) - 1]} ${y.slice(2)}`; // "Mar 26"
  }
  return key.slice(5); // "MM-DD"
}

// Tooltip title — says which period the point covers, so a weekly or monthly
// point can never be mistaken for a single day's count. Spelled out in full
// here; the axis has to stay terse, a tooltip does not.
function tooltipLabel(key, granularity) {
  if (granularity === 'month') {
    const [y, m] = key.split('-');
    return `${MONTHS_LONG[Number(m) - 1]} ${y}`;
  }
  if (granularity === 'week') return `Week of ${key}`;
  return key;
}

// Human name for the period, for the panel subtitle ("Reports per week").
export const GRANULARITY_NOUN = { day: 'day', week: 'week', month: 'month' };

/**
 * Bucket one or more [{ date, count }] series onto a single shared time axis.
 *
 * All series share the axis so the database line and the Data Playground's
 * imported line stay comparable point for point.
 *
 * @param {Array<Array<{date: string, count: number}>>} seriesRows
 * @returns {{granularity: 'day'|'week'|'month', keys: string[], labels: string[],
 *            tooltips: string[], series: number[][]}}
 */
export function bucketTrend(seriesRows = []) {
  const series = seriesRows.map((rows) => rows ?? []);
  const all = series.flat().filter((r) => r && r.date);

  if (!all.length) {
    return { granularity: 'day', keys: [], labels: [], tooltips: [], series: series.map(() => []) };
  }

  const dates = all.map((r) => parseDay(r.date)).sort((a, b) => a - b);
  const first = dates[0];
  const last = dates[dates.length - 1];
  const spanDays = Math.round((last - first) / DAY_MS);

  const granularity =
    spanDays <= DAILY_MAX_DAYS ? 'day' : spanDays <= WEEKLY_MAX_DAYS ? 'week' : 'month';

  const keys = bucketRange(first, last, granularity);
  const index = Object.fromEntries(keys.map((k, i) => [k, i]));

  return {
    granularity,
    keys,
    labels: keys.map((k) => axisLabel(k, granularity)),
    tooltips: keys.map((k) => tooltipLabel(k, granularity)),
    series: series.map((rows) => {
      const counts = keys.map(() => 0);
      for (const r of rows) {
        const i = index[bucketKey(parseDay(r.date), granularity)];
        if (i !== undefined) counts[i] += Number(r.count) || 0;
      }
      return counts;
    }),
  };
}
