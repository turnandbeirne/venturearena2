// VentureBoom(TM) board. Everything it offers comes from rules.js
// (legalActions, selectionActions, isLegal): the board never decides legality.
// It receives the stripped view for its seat, so it cannot show a card that
// seat is not allowed to know. Spectators (playerID null) get the public table.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  legalActions, selectionActions, exitOptions, exitValue, isBetweenRounds,
  CARD, BY_KEY, SETS, SET_IDS, TYPES, DYNAMICS, WORDMARK, MAKER_LINE, HOME_LINK,
  EXIT_NAMES, COMBO_NAMES, SURVIVAL_BONUS,
} from './rules.js';
import { useFit, useLogFeed, useToast } from '../../client/game/hooks.js';
import { fitHand } from './hand-layout.js';
import { artFor } from './art.js';
import { createSounds, soundFor } from './sounds.js';
import './board.css';

/** A seat with no Hard Pass has no choice to make: answer for it after a beat so the table never waits on it. */
const AUTO_LET_GO_MS = 600;
const LONG_PRESS_MS = 480;
const TYPE_ORDER = ['founder', 'unicorn', 'pivot', 'pass', 'hostile', 'ooo', 'research', 'reorg', 'mentor', 'boom'];
const BAND = { boom: 'BOOM', pivot: 'Save', pass: 'Reaction', unicorn: 'Wild', hostile: 'Action', ooo: 'Action', research: 'Action', reorg: 'Action', mentor: 'Action' };
const NAME_GROUPS = [
  { title: 'Action cards', keys: ['pivot', 'hard-pass', 'hostile-takeover', 'out-of-office', 'market-research', 'reorg', 'ask-a-mentor', 'unicorn'] },
];

const colorOf = (c) => (c.type === 'founder' ? SETS[c.set].color : TYPES[c.type].color);
const bandOf = (c) => (c.type === 'founder' ? SETS[c.set].name : BAND[c.type] || 'Action');
/** The line in an illustrated card's header: the founder's set, or what kind of card it is. */
const kindOf = (c) => (c.type === 'boom' ? TYPES.boom.label : bandOf(c));
/** A card's colour, lightened so it reads on the navy card frame. */
function tintOf(c) {
  const hex = colorOf(c).replace('#', '');
  const mix = (i) => Math.round(parseInt(hex.slice(i, i + 2), 16) * 0.42 + 255 * 0.58);
  return `rgb(${mix(0)}, ${mix(2)}, ${mix(4)})`;
}
const money = (v) => `$${v}M`;
const ordinal = (n) => (n === 1 ? '1st' : n === 2 ? '2nd' : n === 3 ? '3rd' : `${n}th`);

function sortHand(hand) {
  return hand.slice().sort((a, b) => {
    const A = CARD[a], B = CARD[b];
    const t = TYPE_ORDER.indexOf(A.type) - TYPE_ORDER.indexOf(B.type);
    if (t) return t;
    if (A.type === 'founder' && A.set !== B.set) return SET_IDS.indexOf(A.set) - SET_IDS.indexOf(B.set);
    return A.name.localeCompare(B.name) || a.localeCompare(b);
  });
}

/** Tap, or press and hold for the card's details. */
function usePress(onTap, onLong) {
  const timer = useRef(null);
  const fired = useRef(false);
  useEffect(() => () => clearTimeout(timer.current), []);
  const stop = () => clearTimeout(timer.current);
  return {
    onPointerDown: () => { fired.current = false; stop(); if (onLong) timer.current = setTimeout(() => { fired.current = true; onLong(); }, LONG_PRESS_MS); },
    onPointerUp: stop, onPointerLeave: stop, onPointerCancel: stop,
    onContextMenu: (e) => { if (onLong) e.preventDefault(); },
    onClick: () => { if (fired.current) { fired.current = false; return; } if (onTap) onTap(); },
  };
}

/**
 * A card face. With an illustration (art.js) it is the owner's card frame,
 * with the kind of card in its blank header and the name on a plate at the
 * bottom; without one it is drawn entirely in CSS: colour band + icon,
 * initials, name, rule line. The text is always drawn here, never baked into
 * a picture, so it stays sharp at every size and can be edited.
 */
function CardFace({ card, selected = false, fresh = null, have = null, onTap, onLong, label, dim = false }) {
  const press = usePress(onTap, onLong);
  const art = artFor(card);
  const cls = `vb__card vb__card--${card.type}${art ? ' vb__card--art' : ''}${selected ? ' vb__card--sel' : ''}${fresh ? ' vb__card--new' : ''}${dim ? ' vb__card--dim' : ''}`;
  const pips = card.type === 'founder' && have !== null
    ? <span className="vb__card-pips" aria-label={`${have} of 5 in hand`}>{[0, 1, 2, 3, 4].map((i) => <i key={i} className={i < have ? 'on' : ''} />)}</span>
    : null;
  const check = selected && <span className="vb__card-check" aria-hidden="true">{'✓'}</span>;
  const body = art ? (
    <>
      <img className="vb__card-img" src={art.sm} alt="" draggable={false} decoding="async" />
      <span className="vb__card-kind"><span aria-hidden="true">{card.icon}</span><span className="vb__card-kindtext">{kindOf(card)}</span></span>
      <span className="vb__card-plate">
        <span className="vb__card-pname">{card.name}</span>
        {card.type === 'founder' ? pips : <span className="vb__card-prule">{card.short}</span>}
      </span>
      {check}
    </>
  ) : (
    <>
      <span className="vb__card-band"><span className="vb__card-bandicon" aria-hidden="true">{card.icon}</span><span className="vb__card-bandtext">{bandOf(card)}</span></span>
      <span className="vb__card-art" aria-hidden="true">{card.type === 'founder' ? initials(card.name) : card.icon}</span>
      <span className="vb__card-name">{card.name}</span>
      {card.type === 'founder' ? pips : <span className="vb__card-rule">{card.short}</span>}
      {check}
    </>
  );
  const style = { '--c': colorOf(card), '--t': tintOf(card) };
  if (!onTap && !onLong) return <span className={cls} style={style}>{body}</span>;
  return <button type="button" key={fresh || 'card'} className={cls} style={style} aria-pressed={selected} aria-label={label || card.name} {...press}>{body}</button>;
}

