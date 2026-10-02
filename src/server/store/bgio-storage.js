// boardgame.io storage backed by our Store, plus the two hooks the arena
// needs: "this match's state just changed" (drives bots, timers, results) and
// "who is allowed to exist" (only the arena creates matches).
import { Async } from 'boardgame.io/internal';

export class ArenaStorage extends Async {
  constructor(store) {
    super();
    this.state = store.col('bgio_state');
    this.meta = store.col('bgio_meta');
    this.listeners = [];
    /** matchIDs the arena has created. See createMatch(). */
    this.allowed = new Set(this.meta.all().map((m) => m.id));
  }
  async connect() {}

  onState(fn) { this.listeners.push(fn); }

  /** The arena's own entry point for a new match. */
  async createArenaMatch(matchID, { initialState, metadata }) {
    this.allowed.add(matchID);
    await this.createMatch(matchID, { initialState, metadata });
  }

  async createMatch(matchID, opts) {
    // boardgame.io creates a match on demand when a socket syncs to an id it
    // has never seen. Left alone, anyone could fill the server's memory with
    // junk matches, so only ids the arena created are ever stored.
    if (!this.allowed.has(matchID)) return;
    this.meta.put({ id: matchID, metadata: opts.metadata });
    this.state.put({ id: matchID, state: opts.initialState });
    this.emit(matchID, opts.initialState, []);
  }

  async setState(matchID, state, deltalog) {
    if (!this.allowed.has(matchID)) return;
    // boardgame.io's own log is not kept: each game carries its own capped
    // action log in G (kit.js pushLog), and an unbounded log per match is the
    // kind of thing that takes a small server down months later.
    this.state.put({ id: matchID, state });
    this.emit(matchID, state, deltalog || []);
  }

  async setMetadata(matchID, metadata) {
    if (!this.allowed.has(matchID)) return;
    this.meta.put({ id: matchID, metadata });
  }

  async fetch(matchID, opts) {
    const out = {};
    const s = this.state.get(matchID);
    if (opts.state) out.state = s ? s.state : undefined;
    if (opts.metadata) { const m = this.meta.get(matchID); out.metadata = m ? m.metadata : undefined; }
    if (opts.log) out.log = [];
    // boardgame.io 0.50 sends `initialState` to every browser at sync WITHOUT
    // running it through playerView: the full starting G, shuffled deck and
    // every hand included. We never hand it a real one. The board does not
    // use it (it is only for the debug panel's "reset").
    if (opts.initialState) out.initialState = s ? { ...s.state, G: {}, plugins: {}, _undo: [], _redo: [], deltalog: [] } : undefined;
    return out;
  }

  async wipe(matchID) {
    this.state.delete(matchID);
    this.meta.delete(matchID);
    this.allowed.delete(matchID);
  }

  async listMatches() { return this.meta.all().map((m) => m.id); }

  /** Full, unfiltered state for server-side use (bots, results). */
  peek(matchID) { const s = this.state.get(matchID); return s ? s.state : undefined; }

  emit(matchID, state, deltalog) {
    for (const fn of this.listeners) {
      try { fn(matchID, state, deltalog); } catch (e) { console.error('[bgio] state listener failed:', e); }
    }
  }
}
