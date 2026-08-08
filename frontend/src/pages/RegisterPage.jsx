// Resident self-registration (public route). Creates the Supabase auth user in
// the browser, then posts the profile to /api/users/register-profile, which
// writes it as a PENDING resident. Nothing is activated here — the account can
// do nothing until a manager approves it, so we deliberately sign the new
// session out again instead of dropping the user into the app.
import { useState } from 'react';
import { Link as RouterLink, Navigate } from 'react-router';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Container,
  IconButton,
  InputAdornment,
  Link,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { Visibility, VisibilityOff } from '@mui/icons-material';
import ApartmentOutlinedIcon from '@mui/icons-material/ApartmentOutlined';
import PersonOutlineIcon from '@mui/icons-material/PersonOutline';
import HomeOutlinedIcon from '@mui/icons-material/HomeOutlined';
import MyLocationIcon from '@mui/icons-material/MyLocation';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import RadioButtonUncheckedIcon from '@mui/icons-material/RadioButtonUnchecked';
import MarkEmailReadOutlinedIcon from '@mui/icons-material/MarkEmailReadOutlined';
import { useAuth } from '../context/AuthContext';
import { signUp, signOut } from '../lib/auth';
import { registerProfile } from '../services/userService';
import { BLOCKS, nearestBlock } from '../utils/blocks';
import { PASSWORD_RULES, checkPassword, isValidEmail, isValidPassword } from '../utils/validation';

// Live per-rule checklist under the password field.
function PasswordChecklist({ password }) {
  const results = checkPassword(password);
  return (
    <Stack spacing={0.25} sx={{ pl: 0.5 }}>
      {PASSWORD_RULES.map((rule) => {
        const passed = results[rule.key];
        return (
          <Stack key={rule.key} direction="row" spacing={0.75} alignItems="center">
            {passed ? (
              <CheckCircleOutlineIcon sx={{ fontSize: 15, color: 'success.main' }} />
            ) : (
              <RadioButtonUncheckedIcon sx={{ fontSize: 15, color: 'text.disabled' }} />
            )}
            <Typography
              variant="caption"
              sx={{ color: passed ? 'success.main' : 'text.secondary' }}
            >
              {rule.label}
            </Typography>
          </Stack>
        );
      })}
    </Stack>
  );
}

