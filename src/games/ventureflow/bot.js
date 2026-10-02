// VentureFlow bot. The game's real robots live inside the engine and are
// played by the server's house seat (rules.js housekeeping), so this bot is
// never a robot at a table. It exists for the automated playouts and the
// workbench, where it plays a PERSON's seat: it answers whatever that seat
// owes (a fortune card, a buyout offer, a launch celebration), makes a couple
// of simple purchases and ends the turn. It sees only what a browser in its
// seat sees, and checks every action against rules.js before sending it.
import { allowed, explain } from './rules.js';

const act = (action) => ({ move: 'act', args: [action] });

export function bot({ G, seat }) {
  if (!G || G.over || !G.vf) return null;
  const vf = G.vf;
  const me = vf.players[seat];
  if (!me || me.type !== 'human') return null;
  const ok = (action) => allowed(G, seat, action) && !explain(G, seat, action);

  // Things this seat owes the table, whoever's turn it is.
  if (vf.pendingLaunch && vf.pendingLaunch.playerId === me.id) return act({ type: 'ACK_STARTUP_LAUNCH' });
  if (vf.status === 'monthRecap') {
    const ack = { type: 'ACK_FORTUNE_CARD', index: vf.fortuneRecapIndex };
    return ok(ack) ? act(ack) : null;
  }
  if (vf.status === 'exitOffer') {
    const offer = vf.pendingExitOffer;
    if (!offer || offer.playerId !== me.id) return null;
    return act({ type: 'RESOLVE_EXIT_OFFER', playerId: me.id, accept: offer.multiplier >= 2 });
  }
  if (vf.status !== 'playing' || vf.activePlayerIndex !== seat) return null;

  // One business when it can be afforded, a skill token toward the next one,
  // then one purchase a turn with about half the cash that is left.
  const start = { type: 'START_BUSINESS' };
  if (me.businesses.length < 3 && me.skillTokens >= 1 && ok(start)) return act(start);
  const learn = { type: 'LEARN_SKILL' };
  if (me.businesses.length < 3 && me.skillTokens === 0 && vf.month <= 18 && me.cash >= 250 && ok(learn)) return act(learn);

  const seats = vf.players.length;
  const turnNo = (vf.month - 1) * seats + vf.activePlayerIndex;
  const boughtThisTurn = me.turnBuys && me.turnBuys.turnNo === turnNo ? Object.values(me.turnBuys.counts || {}).reduce((a, b) => a + b, 0) : 0;
  if (boughtThisTurn === 0) {
    const order = ['treehouse', 'lemonade', 'piggy', 'treasure'].sort(() => Math.random() - 0.5);
    for (const assetId of order) {
      const price = vf.assetPrices[assetId];
      const qty = price > 0 ? Math.floor((me.cash * 0.5) / price) : 0;
      const buy = { type: 'BUY_ASSET', assetId, qty };
      if (qty >= 1 && ok(buy)) return act(buy);
    }
  }
  return act({ type: 'END_TURN' });
}
