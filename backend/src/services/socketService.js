// Real-time emit helpers — the single seam controllers use to push Socket.IO
// events without touching the io instance directly. Rooms are joined in
// config/socket.js on connect (manager-room, inspector-team, contractor-{id},
// block-{n}); callers just name the room(s).
'use strict';

const { getIO } = require('../config/socket');

// Emit one event to a single room.
function emitToRoom(room, event, data) {
  getIO().to(room).emit(event, data);
}

// Emit one event to several rooms at once (Socket.IO de-dupes sockets that are
// in more than one of them).
function emitToRooms(rooms, event, data) {
  if (rooms.length === 0) return;
  getIO().to(rooms).emit(event, data);
}

module.exports = { emitToRoom, emitToRooms };
