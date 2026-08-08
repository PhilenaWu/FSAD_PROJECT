// Catches a render-time crash anywhere below it and shows what broke.
//
// Without this, React 19 unmounts the whole tree when any component throws, so
// a single bad render painted the entire app plain white — no message, no
// retry, and nothing on screen pointing at the cause. That is indistinguishable
// from "the page is still loading", which is exactly how a crash on the manager
// dashboard read as "the dashboard doesn't work".
//
// Must be a class: `getDerivedStateFromError` / `componentDidCatch` have no
// hook equivalent.
import { Component } from 'react';
import { Alert, AlertTitle, Box, Button, Typography } from '@mui/material';

export default class ErrorBoundary extends Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // The console is where a developer looks first; keep the component stack,
    // which the rendered message deliberately does not show.
    console.error('Render error:', error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <Box sx={{ p: { xs: 2, sm: 4 }, maxWidth: 720, mx: 'auto' }}>
        <Alert
          severity="error"
          action={
            <Button color="inherit" size="small" onClick={() => window.location.reload()}>
              Reload
            </Button>
          }
        >
          <AlertTitle>Something went wrong on this page</AlertTitle>
          <Typography variant="body2" sx={{ mb: 1 }}>
            The page stopped rendering, so it could not be displayed. Reloading
            usually clears it; if it comes back, the message below identifies the
            cause.
          </Typography>
          <Typography variant="caption" component="pre" sx={{ whiteSpace: 'pre-wrap', m: 0 }}>
            {error.message}
          </Typography>
        </Alert>
      </Box>
    );
  }
}
