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
  // True while /api/users/me is in flight, so consumers (e.g. the login
  // redirect) can tell "role not loaded yet" apart from "fetch failed".
  const [profileLoading, setProfileLoading] = useState(false);
  const [loading, setLoading] = useState(true);

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
      setProfileLoading(false);
      return;
    }
    let active = true;
    setProfileLoading(true);
    api
      .get('/api/users/me')
      .then((res) => {
        if (active) setProfile(res.data);
      })
      .catch(() => {
        if (active) setProfile(null);
      })
      .finally(() => {
        if (active) setProfileLoading(false);
      });
    return () => {
      active = false;
    };
  }, [user?.id]);

  // Return the signIn result so callers can read its { error }.
  const login = (email, password) => signIn(email, password);
  const logout = () => signOut();

  const value = { user, profile, profileLoading, loading, login, logout };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
