// Checkers board. Legality comes from rules.js (legalMoves), the same
// function the bot and the server's validator use.
import { useRef, useState } from 'react';
import { SIZE, CELLS, EMPTY, QUIET_PLIES, legalMoves, movesFor, tally, ownerOf, isKing, isDark, rowOf, colOf } from './rules.js';
import { useFit, lastOf } from '../../client/game/hooks.js';
import './board.css';

/** Border around the grid, in px. useFit leaves room for it on each side. */
const FRAME = 4;
const FILES = 'ABCDEFGH';
const squareName = (cell) => `${FILES[colOf(cell)]}${SIZE - rowOf(cell)}`;

/**
 * One piece, drawn as SVG so it stays crisp at any cell size. Seat 0 is a
 * solid piece with a grooved ring; seat 1 has a pale centre: the two sides
 * differ by shape as well as by the colours their owners picked. A king is
 * a stack of two with a crown on top.
 */
function Piece({ seat, king, color }) {
  const top = king ? 44 : 50;
  return (
    <svg className="chk__svg" viewBox="0 0 100 100" aria-hidden="true">
      {king && <circle cx="50" cy="54" r="44" fill={color} stroke="#f6f1e7" strokeWidth="4" />}
      {king && <circle cx="50" cy="54" r="44" fill="rgba(0,0,0,0.28)" />}
      <circle cx="50" cy={top} r="44" fill={color} stroke="#f6f1e7" strokeWidth="4" />
      {seat === 1 && <circle cx="50" cy={top} r={king ? 32 : 26} fill="#f6f1e7" stroke="rgba(11,21,48,0.55)" strokeWidth="3" />}
      {seat === 0 && !king && <circle cx="50" cy={top} r="30" fill="none" stroke="rgba(246,241,231,0.6)" strokeWidth="4" />}
      {king && (
        // Pale crown on the solid piece, gold crown on the pale centre: it
        // has to read against any colour a member picks.
        <path
          className="chk__crown" d={`M27 ${top + 15} L22 ${top - 12} L38 ${top - 1} L50 ${top - 18} L62 ${top - 1} L78 ${top - 12} L73 ${top + 15} Z`}
          fill={seat === 0 ? '#f6f1e7' : '#e8b64a'} stroke="#1d1503" strokeWidth="4" strokeLinejoin="round"
        />
      )}
    </svg>
  );
}

