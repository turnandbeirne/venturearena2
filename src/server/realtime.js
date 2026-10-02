// Arena realtime: one socket.io namespace (/arena) on the same server and the
// same WebSocket ingress boardgame.io uses.
//
// The server only ever pushes small "something changed" events plus chat
// lines; browsers refetch what they show. That keeps every authorisation
// decision in the RPC layer instead of duplicating it here.
//
//   rooms:  lobby            everyone
//           u:<userId>       one member (inbox, "your turn")
//           t:<tableId>      people at a table (table, chat, debrief)
import { parseCookies, COOKIE } from './http.js';

export function attachRealtime(io, A) {
  const nsp = io.of('/arena');
  const atTable = new Map(); // tableId -> Map(userId -> socket count)

  nsp.use((socket, next) => {
    const token = parseCookies(socket.handshake.headers.cookie)[COOKIE];
    const user = A.userForToken(token);
    if (!user) return next(new Error('no session'));
    // A plain property, not socket.data: that only exists from socket.io 4.0.
    socket.vaUserId = user.id;
    return next();
  });

  nsp.on('connection', (socket) => {
    const uid = socket.vaUserId;
    socket.join('lobby');
    socket.join(`u:${uid}`);
    const u = A.user(uid);
    if (u) { u.lastSeenAt = A.now(); A.c.users.put(u); }

    socket.on('sub', (tableId, ack) => {
      const t = A.c.tables.get(String(tableId));
      // Table rooms carry chat, so a private table's room is for people at it.
      if (!t || (t.visibility === 'private' && !A.isAtTable(t, uid) && t.hostId !== uid)) { if (typeof ack === 'function') ack(false); return; }
      const room = `t:${t.id}`;
      if (!socket.rooms.has(room)) {
        socket.join(room);
        const m = atTable.get(t.id) || new Map();
        m.set(uid, (m.get(uid) || 0) + 1); atTable.set(t.id, m);
      }
      if (typeof ack === 'function') ack(true);
    });
    const leave = (tableId) => {
      const room = `t:${tableId}`;
      if (!socket.rooms.has(room)) return;
      socket.leave(room);
      const m = atTable.get(String(tableId));
      if (m) { const n = (m.get(uid) || 1) - 1; if (n <= 0) m.delete(uid); else m.set(uid, n); if (m.size === 0) atTable.delete(String(tableId)); }
    };
    socket.on('unsub', leave);
    socket.on('disconnecting', () => { for (const room of socket.rooms) if (room.startsWith('t:')) leave(room.slice(2)); });
  });

  A.emit = (room, event, payload) => { nsp.to(room).emit(event, payload); };
  A.watching = (tableId) => { const m = atTable.get(tableId); return m ? [...m.keys()] : []; };
  return nsp;
}
