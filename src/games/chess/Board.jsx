// Chess board. Legality comes from rules.js (legalMoves, built on chess.js),
// the same function the bot and the server's validator use: the board only
// lights up squares that list contains and never decides a move itself.
import { useEffect, useMemo, useRef, useState } from 'react';
import { legalMoves, inCheck, piecesOf, squareName, material, PROMOTIONS } from './rules.js';
import { useFit, lastOf } from '../../client/game/hooks.js';
import './board.css';

// White is drawn with the outline glyphs over a white fill, Black with the
// solid ones: the two sides differ in shape as well as colour, on either
// square colour. U+FE0E asks for the text glyph; without it some phones draw
// the pawn as a colour emoji.
const SOLID = { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' };
const OUTLINE = { k: '♔', q: '♕', r: '♖', b: '♗', n: '♘', p: '♙' };
const TEXT = '︎';
const PIECE = { k: 'king', q: 'queen', r: 'rook', b: 'bishop', n: 'knight', p: 'pawn' };
const SIDE = { w: 'White', b: 'Black' };
const TAKEN_ORDER = ['q', 'r', 'b', 'n', 'p'];
const ENDINGS = {
  checkmate: 'Checkmate', stalemate: 'Stalemate: a draw', repetition: 'Draw: same position three times',
  'fifty-move': 'Draw: fifty-move rule', material: 'Draw: not enough pieces to mate', mercy: 'Draw: move limit reached', resign: 'Resigned',
};
const FALLBACK = ['#C9962B', '#1C7C86'];

function Piece({ color, type, className = '', style }) {
  return (
    <span className={`chs__pc chs__pc--${color}${className}`} data-fill={SOLID[type] + TEXT} style={style} aria-hidden="true">
      {(color === 'w' ? OUTLINE[type] : SOLID[type]) + TEXT}
    </span>
  );
}

export default function Board({ G, moves, playerID, seats }) {
  const wrap = useRef(null);
  const cell = useFit(wrap, 8, 8);
  const [sel, setSel] = useState(null);
  const [promo, setPromo] = useState(null); // { from, to } while the picker is open

  const mySeat = playerID === null || playerID === undefined ? null : Number(playerID);
  const myColor = mySeat === null ? null : mySeat === 0 ? 'w' : 'b';
  const flipped = mySeat === 1; // Black sits at the bottom of their own board; spectators see White's view
  const myTurn = mySeat !== null && !G.over && String(G.turnP) === String(playerID);

  const pieces = useMemo(() => piecesOf(G.fen), [G.fen]);
  // One question to the rules per position, and only when it is this seat's move.
  const legal = useMemo(() => (myTurn ? legalMoves(G) : []), [G.fen, myTurn]); // eslint-disable-line react-hooks/exhaustive-deps
  const check = useMemo(() => inCheck(G), [G.fen]); // eslint-disable-line react-hooks/exhaustive-deps
  const toMove = G.fen.split(' ')[1];
  const last = lastOf(G, 'move');

  // A new position cancels a half-made choice (the opponent moved, or mine landed).
  useEffect(() => { setSel(null); setPromo(null); }, [G.fen]);

  const targets = new Map();
  if (sel) for (const m of legal) if (m.from === sel && !targets.has(m.to)) targets.set(m.to, m);

  const tap = (sq, piece) => {
    if (!myTurn) return;
    const hit = sel ? targets.get(sq) : null;
    if (hit) {
      if (hit.promotion) setPromo({ from: sel, to: sq });
      else { moves.move(sel, sq); setSel(null); }
      return;
    }
    setSel(piece && piece.color === myColor && sq !== sel ? sq : null);
  };

  const name = (seat) => (seat === mySeat ? 'You' : seats && seats[seat] && seats[seat].name ? seats[seat].name : SIDE[seat === 0 ? 'w' : 'b']);
  const hex = (seat) => (seats && seats[seat] && seats[seat].hex ? seats[seat].hex : FALLBACK[seat]);
  const taken = Array.isArray(G.taken) ? G.taken : [[], []];
  const [white, black] = material(G.fen);
  const lead = [white - black, black - white];

  const strip = (seat) => {
    const color = seat === 0 ? 'w' : 'b';
    const mine = (taken[seat] || []).slice().sort((a, b) => TAKEN_ORDER.indexOf(a) - TAKEN_ORDER.indexOf(b));
    return (
      <div className={`chs__strip${!G.over && Number(G.turnP) === seat ? ' chs__strip--turn' : ''}`} style={{ width: cell * 8 }}>
        <span className="chs__who truncate">
          <i className={`chs__chip chs__chip--${color}`}><Piece color={color} type="k" className=" chs__pc--mini" /></i>
          <i className="chs__swatch" style={{ background: hex(seat) }} />
          <b>{SIDE[color]}</b> {name(seat)}
        </span>
        <span className={`chs__taken${mine.length ? ' chs__taken--some' : ''}`} aria-label={`${SIDE[color]} has captured ${mine.length ? mine.map((t) => PIECE[t]).join(', ') : 'nothing'}`}>
          {mine.map((t, i) => <Piece key={i} color={color === 'w' ? 'b' : 'w'} type={t} className=" chs__pc--mini" />)}
          {lead[seat] > 0 && <b className="chs__lead">+{lead[seat]}</b>}
        </span>
      </div>
    );
  };

  const log = Array.isArray(G.log) ? G.log : [];
  const recent = log.filter((e) => e.t === 'move').slice(-6);
  const status = G.over ? ENDINGS[G.over.reason] || 'Game over' : check ? 'Check' : null;
  const hint = myTurn ? 'Tap a piece, then a marked square' : 'White moves first';

  const top = flipped ? 0 : 1;
  return (
    <div className="chs">
      <div className="chs__measure" ref={wrap} aria-hidden="true" />
      {cell > 0 && (
        <>
          {strip(top)}
          <div className="chs__board" style={{ width: cell * 8, height: cell * 8, '--cell': `${cell}px` }}>
            {Array.from({ length: 64 }, (_, v) => {
              // v walks the board as it is drawn; i is the same square in FEN order (a8 first).
              const i = flipped ? 63 - v : v;
              const sq = squareName(i);
              const piece = pieces[i];
              const dark = ((i >> 3) + (i & 7)) % 2 === 1;
              const target = targets.get(sq);
              const moved = last && (last.from === sq || last.to === sq);
              const checked = check && piece && piece.type === 'k' && piece.color === toMove;
              let slide = null;
              if (piece && last && last.to === sq) {
                const from = last.from.charCodeAt(0) - 97 + (8 - Number(last.from[1])) * 8;
                const f = flipped ? 63 - from : from;
                slide = { '--dx': (f & 7) - (v & 7), '--dy': (f >> 3) - (v >> 3) };
              }
              return (
                <button
                  key={sq} type="button" data-sq={sq}
                  className={`chs__sq chs__sq--${dark ? 'd' : 'l'}${moved ? ' chs__sq--last' : ''}${sel === sq ? ' chs__sq--sel' : ''}${checked ? ' chs__sq--check' : ''}${target ? ' chs__sq--target' : ''}`}
                  aria-label={`${sq}${piece ? `, ${SIDE[piece.color]} ${PIECE[piece.type]}` : ''}${target ? ', move here' : ''}`}
                  aria-pressed={sel === sq}
                  tabIndex={myTurn && ((piece && piece.color === myColor) || target) ? 0 : -1}
                  onClick={() => tap(sq, piece)}
                >
                  {(v & 7) === 0 && <span className="chs__rank">{sq[1]}</span>}
                  {(v >> 3) === 7 && <span className="chs__file">{sq[0]}</span>}
                  {piece && (
                    // Keyed on the log counter: the piece that just moved slides in once, a re-render never replays it.
                    <Piece key={slide ? `m${last.n}` : 's'} color={piece.color} type={piece.type} className={slide ? ' chs__pc--slide' : ''} style={slide || undefined} />
                  )}
                  {target && <span className={piece || target.flags.includes('e') ? 'chs__ring' : 'chs__dot'} />}
                </button>
              );
            })}
            {promo && (
              <div className="chs__promo" onClick={() => setPromo(null)}>
                <div className="chs__promo-box" role="dialog" aria-label="Choose a piece to promote to" onClick={(e) => e.stopPropagation()}>
                  <span className="chs__promo-title">Promote to</span>
                  <div className="chs__promo-row">
                    {PROMOTIONS.map((t) => (
                      <button key={t} type="button" className="chs__promo-btn" data-promo={t} aria-label={PIECE[t]} onClick={() => { moves.move(promo.from, promo.to, t); setPromo(null); setSel(null); }}>
                        <Piece color={myColor} type={t} />
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
          {strip(1 - top)}
          <div className="chs__moves" style={{ width: cell * 8 }} role="status">
            <span className="chs__sans">
              {recent.length === 0 && <span className="chs__hint">{hint}</span>}
              {recent.map((e, k) => (
                <span key={e.n} className={k === recent.length - 1 ? 'chs__san chs__san--new' : 'chs__san'}>
                  {e.ply % 2 === 1 ? <i>{(e.ply + 1) / 2}.</i> : k === 0 ? <i>{e.ply / 2}...</i> : null}{e.san}
                </span>
              ))}
            </span>
            {status && <b className={`chs__status${G.over ? ' chs__status--over' : ''}`}>{status}</b>}
          </div>
        </>
      )}
    </div>
  );
}
