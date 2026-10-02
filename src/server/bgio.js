// The server-side handle on boardgame.io: create a match, read its full
// state, and make a move as any seat (bots, the house seat, a forfeit).
//
// Server-made moves go through boardgame.io's own Master, the same code path a
// browser's move takes, so they are validated by the same rules and broadcast
// to every connected browser through the same pubsub. They are serialised on
// the transport's per-match queue: a bot and a human moving at the same instant
// would otherwise both read state N and one move would be silently dropped as
// stale.
import crypto from 'node:crypto';
import { Master } from 'boardgame.io/master';
import { InitializeGame, ProcessGameConfig } from 'boardgame.io/internal';
import { ArenaStorage } from './store/bgio-storage.js';
import { GAMES } from '../games/registry.js';

/**
 * What a browser may send on a game socket. boardgame.io's own checks are not
 * enough on three counts, each found with a hand-written socket message
 * against the real server (tests/http.test.js):
 *
 *  1. A move belongs to one seat. boardgame.io checks the credentials against
 *     the player id the socket CLAIMS (4th argument of "update") and then
 *     runs the move as `action.payload.playerID`; it never compares the two.
 *     (Bug: anyone seated could move, or resign, as any other seat, a bot or
 *     the house seat included: an instant win and the rating that goes with it.)
 *  2. Only moves. boardgame.io also runs GAME_EVENT actions sent by a browser
 *     (endGame, endTurn, setActivePlayers...), whatever the game's `events`
 *     setting says. (Bug: one "endGame" message ended a table with the
 *     placements the sender chose, and the arena recorded them.)
 *  3. Only matches that exist. For an unknown id boardgame.io builds a new
 *     game on demand with as many players as the caller asks for and sends
 *     it back; this socket needs no session. (Bug: "sync" for a made-up id
 *     with numPlayers in the millions was the server's memory gone.)
 *
 * Anything else is dropped without an answer, which is what boardgame.io
 * does with a move it refuses.
 */
export function guardGameSockets(io, gameNames, db, mayWatch = null) {
  const allowed = (packet, socket) => {
    const [event] = packet;
    if (event === 'update') {
      const [, action, , matchID, playerID] = packet;
      if (!action || typeof action !== 'object' || action.type !== 'MAKE_MOVE') return false;
      const p = action.payload;
      if (!p || typeof p !== 'object' || typeof p.type !== 'string') return false;
      if (typeof playerID !== 'string' || p.playerID !== playerID) return false;
      if (p.args !== undefined && !Array.isArray(p.args)) return false;
      return typeof matchID === 'string' && db.peek(matchID) !== undefined;
    }
    if (event === 'sync') {
      const matchID = packet[1];
      // 4. A private table is for the people at it. The game socket itself
      //    carries no session, so without this anyone who learned a private
      //    table's id (they appear in members' game histories) could watch it.
      return typeof matchID === 'string' && db.peek(matchID) !== undefined && (!mayWatch || mayWatch(matchID, socket));
    }
    // boardgame.io's built-in chat is not used: table talk goes through the
    // arena, where it is tied to a member and rate limited.
    if (event === 'chat') return false;
    return true;
  };
  for (const name of gameNames) {
    io.of(name).on('connection', (socket) => {
      socket.use((packet, next) => { if (Array.isArray(packet) && allowed(packet, socket)) next(); });
    });
  }
}

export function createBgio({ store }) {
  const db = new ArenaStorage(store);
  const processed = {};
  for (const [id, g] of Object.entries(GAMES)) processed[id] = ProcessGameConfig(g.rules);

  let transport = null;       // boardgame.io SocketIO transport, once the server is up
  const localQueues = new Map(); // used before/without a transport (tests)

  function queueFor(matchID) {
    if (transport) return transport.getMatchQueue(matchID);
    let tail = localQueues.get(matchID) || Promise.resolve();
    return {
      add: (fn) => {
        const run = tail.then(fn, fn);
        tail = run.catch(() => {});
        localQueues.set(matchID, tail);
        return run;
      },
    };
  }

  const api = {
    db,
    processed,
    attachTransport(t) { transport = t; },

    /** Create the boardgame.io match behind a table. Returns per-seat credentials. */
    async createMatch(matchID, gameId, numSeats, setupData, seatNames) {
      const game = processed[gameId];
      const house = !!(GAMES[gameId].rules.arena && GAMES[gameId].rules.arena.house);
      const numPlayers = numSeats + (house ? 1 : 0);
      const initialState = InitializeGame({ game, numPlayers, setupData });
      const credentials = [];
      const players = {};
      for (let i = 0; i < numPlayers; i++) {
        // Every id gets credentials, bots and the house seat included: an id
        // without them can be claimed by any socket that asks.
        credentials.push(crypto.randomBytes(18).toString('base64url'));
        players[i] = { id: i, name: seatNames[i] || (i === numSeats ? 'house' : `seat ${i}`), credentials: credentials[i] };
      }
      const metadata = { gameName: game.name, players, unlisted: true, createdAt: Date.now(), updatedAt: Date.now() };
      await db.createArenaMatch(matchID, { initialState, metadata });
      return { credentials, house: house ? String(numSeats) : null };
    },

    state(matchID) { return db.peek(matchID); },

    /** Make a move as `playerID`. Resolves to true if the state advanced. */
    submit(matchID, gameId, playerID, move, args = []) {
      const game = processed[gameId];
      return queueFor(matchID).add(async () => {
        const before = db.peek(matchID);
        if (!before || before.ctx.gameover !== undefined) return false;
        const sendAll = (payload) => { if (transport) transport.pubSub.publish(`MATCH-${matchID}`, payload); };
        // No auth object: this Master instance is ours, the caller is the server.
        const master = new Master(game, db, { send() {}, sendAll });
        await master.onUpdate({ type: 'MAKE_MOVE', payload: { type: move, args, playerID: String(playerID) } }, before._stateID, matchID, String(playerID));
        const after = db.peek(matchID);
        return !!after && after._stateID !== before._stateID;
      });
    },

    /**
     * Replace one seat's credentials (a seat a bot has taken over). boardgame.io
     * reads the match metadata on every move, so the old ones stop working at once.
     */
    async revokeSeat(matchID, seat) {
      const { metadata } = await db.fetch(matchID, { metadata: true });
      if (!metadata || !metadata.players || !metadata.players[seat]) return null;
      const fresh = crypto.randomBytes(18).toString('base64url');
      const players = { ...metadata.players, [seat]: { ...metadata.players[seat], credentials: fresh } };
      await db.setMetadata(matchID, { ...metadata, players, updatedAt: Date.now() });
      return fresh;
    },

    async wipe(matchID) { await db.wipe(matchID); localQueues.delete(matchID); },
  };
  return api;
}
