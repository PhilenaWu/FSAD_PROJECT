// UC-012 Vendor Accounts page (admin). Onboard external vendors, list them by
// soonest-expiring contract, and renew or suspend with confirmation dialogs.
import { useEffect, useMemo, useState } from 'react';
import { Link as RouterLink, Navigate } from 'react-router';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Container,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  IconButton,
  InputAdornment,
  Link,
  MenuItem,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DescriptionOutlinedIcon from '@mui/icons-material/DescriptionOutlined';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import HistoryOutlinedIcon from '@mui/icons-material/HistoryOutlined';
import PaidOutlinedIcon from '@mui/icons-material/PaidOutlined';
import PlayArrowOutlinedIcon from '@mui/icons-material/PlayArrowOutlined';
import FileDownloadOutlinedIcon from '@mui/icons-material/FileDownloadOutlined';
import SearchIcon from '@mui/icons-material/Search';
import { downloadCsv } from '../utils/csvDownload';
import useTableSort from '../components/common/useTableSort';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../context/SocketContext';
import {
  listVendors,
  onboardVendor,
  renewVendor,
  suspendVendor,
  updateVendorDetails,
  getVendorHistory,
  runExpiryCheck,
} from '../services/vendorService';

const EMPTY_FORM = {
  name: '',
  contact_email: '',
  brands_serviced: '',
  contract_start: '',
  contract_end: '',
  account_holder_name: '',
  job_title: '',
  access_reason: '',
  login_email: '',
  login_password: '',
};

// Strong random password for a vendor account (admin-managed credential):
// 16 chars from a mixed set, generated with the browser's CSPRNG.
function generatePassword() {
  const charset = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%&*';
  const bytes = new Uint32Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => charset[b % charset.length]).join('');
}

// Default renewal date: one year after the current contract end (or after
// today when there's no contract) — the usual annual servicing cycle.
function defaultRenewDate(currentEnd) {
  const base = currentEnd ? new Date(currentEnd) : new Date();
  base.setFullYear(base.getFullYear() + 1);
  return base.toISOString().slice(0, 10);
}

// Suggest a login email from the holder's name + the company email's domain:
// "Sing En" + service@dymatics.com → sing.en@dymatics.com. Just a convenience
// default — the admin can overwrite it with the person's real address.
function suggestLoginEmail(holderName, companyEmail) {
  const domain = companyEmail.split('@')[1];
  const local = holderName.trim().toLowerCase().replace(/[^a-z0-9]+/g, '.').replace(/^\.|\.$/g, '');
  return domain && local ? `${local}@${domain}` : '';
}

// How many vendors the table shows before "All" is chosen.
const VENDOR_PREVIEW_COUNT = 10;

// Chip colour for the expiry countdown: red = expired, amber = ≤30 days.
function expiryChip(days) {
  if (days === null || days === undefined) {
    return <Chip size="small" label="No contract" />;
  }
  const label = days === 1 ? '1 day' : `${days} days`;
  if (days < 0) return <Chip size="small" color="error" label="Expired" />;
  if (days === 0) return <Chip size="small" color="warning" label="Today" />;
  if (days <= 30) return <Chip size="small" color="warning" label={label} />;
  return <Chip size="small" color="success" label={label} />;
}

