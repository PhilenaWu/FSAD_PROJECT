// Testing page: sign in / sign up with Supabase Auth and show the user details.
// Not part of the real UI — a scratch page to verify the auth wiring end to end.
import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { signIn, signUp, signOut, onAuthChange } from '../lib/auth';

export default function SignInTest() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [session, setSession] = useState(null);
  const [claims, setClaims] = useState(null);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);

  // Load the current session on mount and keep it in sync with login/logout.
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    return onAuthChange((s) => setSession(s));
  }, []);

  // Whenever the session changes, fetch the *verified* claims — this is the
  // same check the backend does with getClaims(token).
  useEffect(() => {
    if (!session) {
      setClaims(null);
      return;
    }
    supabase.auth.getClaims().then(({ data }) => setClaims(data?.claims ?? null));
  }, [session]);

  async function handleSignIn(e) {
    e.preventDefault();
    setBusy(true);
    setStatus('');
    const { error } = await signIn(email, password);
    setStatus(error ? `Sign in failed: ${error.message}` : 'Signed in.');
    setBusy(false);
  }

  async function handleSignUp() {
    setBusy(true);
    setStatus('');
    const { data, error } = await signUp(email, password);
    if (error) setStatus(`Sign up failed: ${error.message}`);
    else if (!data.session) setStatus('Sign up OK — confirm via email, then sign in.');
    else setStatus('Signed up and signed in.');
    setBusy(false);
  }

  async function handleSignOut() {
    setBusy(true);
    await signOut();
    setStatus('Signed out.');
    setBusy(false);
  }

  const user = session?.user;

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <h1 style={styles.h1}>Supabase Auth — test page</h1>

        {!user ? (
          <form onSubmit={handleSignIn} style={styles.form}>
            <label style={styles.label}>
              Email
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
                style={styles.input}
              />
            </label>
            <label style={styles.label}>
              Password
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
                style={styles.input}
              />
            </label>
            <div style={styles.row}>
              <button type="submit" disabled={busy} style={styles.primary}>
                Sign in
              </button>
              <button type="button" onClick={handleSignUp} disabled={busy} style={styles.secondary}>
                Sign up
              </button>
            </div>
          </form>
        ) : (
          <div style={styles.form}>
            <p style={styles.signedIn}>
              Signed in as <strong>{user.email}</strong>
            </p>
            <button type="button" onClick={handleSignOut} disabled={busy} style={styles.secondary}>
              Sign out
            </button>

            <h2 style={styles.h2}>User details</h2>
            <dl style={styles.dl}>
              <Detail label="User ID" value={user.id} />
              <Detail label="Email" value={user.email} />
              <Detail label="Created" value={user.created_at} />
              <Detail label="Last sign in" value={user.last_sign_in_at} />
            </dl>

            <h2 style={styles.h2}>Verified claims (what the backend trusts)</h2>
            <pre style={styles.pre}>{JSON.stringify(claims, null, 2)}</pre>

            <h2 style={styles.h2}>Access token (Bearer)</h2>
            <p style={styles.hint}>
              Paste into a request to the backend: <code>Authorization: Bearer &lt;token&gt;</code>
            </p>
            <textarea readOnly value={session.access_token} style={styles.token} rows={4} />
            <button
              type="button"
              onClick={() => navigator.clipboard?.writeText(session.access_token)}
              style={styles.secondary}
            >
              Copy token
            </button>
          </div>
        )}

        {status && <p style={styles.status}>{status}</p>}
      </div>
    </div>
  );
}

function Detail({ label, value }) {
  return (
    <>
      <dt style={styles.dt}>{label}</dt>
      <dd style={styles.dd}>{value ?? '—'}</dd>
    </>
  );
}

const styles = {
  page: {
    minHeight: '100vh',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'flex-start',
    padding: '40px 16px',
    fontFamily: 'system-ui, sans-serif',
  },
  card: {
    width: '100%',
    maxWidth: 560,
    border: '1px solid #ccc',
    borderRadius: 10,
    padding: 24,
  },
  h1: { fontSize: 22, marginTop: 0 },
  h2: { fontSize: 16, marginBottom: 6 },
  form: { display: 'flex', flexDirection: 'column', gap: 12 },
  label: { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 14 },
  input: { padding: '8px 10px', fontSize: 14, borderRadius: 6, border: '1px solid #999' },
  row: { display: 'flex', gap: 8 },
  primary: { padding: '8px 14px', borderRadius: 6, cursor: 'pointer', fontWeight: 600 },
  secondary: { padding: '8px 14px', borderRadius: 6, cursor: 'pointer', alignSelf: 'flex-start' },
  signedIn: { margin: 0 },
  dl: { display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px 12px', fontSize: 14 },
  dt: { fontWeight: 600 },
  dd: { margin: 0, wordBreak: 'break-all' },
  pre: {
    background: 'rgba(127,127,127,0.12)',
    padding: 12,
    borderRadius: 6,
    fontSize: 12,
    overflowX: 'auto',
  },
  token: { width: '100%', fontFamily: 'monospace', fontSize: 12, wordBreak: 'break-all' },
  hint: { fontSize: 13, margin: '0 0 6px' },
  status: { marginTop: 16, fontSize: 14 },
};
