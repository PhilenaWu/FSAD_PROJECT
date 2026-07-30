// Shared Socket.IO connection for the app (UC-008 real-time notifications;
// reused later by UC-003/UC-010). Connects once the user is signed in, passing
// the Supabase access token in the handshake so the backend can authenticate
// and auto-join the user's role rooms. Exposes the live socket and a `connected`
// flag for "reconnecting…" UI.
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { useAuth } from './AuthContext';
import { getAccessToken } from '../lib/auth';

const SocketContext = createContext(null);

export function SocketProvider({ children }) {
  const { user } = useAuth();
  const [socket, setSocket] = useState(null);
  const [connected, setConnected] = useState(false);
  const socketRef = useRef(null);

  useEffect(() => {
    // No user → no connection. Tear down any existing socket on logout.
    if (!user) {
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
        setSocket(null);
        setConnected(false);
      }
      return;
    }

    let active = true;
    let created = null;

    // getAccessToken is async; guard against the effect being torn down (logout
    // or user switch) before it resolves.
    getAccessToken().then((token) => {
      if (!active || !token) return;
      created = io(import.meta.env.VITE_API_URL, {
        auth: { token },
        // UC-003 E1: retry a dropped connection every 5 s while the page shows
        // the "live updates paused" banner.
        reconnectionDelay: 5000,
      });
      created.on('connect', () => setConnected(true));
      created.on('disconnect', () => setConnected(false));
      socketRef.current = created;
      setSocket(created);
    });

    return () => {
      active = false;
      if (created) created.disconnect();
      socketRef.current = null;
      setSocket(null);
      setConnected(false);
    };
  }, [user?.id]);

  // Per-record rooms (UC-003 `insp-{id}`), joined when a detail view opens and
  // left when it closes. Role rooms are joined server-side on connect and need
  // nothing here. The server re-checks membership — these are a request, not a
  // grant. Reads socketRef so the identity stays stable across renders.
  const joinRoom = useCallback((room) => {
    socketRef.current?.emit('join', room);
  }, []);

  const leaveRoom = useCallback((room) => {
    socketRef.current?.emit('leave', room);
  }, []);

  return (
    <SocketContext.Provider value={{ socket, connected, joinRoom, leaveRoom }}>
      {children}
    </SocketContext.Provider>
  );
}

export function useSocket() {
  return useContext(SocketContext);
}