/** The small "?" in a card's description: the real founder, business move or startup event behind it. */
function RealStory({ card }) {
  return (
    <a className="vb__q" href={card.link} target="_blank" rel="noopener noreferrer" title="The real-world story" aria-label={`The real-world story behind ${card.name} (opens in a new tab)`}>?</a>
  );
}

/**
 * The opened card: the illustration exactly as it was drawn, nothing covering
 * the art. Kind and name in the header, the full rule in the footer beside
 * the logo, with the "?" that leads to the real story.
 */
function BigCard({ card }) {
  const art = artFor(card);
  // Long names shrink to stay on one line: 18 characters fit at full size.
  const fit = Math.min(1, 18 / card.name.length);
  return (
    <div className="vb__big" style={{ '--c': colorOf(card), '--t': tintOf(card), '--fit': fit }}>
      <img className="vb__big-img" src={art.lg} alt="" draggable={false} />
      <div className="vb__big-head">
        <span className="vb__big-kind"><span aria-hidden="true">{card.icon}</span> {kindOf(card)}</span>
        <span className="vb__big-name">{card.name}</span>
      </div>
      <div className="vb__big-foot"><span className="vb__big-rule">{card.rule} <RealStory card={card} /></span></div>
    </div>
  );
}

function initials(name) {
  const parts = name.replace(/['’]/g, '').split(/[\s-]+/).filter(Boolean);
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

function CardBack({ count = null, label }) {
  const art = artFor('back');
  // The back of the deck as drawn: an explosion with a blank centre, which is
  // where the number of cards left goes.
  if (art) {
    return (
      <span className="vb__card vb__card--back vb__card--backart" aria-label={label}>
        <img className="vb__card-img" src={art.sm} alt="" draggable={false} />
        {count !== null && <span className="vb__back-count">{count}</span>}
      </span>
    );
  }
  return (
    <span className="vb__card vb__card--back" aria-label={label}>
      <span className="vb__back-boom" aria-hidden="true">{'\u{1F4A5}'}</span>
      <span className="vb__back-mark">{WORDMARK}</span>
      {count !== null && <span className="vb__back-count">{count}</span>}
    </span>
  );
}

/** A card as a one-line chip: icon + name. A button when it opens something. */
function Chip({ card, onTap, n = null, compact = false }) {
  const text = compact && card.type === 'founder' ? initials(card.name) : card.name;
  const inner = <>{n !== null && <span className="vb__chip-n">{n}</span>}<span aria-hidden="true">{card.icon}</span><span className="vb__chip-name" title={card.name}>{text}</span></>;
  const style = { '--c': colorOf(card) };
  if (!onTap) return <span className="vb__chip" style={style}>{inner}</span>;
  return <button type="button" className="vb__chip vb__chip--btn" style={style} onClick={onTap}>{inner}</button>;
}

function Sheet({ title, onClose, children, locked = false }) {
  return (
    <div className="vb__veil" onClick={locked ? undefined : onClose}>
      <div className="vb__sheet" role="dialog" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="vb__sheet-head"><h3>{title}</h3>{!locked && <button type="button" className="vb__x" onClick={onClose} aria-label="Close">{'✕'}</button>}</div>
        <div className="vb__sheet-body">{children}</div>
      </div>
    </div>
  );
}

export default function Board({ G, moves, playerID, seats }) {
  const wrap = useRef(null);
  // The board is laid out on a 12 x 17 grid of the space it is given; every
  // card and font size derives from one cell, so it fits a phone and a laptop.
  const unit = useFit(wrap, 12, 17, { max: 40, min: 22 });
  const mySeat = playerID === null || playerID === undefined ? null : Number(playerID);
  const me = mySeat !== null && G.players ? G.players[String(mySeat)] || null : null;
  const n = G.n;
  const p = G.pending;
  const waiting = Array.isArray(G.waiting) ? G.waiting : [];
  const log = Array.isArray(G.log) ? G.log : [];

  const [sel, setSel] = useState([]);
  const [sheet, setSheet] = useState(null);
  const [boomFx, setBoomFx] = useState(null);
  const [recap, setRecap] = useState(() => (G.summary && !G.over ? { ...G.summary, n: 0 } : null));
  const [placeAt, setPlaceAt] = useState(0);
  const [toast, showToast] = useToast(3200);

  // Sounds (sounds.js). Browsers refuse audio until the person has touched
  // the page, so the first tap, click or key press anywhere unlocks it.
  const sounds = useMemo(() => createSounds(), []);
  const [muted, setMuted] = useState(sounds.muted);
  useEffect(() => {
    const unlock = () => sounds.unlock();
    window.addEventListener('pointerdown', unlock, { passive: true });
    window.addEventListener('keydown', unlock);
    return () => { window.removeEventListener('pointerdown', unlock); window.removeEventListener('keydown', unlock); sounds.close(); };
  }, [sounds]);
  const toggleSound = () => { const next = !muted; sounds.setMuted(next); setMuted(next); if (!next) { sounds.unlock(); sounds.play('blip'); } };

  const nm = (s) => (s === mySeat ? 'You' : seats[s] ? seats[s].name : `Seat ${s + 1}`);
  const hex = (s) => (seats[s] ? seats[s].hex : '#8a97b5');
  const cardName = (k) => (BY_KEY[k] ? BY_KEY[k].name : k);

  const hand = useMemo(() => (me ? sortHand(me.hand) : []), [me]);

  // Every card in the hand is on screen at once (hand-layout.js). The space
  // is measured, not assumed: everything else on the board keeps its height,
  // the table gives up what it can spare down to its minimum, and the hand
  // gets the rest. Re-measured after every render (the action bar and the
  // private strip change height) and when the board is resized.
  const tableRef = useRef(null);
  const handRef = useRef(null);
  const [handFit, setHandFit] = useState(null);
  const measureHand = useCallback(() => {
    const root = wrap.current; const handEl = handRef.current; const tableEl = tableRef.current;
    if (!root || !handEl || !tableEl || !unit) return;
    const px = (v) => parseFloat(v) || 0;
    const hs = getComputedStyle(handEl);
    let others = 0; let inFlow = 0;
    for (const c of root.children) {
      const pos = getComputedStyle(c).position;
      if (pos === 'absolute' || pos === 'fixed' || c.offsetHeight === 0) continue;
      inFlow += 1;
      if (c !== handEl && c !== tableEl) others += c.offsetHeight;
    }
    const gapY = px(getComputedStyle(root).rowGap);
    const height = root.clientHeight - others - gapY * Math.max(0, inFlow - 1) - px(getComputedStyle(tableEl).minHeight) - px(hs.paddingTop) - px(hs.paddingBottom);
    const width = handEl.clientWidth - px(hs.paddingLeft) - px(hs.paddingRight);
    // "Roomy": the table at 6.2 cells, enough for the piles and the Exit strip.
    const roomy = height - Math.max(0, unit * 6.2 - px(getComputedStyle(tableEl).minHeight));
    const next = fitHand({ n: hand.length, width, height, roomy, maxW: unit * 2.9 });
    setHandFit((prev) => (prev && prev.w === next.w && prev.perRow === next.perRow && prev.rows === next.rows && prev.scroll === next.scroll ? prev : next));
  }, [unit, hand.length]);
  useLayoutEffect(() => { measureHand(); });
  useLayoutEffect(() => {
    if (!wrap.current) return undefined;
    const ro = new ResizeObserver(() => measureHand());
    ro.observe(wrap.current);
    return () => ro.disconnect();
  }, [measureHand]);
  const selected = sel.filter((id) => hand.includes(id));
  const acts = useMemo(() => (mySeat === null ? [] : legalActions(G, mySeat)), [G, mySeat]);
  const selActs = useMemo(() => (mySeat === null ? [] : selectionActions(G, mySeat, selected)), [G, mySeat, selected.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps
  const can = (move) => acts.some((a) => a.move === move);
  const myTurn = can('draw');

  // Your turn, and the end of the game, have no log entry of their own: they
  // sound when the fact changes, never on the first render (a refresh
  // mid-turn must not chime).
  const wasMyTurn = useRef(null);
  useEffect(() => {
    if (wasMyTurn.current === false && myTurn) sounds.queue('turn');
    wasMyTurn.current = myTurn;
  }, [myTurn, sounds]);
  const wasOver = useRef(null);
  const isOver = !!G.over;
  useEffect(() => {
    if (wasOver.current === false && isOver) {
      const place = G.over && Array.isArray(G.over.placements) && mySeat !== null ? G.over.placements[mySeat] : null;
      sounds.queue(place === 1 || mySeat === null ? 'win' : 'lose');
    }
    wasOver.current = isOver;
  }, [isOver]); // eslint-disable-line react-hooks/exhaustive-deps
  // The BOOM pictures are only seen for a second and a half: have them ready.
  useEffect(() => { for (const c of Object.values(BY_KEY)) { if (c.type === 'boom' && artFor(c.key)) { const im = new Image(); im.src = artFor(c.key).sm; } } }, []);
  const owe = mySeat !== null && !!p && waiting.includes(mySeat);
  const stage = owe ? p.stage : null;
  const canPass = stage === 'react' && acts.some((a) => a.move === 'react' && a.args[0] === true);
  const setCount = useMemo(() => {
    const out = {};
    for (const id of hand) if (CARD[id].type === 'founder') out[CARD[id].set] = (out[CARD[id].set] || 0) + 1;
    return out;
  }, [hand]);

  // --- things that happen once per log entry (never on a re-render) ----------
  useLogFeed(G, (e) => {
    const snd = soundFor(e, mySeat);
    if (snd) sounds.queue(snd);
    if (e.t === 'boom') setBoomFx({ n: e.n, k: e.k, p: e.p, out: null });
    else if (e.t === 'pivot') setBoomFx((f) => (f ? { ...f, out: 'pivot' } : f));
    else if (e.t === 'bust') setBoomFx((f) => (f ? { ...f, out: 'bust' } : f));
    else if (e.t === 'round') setRecap(e);
    else if (e.t === 'deal') { setSel([]); setSheet((s) => (s && s.kind === 'detail' ? s : null)); }
  });
  useEffect(() => {
    if (!boomFx) return undefined;
    // A survived BOOM is a beat; a bankruptcy gets a longer look.
    const t = setTimeout(() => setBoomFx(null), boomFx.out === 'bust' ? 2300 : 1500);
    return () => clearTimeout(t);
  }, [boomFx && boomFx.n, boomFx && boomFx.out]); // eslint-disable-line react-hooks/exhaustive-deps

  // A private line (which card you drew, gave or lost), keyed by its own counter.
  const noteN = me && me.note ? me.note.n : 0;
  const seenNote = useRef(null);
  useEffect(() => {
    if (seenNote.current === null) { seenNote.current = noteN; return; }
    if (noteN <= seenNote.current || !me || !me.note) return;
    seenNote.current = noteN;
    const o = me.note;
    const name = cardName(o.k);
    if (o.t === 'drew') showToast(`You drew ${name}`, `n${o.n}`);
    else if (o.t === 'got') showToast(o.how === 'poach' ? `You poached ${name} from ${nm(o.from)}` : `${nm(o.from)} handed you ${name}`, `n${o.n}`);
    else if (o.t === 'lost') showToast(o.how === 'poach' ? `${nm(o.to)} poached your ${name}` : `You gave ${name} to ${nm(o.to)}`, `n${o.n}`);
  }, [noteN]); // eslint-disable-line react-hooks/exhaustive-deps
  const freshKey = me && me.note && me.note.t !== 'lost' ? me.note.k : null;
  const freshId = freshKey ? [...(me ? me.hand : [])].reverse().find((id) => CARD[id].key === freshKey) : null;

  // The summary stays up until dismissed; once the next round is under way it closes itself.
  const recapStale = !!recap && !G.over && (!G.summary || G.summary.round !== recap.round);
  const recapClosing = recapStale && !boomFx;
  useEffect(() => {
    if (!recapClosing) return undefined;
    const t = setTimeout(() => setRecap(null), 5000);
    return () => clearTimeout(t);
  }, [recapClosing]);

  // No Hard Pass in hand: there is nothing to decide, so let it go automatically.
  const autoKey = stage === 'react' && !canPass ? `${p.id}:${p.passes}` : null;
  useEffect(() => {
    if (!autoKey) return undefined;
    const [id, passes] = autoKey.split(':').map(Number);
    const send = () => moves.react(false, id, passes);
    const first = setTimeout(send, AUTO_LET_GO_MS);
    const again = setInterval(send, 3000); // an answer lost on the way is sent again
    return () => { clearTimeout(first); clearInterval(again); };
  }, [autoKey, moves]);

  // Choices that are mine alone open their own sheet.
  const deckCount = G.deckCount || 0;
  const stageKey = stage === 'place' || stage === 'pick' ? `${stage}:${p.id}` : null;
  useEffect(() => {
    if (!stageKey) return;
    setPlaceAt(Math.min(deckCount, 2));
    setSheet(null);
  }, [stageKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (id) => { sounds.play('tick'); setSel((cur) => { const c = cur.filter((x) => hand.includes(x)); return c.includes(id) ? c.filter((x) => x !== id) : [...c, id]; }); };
  const detail = (card) => setSheet({ kind: 'detail', id: card.id });
  const send = (fn) => { fn(); setSel([]); setSheet(null); };

  const run = (a, target = null, named = null) => {
    if (a.needsTarget && target === null) { setSheet({ kind: 'target', action: a, cards: selected.slice() }); return; }
    if (a.needsName && named === null) { setSheet({ kind: 'name', action: a, target, cards: selected.slice() }); return; }
    const cards = (sheet && sheet.cards) || selected;
    if (a.move === 'play') send(() => (a.needsTarget ? moves.play(cards[0], target) : moves.play(cards[0])));
    else if (a.move === 'exit') send(() => moves.exit(a.kind, cards));
    else if (a.kind === 'review') send(() => moves.combo('review', cards));
    else if (a.kind === 'poach') send(() => moves.combo('poach', cards, target));
    else send(() => moves.combo('acquihire', cards, target, named));
  };
  const actLabel = (a) => (a.move === 'exit' ? `${EXIT_NAMES[a.kind]} +${money(a.value)}` : a.move === 'play' ? `Play ${TYPES[a.kind].label}` : COMBO_NAMES[a.kind]);

  // --- the story so far, in the table's words ---------------------------------
  const say = (e) => {
    switch (e.t) {
      case 'deal': return `Quarter ${e.round} dealt. ${nm(e.first)} to start.${e.hot ? ' Hot Market: Exits pay double.' : ''}`;
      case 'play': return `${nm(e.p)} played ${cardName(e.k)}${e.k === 'ask-a-mentor' ? ` on ${nm(e.to)}` : ''}`;
      case 'combo': return e.k === 'poach' ? `${nm(e.p)} played a Poach on ${nm(e.to)}` : e.k === 'acquihire' ? `${nm(e.p)} called an Acqui-hire on ${nm(e.to)} for ${cardName(e.named)}` : `${nm(e.p)} called a Portfolio Review`;
      case 'offer': return `${nm(e.p)} laid down a ${EXIT_NAMES[e.k]} (${money(e.value)})`;
      case 'pass': return `${nm(e.p)} played a Hard Pass!`;
      case 'cancel': return e.kind === 'exit' ? 'The deal fell through: its cards go to the discard pile' : 'Stopped by a Hard Pass';
      case 'exit': return `${nm(e.p)} banked a ${EXIT_NAMES[e.k]}: +${money(e.value)}`;
      case 'attack': return `Hostile Takeover: ${nm(e.to)} must take ${e.turns} turns`;
      case 'skip': return `${nm(e.p)} went Out of Office: no draw`;
      case 'peek': return `${nm(e.p)} looked at the top ${e.c} card${e.c === 1 ? '' : 's'}`;
      case 'shuffle': return `${nm(e.p)} shuffled the draw pile`;
      case 'ask': return `${nm(e.to)} must hand ${nm(e.p)} a card`;
      case 'gave': return e.ok ? `${nm(e.p)} handed ${nm(e.to)} a card` : `${nm(e.p)} had no card to give`;
      case 'steal': return e.ok ? `${nm(e.p)} poached a card from ${nm(e.from)}` : `${nm(e.from)} had nothing to poach`;
      case 'hire': return e.ok ? `${nm(e.from)} handed over ${cardName(e.named)}` : `${nm(e.from)} had no ${cardName(e.named)}`;
      case 'review': return `${nm(e.p)} searched the discard pile`;
      case 'took': return `${nm(e.p)} took ${cardName(e.k)} from the discard pile`;
      case 'draw': return `${nm(e.p)} drew a card`;
      case 'boom': return `${nm(e.p)} drew a BOOM: ${cardName(e.k)}!`;
      case 'pivot': return `${nm(e.p)} pivoted and survived`;
      case 'placed': return `${nm(e.p)} slid the BOOM back into the pile`;
      case 'bust': return `${nm(e.p)} went bankrupt`;
      case 'round': return `Quarter ${e.round} closed`;
      case 'refill': return 'The discards were shuffled into the draw pile';
      default: return null;
    }
  };
  const feed = [];
  for (let i = log.length - 1; i >= 0 && feed.length < 3; i--) { const text = say(log[i]); if (text) feed.unshift({ n: log[i].n, text, t: log[i].t }); }

  const allExits = [];
  for (let s = 0; s < n; s++) (G.exits[s] || []).forEach((e, i) => allExits.push({ key: `${s}:${i}`, seat: s, kind: e.kind, set: e.set, value: e.value }));
  const top = G.discard && G.discard.length ? CARD[G.discard[G.discard.length - 1]] : null;
  const booms = Math.max(0, n - 1);
  const lastDraw = [...log].reverse().find((e) => e.t === 'draw' || e.t === 'boom' || e.t === 'deal');

  const pendingLine = () => {
    if (!p) return null;
    if (p.stage === 'give') return owe ? `${nm(p.by)} asked you for a card. Tap one, then give it.` : `${nm(p.target)} is choosing a card for ${nm(p.by)}`;
    if (p.stage === 'place') return owe ? 'You pivoted! Slide the BOOM back into the pile.' : `${nm(p.by)} pivoted and is hiding the BOOM in the pile`;
    if (p.stage === 'pick') return owe ? 'Portfolio Review: take a card from the discard pile.' : `${nm(p.by)} is choosing from the discard pile`;
    const who = nm(p.by);
    if (p.kind === 'exit') return `${who}: ${EXIT_NAMES[p.what]}${p.set ? ` (${SETS[p.set].name})` : ''} for ${money(p.value)}`;
    if (p.what === 'poach') return `${who}: Poach on ${nm(p.target)}`;
    if (p.what === 'acquihire') return `${who}: Acqui-hire on ${nm(p.target)} for ${cardName(p.named)}`;
    if (p.what === 'review') return `${who}: Portfolio Review`;
    return `${who}: ${cardName(p.k)}${p.target !== null && p.target !== undefined ? ` on ${nm(p.target)}` : ''}`;
  };

  const standing = useMemo(() => {
    const order = Array.from({ length: n }, (_, i) => i);
    if (G.over && Array.isArray(G.over.placements)) return order.sort((a, b) => G.over.placements[a] - G.over.placements[b] || a - b);
    return order.sort((a, b) => G.scores[b] - G.scores[a] || a - b);
  }, [G.over, G.scores, n]);

  const suggestions = myTurn && !selected.length ? exitOptions(hand).filter((o, i, all) => all.findIndex((x) => x.set === o.set) === i).slice(0, 3) : [];
  const give = stage === 'give' && selected.length === 1 ? selected[0] : null;
  const hint = () => {
    if (stage === 'give') return give ? '' : 'Tap the card you will give away.';
    if (!myTurn) return G.turnP !== null && G.turnP !== undefined && !p ? `${nm(Number(G.turnP))} ${Number(G.turnP) === mySeat ? 'are' : 'is'} up` : '';
    if (!selected.length) return suggestions.length ? '' : 'Play cards, or draw to end your turn.';
    if (selActs.length) return '';
    if (selected.length === 1) {
      const t = CARD[selected[0]].type;
      if (t === 'pivot') return 'A Pivot plays itself when you draw a BOOM.';
      if (t === 'pass') return 'A Hard Pass is played when someone else acts.';
      if (t === 'mentor') return 'Nobody has a card to give.';
      return 'Founders work in sets: add more from the same set.';
    }
    return 'These cards do not make a combo or an Exit.';
  };

  return (
    <div className="vb" ref={wrap} style={{ '--u': `${unit || 28}px` }} data-turn={myTurn ? '1' : '0'} data-compact={(unit || 28) * 2.9 < 80 ? '1' : undefined}>
      {/* round, variant and the wordmark */}
      <div className="vb__top">
        <span className="vb__round">Quarter <b>{G.round}</b> / {G.rounds}</span>
        {G.hot && <span className="vb__tag vb__tag--hot">{'\u{1F525}'} Hot Market x2</span>}
        {G.kids && <span className="vb__tag">Kids</span>}
        <span className="vb__brand"><b>{WORDMARK}</b> <span>{MAKER_LINE}</span></span>
      </div>

      {/* everyone at a glance */}
      <div className={`vb__scores vb__scores--${n <= 4 ? n : 3}`}>
        {Array.from({ length: n }, (_, s) => {
          const turn = !G.over && G.turnP !== null && G.turnP !== undefined && Number(G.turnP) === s;
          return (
            <button type="button" key={s} className={`vb__seat${turn ? ' vb__seat--turn' : ''}${waiting.includes(s) ? ' vb__seat--wait' : ''}`} style={{ '--seat': hex(s) }} onClick={() => setSheet({ kind: 'player', seat: s })} aria-label={`${nm(s)}: ${money(G.scores[s])}, ${G.counts[s]} cards, ${G.bankruptcies[s]} bankruptcies`}>
              <span className="vb__seat-name">{turn && <i aria-hidden="true">{'▶'}</i>}{nm(s)}</span>
              <span className="vb__seat-meta">
                <span className="vb__seat-score">{money(G.scores[s])}</span>
                <span title="Cards in hand">{'\u{1F0CF}'}{G.counts[s]}</span>
                {(G.exits[s] || []).length > 0 && <span title="Exits this quarter">{'\u2B50'}{G.exits[s].length}</span>}
                {G.bankruptcies[s] > 0 && <span title="Bankruptcies">{'\u{1F4A5}'}{G.bankruptcies[s]}</span>}
                {turn && G.turnsLeft > 1 && <span className="vb__seat-turns" title="Turns owed">x{G.turnsLeft}</span>}
              </span>
            </button>
          );
        })}
      </div>

      {/* the table: draw pile, discard pile, what just happened */}
      <div className="vb__table" ref={tableRef}>
        <button type="button" className="vb__sound" onClick={toggleSound} aria-pressed={!muted} aria-label={muted ? 'Turn sounds on' : 'Mute sounds'} title={muted ? 'Sounds are off' : 'Sounds are on'}>
          <span aria-hidden="true">{muted ? '\u{1F507}' : '\u{1F50A}'}</span>
        </button>
        <div className="vb__table-main">
        <div className="vb__piles">
          <button type="button" className={`vb__pile${myTurn ? ' vb__pile--live' : ''}`} disabled={!myTurn} onClick={() => send(() => moves.draw())} aria-label={myTurn ? `Draw a card and end your turn. ${deckCount} cards in the pile.` : `Draw pile: ${deckCount} cards`}>
            <span key={lastDraw ? `d${lastDraw.n}` : 'd'} className="vb__pile-card vb__pile-card--deck"><CardBack count={deckCount} label="" /></span>
            <span className="vb__pile-cap">{'\u{1F4A5}'} {booms} in {deckCount}</span>
          </button>
          <button type="button" className="vb__pile" disabled={!top} onClick={() => setSheet({ kind: 'discard' })} aria-label={top ? `Discard pile, ${G.discard.length} cards. Top: ${top.name}` : 'Discard pile: empty'}>
            <span key={top ? `t${G.discard.length}${top.id}` : 't'} className="vb__pile-card vb__pile-card--top">{top ? <CardFace card={top} /> : <span className="vb__card vb__card--empty">Discard</span>}</span>
            <span className="vb__pile-cap">Discards: {G.discard ? G.discard.length : 0}</span>
          </button>
        </div>
        <div className={`vb__side${p ? ' vb__side--busy' : ''}`}>
          <div className="vb__feed" role="log" aria-live="polite">
            {!p && feed.slice(toast ? -2 : -3).map((f) => <div key={f.n} className={`vb__line vb__line--${f.t}`}>{f.text}</div>)}
            {toast && <div key={toast.key} className="vb__note">{'\u{1F512}'} {toast.text}</div>}
          </div>
          {/* an action waiting for Hard Passes, or for somebody's choice */}
          {p && (
            <div className={`vb__pending${owe ? ' vb__pending--me' : ''}`} key={`${p.id}:${p.stage}`}>
              <div className="vb__pending-text">
                <b>{pendingLine()}</b>
                {p.stage === 'react' && (
                  <span className="vb__pending-sub">
                    {p.passes > 0 ? `${p.passes} Hard Pass${p.passes === 1 ? '' : 'es'}: ${p.passes % 2 ? 'stopped as it stands' : 'back on'}. ` : ''}
                    {owe ? (canPass ? 'Stop it with a Hard Pass?' : 'No Hard Pass in hand: letting it go.') : `Waiting for ${waiting.length} answer${waiting.length === 1 ? '' : 's'}`}
                  </span>
                )}
              </div>
              {p.stage === 'react' && p.kind !== 'card' && p.shown && p.shown.length > 0 && !(stage === 'react' && canPass) && (
                <div className="vb__pending-cards">{p.shown.map((k, i) => (BY_KEY[k] ? <Chip key={`${k}${i}`} card={BY_KEY[k]} compact /> : null))}</div>
              )}
              {stage === 'react' && canPass && (
                <div className="vb__pending-btns">
                  <button type="button" className="vb__btn vb__btn--stop" onClick={() => moves.react(true, p.id, p.passes)}>{'\u{1F6AB}'} Hard Pass</button>
                  <button type="button" className="vb__btn" onClick={() => moves.react(false, p.id, p.passes)}>Let it go</button>
                </div>
              )}
            </div>
          )}
        </div>
        </div>
        {/* every player's Exit area, when the table has room for it (see board.css) */}
        <div className="vb__areas" aria-label="Exits on the table this quarter">
          <span className="vb__areas-title">Exits this quarter</span>
          {allExits.length === 0 && <span className="vb__areas-none">None yet. Bank three or more founders from one set, or one from each.</span>}
          {allExits.map((e) => (
            <span key={e.key} className="vb__chip vb__chip--exit" style={{ '--c': hex(e.seat) }}>{'\u2B50'} <span className="vb__chip-name">{nm(e.seat)}: {EXIT_NAMES[e.kind]}{e.set ? ` (${SETS[e.set].name})` : ''} {money(e.value)}</span></span>
          ))}
        </div>
      </div>

      {boomFx && (
        <div key={boomFx.n} className={`vb__boom${boomFx.out ? ` vb__boom--${boomFx.out}` : ''}`} role="alert">
          {artFor(boomFx.k)
            ? <img className="vb__boom-card" src={artFor(boomFx.k).sm} alt="" draggable={false} />
            : <div className="vb__boom-burst" aria-hidden="true">{'\u{1F4A5}'}</div>}
          <div className="vb__boom-word">BOOM!</div>
          <div className="vb__boom-name">{cardName(boomFx.k)}</div>
          <div className="vb__boom-out">{boomFx.out === 'pivot' ? `${nm(boomFx.p)} pivoted. Saved!` : boomFx.out === 'bust' ? `${nm(boomFx.p)} went bankrupt` : `${nm(boomFx.p)} drew it`}</div>
        </div>
      )}

      {/* only you see this: what Market Research showed you, and your Exits */}
      {me && ((me.peek && me.peek.length > 0) || (me.boomAt !== null && me.boomAt !== undefined) || (G.exits[mySeat] || []).length > 0) && (
        <div className="vb__mine">
          {me.peek && me.peek.length > 0 && (
            <div className="vb__mine-group">
              <span className="vb__mine-label">{'\u{1F50D}'} Next up{me.stale ? ' (may have moved)' : ''}</span>
              {me.peek.map((id, i) => <Chip key={id} card={CARD[id]} n={i + 1} onTap={() => detail(CARD[id])} />)}
            </div>
          )}
          {me.boomAt !== null && me.boomAt !== undefined && (
            <div className="vb__mine-group"><span className="vb__mine-label">{'\u{1F4A5}'} Your BOOM: {me.boomAt === 0 ? 'on top' : `${me.boomAt} down`}{me.stale ? ' (roughly)' : ''}</span></div>
          )}
          {(G.exits[mySeat] || []).length > 0 && (
            <div className="vb__mine-group">
              <button type="button" className="vb__chip vb__chip--btn vb__chip--exit" onClick={() => setSheet({ kind: 'player', seat: mySeat })}>
                {'⭐'} <span className="vb__chip-name">Your Exits: {money(G.exits[mySeat].reduce((a, e) => a + e.value, 0))}</span>
              </button>
            </div>
          )}
        </div>
      )}

      {/* your hand */}
      {me ? (
        <div
          className={`vb__hand${handFit && handFit.scroll ? ' vb__hand--scroll' : ''}`} ref={handRef} aria-label="Your hand" data-rows={handFit ? handFit.rows : 1} data-small={handFit && handFit.w < 80 ? '1' : undefined}
          style={handFit ? { '--hand-w': `${handFit.w}px`, '--hand-cols': handFit.perRow } : undefined}
        >
          {hand.map((id) => (
            <CardFace
              key={id} card={CARD[id]} selected={selected.includes(id)} fresh={id === freshId ? `f${noteN}` : null}
              have={CARD[id].type === 'founder' ? setCount[CARD[id].set] : null}
              onTap={() => toggle(id)} onLong={() => detail(CARD[id])}
              label={`${CARD[id].name}${selected.includes(id) ? ', selected' : ''}`}
            />
          ))}
          {!hand.length && <div className="vb__empty">No cards in hand.</div>}
        </div>
      ) : (
        <div className="vb__watch">
          <span className="vb__watch-note">You are watching. Hands are hidden: tap a player to see their Exits.</span>
        </div>
      )}

      {/* exactly what the selection can legally do */}
      {me && (
        <div className="vb__bar">
          <div className="vb__bar-acts">
            {selected.length > 0 && <button type="button" className="vb__btn vb__btn--ghost" onClick={() => setSel([])} aria-label="Clear selection">{'✕'}</button>}
            {selected.length === 1 && <button type="button" className="vb__btn vb__btn--ghost" onClick={() => detail(CARD[selected[0]])} aria-label="Card details">{'ℹ'} Info</button>}
            {give && <button type="button" className="vb__btn vb__btn--gold" onClick={() => send(() => moves.give(give))}>Give {CARD[give].name}</button>}
            {selActs.map((a) => (
              <button type="button" key={`${a.move}:${a.kind}`} className={`vb__btn${a.move === 'exit' ? ' vb__btn--gold' : ' vb__btn--act'}`} onClick={() => run(a)}>{actLabel(a)}</button>
            ))}
            {suggestions.map((o) => (
              <button type="button" key={`${o.kind}:${o.set}`} className="vb__btn vb__btn--hint" onClick={() => setSel(o.cards)}>{'⭐'} {EXIT_NAMES[o.kind]} {money(exitValue(o.kind, G))}</button>
            ))}
            {hint() && <span className="vb__bar-hint">{hint()}</span>}
          </div>
          {myTurn && <button type="button" className={`vb__btn vb__btn--draw${selected.length ? '' : ' vb__btn--gold'}`} onClick={() => send(() => moves.draw())}>Draw{G.turnsLeft > 1 ? ` (${G.turnsLeft} turns)` : ''}</button>}
        </div>
      )}

      {/* ---- sheets ---------------------------------------------------------- */}
      {sheet && sheet.kind === 'detail' && CARD[sheet.id] && <Detail card={CARD[sheet.id]} onClose={() => setSheet(null)} />}

      {sheet && sheet.kind === 'target' && (
        <Sheet title={`${actLabel(sheet.action)}: who?`} onClose={() => setSheet(null)}>
          <div className="vb__list">
            {sheet.action.targets.map((s) => (
              <button type="button" key={s} className="vb__row" style={{ '--seat': hex(s) }} onClick={() => run(sheet.action, s)}>
                <span className="vb__row-dot" /><span className="vb__row-name">{nm(s)}</span><span className="vb__row-meta">{G.counts[s]} card{G.counts[s] === 1 ? '' : 's'} {'·'} {money(G.scores[s])}</span>
              </button>
            ))}
          </div>
          <DynamicLink d={sheet.action.move === 'combo' ? DYNAMICS[sheet.action.kind] : null} />
        </Sheet>
      )}

      {sheet && sheet.kind === 'name' && (
        <Sheet title={`Name the card you want from ${nm(sheet.target)}`} onClose={() => setSheet(null)}>
          {[...NAME_GROUPS, ...SET_IDS.map((s) => ({ title: `${SETS[s].icon} ${SETS[s].name}`, keys: Object.values(BY_KEY).filter((c) => c.set === s).map((c) => c.key) }))].map((g) => (
            <div key={g.title} className="vb__names">
              <div className="vb__names-title">{g.title}</div>
              <div className="vb__names-grid">
                {g.keys.filter((k) => BY_KEY[k] && !(G.kids && k === 'hostile-takeover')).map((k) => (
                  <button type="button" key={k} className="vb__namebtn" style={{ '--c': colorOf(BY_KEY[k]) }} onClick={() => run(sheet.action, sheet.target, k)}><span aria-hidden="true">{BY_KEY[k].icon}</span> {BY_KEY[k].name}</button>
                ))}
              </div>
            </div>
          ))}
        </Sheet>
      )}

      {sheet && sheet.kind === 'discard' && (
        <Sheet title={`Discard pile (${G.discard.length})`} onClose={() => setSheet(null)}>
          <div className="vb__cards">{[...G.discard].reverse().map((id) => <CardFace key={id} card={CARD[id]} onTap={() => detail(CARD[id])} />)}</div>
        </Sheet>
      )}

      {sheet && sheet.kind === 'player' && (
        <Sheet title={sheet.seat === mySeat ? 'Your company' : nm(sheet.seat)} onClose={() => setSheet(null)}>
          <div className="vb__stats">
            <span><b>{money(G.scores[sheet.seat])}</b> valuation</span>
            <span><b>{G.counts[sheet.seat]}</b> cards in hand</span>
            <span><b>{G.bankruptcies[sheet.seat]}</b> bankruptcies</span>
            <span><b>{G.bigExits[sheet.seat]}</b> big Exits</span>
          </div>
          <div className="vb__names-title">Exits this quarter</div>
          {(G.exits[sheet.seat] || []).length === 0 && <p className="vb__muted">None yet.</p>}
          {(G.exits[sheet.seat] || []).map((e, i) => (
            <div key={i} className="vb__exit">
              <div className="vb__exit-head">{'⭐'} {EXIT_NAMES[e.kind]}{e.set ? ` (${SETS[e.set].name})` : ''} <b>{money(e.value)}</b></div>
              <div className="vb__cards vb__cards--small">{e.cards.map((id) => <CardFace key={id} card={CARD[id]} onTap={() => detail(CARD[id])} />)}</div>
            </div>
          ))}
          <DynamicLink d={DYNAMICS.exits} />
        </Sheet>
      )}

      {stage === 'pick' && !(sheet && sheet.kind === 'detail') && (
        <Sheet title="Portfolio Review: take one card" locked onClose={() => {}}>
          <p className="vb__muted">Tap a card to take it into your hand. Hold a card to read it.</p>
          <div className="vb__cards">{[...G.discard].reverse().map((id) => <CardFace key={id} card={CARD[id]} onTap={() => send(() => moves.pick(id))} onLong={() => detail(CARD[id])} label={`Take ${CARD[id].name}`} />)}</div>
          <DynamicLink d={DYNAMICS.review} />
        </Sheet>
      )}

      {stage === 'place' && !boomFx && !(sheet && sheet.kind === 'detail') && (
        <Sheet title="Pivot! Hide the BOOM" locked onClose={() => {}}>
          <p className="vb__muted">Your Pivot cancelled <b>{cardName(p.k)}</b>. Slide it back into the draw pile. Nobody else sees where.</p>
          <div className="vb__place-quick">
            {[[0, 'On top'], [1, '2nd'], [2, '3rd'], [Math.floor(deckCount / 2), 'Middle'], [deckCount, 'Bottom']].filter(([pos], i, all) => pos <= deckCount && all.findIndex(([x]) => x === pos) === i).map(([pos, name]) => (
              <button type="button" key={name} className={`vb__btn${placeAt === pos ? ' vb__btn--gold' : ''}`} onClick={() => setPlaceAt(pos)}>{name}</button>
            ))}
          </div>
          {deckCount > 0 && <input className="vb__range" type="range" min={0} max={deckCount} value={Math.min(placeAt, deckCount)} onChange={(e) => setPlaceAt(Number(e.target.value))} aria-label="Cards above the BOOM" />}
          <p className="vb__place-say">{Math.min(placeAt, deckCount) === 0 ? 'The very next card drawn.' : `${Math.min(placeAt, deckCount)} card${Math.min(placeAt, deckCount) === 1 ? '' : 's'} above it: the ${ordinal(Math.min(placeAt, deckCount) + 1)} card drawn.`}</p>
          <button type="button" className="vb__btn vb__btn--gold vb__btn--wide" onClick={() => send(() => moves.place(Math.min(placeAt, deckCount)))}>Slide it in</button>
        </Sheet>
      )}

      {/* between rounds, and the end of the game */}
      {recap && !G.over && !boomFx && (
        <div className="vb__veil vb__veil--center">
          <div className="vb__recap" role="dialog" aria-label={`Quarter ${recap.round} summary`}>
            <div className="vb__recap-head">
              <div className="vb__eyebrow">Quarter {recap.round} of {G.rounds} closed</div>
              {recap.bankrupt !== null && recap.bankrupt !== undefined
                ? <h3><span aria-hidden="true">{'\u{1F4A5}'}</span> {recap.boomCard ? cardName(recap.boomCard) : 'BOOM'}: {nm(recap.bankrupt)} went bankrupt</h3>
                : <h3>Nobody went bankrupt</h3>}
            </div>
            <ScoreRows order={standing} nm={nm} hex={hex} G={G} gains={recap.gains} scores={recap.scores} bankrupt={recap.bankrupt} />
            <p className="vb__muted">Survivors score a {money(SURVIVAL_BONUS)} bonus. Hands are thrown in and a new quarter is dealt.</p>
            <button type="button" className="vb__btn vb__btn--gold vb__btn--wide" onClick={() => { if (mySeat !== null && isBetweenRounds(G) && G.summary.round === recap.round) moves.ready(G.round); setRecap(null); }}>{recapStale ? 'Back to the table' : 'Continue'}</button>
          </div>
        </div>
      )}
      {G.over && !boomFx && (
        <div className="vb__veil vb__veil--center">
          <div className="vb__recap" role="dialog" aria-label="Final standings">
            <div className="vb__recap-head">
              <div className="vb__eyebrow">Final standings after {G.round} quarter{G.round === 1 ? '' : 's'}</div>
              <h3>{'\u{1F3C6}'} {winnerLine(standing.filter((s) => G.over.placements[s] === 1), mySeat, nm)}</h3>
            </div>
            <ScoreRows order={standing} nm={nm} hex={hex} G={G} scores={G.scores} placements={G.over.placements} />
            <a className="vb__learn" href={HOME_LINK} target="_blank" rel="noopener noreferrer">{WORDMARK}: {MAKER_LINE} {'\u2197'}</a>
          </div>
        </div>
      )}
    </div>
  );
}

function winnerLine(winners, mySeat, nm) {
  if (winners.length === 1) return winners[0] === mySeat ? 'You win!' : `${nm(winners[0])} wins`;
  return `${winners.map(nm).join(' and ')} share first place`;
}

function ScoreRows({ order, nm, hex, G, gains = null, scores, placements = null, bankrupt = null }) {
  return (
    <div className="vb__rows">
      {order.map((s) => (
        <div key={s} className={`vb__srow${s === bankrupt ? ' vb__srow--bust' : ''}`} style={{ '--seat': hex(s) }}>
          <span className="vb__srow-place">{placements ? ordinal(placements[s]) : <span className="vb__row-dot" />}</span>
          <span className="vb__srow-name">{nm(s)}{s === bankrupt ? ' \u{1F4A5}' : ''}</span>
          <span className="vb__srow-meta">{placements ? `${G.bankruptcies[s]} bankrupt · ${G.bigExits[s]} big` : gains ? (gains[s] > 0 ? `+${money(gains[s])}` : '+$0') : ''}</span>
          <b className="vb__srow-score">{money(scores[s])}</b>
        </div>
      ))}
    </div>
  );
}

function DynamicLink({ d }) {
  if (!d) return null;
  return <a className="vb__learn" href={d.link} target="_blank" rel="noopener noreferrer">The business behind {d.name}: {d.dynamic} {'↗'}</a>;
}

/** The opened card: the full card as drawn, its flavour line, the business move behind it and the link to the real story. */
function Detail({ card, onClose }) {
  const set = card.set ? SETS[card.set] : null;
  const art = artFor(card);
  return (
    <Sheet title={card.name} onClose={onClose}>
      <div className={`vb__detail${art ? ' vb__detail--art' : ''}`}>
        {art ? <BigCard card={card} /> : <div className="vb__detail-card"><CardFace card={card} /></div>}
        <div className="vb__detail-text">
          {!art && <div className="vb__eyebrow">{card.type === 'founder' ? `${set.name} · ${set.nickname}` : TYPES[card.type].label}</div>}
          {!art && <p className="vb__detail-rule">{card.rule} <RealStory card={card} /></p>}
          <p className="vb__detail-flavor">{card.flavor}</p>
          {set && <p className="vb__muted">{art ? `${set.name}, ${set.nickname}. ` : ''}Running gag: {set.gag}.</p>}
          <div className="vb__dynamic"><span className="vb__eyebrow">The real business move</span><b>{card.dynamic}</b></div>
          <a className="vb__learn" href={card.link} target="_blank" rel="noopener noreferrer">Learn the real story {'↗'}</a>
        </div>
      </div>
      <p className="vb__brandline"><b>{WORDMARK}</b> {'·'} {MAKER_LINE}</p>
    </Sheet>
  );
}
