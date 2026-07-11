// CSV import for the dashboard's what-if preview. Parses a CSV of inspection
// rows and merges them into the fetched analytics datasets CLIENT-SIDE ONLY —
// nothing is written to the database; "Clear" simply drops the parsed rows.
//
// Expected header: block,category[,date][,resolution_time_hours]
//   block / category — used by the heatmap
//   date (YYYY-MM-DD) — used by the trend line
//   resolution_time_hours — used by the SLA gauge (≤ threshold = compliant)

// Parse CSV text → array of { block, category, date, resolution_time_hours }.
// Throws with a readable message when the file doesn't fit the format.
export function parseInspectionsCsv(text) {
  const lines = text.trim().split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) {
    throw new Error('CSV needs a header row and at least one data row.');
  }

  const headers = lines[0].split(',').map((h) => h.trim().toLowerCase());
  const iBlock = headers.indexOf('block');
  const iCategory = headers.indexOf('category');
  const iDate = headers.indexOf('date');
  const iHours = headers.indexOf('resolution_time_hours');

  if (iBlock === -1 || iCategory === -1) {
    throw new Error('CSV must have "block" and "category" columns (optional: date, resolution_time_hours).');
  }

  return lines.slice(1).map((line, n) => {
    const cells = line.split(',').map((c) => c.trim());
    const row = {
      block: cells[iBlock],
      category: cells[iCategory],
      date: iDate !== -1 ? cells[iDate] || null : null,
      resolution_time_hours:
        iHours !== -1 && cells[iHours] !== '' && cells[iHours] != null
          ? Number(cells[iHours])
          : null,
    };
    if (!row.block || !row.category) {
      throw new Error(`Row ${n + 2}: block and category are required.`);
    }
    if (row.resolution_time_hours != null && Number.isNaN(row.resolution_time_hours)) {
      throw new Error(`Row ${n + 2}: resolution_time_hours must be a number.`);
    }
    return row;
  });
}

// heatmap [{block, category, count}] + imported rows → merged copy.
export function mergeHeatmap(heatmap, imported) {
  const merged = heatmap.map((r) => ({ ...r }));
  for (const row of imported) {
    const hit = merged.find((r) => r.block === row.block && r.category === row.category);
    if (hit) {
      hit.count += 1;
    } else {
      merged.push({ block: row.block, category: row.category, count: 1 });
    }
  }
  return merged.sort((a, b) => a.block.localeCompare(b.block) || a.category.localeCompare(b.category));
}

// trends [{date, count}] + imported rows (with a date) → merged, sorted by date.
export function mergeTrends(trends, imported) {
  const merged = trends.map((r) => ({ ...r }));
  for (const row of imported) {
    if (!row.date) continue;
    const hit = merged.find((r) => r.date === row.date);
    if (hit) {
      hit.count += 1;
    } else {
      merged.push({ date: row.date, count: 1 });
    }
  }
  return merged.sort((a, b) => a.date.localeCompare(b.date));
}

// sla summary + imported rows (with resolution hours) → recomputed summary.
export function mergeSla(sla, imported) {
  const resolved = imported.filter((r) => r.resolution_time_hours != null);
  if (!resolved.length) return sla;

  const compliant_count =
    sla.compliant_count +
    resolved.filter((r) => r.resolution_time_hours <= sla.sla_threshold_hrs).length;
  const total_resolved = sla.total_resolved + resolved.length;

  return {
    ...sla,
    compliant_count,
    total_resolved,
    sla_percentage: Number(((compliant_count / total_resolved) * 100).toFixed(2)),
  };
}
