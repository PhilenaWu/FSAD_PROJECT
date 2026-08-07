// Login page — centered MUI card on the light background. No header/nav.
// Uses the AuthContext login() (which wraps Supabase signIn).
import { useState } from 'react';
import { Link as RouterLink, Navigate } from 'react-router';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  CircularProgress,
  Container,
  FormControlLabel,
  IconButton,
  InputAdornment,
  Link,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { Visibility, VisibilityOff } from '@mui/icons-material';
import { useAuth } from '../context/AuthContext';
import api from '../services/api';

// Where each role lands after login. Contractor/admin workspaces aren't built
// yet — those routes render a "not ready yet" placeholder rather than erroring.
const ROLE_HOME = {
  resident: '/report',
  inspector: '/dashboard',
  manager: '/dashboard',
  contractor: '/contractor-inbox',
  admin: '/admin/costs',
};

export default function LoginPage() {
  const { user, profile, profileLoading, loading, login, logout } = useAuth();

  // Pre-fill the email from a previous "Remember me" (email only, never password).
  const savedEmail = localStorage.getItem('rememberedEmail') ?? '';
  const [email, setEmail] = useState(savedEmail);
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(Boolean(savedEmail));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (!email.trim() || !password) {
      setError('Please enter your email and password.');
      return;
    }
    setBusy(true);
    const { error: signInError } = await login(email, password);
    setBusy(false);
    if (signInError) {
      setError(signInError.message);
      return;
    }
    // UC-012: suspended accounts (expired/terminated vendors) authenticate at
    // Supabase but the backend refuses the profile — sign out and explain.
    try {
      await api.get('/api/users/me');
    } catch (meErr) {
      if (meErr.response?.data?.code === 'ACCOUNT_SUSPENDED') {
        await logout();
        setError('This account is suspended. Contact the administrator.');
        return;
      }
      // Other profile errors: let the normal post-login flow handle them.
    }
    // Remember (or forget) the email for next time — email only.
    if (rememberMe) {
      localStorage.setItem('rememberedEmail', email);
    } else {
      localStorage.removeItem('rememberedEmail');
    }
    // No explicit navigate: once the session lands, the redirect below routes
    // by the profile's role (which needs /api/users/me to resolve first).
  }

  // Already signed in: skip the form. Wait for the session check first so we
  // don't flash the login form before redirecting.
  if (loading) {
    return (
      <Box
        sx={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          bgcolor: 'background.default',
        }}
      >
        <CircularProgress />
      </Box>
    );
  }
  if (user) {
    // Signed in: wait for the profile (role) before choosing a destination, so
    // we don't briefly bounce to the wrong workspace.
    if (profileLoading) {
      return (
        <Box
          sx={{
            minHeight: '100vh',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            bgcolor: 'background.default',
          }}
        >
          <CircularProgress />
        </Box>
      );
    }
    // Profile fetch failed / unknown role: fall back to the dashboard.
    return <Navigate to={ROLE_HOME[profile?.role] ?? '/dashboard'} replace />;
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
      }}
    >
      <Container maxWidth="xs" disableGutters>
        <Paper elevation={3} sx={{ p: 4, borderRadius: 2 }}>
          <Stack spacing={1} sx={{ mb: 3 }}>
            <Typography variant="h5" component="h1" fontWeight={700} sx={{ color: 'primary.main', textAlign: 'center' }}>
              Welcome back
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center' }}>
              Sign in to report and track estate issues
            </Typography>
          </Stack>

          <Box component="form" onSubmit={handleSubmit} noValidate>
            <Stack spacing={2}>
              {error && <Alert severity="error">{error}</Alert>}

              <TextField
                label="Email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
                fullWidth
              />

              <TextField
                label="Password"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
                fullWidth
                InputProps={{
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
                }}
              />

              <FormControlLabel
                control={
                  <Checkbox
                    checked={rememberMe}
                    onChange={(e) => setRememberMe(e.target.checked)}
                  />
                }
                label="Remember me"
              />

              <Button
                type="submit"
                variant="contained"
                color="primary"
                size="large"
                fullWidth
                disabled={busy}
              >
                Sign in
              </Button>

              <Stack
                direction="row"
                justifyContent="space-between"
                sx={{ fontSize: 14 }}
              >
                <Link component={RouterLink} to="/register" underline="hover">
                  New resident? Register
                </Link>
                <Link component={RouterLink} to="/forgot-password" underline="hover">
                  Forgot password
                </Link>
              </Stack>
            </Stack>
          </Box>
        </Paper>
      </Container>
    </Box>
  );
}
