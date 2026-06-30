// Shared auth state for the app. Wraps the existing Supabase helpers in
// lib/auth.js and keeps the current user in sync across refresh and
// logout-in-another-tab via onAuthChange().
import { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { signIn, signOut, onAuthChange } from '../lib/auth';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
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

  // Return the signIn result so callers can read its { error }.
  const login = (email, password) => signIn(email, password);
  const logout = () => signOut();

  const value = { user, loading, login, logout };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
