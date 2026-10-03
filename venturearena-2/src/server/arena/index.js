// Build the arena: context + every module. `createArena({ store })` is all a
// test needs; the server adds the boardgame.io handle, the realtime emitter
// and the mailer.
import { createContext } from './context.js';
import { install as users } from './users.js';
import { install as tables } from './tables.js';
import { install as play } from './play.js';
import { install as social } from './social.js';
import { install as matching } from './matching.js';
import { install as community } from './community.js';
import { install as runner } from '../bots/runner.js';

export function createArena(opts) {
  const A = createContext(opts);
  A.bgio = opts.bgio || null;
  users(A);
  tables(A);
  play(A);
  social(A);
  matching(A);
  community(A);
  runner(A);
  if (A.bgio) A.bgio.db.onState((matchID, state, deltalog) => A.hooks.matchState(matchID, state, deltalog));

  /** Call a handler the way the HTTP layer does. */
  A.call = async (name, me, args = {}, req = { ip: 'local' }) => {
    const fn = Object.prototype.hasOwnProperty.call(A.rpc, name) ? A.rpc[name] : null;
    if (!fn) throw A.err('Unknown request', 404);
    if (!me && !A.publicRpc.has(name)) throw A.err('Sign in or enter as a guest first.', 401);
    return fn(me, args || {}, req);
  };
  return A;
}

export { ArenaError } from './context.js';
