// One socket to the /arena namespace for the whole app. The server pushes
// "something changed" events; components refetch what they show.
//
// Handlers and table subscriptions are kept HERE, not on the socket, and are
// put back on every new socket. (They used to live on the socket object: after
// signing in from a guest session the socket was replaced, and anything still
// mounted, the "your plan changed" listener for one, was left listening to a
// closed connection until the page was reloaded.)
import { useEffect, useRef } from 'react';
import { io } from 'socket.io-client';

let socket = null;
const tableSubs = new Map(); // tableId -> count
const handlers = new Map();  // event -> Set(fn)

function attach(s, event) {
  if (s.__va && s.__va.has(event)) return;
  (s.__va || (s.__va = new Set())).add(event);
  s.on(event, (payload) => { for (const fn of [...(handlers.get(event) || [])]) fn(payload); });
}

export function connectRealtime() {
  if (socket) return socket;
  socket = io('/arena', { transports: ['websocket', 'polling'], withCredentials: true });
  for (const event of handlers.keys()) attach(socket, event);
  // After a (re)connect the server has forgotten which tables this socket watched.
  socket.on('connect', () => { for (const id of tableSubs.keys()) socket.emit('sub', id); });
  return socket;
}
export function disconnectRealtime() { if (socket) { socket.close(); socket = null; } }

/** Tell this browser's own listeners that something changed (no round trip). */
export function localEvent(event, payload) { for (const fn of [...(handlers.get(event) || [])]) fn(payload); }

/** Run `handler` on a realtime event while the component is mounted. */
export function useEvent(event, handler) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    const fn = (payload) => ref.current(payload);
    if (!handlers.has(event)) handlers.set(event, new Set());
    handlers.get(event).add(fn);
    attach(connectRealtime(), event);
    return () => { handlers.get(event).delete(fn); };
  }, [event]);
}

/** Join a table's room while mounted. */
export function useTableRoom(tableId) {
  useEffect(() => {
    if (!tableId) return undefined;
    const s = connectRealtime();
    tableSubs.set(tableId, (tableSubs.get(tableId) || 0) + 1);
    if (s.connected) s.emit('sub', tableId);
    return () => {
      const n = (tableSubs.get(tableId) || 1) - 1;
      if (n <= 0) { tableSubs.delete(tableId); if (socket && socket.connected) socket.emit('unsub', tableId); } else tableSubs.set(tableId, n);
    };
  }, [tableId]);
}
