// Socket.IO server init + CORS config. UC-008 (and later UC-003/UC-010) push
// real-time events to room-scoped clients. Each connecting socket authenticates
// with the same Supabase access token used for REST, then auto-joins the rooms
// that match its role so the notification controller can target them by name.
'use strict';

const { Server } = require('socket.io');
const config = require('./env');
const supabase = require('./supabase');
const db = require('./db');

// Single io instance for the process, set by initSocket() and read by getIO().
let io = null;

// Attach a Socket.IO server to the given HTTP server. CORS is locked to the one
// allowed frontend origin, mirroring the Express CORS config in app.js.
function initSocket(httpServer) {
  io = new Server(httpServer, {
    cors: { origin: config.FRONTEND_URL, credentials: true },
  });

  // Handshake auth: the client sends its Supabase token in auth.token. Validate
  // it the same way middleware/auth.js validates the REST bearer token, then
  // stash the user id/role on the socket for the room-join step below.
  io.use(async (socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) {
      return next(new Error('Missing auth token'));
    }

    const { data, error } = await supabase.auth.getClaims(token);
    if (error || !data?.claims) {
      return next(new Error('Invalid or expired token'));
    }

    const userId = data.claims.sub;
    const { rows } = await db.query(
      'SELECT role, block_number, status FROM users WHERE id = $1',
      [userId]
    );
    const profile = rows[0];
    if (!profile || profile.status !== 'active') {
      return next(new Error('No active profile'));
    }

    socket.user = {
      id: userId,
      role: profile.role,
      block_number: profile.block_number,
    };
    next();
  });

  // On connect, auto-join the rooms that match the user's role. Notification
  // scopes resolve to these same room names in the controller.
  io.on('connection', (socket) => {
    const { id, role, block_number } = socket.user;

    if (role === 'manager') socket.join('manager-room');
    if (role === 'inspector') socket.join('inspector-team');
    if (role === 'contractor') socket.join(`contractor-${id}`);
    if (role === 'resident' && block_number) socket.join(`block-${block_number}`);
  });

  return io;
}

// Accessor for the initialised io instance. Throws if called before initSocket,
// which would be a programming error (server.js wires this up on boot).
function getIO() {
  if (!io) {
    throw new Error('Socket.IO not initialised — call initSocket() first.');
  }
  return io;
}

module.exports = { initSocket, getIO };
