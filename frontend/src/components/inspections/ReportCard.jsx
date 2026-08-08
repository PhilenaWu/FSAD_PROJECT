// One report on the UC-003 "My reports" page — the summary line and the
// expandable detail (checklist + audit timeline). Used for both live reports
// and closed ones in the history section; the parent owns all state and
// passes it down.
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Collapse,
  Divider,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import { groupBySection } from '../../utils/myReports';
import { statusDisplay } from '../../utils/statusDisplay';
import { timeAgo } from '../../utils/timeAgo';
import { BLOCKS } from '../../utils/blocks';
import { CATEGORIES } from '../../utils/inspectionOptions';

function formatDate(iso) {
  return new Date(iso).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export default function ReportCard({
  report,
  expanded,
  detail,
  detailLoading,
  detailError,
  onToggle,
  onRetryDetail,
  // Editable for 30 minutes after filing (myReportsController's
  // EDIT_WINDOW_MS) — computed by the parent via utils/myReports.isEditable.
  editable,
  editing,
  editDraft,
  editSaving,
  editError,
  onEditToggle,
  onEditChange,
  onEditSave,
  onEditCancel,
}) {
  const display = statusDisplay(report.status);
  const panelId = `report-detail-${report.id}`;

  return (
    <Paper elevation={2} sx={{ p: { xs: 2.5, sm: 3 }, borderRadius: 3 }}>
      <Stack direction="row" spacing={2}>
        {report.photo_url && (
          <Box
            component="img"
            src={report.photo_url}
            alt=""
            sx={{ width: 72, height: 72, objectFit: 'cover', borderRadius: 2, flexShrink: 0 }}
          />
        )}
        <Box sx={{ flexGrow: 1, minWidth: 0 }}>
          <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={1}>
            <Typography variant="subtitle1" fontWeight={700} sx={{ minWidth: 0 }}>
              {report.title}
            </Typography>
            <Chip size="small" color={display.color} label={display.label} />
          </Stack>
          <Typography variant="body2" color="text.secondary" noWrap>
            {report.category} · Block {report.location_block}
            {report.location_unit ? ` #${report.location_unit}` : ''} ·{' '}
            {formatDate(report.created_at)}
          </Typography>

          <Button
            size="small"
            sx={{ mt: 1, px: 0 }}
            onClick={onToggle}
            aria-expanded={expanded}
            aria-controls={panelId}
          >
            {expanded ? 'Hide details' : 'View details'}
          </Button>
        </Box>
      </Stack>

      <Collapse in={expanded} unmountOnExit>
        <Box id={panelId}>
          <Divider sx={{ my: 2 }} />
          {detailLoading ? (
            <Stack alignItems="center" sx={{ py: 3 }}>
              <CircularProgress size={24} />
            </Stack>
          ) : detailError ? (
            <Alert
              severity="error"
              action={
                <Button size="small" onClick={onRetryDetail}>
                  Retry
                </Button>
              }
            >
              Could not load the details for this report.
            </Alert>
          ) : detail && editing ? (
            <Stack spacing={2}>
              {editError && <Alert severity="error">{editError}</Alert>}
              <TextField
                label="Title"
                size="small"
                fullWidth
                required
                value={editDraft.title}
                onChange={(e) => onEditChange({ ...editDraft, title: e.target.value })}
              />
              <TextField
                label="Description"
                size="small"
                fullWidth
                required
                multiline
                minRows={3}
                value={editDraft.description}
                onChange={(e) => onEditChange({ ...editDraft, description: e.target.value })}
              />
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                <TextField
                  select
                  label="Category"
                  size="small"
                  fullWidth
                  value={editDraft.category}
                  onChange={(e) => onEditChange({ ...editDraft, category: e.target.value })}
                >
                  {CATEGORIES.map((c) => (
                    <MenuItem key={c} value={c}>{c}</MenuItem>
                  ))}
                </TextField>
                <TextField
                  select
                  label="Block"
                  size="small"
                  fullWidth
                  value={editDraft.location_block}
                  onChange={(e) => onEditChange({ ...editDraft, location_block: e.target.value })}
                >
                  {BLOCKS.map((b) => (
                    <MenuItem key={b} value={b}>{b}</MenuItem>
                  ))}
                </TextField>
                <TextField
                  label="Unit (optional)"
                  size="small"
                  fullWidth
                  value={editDraft.location_unit ?? ''}
                  onChange={(e) => onEditChange({ ...editDraft, location_unit: e.target.value })}
                />
              </Stack>
              <Stack direction="row" spacing={1}>
                <Button variant="contained" size="small" disabled={editSaving} onClick={onEditSave}>
                  {editSaving ? 'Saving…' : 'Save changes'}
                </Button>
                <Button size="small" disabled={editSaving} onClick={onEditCancel}>
                  Cancel
                </Button>
              </Stack>
            </Stack>
          ) : detail ? (
            <Stack spacing={2}>
              {editable && (
                <Button
                  size="small"
                  variant="outlined"
                  startIcon={<EditOutlinedIcon fontSize="small" />}
                  onClick={onEditToggle}
                  sx={{ alignSelf: 'flex-start' }}
                >
                  Edit report
                </Button>
              )}
              {detail.description && <Typography variant="body2">{detail.description}</Typography>}

              {detail.closing_remark && (
                <Alert severity="success" icon={false}>
                  <Typography variant="subtitle2" fontWeight={700}>
                    How it was resolved
                  </Typography>
                  <Typography variant="body2">{detail.closing_remark}</Typography>
                </Alert>
              )}

              {detail.checklist_results?.length > 0 && (
                <Box>
                  <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>
                    Checklist
                  </Typography>
                  <Stack spacing={1.5}>
                    {groupBySection(detail.checklist_results).map(([section, items]) => (
                      <Box key={section}>
                        <Typography variant="caption" color="text.secondary">
                          {section}
                        </Typography>
                        {items.map((item) => (
                          <Stack
                            key={item.id}
                            direction="row"
                            spacing={1}
                            alignItems="center"
                            sx={{ mt: 0.5 }}
                          >
                            <Chip
                              size="small"
                              label={item.severity ?? item.result}
                              color={item.result === 'Defect' ? 'warning' : 'success'}
                              variant={item.result === 'Defect' ? 'filled' : 'outlined'}
                            />
                            <Typography variant="body2" sx={{ minWidth: 0 }}>
                              {item.item_text}
                              {item.remark ? ` — ${item.remark}` : ''}
                            </Typography>
                          </Stack>
                        ))}
                      </Box>
                    ))}
                  </Stack>
                </Box>
              )}

              <Box>
                <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>
                  Progress
                </Typography>
                {detail.history.length === 0 ? (
                  <Typography variant="body2" color="text.secondary">
                    No updates yet — your report is waiting to be reviewed.
                  </Typography>
                ) : (
                  <Stack spacing={1}>
                    {detail.history.map((h) => (
                      <Box key={h.id}>
                        <Typography variant="body2" fontWeight={600}>
                          {h.action}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {h.actor_name ? `${h.actor_name} · ` : ''}
                          {timeAgo(h.created_at)}
                        </Typography>
                        {h.note && (
                          <Typography variant="body2" color="text.secondary">
                            {h.note}
                          </Typography>
                        )}
                      </Box>
                    ))}
                  </Stack>
                )}
              </Box>
            </Stack>
          ) : null}
        </Box>
      </Collapse>
    </Paper>
  );
}
