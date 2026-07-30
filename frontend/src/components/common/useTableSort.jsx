// Click-to-sort behaviour shared by the app's data tables (cost per
// contractor, recent costed jobs, vendors). Keeping it in one place means
// every table orders the same way — including how it treats a missing value,
// which is the part that quietly differs when each table rolls its own
// comparator.
import { useCallback, useState } from 'react';
import TableSortLabel from '@mui/material/TableSortLabel';

export default function useTableSort(defaultKey, defaultDir = 'desc') {
  const [sort, setSort] = useState({ key: defaultKey, dir: defaultDir });

  // First click on a new column sorts descending — for money and dates that is
  // the answer people are usually after; clicking the active column flips it.
  const toggleSort = useCallback((key) => {
    setSort((s) => ({ key, dir: s.key === key && s.dir === 'desc' ? 'asc' : 'desc' }));
  }, []);

  const sortLabel = useCallback(
    (key, label) => (
      <TableSortLabel
        active={sort.key === key}
        direction={sort.key === key ? sort.dir : 'desc'}
        onClick={() => toggleSort(key)}
      >
        {label}
      </TableSortLabel>
    ),
    [sort, toggleSort]
  );

  // Returns a new array — never sorts the caller's rows in place, which would
  // mutate state held elsewhere on the page.
  const sortRows = useCallback(
    (rows) => {
      const { key, dir } = sort;
      return [...rows].sort((a, b) => {
        const x = a[key];
        const y = b[key];
        // A blank cell (a job with no lift, say) always sorts last, whichever
        // direction is active — otherwise flipping the column buries the rows
        // that do have a value.
        if (x == null && y == null) return 0;
        if (x == null) return 1;
        if (y == null) return -1;
        const cmp = typeof x === 'string' && typeof y === 'string' ? x.localeCompare(y) : x - y;
        return dir === 'asc' ? cmp : -cmp;
      });
    },
    [sort]
  );

  return { sort, setSort, sortLabel, sortRows };
}
