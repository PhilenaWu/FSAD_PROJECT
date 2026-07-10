// Client-side CSV export (phase task 5.10) — converts an array of flat
// objects to CSV and triggers a browser download. First row = column headers.
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

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
