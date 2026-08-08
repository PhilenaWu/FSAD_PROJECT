// Shared auth state for the app. Wraps the existing Supabase helpers in
// lib/auth.js and keeps the current user in sync across refresh and
// logout-in-another-tab via onAuthChange().
import { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { signIn, signOut, onAuthChange } from '../lib/auth';
import api from '../services/api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  // profile = the user's row from the `users` table (name/role/block/unit),
  // fetched separately since the Supabase auth user doesn't carry these.
  const [profile, setProfile] = useState(null);
  // True when /api/users/me actually failed (as opposed to not fetched yet).
  const [profileError, setProfileError] = useState(false);
  // True when that failure was "no reply at all" rather than an HTTP status —
  // in development that is almost always the API server not being started.
  // Worth separating: the generic copy sends people to look at the account,
  // which is the wrong place when the server is simply down.
  const [profileUnreachable, setProfileUnreachable] = useState(false);
  // Distinguished from a generic failure: a suspended account authenticates
  // with Supabase fine but is refused by /api/users/me (403 ACCOUNT_SUSPENDED).
  // Without this the app fell through to resident chrome, so a suspended user
  // saw a silently wrong workspace instead of being told why.
  const [suspended, setSuspended] = useState(false);
  // Same idea for self-registered residents: 'pending' until a manager
  // approves them, 'rejected' if refused. Both hold a valid Supabase session
  // but are refused by /api/users/me, so without this they would fall through
  // to resident chrome exactly as suspended accounts used to.
  const [accountBlocked, setAccountBlocked] = useState(null); // 'pending' | 'rejected'
  const [loading, setLoading] = useState(true);
  // Bumped by reloadProfile() to re-run the fetch below — the manual retry
  // offered when the profile could not be loaded.
  const [reloadKey, setReloadKey] = useState(0);

  // Derived, not state: true from the instant a user exists until the profile
  // resolves or errors. Deriving it closes the one-render gap right after
  // login where a state flag would still be false — that gap made role-based
  // redirects fire before the role was known (managers landed on the
  // resident side).
  const profileLoading = Boolean(user) && profile === null && !profileError;

  useEffect(() => {
    // Seed from the current session, then subscribe to future changes.
    // The catch matters: ProtectedRoute renders nothing while `loading` is
    // true, so a rejected getSession() (unreachable auth host, corrupt stored
    // session) left `loading` stuck on and painted the whole app blank white
    // with no error and no way out. Failing to read a session is the same
    // answer as having none — fall through to /login.
    supabase.auth
      .getSession()
      .then(({ data }) => {
        setUser(data.session?.user ?? null);
      })
      .catch(() => {
        setUser(null);
      })
      .finally(() => {
        setLoading(false);
      });

    const unsubscribe = onAuthChange((session) => {
      setUser(session?.user ?? null);
    });
    return unsubscribe;
  }, []);

  // Load the profile row whenever the signed-in user changes; clear it on
  // logout. Header fields degrade gracefully until this resolves.
  useEffect(() => {
    if (!user) {
      setProfile(null);
      setProfileError(false);
      setSuspended(false);
      setAccountBlocked(null);
      return;
    }
    let active = true;
    setProfile(null);
    setProfileError(false);
    setProfileUnreachable(false);
    setSuspended(false);
    setAccountBlocked(null);

    // Transient failures get retried before we give up: the backend sleeps on
    // Render's free tier, and a cold start is a timeout, not an answer about
    // who this user is. A 4xx IS an answer — suspended, unapproved, no profile
    // row — so those stop immediately. profileLoading stays true throughout,
    // so a cold start shows the spinner and usually resolves unseen.
    async function loadProfile() {
      for (let attempt = 0; ; attempt += 1) {
        try {
          const res = await api.get('/api/users/me');
          if (active) setProfile(res.data);
          return;
        } catch (err) {
          const transient = !err.response || err.response.status >= 500;
          if (transient && attempt < 2) {
            await new Promise((r) => setTimeout(r, 600 * 2 ** attempt));
            if (!active) return;
            continue;
          }
          if (!active) return;
          setProfileError(true);
          // No `response` means the request never got an answer — the server is
          // down, the wrong port, or CORS refused it outright.
          setProfileUnreachable(!err.response);
          const code = err.response?.data?.code;
          setSuspended(code === 'ACCOUNT_SUSPENDED');
          if (code === 'ACCOUNT_PENDING') setAccountBlocked('pending');
          if (code === 'ACCOUNT_REJECTED') setAccountBlocked('rejected');
          return;
        }
      }
    }
    loadProfile();

    return () => {
      active = false;
    };
  }, [user?.id, reloadKey]);

  // Return the signIn result so callers can read its { error }.
  const login = (email, password) => signIn(email, password);
  const logout = () => signOut();

  const value = {
    user,
    profile,
    profileLoading,
    // Exposed so the route gate can tell "refused" (suspended/unapproved, which
    // have their own screens) from "we could not find out" — which must not be
    // guessed at, since guessing meant resident chrome for everyone.
    profileError,
    // Narrows that further: the request got no reply at all, so the screen can
    // point at the API server instead of the account.
    profileUnreachable,
    reloadProfile: () => setReloadKey((k) => k + 1),
    suspended,
    accountBlocked,
    loading,
    login,
    logout,
  };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
