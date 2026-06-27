// Route guard: only render nested routes when there's an auth token, otherwise
// redirect to /login. Reuses getAccessToken() — no auth logic of its own.
import { useState, useEffect } from 'react';
import { Navigate, Outlet } from 'react-router';
import { getAccessToken } from '../lib/auth';

export default function ProtectedRoute() {
  // null = still checking, true/false = token present or not.
  const [authed, setAuthed] = useState(null);

  useEffect(() => {
    getAccessToken().then((token) => setAuthed(!!token));
  }, []);

  if (authed === null) return null; // brief check; render nothing meanwhile
  return authed ? <Outlet /> : <Navigate to="/login" replace />;
}
