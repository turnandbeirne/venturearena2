// Four in a Row board. Legality comes from rules.js (legalMoves), the same
// function the bot and the server's validator use.
import { useRef, useState } from 'react';
import { COLS, ROWS, idx, legalMoves, landingRow } from './rules.js';
import { useFit, lastOf } from '../../client/game/hooks.js';
import './board.css';

export default function Board({ G, moves, playerID, seats }) {
  const wrap = useRef(null);
  const cell = useFit(wrap, COLS, ROWS + 1, { max: 84 });
  const [hover, setHover] = useState(null);
  const mySeat = playerID === null ? null : Number(playerID);
  const myTurn = mySeat !== null && !G.over && String(G.turnP) === String(playerID);
  const legal = myTurn ? legalMoves(G) : [];
  const last = lastOf(G, 'drop');
  const win = new Set(G.line || []);
  const color = (seat) => (seats[seat] ? seats[seat].hex : seat === 0 ? '#e8b64a' : '#2fb7a6');

  return (
    <div className="fir" ref={wrap}>
      {cell > 0 && (
        <div className="fir__grid" style={{ width: cell * COLS, '--cell': `${cell}px` }}>
          <div className="fir__drops" aria-hidden="true">
            {Array.from({ length: COLS }, (_, col) => (
              <div key={col} className="fir__drop">
                {myTurn && hover === col && legal.includes(col) && <span className="fir__disc fir__disc--ghost" style={{ background: color(mySeat) }} />}
              </div>
            ))}
          </div>
          <div className="fir__board">
            {Array.from({ length: COLS }, (_, col) => {
              const can = legal.includes(col);
              const lands = landingRow(G.board, col);
              return (
                <button
                  key={col} type="button" className={`fir__col${can ? ' fir__col--can' : ''}`} disabled={!can}
                  aria-label={can ? `Drop in column ${col + 1}` : `Column ${col + 1}`}
                  onMouseEnter={() => setHover(col)} onMouseLeave={() => setHover(null)} onFocus={() => setHover(col)}
                  onClick={() => { if (can) moves.drop(col); }}
                >
                  {Array.from({ length: ROWS }, (_, row) => {
                    const v = G.board[idx(row, col)];
                    const fresh = last && last.col === col && last.row === row;
                    return (
                      <span key={row} className={`fir__hole${can && row === lands && hover === col ? ' fir__hole--target' : ''}`}>
                        {v !== null && (
                          <span
                            // Keyed on the log counter: a new drop animates once, a re-render never replays it.
                            key={fresh ? `d${last.n}` : 's'}
                            className={`fir__disc${fresh ? ' fir__disc--drop' : ''}${win.has(idx(row, col)) ? ' fir__disc--win' : ''}`}
                            style={{ background: color(v), '--from': `${-(row + 1) * 100}%` }}
                          />
                        )}
                      </span>
                    );
                  })}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
