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
  // Distinguished from a generic failure: a suspended account authenticates
  // with Supabase fine but is refused by /api/users/me (403 ACCOUNT_SUSPENDED).
  // Without this the app fell through to resident chrome, so a suspended user
  // saw a silently wrong workspace instead of being told why.
  const [suspended, setSuspended] = useState(false);
  const [loading, setLoading] = useState(true);

  // Derived, not state: true from the instant a user exists until the profile
  // resolves or errors. Deriving it closes the one-render gap right after
  // login where a state flag would still be false — that gap made role-based
  // redirects fire before the role was known (managers landed on the
  // resident side).
  const profileLoading = Boolean(user) && profile === null && !profileError;

  useEffect(() => {
    // Seed from the current session, then subscribe to future changes.
    supabase.auth.getSession().then(({ data }) => {
      setUser(data.session?.user ?? null);
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
      return;
    }
    let active = true;
    setProfile(null);
    setProfileError(false);
    setSuspended(false);
    api
      .get('/api/users/me')
      .then((res) => {
        if (active) setProfile(res.data);
      })
      .catch((err) => {
        if (!active) return;
        setProfileError(true);
        setSuspended(err.response?.data?.code === 'ACCOUNT_SUSPENDED');
      });
    return () => {
      active = false;
    };
  }, [user?.id]);

  // Return the signIn result so callers can read its { error }.
  const login = (email, password) => signIn(email, password);
  const logout = () => signOut();

  const value = { user, profile, profileLoading, suspended, loading, login, logout };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
