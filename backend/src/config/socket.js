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

// Guards the client-supplied record id in canJoinRecordRoom below.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// May this user listen to this per-record room (UC-003 `insp-{id}`)? Room names
// arrive from the client, so membership is decided here rather than trusted —
// otherwise anyone could name a room and watch a stranger's complaint. Only
// `insp-` rooms can be joined on request; role rooms are assigned on connect.
//
// The uuid shape check is not cosmetic: a malformed id reaches pg as an invalid
// uuid and rejects, and this runs inside an async socket handler that nothing
// awaits — an unhandled rejection there takes the whole process down.
async function canJoinRecordRoom(room, userId) {
  if (typeof room !== 'string' || !room.startsWith('insp-')) return false;
  const id = room.slice(5);
  if (!UUID_RE.test(id)) return false;

  const { rows } = await db.query(
    'SELECT 1 FROM inspections WHERE id = $1 AND (resident_id = $2 OR inspector_id = $2)',
    [id, userId]
  );
  return rows.length > 0;
}

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
    if (role === 'admin') socket.join('admin-room');
    if (role === 'inspector') socket.join('inspector-team');
    if (role === 'contractor') socket.join(`contractor-${id}`);
    if (role === 'resident' && block_number) socket.join(`block-${block_number}`);

    // UC-003: an originator watching one record joins its per-record room so
    // status changes reach them directly (a resident's block room is too broad,
    // and an inspector has no status room at all).
    socket.on('join', async (room) => {
      if (await canJoinRecordRoom(room, id)) socket.join(room);
    });

    socket.on('leave', (room) => socket.leave(room));
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

module.exports = { initSocket, getIO, canJoinRecordRoom };
