// UC-005 priority queue table — records ranked by the composite score
// (ai_priority_score × 0.5 + recency × 0.3 + frequency × 0.2, computed
// server-side). Rows link to the record detail page.
import { Link } from 'react-router';
import {
  Chip,
  Link as MuiLink,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
} from '@mui/material';

const PRIORITY_COLOR = {
  Critical: 'error',
  High: 'warning',
  Medium: 'default',
  Low: 'default',
};

export default function PriorityQueue({ rows }) {
  return (
    <TableContainer>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>Record</TableCell>
            <TableCell>Block</TableCell>
            <TableCell>Category</TableCell>
            <TableCell>Priority</TableCell>
            <TableCell>Status</TableCell>
            <TableCell align="right">Score</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.id} hover>
              <TableCell>
                <MuiLink component={Link} to={`/incidents/${r.id}`} underline="hover" color="primary">
                  {r.title}
                </MuiLink>
              </TableCell>
              <TableCell>{r.block}</TableCell>
              <TableCell>{r.category}</TableCell>
              <TableCell>
                <Chip label={r.priority} size="small" color={PRIORITY_COLOR[r.priority]} variant="outlined" />
              </TableCell>
              <TableCell>{r.status}</TableCell>
              <TableCell align="right">{r.composite_score.toFixed(1)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}
