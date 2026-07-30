// Client-side CSV export (phase task 5.10) — converts an array of flat
// objects to CSV and triggers a browser download. First row = column headers.

// UTF-8 byte-order mark. Written as an escape rather than the literal
// character so it stays visible in review and no editor can silently strip it.
export const BOM = '\uFEFF';

export function downloadCsv(rows, filename = 'export.csv') {
  if (!rows.length) return;

  const headers = Object.keys(rows[0]);
  const escape = (val) => {
    const s = String(val ?? '');
    return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
  };
  const csv = [
    headers.join(','),
    ...rows.map((row) => headers.map((h) => escape(row[h])).join(',')),
  ].join('\n');

  // Excel reads a CSV as the system codepage unless the file opens with a
  // UTF-8 byte-order mark, which turns every em dash and accented name in the
  // export into mojibake. The BOM costs three bytes and is ignored elsewhere.
  const blob = new Blob([BOM, csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
