// Connect a browser to one boardgame.io match. The board gets plain props
// (G, ctx, moves, playerID); it never sees the client object.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Client } from 'boardgame.io/client';
import { SocketIO } from 'boardgame.io/multiplayer';

export function useMatch({ rules, matchID, playerID, credentials, numPlayers }) {
  const [state, setState] = useState(null);
  const [connected, setConnected] = useState(false);
  const clientRef = useRef(null);

  useEffect(() => {
    if (!rules || !matchID) return undefined;
    const client = Client({
      game: rules,
      numPlayers,
      matchID,
      playerID: playerID === null ? undefined : playerID,
      credentials: credentials || undefined,
      multiplayer: SocketIO({ server: window.location.origin }),
      debug: false,
    });
    clientRef.current = client;
    const unsub = client.subscribe((s) => {
      // Before the first sync the client holds a locally built state; show
      // nothing until the server's copy arrives.
      if (s && s.isConnected !== undefined) setConnected(!!s.isConnected);
      setState(s && s._stateID !== undefined && s.isConnected ? s : (prev) => prev);
    });
    client.start();
    return () => { unsub(); client.stop(); clientRef.current = null; setState(null); setConnected(false); };
  }, [rules, matchID, playerID, credentials, numPlayers]);

  const moves = useMemo(() => {
    const out = {};
    if (!rules) return out;
    for (const name of Object.keys(rules.moves)) {
      out[name] = (...args) => { const c = clientRef.current; if (c && c.moves[name]) c.moves[name](...args); };
    }
    return out;
  }, [rules]);

  return { G: state ? state.G : null, ctx: state ? state.ctx : null, moves, connected, stateID: state ? state._stateID : null };
}
