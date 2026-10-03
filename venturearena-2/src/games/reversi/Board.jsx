// Reversi board. Legality comes from rules.js (legalMoves, flipsFor), the
// same functions the bot and the server's validator use.
import { useRef, useState } from 'react';
import { SIZE, CELLS, legalMoves, flipsFor, counts } from './rules.js';
import { useFit, lastOf } from '../../client/game/hooks.js';
import './board.css';

/** Border around the grid, in px. useFit leaves room for it on each side. */
const FRAME = 4;
const FILES = 'ABCDEFGH';
const squareName = (cell) => `${FILES[cell % SIZE]}${Math.floor(cell / SIZE) + 1}`;

/** One disc. Seat 0 is solid; seat 1 has a pale centre, so the two sides
 *  differ by shape as well as by the colours their owners picked. */
function Disc({ seat, color, className = '', style }) {
  return <span className={`rev__disc rev__disc--s${seat} ${className}`} style={{ '--c': color, ...style }} />;
}

export default function Board({ G, moves, playerID, seats }) {
  const fit = useRef(null);
  const cell = useFit(fit, SIZE, SIZE, { pad: FRAME, max: 84 });
  const [peek, setPeek] = useState(null);
  // Entries already in the log when the board mounts are history, not news:
  // only what arrives afterwards is animated (a refresh replays nothing).
  const born = useRef(typeof G.logN === 'number' ? G.logN : 0);

  const mySeat = playerID === null || playerID === undefined ? null : Number(playerID);
  const myTurn = mySeat !== null && !G.over && String(G.turnP) === String(playerID);
  const legal = new Set(myTurn ? legalMoves(G, mySeat) : []);
  const color = (seat) => (seats && seats[seat] && seats[seat].hex ? seats[seat].hex : seat === 0 ? '#e8b64a' : '#2fb7a6');
  const nameOf = (seat) => (seat === mySeat ? 'You' : seats && seats[seat] ? seats[seat].name : `Seat ${seat + 1}`);

  const last = lastOf(G, 'place');
  const fresh = last && last.n > born.current ? last : null;
  // Flips ripple outward from the new disc: delay by distance from it.
  const flipDelay = new Map();
  if (fresh) {
    const r0 = Math.floor(fresh.cell / SIZE), c0 = fresh.cell % SIZE;
    for (const f of fresh.flips || []) flipDelay.set(f, Math.max(Math.abs(Math.floor(f / SIZE) - r0), Math.abs((f % SIZE) - c0)));
  }
  const wouldFlip = new Set(myTurn && peek !== null && legal.has(peek) ? flipsFor(G.board, mySeat, peek) : []);

  const [a, b] = counts(G.board);
  const lead = a === b ? null : a > b ? 0 : 1;

  // One line about the newest thing that happened, read from the log.
  const log = Array.isArray(G.log) ? G.log : [];
  const tail = log.length ? log[log.length - 1] : null;
  let note;
  if (G.over) {
    const resigned = log.find((e) => e.t === 'resign');
    note = resigned ? `${nameOf(resigned.p)} resigned.` : lead === null ? `A draw: ${a} discs each.` : `${nameOf(lead)} won, ${Math.max(a, b)} discs to ${Math.min(a, b)}.`;
  } else if (tail && tail.t === 'pass') {
    const other = 1 - tail.p;
    note = `${nameOf(tail.p)} had no legal move, so ${other === mySeat ? 'you play' : `${nameOf(other)} plays`} again.`;
  } else if (last) {
    const k = (last.flips || []).length;
    note = `${nameOf(last.p)} played ${squareName(last.cell)} and flipped ${k} ${k === 1 ? 'disc' : 'discs'}.`;
  } else {
    note = myTurn ? 'Tap a marked square to place a disc.' : 'Trap a line of discs between two of yours to flip it.';
  }

  const boardPx = cell * SIZE + FRAME * 2;
  return (
    <div className="rev">
      {/* Measured, never drawn: the space left for the grid under the score. */}
      <div className="rev__probe" ref={fit} aria-hidden="true" />
      <div className="rev__head" style={cell > 0 ? { width: boardPx } : undefined}>
        <div className="rev__note" role="status"><span>{note}</span></div>
        <div className="rev__score" role="group" aria-label="Disc count">
          <span className={`rev__tally${lead === 0 ? ' rev__tally--lead' : ''}`}>
            <Disc seat={0} color={color(0)} className="rev__disc--chip" />
            <b className="rev__num" data-count="0">{a}</b>
            <span className="rev__name">{nameOf(0)}</span>
          </span>
          <span className="rev__bar" aria-hidden="true">
            <i style={{ width: `${a + b ? (a / (a + b)) * 100 : 50}%`, background: color(0) }} />
            <i style={{ flex: 1, background: color(1) }} />
          </span>
          <span className={`rev__tally rev__tally--right${lead === 1 ? ' rev__tally--lead' : ''}`}>
            <span className="rev__name">{nameOf(1)}</span>
            <b className="rev__num" data-count="1">{b}</b>
            <Disc seat={1} color={color(1)} className="rev__disc--chip" />
          </span>
        </div>
      </div>
      {cell > 0 && (
        <div className="rev__grid" role="group" aria-label="Reversi board" style={{ '--cell': `${cell}px`, '--frame': `${FRAME}px` }} onMouseLeave={() => setPeek(null)}>
          {Array.from({ length: CELLS }, (_, i) => {
            const v = G.board[i];
            const can = legal.has(i);
            const isNew = fresh && fresh.cell === i;
            const flipped = fresh && flipDelay.has(i);
            const disc = v !== null && (
              // Keyed on the log counter: a new move animates once, a re-render never replays it.
              <span key={isNew || flipped ? `m${fresh.n}` : 's'} className="rev__slot">
                {flipped && <Disc seat={1 - v} color={color(1 - v)} className="rev__disc--out" style={{ '--d': `${80 + flipDelay.get(i) * 70}ms` }} />}
                <Disc
                  seat={v} color={color(v)}
                  className={`${isNew ? 'rev__disc--pop' : ''}${flipped ? ' rev__disc--in' : ''}${last && last.cell === i ? ' rev__disc--last' : ''}${wouldFlip.has(i) ? ' rev__disc--would' : ''}`}
                  style={flipped ? { '--d': `${80 + flipDelay.get(i) * 70}ms` } : undefined}
                />
              </span>
            );
            if (can) {
              return (
                <button
                  key={i} type="button" className={`rev__cell rev__cell--can${peek === i ? ' rev__cell--peek' : ''}`} data-cell={i}
                  aria-label={`Place a disc on ${squareName(i)}`}
                  onMouseEnter={() => setPeek(i)} onFocus={() => setPeek(i)} onBlur={() => setPeek(null)}
                  onClick={() => { setPeek(null); moves.place(i); }}
                >
                  <span className="rev__hint" style={{ '--c': color(mySeat) }} />
                </button>
              );
            }
            return <div key={i} className="rev__cell" data-cell={i}>{disc}</div>;
          })}
        </div>
      )}
    </div>
  );
}
