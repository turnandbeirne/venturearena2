// Run a game's rules exactly as the server does, without a network or a
// database. Used by the playout tests (tests/playout.test.js) and by anything
// server-side that needs to look at "what would this move do".
//
// Why not boardgame.io's own test Client: moves are { client: false }, and the
// local Client skips those. This goes through the same reducer the Master uses.
import { InitializeGame, CreateGameReducer, ProcessGameConfig } from 'boardgame.io/internal';
import { actingSeats } from './kit.js';

const MAKE_MOVE = 'MAKE_MOVE';

export function createMatch(game, numSeats, setupData) {
  const g = ProcessGameConfig(game);
  const numPlayers = numSeats + (game.arena && game.arena.house ? 1 : 0);
  const reducer = CreateGameReducer({ game: g });
  let state = InitializeGame({ game: g, numPlayers, setupData });
  return {
    game: g,
    get state() { return state; },
    get G() { return state.G; },
    get ctx() { return state.ctx; },
    /** What a browser in `seat` receives (null = spectator). */
    view(seat) {
      const playerID = seat === null || seat === undefined ? null : String(seat);
      return g.playerView({ G: state.G, ctx: state.ctx, playerID });
    },
    /** Apply a move. Returns true if the rules accepted it. */
    move(seat, name, ...args) {
      const action = { type: MAKE_MOVE, payload: { type: name, args, playerID: String(seat) } };
      const next = reducer(state, action);
      const rejected = !!(next.transients && next.transients.error) || next._stateID === state._stateID;
      if (rejected) return false;
      const { transients, ...clean } = next; // eslint-disable-line no-unused-vars
      state = clean;
      return true;
    },
    house() { return state.G.house; },
  };
}

/**
 * Play a whole game with bots and return the final G. Throws if a bot makes a
 * move the rules refuse, or the game does not end within `maxSteps`: either is
 * a real bug (bot and validator disagree, or a stalemate with no mercy limit).
 */
export function playout({ game, bot, housekeeping, numSeats, setupData, maxSteps = 20000, onStep }) {
  const m = createMatch(game, numSeats, setupData);
  let steps = 0;
  while (!m.G.over) {
    if (++steps > maxSteps) throw new Error(`${game.name}: no result after ${maxSteps} steps (turnP=${m.G.turnP})`);
    // Seats that owe an action go first; the server's own seat only steps in
    // when nobody at the table acts (a robot inside the engine, or a timer
    // that would have run out). That is the order the live runner uses too.
    let acted = false;
    for (const seat of actingSeats(m.G)) {
      const act = bot({ G: m.view(seat), ctx: m.ctx, seat });
      if (!act) continue;
      if (!m.move(seat, act.move, ...(act.args || []))) {
        throw new Error(`${game.name}: bot move ${act.move}(${JSON.stringify(act.args || [])}) by seat ${seat} was refused`);
      }
      if (onStep) onStep(m, { seat, ...act });
      acted = true;
      break;
    }
    if (acted) continue;
    // A fake clock that only moves forward, for games whose housekeeping reads `now`.
    const chore = housekeeping ? housekeeping(m.G, { now: 1700000000000 + steps * 1000, seats: null, playout: true }) : null;
    if (!chore) throw new Error(`${game.name}: nobody can act and the game is not over (turnP=${m.G.turnP}, waiting=${JSON.stringify(m.G.waiting)})`);
    if (!m.move(m.house(), chore.move, ...(chore.args || []))) {
      throw new Error(`${game.name}: house move ${chore.move} was refused`);
    }
    if (onStep) onStep(m, { seat: 'house', ...chore });
  }
  return m;
}

export { actingSeats } from './kit.js';
