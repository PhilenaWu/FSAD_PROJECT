// Thin wrappers around Supabase Auth for the browser.
// After signing in, use getAccessToken() to attach the token to backend
// requests: `Authorization: Bearer <token>`. The backend validates it.
import { supabase } from './supabaseClient';

export function signUp(email, password) {
  return supabase.auth.signUp({ email, password });
}

export function signIn(email, password) {
  return supabase.auth.signInWithPassword({ email, password });
}

export function signOut() {
  return supabase.auth.signOut();
}

// Change the signed-in user's password (profile page). Supabase Auth owns the
// credential; the session must be live, and no backend endpoint is involved.
export function updatePassword(password) {
  return supabase.auth.updateUser({ password });
}

// Current session's access token (JWT), or null if signed out.
export async function getAccessToken() {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

// Subscribe to login/logout changes. Returns an unsubscribe function.
export function onAuthChange(callback) {
  const { data } = supabase.auth.onAuthStateChange((_event, session) => {
    callback(session);
  });
  return () => data.subscription.unsubscribe();
}
