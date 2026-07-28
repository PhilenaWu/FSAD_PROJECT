// UC-005 contractor scorecard table (phase task 5.13a) — avg rectification
// days, repeat-defect rate, overdue count per contractor.
import {
  Chip,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';

export default function ContractorScorecard({ rows }) {
  return (
    <TableContainer>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>Contractor</TableCell>
            <TableCell align="right">Jobs</TableCell>
            <TableCell align="right">Avg rectification (days)</TableCell>
            <TableCell align="right">Repeat-defect rate</TableCell>
            <TableCell align="right">Overdue</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.contractor}>
              <TableCell>
                <Typography variant="body2" fontWeight={600}>
                  {r.contractor}
                </Typography>
              </TableCell>
              <TableCell align="right">{r.jobs}</TableCell>
              {/* Avg is NULL until a job has been acknowledged and rectified. */}
              <TableCell align="right">
                {r.avg_rectification_days == null ? '—' : r.avg_rectification_days.toFixed(1)}
              </TableCell>
              <TableCell align="right">
                {r.repeat_defect_rate == null ? '—' : `${r.repeat_defect_rate.toFixed(1)}%`}
              </TableCell>
              <TableCell align="right">
                <Chip
                  label={r.overdue_count}
                  size="small"
                  color={r.overdue_count > 0 ? 'primary' : 'default'}
                  variant={r.overdue_count > 0 ? 'filled' : 'outlined'}
                />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}