export default function Board({ G, moves, playerID, seats }) {
  const fit = useRef(null);
  const cell = useFit(fit, SIZE, SIZE, { pad: FRAME, max: 84 });
  const [pick, setPick] = useState(null);
  // Entries already in the log when the board mounts are history, not news:
  // only what arrives afterwards is animated (a refresh replays nothing).
  const born = useRef(typeof G.logN === 'number' ? G.logN : 0);

  const mySeat = playerID === null || playerID === undefined ? null : Number(playerID);
  const myTurn = mySeat !== null && !G.over && String(G.turnP) === String(playerID);
  // Seat 1 sees the board turned round, so everyone plays up the screen.
  // Spectators get seat 0's view.
  const flip = mySeat === 1;
  const color = (seat) => (seats && seats[seat] && seats[seat].hex ? seats[seat].hex : seat === 0 ? '#e8b64a' : '#2fb7a6');
  const nameOf = (seat) => (seat === mySeat ? 'You' : seats && seats[seat] ? seats[seat].name : `Seat ${seat + 1}`);

  const legal = myTurn ? legalMoves(G, mySeat) : [];
  const movers = new Set(legal.map((mv) => mv.from));
  const forced = legal.length > 0 && legal[0].over !== null;
  const chained = myTurn && G.mustFrom !== null && G.mustFrom !== undefined;
  // With one piece able to move (always the case mid-jump) it is selected
  // for you; otherwise the piece you tapped, while it can still move.
  const sel = movers.size === 1 ? [...movers][0] : pick !== null && movers.has(pick) ? pick : null;
  const targets = new Map(legal.filter((mv) => mv.from === sel).map((mv) => [mv.to, mv]));

  const last = lastOf(G, 'move');
  const fresh = last && last.n > born.current ? last : null;
  const sign = flip ? -1 : 1;

  const t = tally(G.board);
  const total = t.map((x) => x.men + x.kings);

  // One line about what matters now, read from the state and the log.
  const log = Array.isArray(G.log) ? G.log : [];
  const quiet = G.quiet || 0;
  let note;
  if (G.over) {
    const resigned = log.find((e) => e.t === 'resign');
    const p = G.over.placements || [1, 1];
    if (resigned) note = `${nameOf(resigned.p)} resigned.`;
    else if (p[0] === p[1]) note = quiet >= QUIET_PLIES ? 'A draw: 40 moves each with no capture and only kings moving.' : 'A draw: the move limit was reached with level material.';
    else {
      const loser = p[0] === 1 ? 1 : 0;
      const stuck = total[loser] > 0 && movesFor(G.board, loser).length === 0;
      note = total[loser] === 0 ? `${nameOf(1 - loser)} captured every piece.` : stuck ? `${nameOf(loser)} had no legal move left.` : `${nameOf(1 - loser)} won on pieces at the move limit.`;
    }
  } else if (chained) note = 'Keep jumping: the same piece must capture again.';
  else if (myTurn && forced) note = sel === null ? 'You must capture. Tap one of the ringed pieces.' : 'You must capture. Tap the marked square.';
  else if (myTurn && sel !== null) note = 'Tap a marked square to move there.';
  else if (myTurn && !last) note = 'Tap one of your pieces, then a marked square.';
  else if (last) {
    const took = last.cap !== null && last.cap !== undefined;
    note = `${nameOf(last.p)} ${last.king ? 'crowned a king on' : took ? 'captured and landed on' : 'moved to'} ${squareName(last.to)}.`;
    // Warn before the 40-move draw arrives, not after.
    if (quiet >= QUIET_PLIES - 30) note = `${Math.ceil((QUIET_PLIES - quiet) / 2)} more moves each with no capture and only kings moving make a draw.`;
  } else note = 'Pieces move diagonally forward on the dark squares.';

  const onSquare = (i) => {
    if (targets.has(i)) { setPick(null); moves.move(sel, i); return; }
    setPick(movers.has(i) && i !== pick ? i : null);
  };

  const tallyOf = (seat, right) => (
    <span className={`chk__tally${right ? ' chk__tally--right' : ''}`} data-seat={seat}>
      <span className="chk__chip"><Piece seat={seat} king={false} color={color(seat)} /></span>
      <span className="chk__who">
        <span className="chk__name">{nameOf(seat)}</span>
        <span className="chk__count"><b data-count={seat}>{total[seat]}</b> {total[seat] === 1 ? 'piece' : 'pieces'}{t[seat].kings > 0 && ` (${t[seat].kings} ${t[seat].kings === 1 ? 'king' : 'kings'})`}</span>
      </span>
    </span>
  );

  const boardPx = cell * SIZE + FRAME * 2;
  return (
    <div className="chk">
      {/* Measured, never drawn: the space left for the grid under the score. */}
      <div className="chk__probe" ref={fit} aria-hidden="true" />
      <div className="chk__head" style={cell > 0 ? { width: boardPx } : undefined}>
        <div className="chk__note" role="status"><span>{note}</span></div>
        <div className="chk__score" role="group" aria-label="Pieces left">{tallyOf(flip ? 1 : 0, false)}{tallyOf(flip ? 0 : 1, true)}</div>
      </div>
      {cell > 0 && (
        <div className="chk__grid" role="group" aria-label="Checkers board" style={{ '--cell': `${cell}px`, '--frame': `${FRAME}px` }}>
          {Array.from({ length: CELLS }, (_, view) => {
            const i = flip ? CELLS - 1 - view : view;
            if (!isDark(i)) return <div key={i} className="chk__sq chk__sq--light" />;
            const v = G.board[i];
            const seat = ownerOf(v);
            const target = targets.get(i);
            const canPick = movers.has(i);
            const moved = fresh && fresh.to === i && v !== EMPTY;
            const taken = fresh && fresh.cap === i && v === EMPTY;
            const cls = `chk__sq chk__sq--dark${sel === i ? ' chk__sq--sel' : ''}${last && (last.from === i || last.to === i) ? ' chk__sq--last' : ''}${moved ? ' chk__sq--moving' : ''}`;
            const inside = (
              <>
                {v !== EMPTY && (
                  <span
                    // Keyed on the log counter: a new move animates once, a re-render never replays it.
                    key={moved ? `m${fresh.n}` : 's'}
                    className={`chk__piece${moved ? ' chk__piece--slide' : ''}${moved && fresh.king ? ' chk__piece--crowned' : ''}${canPick ? ' chk__piece--can' : ''}`}
                    style={moved ? { '--dx': (colOf(fresh.from) - colOf(i)) * sign, '--dy': (rowOf(fresh.from) - rowOf(i)) * sign } : undefined}
                    data-seat={seat} data-king={isKing(v) ? '1' : '0'}
                  >
                    <Piece seat={seat} king={isKing(v)} color={color(seat)} />
                  </span>
                )}
                {taken && (
                  <span key={`x${fresh.n}`} className="chk__piece chk__piece--gone">
                    <Piece seat={1 - fresh.p} king={!!fresh.capK} color={color(1 - fresh.p)} />
                  </span>
                )}
                {target && <span className={`chk__dot${target.over !== null ? ' chk__dot--jump' : ''}`} />}
              </>
            );
            if (target || canPick) {
              const label = target
                ? `${target.over !== null ? 'Capture and land on' : 'Move to'} ${squareName(i)}`
                : `${sel === i ? 'Selected: your' : 'Your'} ${isKing(v) ? 'king' : 'piece'} on ${squareName(i)}`;
              return <button key={i} type="button" className={`${cls} chk__sq--tap`} data-cell={i} data-role={target ? 'target' : 'piece'} aria-label={label} aria-pressed={target ? undefined : sel === i} onClick={() => onSquare(i)}>{inside}</button>;
            }
            return <div key={i} className={cls} data-cell={i} onClick={myTurn ? () => setPick(null) : undefined}>{inside}</div>;
          })}
        </div>
      )}
    </div>
  );
}
