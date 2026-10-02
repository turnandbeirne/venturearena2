// Mancala board. Legality comes from rules.js (legalMoves), the same function
// the bot and the server's validator use; the path a sow takes comes from
// pathOf(), the function the rules sow with.
//
// Two layouts from one grid, chosen by measuring the space (never the
// viewport): an upright board for phones (stores top and bottom, your pits down
// the left, sowing counter-clockwise as on a real board turned a quarter) and
// the familiar long board when the space is wide enough for bigger pits.
import { useRef } from 'react';
import { PITS, SLOTS, storeOf, pitIndex, isStore, ownerOf, opposite, legalMoves, pathOf } from './rules.js';
import { useFit, lastOf } from '../../client/game/hooks.js';
import './board.css';

const GAP = 6;
const PAD = 10;
/** Upright pits are twice as wide as tall: the count sits beside the stones and a store has room for a name. */
const WIDE = 2;
const FALLBACK = ['#C9962B', '#1C7C86'];

/** Stones drawn as beads on a sunflower spiral: even, and stable between renders. */
function Stones({ count, slot, max }) {
  const shown = Math.min(count, max);
  const spread = shown <= 1 ? 0 : Math.min(36, 10 + 6.5 * Math.sqrt(shown));
  const dots = [];
  for (let i = 0; i < shown; i++) {
    const r = spread * Math.sqrt((i + 0.5) / shown);
    const a = i * 2.39996 + slot;
    dots.push(<i key={i} className={`man__stone man__stone--${(slot * 3 + i) % 5}`} style={{ left: `${50 + r * Math.cos(a)}%`, top: `${50 + r * Math.sin(a)}%` }} />);
  }
  return <span className="man__stones" aria-hidden="true">{dots}</span>;
}

export default function Board({ G, moves, playerID, seats }) {
  const wrap = useRef(null);
  const tall = useFit(wrap, 2 * WIDE, PITS + 2, { gap: GAP, pad: PAD, max: 76 });
  const long = useFit(wrap, PITS + 2, 2, { gap: GAP, pad: PAD, max: 108 });
  const upright = long <= tall;
  const cell = upright ? tall : long;

  const mySeat = playerID === null || playerID === undefined ? null : Number(playerID);
  const bottom = mySeat === null ? 0 : mySeat; // spectators see seat 0's view
  const myTurn = mySeat !== null && !G.over && String(G.turnP) === String(playerID);
  const legal = myTurn ? legalMoves(G, mySeat) : [];
  const color = (seat) => (seats && seats[seat] && seats[seat].hex ? seats[seat].hex : FALLBACK[seat]);
  const name = (seat) => (seat === mySeat ? 'You' : seats && seats[seat] && seats[seat].name ? seats[seat].name : `Seat ${seat + 1}`);

  // The newest sow, and where each of its stones went. Everything that moves is
  // keyed on the log counter: a new sow animates once, a re-render never replays it.
  const last = lastOf(G, 'sow');
  const order = new Map();
  if (last) pathOf(last.p, last.from, last.stones).forEach((slot, k) => { if (!order.has(slot)) order.set(slot, k); });
  const capSlots = last && last.cap ? [last.last, opposite(last.last)] : [];

  const place = (i) => {
    const seat = ownerOf(i);
    const mine = seat === bottom;
    if (isStore(i)) return upright ? { gridColumn: '1 / 3', gridRow: mine ? PITS + 2 : 1 } : { gridColumn: mine ? PITS + 2 : 1, gridRow: '1 / 3' };
    const k = i - pitIndex(seat, 0);
    if (upright) return mine ? { gridColumn: 1, gridRow: 2 + k } : { gridColumn: 2, gridRow: PITS + 1 - k };
    return mine ? { gridColumn: 2 + k, gridRow: 2 } : { gridColumn: PITS + 1 - k, gridRow: 1 };
  };

  const anim = (i) => {
    if (!last) return { key: 's', cls: '', delay: 0 };
    const k = order.get(i);
    const steps = order.size;
    if (capSlots.includes(i)) return { key: `c${last.n}`, cls: ' man__in--cap', delay: steps * 70 };
    if (k !== undefined) return { key: `h${last.n}`, cls: ' man__in--hit', delay: k * 70 };
    if (i === last.from) return { key: `f${last.n}`, cls: ' man__in--src', delay: 0 };
    if (last.cap && i === storeOf(last.p)) return { key: `b${last.n}`, cls: ' man__in--bank', delay: steps * 70 + 120 };
    return { key: 's', cls: '', delay: 0 };
  };

  let note;
  if (G.over) {
    const swept = lastOf(G, 'sweep');
    const quit = lastOf(G, 'resign');
    note = quit ? `${name(quit.p)} resigned`
      : `${name(bottom)} ${G.pits[storeOf(bottom)]}, ${name(1 - bottom)} ${G.pits[storeOf(1 - bottom)]}${swept ? ` (${name(swept.p)} kept the last ${swept.stones})` : ''}`;
  } else if (last) {
    note = `${name(last.p)} sowed ${last.stones}${last.cap ? `, captured ${last.cap}` : ''}${last.extra ? (last.p === mySeat ? ': go again' : ': extra turn') : ''}`;
  } else {
    note = mySeat === null ? 'Stones are sown counter-clockwise, one per pit' : `Your pits are ${upright ? 'on the left' : 'the bottom row'}. Tap one to sow it.`;
  }

  return (
    <div className="man">
      <div className="man__measure" ref={wrap} aria-hidden="true" />
      <div className="man__note truncate" role="status">{note}</div>
      {cell > 0 && (
        <div
          className={`man__board man__board--${upright ? 'v' : 'h'}`}
          style={{ '--cell': `${cell}px`, '--pw': `${Math.floor(cell * WIDE)}px`, '--gap': `${GAP}px`, '--pad': `${PAD}px` }}
        >
          {Array.from({ length: SLOTS }, (_, i) => {
            const seat = ownerOf(i);
            const count = G.pits[i];
            const a = anim(i);
            const inner = (
              <span key={a.key} className={`man__in${a.cls}`} style={{ animationDelay: `${a.delay}ms` }}>
                {isStore(i) && <span className="man__name truncate">{name(seat)}</span>}
                <Stones count={count} slot={i} max={isStore(i) ? 30 : 14} />
                <span className="man__num">{count}</span>
              </span>
            );
            if (isStore(i)) {
              return (
                <div key={i} className={`man__store${seat === bottom ? ' man__store--mine' : ''}`} style={{ ...place(i), '--seat': color(seat) }} data-slot={i} aria-label={`${name(seat)}: store, ${count} stones`}>
                  {inner}
                </div>
              );
            }
            const pit = i - pitIndex(seat, 0);
            const can = seat === mySeat && legal.includes(pit);
            return (
              <button
                key={i} type="button" disabled={!can} data-slot={i}
                className={`man__pit${can ? ' man__pit--can' : ''}${seat === bottom ? ' man__pit--mine' : ' man__pit--theirs'}${count === 0 ? ' man__pit--empty' : ''}`}
                style={{ ...place(i), '--seat': color(seat) }}
                aria-label={`${name(seat)}: pit ${pit + 1}, ${count} stones${can ? ', tap to sow' : ''}`}
                onClick={() => { if (can) moves.sow(pit); }}
              >
                {inner}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
