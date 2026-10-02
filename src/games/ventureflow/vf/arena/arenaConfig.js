// Shim for the old src/arena/arenaConfig.js. VentureFlow used to talk to the
// arena over HTTP from here (Supabase URL, publishable key, poll interval);
// on VentureArena v2 the board is handed the server's state directly, so only
// the timing constants the vendored components read are left.

// Stall ladder on a live person's turn, measured from the last move this
// browser saw: a nudge, then a notice. The third rung (the table may vote, the
// host may replace) is no longer timed in the browser: the server marks the
// seat as stalled (rules.js MARK_STALL) and the board shows it from G.stall.
export const ARENA_STALL_WARN_MS = 40 * 1000;
export const ARENA_STALL_NOTICE_MS = 60 * 1000;
export const ARENA_STALL_CURE_MS = 20 * 1000;
export const ARENA_STALL_MS = ARENA_STALL_NOTICE_MS + ARENA_STALL_CURE_MS;

// Trades fired within this window (a press-and-hold) are sent as one move.
export const ARENA_TRADE_BATCH_MS = 220;