export default function AdminVendorPage() {
  const { profile } = useAuth();
  const [vendors, setVendors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Onboard dialog state
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [contractDoc, setContractDoc] = useState(null);
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);

  // Renew / suspend dialog state — the vendor row being acted on, or null.
  const [renewTarget, setRenewTarget] = useState(null);
  const [renewDate, setRenewDate] = useState('');
  const [renewDoc, setRenewDoc] = useState(null);
  const [suspendTarget, setSuspendTarget] = useState(null);

  // Edit-details and history dialogs.
  const [editTarget, setEditTarget] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [historyTarget, setHistoryTarget] = useState(null);
  const [historyRows, setHistoryRows] = useState(null); // null = loading

  async function reload() {
    try {
      const res = await listVendors();
      setVendors(res.data.data);
    } catch {
      setError('Could not load vendors.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    reload();
  }, []);

  // Live update: the expiry job emits vendor_expired to admin-room — refresh
  // the table and surface the alert without a page reload.
  const { socket } = useSocket();
  useEffect(() => {
    if (!socket) return;
    const onExpired = (payload) => {
      setError('');
      setSuccess(payload.message || `Vendor "${payload.name}" contract expired — account suspended.`);
      reload();
    };
    socket.on('vendor_expired', onExpired);
    return () => socket.off('vendor_expired', onExpired);
  }, [socket]);

  async function handleRunExpiryCheck() {
    setBusy(true);
    try {
      const res = await runExpiryCheck();
      const n = res.data.suspended;
      setSuccess(n === 0
        ? 'Expiry check complete — no contracts have lapsed.'
        : `Expiry check complete — ${n} vendor${n === 1 ? '' : 's'} suspended.`);
      reload();
    } catch (err) {
      setError(err.response?.data?.message || 'Expiry check failed.');
    } finally {
      setBusy(false);
    }
  }

  // Table search + status filter (client-side — the list is small).
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [rowLimit, setRowLimit] = useState(Infinity);
  const vendorSort = useTableSort('days_until_expiry', 'asc');

  // One predicate per status chip, so the chip counts and the filter can never
  // disagree about what "expiring" means.
  const matchesStatus = (v, status) => {
    switch (status) {
      case 'active': return v.status === 'active';
      case 'suspended': return v.status === 'suspended';
      case 'expiring': return v.status === 'active'
        && v.days_until_expiry !== null && v.days_until_expiry >= 0 && v.days_until_expiry <= 30;
      case 'expired': return v.days_until_expiry !== null && v.days_until_expiry < 0;
      default: return true;
    }
  };

  const matchesSearch = (v, q) =>
    !q || `${v.name} ${v.account_holder ?? ''} ${v.contact_email ?? ''} ${v.brands_serviced ?? ''}`
      .toLowerCase().includes(q);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    const rows = vendors.filter((v) => matchesSearch(v, q) && matchesStatus(v, statusFilter));
    return vendorSort.sortRows(rows);
  }, [vendors, search, statusFilter, vendorSort]);

  const shownRows = rowLimit === Infinity ? visible : visible.slice(0, rowLimit);

  // Chip counts respect the search box but not each other — each says how many
  // vendors that status would show right now.
  const statusCounts = useMemo(() => {
    const q = search.trim().toLowerCase();
    const searched = vendors.filter((v) => matchesSearch(v, q));
    return {
      active: searched.filter((v) => matchesStatus(v, 'active')).length,
      expiring: searched.filter((v) => matchesStatus(v, 'expiring')).length,
      expired: searched.filter((v) => matchesStatus(v, 'expired')).length,
      suspended: searched.filter((v) => matchesStatus(v, 'suspended')).length,
    };
  }, [vendors, search]);

  // Clicking the active chip clears it, so the filter needs no separate "All".
  const toggleStatus = (status) =>
    setStatusFilter((current) => (current === status ? 'all' : status));

  const VENDOR_ORDERS = [
    { label: 'Soonest expiring', key: 'days_until_expiry', dir: 'asc' },
    { label: 'Latest expiring', key: 'days_until_expiry', dir: 'desc' },
    { label: 'Vendor A–Z', key: 'name', dir: 'asc' },
    { label: 'Vendor Z–A', key: 'name', dir: 'desc' },
  ];
  const activeVendorOrder =
    VENDOR_ORDERS.find((o) => o.key === vendorSort.sort.key && o.dir === vendorSort.sort.dir)?.label ?? '';

  // Export the filtered view as CSV (reuses the UC-005 helper).
  function handleExportCsv() {
    downloadCsv(
      visible.map((v) => ({
        vendor: v.name,
        contact_email: v.contact_email,
        brands: v.brands_serviced ?? '',
        account_holder: v.account_holder ?? '',
        job_title: v.job_title ?? '',
        login_email: v.login_email ?? '',
        contract_start: v.contract_start ?? '',
        contract_end: v.contract_end ?? '',
        days_until_expiry: v.days_until_expiry ?? '',
        account_status: v.status ?? 'no login',
        access_reason: v.access_reason ?? '',
      })),
      'vendor-accounts.csv'
    );
  }

  // Contracts on active accounts ending within 30 days — drives the banner.
  const expiringSoon = vendors.filter(
    (v) => v.status === 'active' && v.days_until_expiry !== null
      && v.days_until_expiry >= 0 && v.days_until_expiry <= 30
  );

  // Inline date sanity checks (VND-T02 mirrored client-side). The server's
  // INVALID_CONTRACT_DATES check remains the enforcement; these save the
  // round-trip and put the error on the field that caused it.
  const contractDatesInvalid = Boolean(
    form.contract_start && form.contract_end && form.contract_end < form.contract_start
  );
  // A renewal must extend the contract — an end date on or before the current
  // one (when there is one) is not a renewal.
  const renewDateInvalid = Boolean(
    renewDate && renewTarget?.contract_end && renewDate <= renewTarget.contract_end.slice(0, 10)
  );

  // Track whether the admin has typed in the login-email field themselves;
  // until then we keep auto-suggesting from name + company domain.
  const [loginEmailTouched, setLoginEmailTouched] = useState(false);

  function setField(field) {
    return (e) => {
      const value = e.target.value;
      setForm((f) => {
        const nextForm = { ...f, [field]: value };
        if (!loginEmailTouched && (field === 'account_holder_name' || field === 'contact_email')) {
          nextForm.login_email = suggestLoginEmail(
            field === 'account_holder_name' ? value : nextForm.account_holder_name,
            field === 'contact_email' ? value : nextForm.contact_email
          );
        }
        return nextForm;
      });
    };
  }

  async function handleOnboard(e) {
    e.preventDefault();
    setFormError('');
    setBusy(true);
    try {
      const data = new FormData();
      Object.entries(form).forEach(([k, v]) => data.append(k, v));
      if (contractDoc) data.append('contract_doc', contractDoc);
      await onboardVendor(data);
      setFormOpen(false);
      setForm(EMPTY_FORM);
      setContractDoc(null);
      setLoginEmailTouched(false);
      setSuccess(`Vendor "${form.name}" onboarded.`);
      reload();
    } catch (err) {
      setFormError(err.response?.data?.message || 'Onboarding failed.');
    } finally {
      setBusy(false);
    }
  }

  async function handleRenew() {
    setBusy(true);
    try {
      await renewVendor(renewTarget.id, renewDate, renewDoc);
      setSuccess(`Contract for "${renewTarget.name}" renewed until ${renewDate}.`);
      setRenewTarget(null);
      setRenewDate('');
      setRenewDoc(null);
      reload();
    } catch (err) {
      setError(err.response?.data?.message || 'Renewal failed.');
      setRenewTarget(null);
    } finally {
      setBusy(false);
    }
  }

  function openEdit(v) {
    setEditForm({
      contact_email: v.contact_email || '',
      brands_serviced: v.brands_serviced || '',
      account_holder_name: v.account_holder || '',
      job_title: v.job_title || '',
      access_reason: v.access_reason || '',
    });
    setEditTarget(v);
  }

  async function handleEditSave() {
    setBusy(true);
    try {
      await updateVendorDetails(editTarget.id, editForm);
      setSuccess(`Details for "${editTarget.name}" updated.`);
      setEditTarget(null);
      reload();
    } catch (err) {
      setError(err.response?.data?.message || 'Update failed.');
      setEditTarget(null);
    } finally {
      setBusy(false);
    }
  }

  async function openHistory(v) {
    setHistoryTarget(v);
    setHistoryRows(null);
    try {
      const res = await getVendorHistory(v.id);
      setHistoryRows(res.data.data);
    } catch {
      setHistoryRows([]);
      setError('Could not load history.');
    }
  }

  async function handleSuspend() {
    setBusy(true);
    try {
      await suspendVendor(suspendTarget.id);
      setSuccess(`Vendor "${suspendTarget.name}" suspended.`);
      setSuspendTarget(null);
      reload();
    } catch (err) {
      setError(err.response?.data?.message || 'Suspension failed.');
      setSuspendTarget(null);
    } finally {
      setBusy(false);
    }
  }

  // UI-level convenience guard — the backend enforces the admin role anyway.
  if (profile && profile.role !== 'admin') {
    return <Navigate to="/dashboard" replace />;
  }

  return (
    <Box sx={{ py: { xs: 4, sm: 6 }, px: 2 }}>
      <Container maxWidth="lg">
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          justifyContent="space-between"
          alignItems={{ xs: 'flex-start', sm: 'center' }}
          spacing={{ xs: 2, sm: 0 }}
          sx={{ mb: 3 }}
        >
          <Box>
            <Typography variant="h4" component="h1" fontWeight={700} color="primary.main">
              Vendor accounts
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Contractor logins are tied to their contract period
            </Typography>
          </Box>
          <Stack direction="row" spacing={1}>
            <Tooltip title="Runs the same check the nightly job performs: suspends any vendor whose contract has lapsed">
              <Button
                variant="outlined"
                startIcon={<PlayArrowOutlinedIcon />}
                onClick={handleRunExpiryCheck}
                disabled={busy}
              >
                Run expiry check
              </Button>
            </Tooltip>
            <Button variant="contained" startIcon={<AddIcon />} onClick={() => setFormOpen(true)}>
              Onboard vendor
            </Button>
          </Stack>
        </Stack>

        {error && <Alert severity="error" onClose={() => setError('')} sx={{ mb: 2 }}>{error}</Alert>}
        {success && <Alert severity="success" onClose={() => setSuccess('')} sx={{ mb: 2 }}>{success}</Alert>}
        {expiringSoon.length > 0 && (
          <Alert severity="warning" sx={{ mb: 2 }}>
            {expiringSoon.length === 1
              ? `1 contract expires within 30 days: ${expiringSoon[0].name} (${expiringSoon[0].days_until_expiry === 0 ? 'today' : `${expiringSoon[0].days_until_expiry} day${expiringSoon[0].days_until_expiry === 1 ? '' : 's'}`}).`
              : `${expiringSoon.length} contracts expire within 30 days: ${expiringSoon.map((v) => v.name).join(', ')}.`}
            {' '}Renew them to keep vendor access active.
          </Alert>
        )}

        {!loading && vendors.length > 0 && (
          <Stack
            direction="row"
            spacing={2}
            sx={{ mb: 2, flexWrap: 'wrap', rowGap: 1.5 }}
            alignItems="center"
          >
            <TextField
              size="small"
              placeholder="Search vendor, holder, email, brand…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              sx={{ flexGrow: 1, maxWidth: 380 }}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment>
                ),
              }}
            />
            {/* Status as chips with live counts — the same pattern as the cost
                dashboard's outlier filter. A count is the thing an admin wants
                to know before clicking, so it is on the control, not behind it. */}
            {[
              { key: 'expiring', label: 'Expiring ≤30d', color: 'warning' },
              { key: 'expired', label: 'Expired', color: 'error' },
              { key: 'suspended', label: 'Suspended', color: 'default' },
              { key: 'active', label: 'Active', color: 'success' },
            ].map((s) => (
              <Chip
                key={s.key}
                size="small"
                label={`${s.label} (${statusCounts[s.key]})`}
                color={statusFilter === s.key ? s.color : 'default'}
                variant={statusFilter === s.key ? 'filled' : 'outlined'}
                disabled={statusCounts[s.key] === 0 && statusFilter !== s.key}
                onClick={() => toggleStatus(s.key)}
              />
            ))}
            <TextField
              size="small"
              select
              label="Order"
              value={activeVendorOrder}
              onChange={(e) => {
                const o = VENDOR_ORDERS.find((x) => x.label === e.target.value);
                if (o) vendorSort.setSort({ key: o.key, dir: o.dir });
              }}
              sx={{ minWidth: 180 }}
              helperText={activeVendorOrder ? '' : 'sorted by a column'}
            >
              {VENDOR_ORDERS.map((o) => (
                <MenuItem key={o.label} value={o.label}>{o.label}</MenuItem>
              ))}
            </TextField>
            <ToggleButtonGroup
              value={rowLimit}
              exclusive
              size="small"
              onChange={(_e, v) => v && setRowLimit(v)}
            >
              <ToggleButton value={VENDOR_PREVIEW_COUNT} sx={{ px: 2, textTransform: 'none' }}>
                First {VENDOR_PREVIEW_COUNT}
              </ToggleButton>
              <ToggleButton value={Infinity} sx={{ px: 2, textTransform: 'none' }}>
                All ({visible.length})
              </ToggleButton>
            </ToggleButtonGroup>
            {statusFilter !== 'all' && (
              <Chip
                label="Clear filter"
                size="small"
                variant="outlined"
                color="warning"
                onDelete={() => setStatusFilter('all')}
                onClick={() => setStatusFilter('all')}
              />
            )}
            <Box sx={{ flexGrow: 1 }} />
            <Tooltip title={visible.length === 0 ? 'Nothing to export' : 'Export the current view as CSV'}>
              <span>
                <Button
                  size="small"
                  startIcon={<FileDownloadOutlinedIcon />}
                  disabled={visible.length === 0}
                  onClick={handleExportCsv}
                >
                  Export CSV
                </Button>
              </span>
            </Tooltip>
          </Stack>
        )}

        {loading ? (
          <Stack alignItems="center" sx={{ py: 6 }}>
            <CircularProgress />
          </Stack>
        ) : (
          <TableContainer component={Paper} variant="outlined">
            {/* min-width keeps columns readable; TableContainer scrolls
                horizontally on narrow screens instead of crushing cells. */}
            <Table size="small" sx={{ minWidth: 900 }}>
              <TableHead>
                <TableRow>
                  <TableCell>{vendorSort.sortLabel('name', 'Vendor')}</TableCell>
                  <TableCell>{vendorSort.sortLabel('account_holder', 'Account holder')}</TableCell>
                  <TableCell>Brands</TableCell>
                  <TableCell>{vendorSort.sortLabel('contract_end', 'Contract')}</TableCell>
                  <TableCell>{vendorSort.sortLabel('days_until_expiry', 'Expires in')}</TableCell>
                  <TableCell>{vendorSort.sortLabel('status', 'Account')}</TableCell>
                  <TableCell align="right">Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {shownRows.map((v) => (
                  <TableRow key={v.id} hover>
                    <TableCell>
                      <Typography variant="body2" fontWeight={600}>{v.name}</Typography>
                      <Typography variant="caption" color="text.secondary">{v.contact_email}</Typography>
                    </TableCell>
                    <TableCell>
                      {v.account_holder ? (
                        <Tooltip
                          title={v.access_reason ? `Access reason: ${v.access_reason}` : ''}
                          placement="top-start"
                        >
                          <Box>
                            <Typography variant="body2">{v.account_holder}</Typography>
                            <Typography variant="caption" color="text.secondary">
                              {v.job_title || '—'}
                            </Typography>
                          </Box>
                        </Tooltip>
                      ) : (
                        '—'
                      )}
                    </TableCell>
                    <TableCell>{v.brands_serviced || '—'}</TableCell>
                    <TableCell>
                      {v.contract_start && v.contract_end ? (
                        <Stack direction="row" spacing={0.5} alignItems="center">
                          <span>{`${v.contract_start.slice(0, 10)} → ${v.contract_end.slice(0, 10)}`}</span>
                          {v.contract_doc_url && (
                            <Tooltip title="View contract document">
                              <Link href={v.contract_doc_url} target="_blank" rel="noopener" sx={{ display: 'inline-flex' }}>
                                <DescriptionOutlinedIcon fontSize="small" />
                              </Link>
                            </Tooltip>
                          )}
                        </Stack>
                      ) : (
                        '—'
                      )}
                    </TableCell>
                    <TableCell>{expiryChip(v.days_until_expiry)}</TableCell>
                    <TableCell>
                      {v.status ? (
                        <Chip
                          size="small"
                          color={v.status === 'active' ? 'success' : 'default'}
                          variant="outlined"
                          label={v.status}
                        />
                      ) : (
                        <Chip size="small" variant="outlined" label="no login" />
                      )}
                    </TableCell>
                    <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                      <Tooltip title="Edit details">
                        <IconButton size="small" onClick={() => openEdit(v)}>
                          <EditOutlinedIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title="History">
                        <IconButton size="small" onClick={() => openHistory(v)}>
                          <HistoryOutlinedIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      {/* UC-012 → UC-011: the cost dashboard filtered to this
                          vendor is the evidence for the renewal decision. */}
                      <Tooltip title="View this vendor's costs on the cost dashboard">
                        <IconButton
                          size="small"
                          component={RouterLink}
                          to={`/admin/costs?contractorId=${v.id}`}
                        >
                          <PaidOutlinedIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      <Button
                        size="small"
                        onClick={() => { setRenewDate(defaultRenewDate(v.contract_end)); setRenewDoc(null); setRenewTarget(v); }}
                      >
                        Renew
                      </Button>
                      <Button
                        size="small"
                        color="error"
                        disabled={!v.status || v.status === 'suspended'}
                        onClick={() => setSuspendTarget(v)}
                      >
                        Suspend
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                {visible.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} align="center" sx={{ py: 4, color: 'text.secondary' }}>
                      {vendors.length === 0
                        ? 'No vendors yet — onboard the first one.'
                        : 'No vendors match the current search/filter.'}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </TableContainer>
        )}

        {/* Onboard dialog */}
        <Dialog open={formOpen} onClose={() => !busy && setFormOpen(false)} fullWidth maxWidth="sm">
          <form onSubmit={handleOnboard}>
            <DialogTitle>Onboard vendor</DialogTitle>
            <DialogContent>
              <Stack spacing={2} sx={{ mt: 1 }}>
                {formError && <Alert severity="error">{formError}</Alert>}

                <Typography variant="subtitle2" color="text.secondary">Company</Typography>
                <TextField label="Company name" required value={form.name} onChange={setField('name')} />
                <TextField label="Company contact email" type="email" required
                  helperText="General service address, e.g. service@dymatics.com"
                  value={form.contact_email} onChange={setField('contact_email')} />
                <TextField label="Brands serviced (comma-separated)" value={form.brands_serviced} onChange={setField('brands_serviced')} />
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                  <TextField label="Contract start" type="date" required fullWidth
                    InputLabelProps={{ shrink: true }}
                    value={form.contract_start} onChange={setField('contract_start')} />
                  <TextField label="Contract end" type="date" required fullWidth
                    InputLabelProps={{ shrink: true }}
                    error={contractDatesInvalid}
                    helperText={contractDatesInvalid ? 'Contract end must be on or after the start' : ''}
                    value={form.contract_end} onChange={setField('contract_end')} />
                </Stack>

                <Typography variant="subtitle2" color="text.secondary" sx={{ pt: 1 }}>
                  Account holder — the person these credentials belong to
                </Typography>
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                  <TextField label="Full name" required fullWidth
                    value={form.account_holder_name} onChange={setField('account_holder_name')} />
                  <TextField label="Position / job title" required fullWidth
                    placeholder="e.g. VP Operations"
                    value={form.job_title} onChange={setField('job_title')} />
                </Stack>
                <TextField label="Login email (their work email)" type="email" required
                  helperText="Suggested from name + company domain — replace with their real address if different"
                  value={form.login_email}
                  onChange={(e) => {
                    setLoginEmailTouched(true);
                    setForm((f) => ({ ...f, login_email: e.target.value }));
                  }} />
                <Stack direction="row" spacing={1} alignItems="flex-start">
                  <TextField label="Vendor password (admin-set)" required fullWidth
                    helperText="This credential is managed by EM Services — record it and share it with the vendor securely"
                    value={form.login_password} onChange={setField('login_password')} />
                  <Button
                    variant="outlined"
                    sx={{ whiteSpace: 'nowrap', mt: 1 }}
                    onClick={() => setForm((f) => ({ ...f, login_password: generatePassword() }))}
                  >
                    Generate
                  </Button>
                </Stack>
                <TextField label="Reason for access" required multiline minRows={2}
                  placeholder="e.g. Manages lift defect rectification for Blocks 44A–48C under the 2026 contract"
                  value={form.access_reason} onChange={setField('access_reason')} />
                <Button component="label" variant="outlined">
                  {contractDoc ? contractDoc.name : 'Attach contract document (optional)'}
                  <input
                    hidden
                    type="file"
                    accept=".pdf,.doc,.docx"
                    onChange={(e) => setContractDoc(e.target.files[0] ?? null)}
                  />
                </Button>
              </Stack>
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setFormOpen(false)} disabled={busy}>Cancel</Button>
              <Button type="submit" variant="contained" disabled={busy || contractDatesInvalid}>
                {busy ? 'Onboarding…' : 'Onboard'}
              </Button>
            </DialogActions>
          </form>
        </Dialog>

        {/* Renew dialog */}
        <Dialog open={Boolean(renewTarget)} onClose={() => !busy && setRenewTarget(null)}>
          <DialogTitle>Renew contract — {renewTarget?.name}</DialogTitle>
          <DialogContent>
            <DialogContentText sx={{ mb: 2 }}>
              Set the new contract end date. A suspended account is reactivated.
            </DialogContentText>
            <Stack spacing={2}>
              <TextField label="New contract end" type="date" required fullWidth
                InputLabelProps={{ shrink: true }}
                error={renewDateInvalid}
                helperText={renewDateInvalid ? 'Must be after the current contract end' : ''}
                value={renewDate} onChange={(e) => setRenewDate(e.target.value)} />
              <Button component="label" variant="outlined">
                {renewDoc ? renewDoc.name : 'Attach new contract document (optional)'}
                <input
                  hidden
                  type="file"
                  accept=".pdf,.doc,.docx"
                  onChange={(e) => setRenewDoc(e.target.files[0] ?? null)}
                />
              </Button>
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setRenewTarget(null)} disabled={busy}>Cancel</Button>
            <Button variant="contained" onClick={handleRenew} disabled={busy || !renewDate || renewDateInvalid}>
              Renew
            </Button>
          </DialogActions>
        </Dialog>

        {/* Edit details dialog — contract dates stay in Renew; login email is
            the account's identity and stays immutable. */}
        <Dialog open={Boolean(editTarget)} onClose={() => !busy && setEditTarget(null)} fullWidth maxWidth="sm">
          <DialogTitle>Edit details — {editTarget?.name}</DialogTitle>
          <DialogContent>
            <Stack spacing={2} sx={{ mt: 1 }}>
              <TextField label="Company contact email" type="email"
                value={editForm.contact_email || ''}
                onChange={(e) => setEditForm((f) => ({ ...f, contact_email: e.target.value }))} />
              <TextField label="Brands serviced"
                value={editForm.brands_serviced || ''}
                onChange={(e) => setEditForm((f) => ({ ...f, brands_serviced: e.target.value }))} />
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                <TextField label="Account holder name" fullWidth
                  value={editForm.account_holder_name || ''}
                  onChange={(e) => setEditForm((f) => ({ ...f, account_holder_name: e.target.value }))} />
                <TextField label="Position / job title" fullWidth
                  value={editForm.job_title || ''}
                  onChange={(e) => setEditForm((f) => ({ ...f, job_title: e.target.value }))} />
              </Stack>
              <TextField label="Reason for access" multiline minRows={2}
                value={editForm.access_reason || ''}
                onChange={(e) => setEditForm((f) => ({ ...f, access_reason: e.target.value }))} />
              <Typography variant="caption" color="text.secondary">
                Contract dates are changed via Renew. The login email cannot be edited.
              </Typography>
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setEditTarget(null)} disabled={busy}>Cancel</Button>
            <Button variant="contained" onClick={handleEditSave} disabled={busy}>Save</Button>
          </DialogActions>
        </Dialog>

        {/* History dialog — the vendor's audit trail from vendor_history. */}
        <Dialog open={Boolean(historyTarget)} onClose={() => setHistoryTarget(null)} fullWidth maxWidth="sm">
          <DialogTitle>History — {historyTarget?.name}</DialogTitle>
          <DialogContent>
            {historyRows === null ? (
              <Stack alignItems="center" sx={{ py: 3 }}><CircularProgress size={28} /></Stack>
            ) : historyRows.length === 0 ? (
              <DialogContentText>
                No recorded actions yet — history starts from onboarding.
              </DialogContentText>
            ) : (
              <Stack spacing={1.5} sx={{ mt: 1 }}>
                {historyRows.map((h) => (
                  <Box key={h.id} sx={{ borderLeft: 2, borderColor: 'divider', pl: 1.5 }}>
                    <Typography variant="body2" fontWeight={600}>{h.action}</Typography>
                    {h.note && (
                      <Typography variant="body2" color="text.secondary">{h.note}</Typography>
                    )}
                    <Typography variant="caption" color="text.secondary">
                      {h.actor_name} · {new Date(h.created_at).toLocaleString()}
                    </Typography>
                  </Box>
                ))}
              </Stack>
            )}
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setHistoryTarget(null)}>Close</Button>
          </DialogActions>
        </Dialog>

        {/* Suspend confirm dialog */}
        <Dialog open={Boolean(suspendTarget)} onClose={() => !busy && setSuspendTarget(null)}>
          <DialogTitle>Suspend vendor?</DialogTitle>
          <DialogContent>
            <DialogContentText>
              "{suspendTarget?.name}" will lose access immediately. Their open
              defects will need reassignment. You can reactivate them later by
              renewing the contract.
            </DialogContentText>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setSuspendTarget(null)} disabled={busy}>Cancel</Button>
            <Button color="error" variant="contained" onClick={handleSuspend} disabled={busy}>
              Suspend
            </Button>
          </DialogActions>
        </Dialog>
      </Container>
    </Box>
  );
}