export default function RegisterPage() {
  const { user, loading } = useAuth();

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [block, setBlock] = useState('');
  const [unit, setUnit] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  // Fields the user has left once — errors stay hidden until then so an
  // untouched form isn't red before anything has been typed.
  const [touched, setTouched] = useState({});
  const [error, setError] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);

  // GPS is a hint only: it names the nearest block and never writes to `block`.
  const [locating, setLocating] = useState(false);
  const [blockHint, setBlockHint] = useState('');

  const emailValid = isValidEmail(email);
  const passwordValid = isValidPassword(password);
  const passwordsMatch = password === confirmPassword;
  const formValid =
    fullName.trim() && emailValid && passwordValid && passwordsMatch && block;

  function markTouched(field) {
    setTouched((prev) => ({ ...prev, [field]: true }));
  }

  function suggestBlock() {
    setBlockHint('');
    if (!navigator.geolocation) {
      setBlockHint('Location is not supported by this browser — pick your block above.');
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        const suggestion = nearestBlock({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
        });
        setBlockHint(
          `Nearest block (estimated): ${suggestion}. Select it above if that's right.`
        );
      },
      () => {
        // Denied, timed out, or unavailable — all the same friendly outcome.
        setLocating(false);
        setBlockHint('Could not get your location — pick your block above.');
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 }
    );
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setTouched({ fullName: true, email: true, password: true, confirmPassword: true, block: true });
    if (!formValid) return;

    setBusy(true);
    // 1. Supabase owns the credentials. Its own error text is what the user
    //    sees for an already-registered email — we add nothing to it, so this
    //    reveals no more about who has an account than Supabase already does.
    const { data, error: signUpError } = await signUp(email.trim(), password);
    if (signUpError) {
      setBusy(false);
      setError(signUpError.message);
      return;
    }
    // The profile POST authenticates with the session signUp just returned. No
    // session means the project requires email confirmation first.
    if (!data.session) {
      setBusy(false);
      setError(
        'Please confirm your email address using the link we just sent, then register again.'
      );
      return;
    }

    // 2. Profile row — the server hardcodes role='resident', status='pending'.
    try {
      await registerProfile({
        full_name: fullName.trim(),
        block_number: block,
        unit_number: unit.trim() || null,
      });
    } catch (err) {
      setBusy(false);
      const code = err.response?.data?.code;
      setError(
        code === 'VALIDATION_ERROR' || code === 'RATE_LIMITED'
          ? err.response.data.message
          : 'Something went wrong submitting your request. Please try again.'
      );
      return;
    }

    // 3. Drop the session: a pending account must not be signed in anywhere.
    await signOut();
    setBusy(false);
    setSubmitted(true);
  }

  // Already signed in (an approved user who wandered here): send them onward
  // rather than letting them create a second account.
  if (!loading && user && !submitted && !busy) {
    return <Navigate to="/dashboard" replace />;
  }

  return (
    <Box
      sx={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        bgcolor: 'background.default',
        px: 2,
        py: 4,
      }}
    >
      <Container maxWidth="sm" disableGutters>
        <Paper elevation={3} sx={{ p: 4, borderRadius: 2 }}>
          {submitted ? (
            <Stack spacing={2} alignItems="center" sx={{ textAlign: 'center' }}>
              <MarkEmailReadOutlinedIcon sx={{ fontSize: 48, color: 'primary.main' }} />
              <Typography variant="h5" component="h1" fontWeight={700} sx={{ color: 'primary.main' }}>
                Request submitted
              </Typography>
              <Alert severity="success" sx={{ width: '100%', textAlign: 'left' }}>
                Your request has been submitted. A manager will review your
                details before you can sign in.
              </Alert>
              <Typography variant="body2" color="text.secondary">
                We'll verify the block and unit you gave against the estate
                records. You won't be able to sign in until that's done.
              </Typography>
              <Button component={RouterLink} to="/login" variant="contained" fullWidth>
                Back to sign in
              </Button>
            </Stack>
          ) : (
            <>
              <Stack spacing={1} sx={{ mb: 3 }}>
                <Typography
                  variant="h5"
                  component="h1"
                  fontWeight={700}
                  sx={{ color: 'primary.main', textAlign: 'center' }}
                >
                  Register as a resident
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center' }}>
                  A manager verifies every request before the account is activated
                </Typography>
              </Stack>

              <Box component="form" onSubmit={handleSubmit} noValidate>
                <Stack spacing={2}>
                  {error && <Alert severity="error">{error}</Alert>}

                  <TextField
                    label="Full name"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    onBlur={() => markTouched('fullName')}
                    error={touched.fullName && !fullName.trim()}
                    helperText={
                      touched.fullName && !fullName.trim() ? 'Enter your full name.' : ' '
                    }
                    required
                    autoComplete="name"
                    fullWidth
                    slotProps={{
                      input: {
                        startAdornment: (
                          <InputAdornment position="start">
                            <PersonOutlineIcon fontSize="small" color="action" />
                          </InputAdornment>
                        ),
                      },
                    }}
                  />

                  <TextField
                    label="Email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    onBlur={() => markTouched('email')}
                    error={touched.email && !emailValid}
                    helperText={
                      touched.email && !emailValid ? 'Enter a valid email address.' : ' '
                    }
                    required
                    autoComplete="email"
                    fullWidth
                  />

                  <Box>
                    <TextField
                      label="Password"
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      onBlur={() => markTouched('password')}
                      error={touched.password && !passwordValid}
                      required
                      autoComplete="new-password"
                      fullWidth
                      sx={{ mb: 1 }}
                      slotProps={{
                        input: {
                          endAdornment: (
                            <InputAdornment position="end">
                              <IconButton
                                aria-label={showPassword ? 'Hide password' : 'Show password'}
                                onClick={() => setShowPassword((show) => !show)}
                                edge="end"
                              >
                                {showPassword ? <VisibilityOff /> : <Visibility />}
                              </IconButton>
                            </InputAdornment>
                          ),
                        },
                      }}
                    />
                    <PasswordChecklist password={password} />
                  </Box>

                  <TextField
                    label="Confirm password"
                    type={showPassword ? 'text' : 'password'}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    onBlur={() => markTouched('confirmPassword')}
                    error={touched.confirmPassword && !passwordsMatch}
                    helperText={
                      touched.confirmPassword && !passwordsMatch
                        ? 'Passwords do not match.'
                        : ' '
                    }
                    required
                    autoComplete="new-password"
                    fullWidth
                  />

                  <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                    <TextField
                      select
                      label="Block"
                      value={block}
                      onChange={(e) => setBlock(e.target.value)}
                      onBlur={() => markTouched('block')}
                      error={touched.block && !block}
                      helperText={touched.block && !block ? 'Select your block.' : ' '}
                      required
                      fullWidth
                      slotProps={{
                        input: {
                          startAdornment: (
                            <InputAdornment position="start">
                              <ApartmentOutlinedIcon fontSize="small" color="action" />
                            </InputAdornment>
                          ),
                        },
                      }}
                    >
                      <MenuItem value="" disabled>
                        Select block
                      </MenuItem>
                      {BLOCKS.map((b) => (
                        <MenuItem key={b} value={b}>
                          {b}
                        </MenuItem>
                      ))}
                    </TextField>

                    <TextField
                      label="Unit (optional)"
                      value={unit}
                      onChange={(e) => setUnit(e.target.value)}
                      placeholder="E.g. #12-05"
                      helperText=" "
                      fullWidth
                      slotProps={{
                        input: {
                          startAdornment: (
                            <InputAdornment position="start">
                              <HomeOutlinedIcon fontSize="small" color="action" />
                            </InputAdornment>
                          ),
                        },
                      }}
                    />
                  </Stack>

                  {/* Suggestion only — never writes to the Block select above. */}
                  <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap">
                    <Button
                      variant="outlined"
                      size="small"
                      startIcon={<MyLocationIcon fontSize="small" />}
                      onClick={suggestBlock}
                      disabled={locating}
                    >
                      {locating ? 'Locating…' : 'Use my location'}
                    </Button>
                    {blockHint && (
                      <Typography variant="caption" color="text.secondary">
                        {blockHint}
                      </Typography>
                    )}
                  </Stack>

                  <Button
                    type="submit"
                    variant="contained"
                    color="primary"
                    size="large"
                    fullWidth
                    disabled={busy}
                    startIcon={busy ? <CircularProgress size={18} color="inherit" /> : null}
                  >
                    {busy ? 'Submitting…' : 'Submit request'}
                  </Button>

                  <Typography variant="body2" align="center">
                    <Link component={RouterLink} to="/login" underline="hover">
                      Already have an account? Sign in
                    </Link>
                  </Typography>
                </Stack>
              </Box>
            </>
          )}
        </Paper>
      </Container>
    </Box>
  );
}
