// Everything a table can tell you about the game being played, in one place:
// how to play, the key to the cards or pieces, how the game is going, and
// what the dice (or the draw pile) have done so far. GameStage opens it in a
// drawer; the Key is also a page of its own (/key/<game>).
//
// A game provides the content through its info.js: `key` (data), and the pure
// functions `progress(G)` and `rolls(G)`. This file only draws it, so a new
// game gets all four tabs by writing data, not a screen.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useInRouterContext } from 'react-router-dom';
import { rpc } from '../api.js';
import { Avatar } from '../components/ui.jsx';
import { clockTime, spanText } from '../../shared/time.js';
import { useElapsed } from './clock.jsx';
import { PACES, PACE_IDS, paceOf } from '../../shared/pace.js';

/** The tabs a game has, in order. `G` may be null (the Key page has no game in progress). */
export function infoTabs(info, G) {
  const tabs = [{ id: 'help', label: 'Rules' }];
  if (info && info.key) tabs.push({ id: 'key', label: 'Key' });
  if (info && info.progress && G) tabs.push({ id: 'progress', label: 'Progress' });
  if (info && info.rolls && G) tabs.push({ id: 'rolls', label: info.rollsLabel || 'Rolls' });
  if (info && info.describe && G) tabs.push({ id: 'moves', label: 'Moves' });
  return tabs;
}

export function HowTo({ game }) {
  return (
    <div className="stack">
      <ol style={{ margin: 0, paddingLeft: 20 }} className="stack">{(game.howTo || []).map((step) => <li key={step}>{step}</li>)}</ol>
      {game.watchFor && <p className="notice"><b>What to watch for:</b> {game.watchFor}</p>}
    </div>
  );
}

// ---- the Key ----------------------------------------------------------------------------
function KeyItem({ item, art, open, focused }) {
  const pic = art ? art(item) : null;
  const ref = useRef(null);
  useEffect(() => {
    if (focused && ref.current && ref.current.scrollIntoView) ref.current.scrollIntoView({ block: 'start' });
  }, [focused]);
  return (
    <li className={`gkey__item${focused ? ' gkey__item--focus' : ''}`} id={`key-${item.id}`} ref={ref} data-key-item={item.id}>
      {pic ? <img className="gkey__art" src={pic.sm} alt="" loading="lazy" /> : <span className="gkey__icon" aria-hidden="true">{item.icon}</span>}
      <div className="gkey__body">
        <h4 className="gkey__name">{item.name}{item.count ? <span className="gkey__count">{item.count}</span> : null}</h4>
        <p className="gkey__power">{item.power}</p>
        {(item.trait || item.dynamic) && (
          <p className="gkey__trait"><span className="eyebrow">{item.trait && item.dynamic && item.dynamic !== item.trait ? 'Trait' : 'Stands for'}</span> {item.trait || item.dynamic}</p>
        )}
        {item.lesson && <p className="gkey__lesson"><span className="eyebrow">Lesson</span> {item.lesson}</p>}
        {item.flavor && <p className="gkey__flavor">{item.flavor}</p>}
        {item.story && (
          <details className="gkey__story" open={open || undefined}>
            <summary>The real story: <b>{item.story.who}</b></summary>
            <p>{item.story.text}</p>
          </details>
        )}
      </div>
    </li>
  );
}

/**
 * The key to a game's cards or pieces. `focus` is the id of one entry to open
 * at (a card's "?" passes its own); `art(item)` returns { sm } for games whose
 * pieces have pictures.
 */
export function GameKey({ data, art, focus }) {
  const [group, setGroup] = useState(null);
  const groups = data.groups || [];
  const focusGroup = focus ? groups.find((g) => g.items.some((i) => i.id === focus)) : null;
  // A card's "?" opens the Key on that one card's group; the chips widen it.
  const active = group === null ? (focusGroup ? focusGroup.id : 'all') : group;
  const shown = active === 'all' ? groups : groups.filter((g) => g.id === active);
  const total = groups.reduce((a, g) => a + g.items.length, 0);
  return (
    <div className="gkey stack">
      {data.intro && <p className="gkey__intro">{data.intro}</p>}
      {groups.length > 1 && (
        <div className="row-wrap" role="group" aria-label="Show">
          <button type="button" className={`chip${active === 'all' ? ' on' : ''}`} aria-pressed={active === 'all'} onClick={() => setGroup('all')}>All {total}</button>
          {groups.map((g) => (
            <button key={g.id} type="button" className={`chip${active === g.id ? ' on' : ''}`} aria-pressed={active === g.id} onClick={() => setGroup(g.id)}>
              {g.icon ? <span aria-hidden="true">{g.icon}</span> : null} {g.name}
            </button>
          ))}
        </div>
      )}
      {shown.map((g) => (
        <section key={g.id} className="gkey__group" aria-label={g.name} style={g.color ? { '--gk': g.color } : undefined}>
          <h3 className="gkey__gname">{g.icon ? <span aria-hidden="true">{g.icon} </span> : null}{g.name} <span className="gkey__count">{g.items.length}</span></h3>
          {g.blurb && <p className="muted small">{g.blurb}</p>}
          <ul className="gkey__list">
            {g.items.map((i) => <KeyItem key={i.id} item={i} art={art} open={i.id === focus} focused={i.id === focus} />)}
          </ul>
        </section>
      ))}
      {data.note && <p className="tiny muted">{data.note}</p>}
    </div>
  );
}

// ---- Progress ----------------------------------------------------------------------------
function Meter({ stage }) {
  const pct = stage.of > 0 ? Math.max(0, Math.min(100, Math.round((stage.done / stage.of) * 100))) : 0;
  return (
    <div className="gprog__stage">
      <div className="gprog__stage-label">{stage.label}</div>
      <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={stage.of} aria-valuenow={Math.min(stage.done, stage.of)} aria-label={stage.caption || stage.label}><i style={{ width: `${pct}%` }} /></div>
      {stage.caption && <div className="tiny muted">{stage.caption}</div>}
    </div>
  );
}

/** "3 h 20 min in Chess over 14 finished games", from the member's own record. */
function TimeInvested({ gameId, gameName, table, playing }) {
  const elapsedMs = useElapsed(table);
  const inRouter = useInRouterContext();
  const [t, setT] = useState(null);
  useEffect(() => {
    let alive = true;
    rpc('timeInvested', { gameId }).then((r) => { if (alive) setT(r); }).catch(() => {});
    return () => { alive = false; };
  }, [gameId]);
  const mine = t && t.games.find((g) => g.gameId === gameId);
  return (
    <div className="gprog__time">
      <div><span className="eyebrow">This game</span><b className="gprog__clock">{clockTime(elapsedMs)}</b></div>
      <div>
        <span className="eyebrow">Your time in {gameName}</span>
        <b>{t ? spanText((mine ? mine.ms : 0) + (playing ? elapsedMs : 0)) : '…'}</b>
        {t && <span className="tiny muted"> {mine ? `over ${mine.played} finished game${mine.played === 1 ? '' : 's'}${playing ? ' and this one' : ''}` : playing ? 'this is your first' : ''}</span>}
      </div>
      {t && t.total > 0 && <div><span className="eyebrow">All your time here</span><b>{spanText(t.total + (playing ? elapsedMs : 0))}</b> {inRouter && <Link className="tiny" to="/history">See it by game</Link>}</div>}
    </div>
  );
}

export function Progress({ data, seats, mySeat, game, table, playing }) {
  return (
    <div className="gprog stack">
      {data.stage && <Meter stage={data.stage} />}
      <ul className="gprog__seats">
        {data.rows.map((row, s) => {
          const seat = seats[s] || { name: `Seat ${s + 1}` };
          return (
            <li key={s} className={`gprog__seat${s === mySeat ? ' gprog__seat--me' : ''}`} data-progress-seat={s}>
              <div className="gprog__who">
                {seat.hex && <span className="swatch" style={{ width: 10, height: 10, borderRadius: '50%', background: seat.hex, flex: 'none' }} />}
                <Avatar p={seat.card || { avatar: seat.avatar }} size={22} />
                <b className="truncate">{seat.name}</b>{s === mySeat && <span className="tiny muted" style={{ flex: 'none' }}>(you)</span>}
              </div>
              <dl className="gprog__nums">
                {data.columns.map((c, i) => <div key={c}><dt>{c}</dt><dd>{row[i]}</dd></div>)}
              </dl>
            </li>
          );
        })}
      </ul>
      {(data.notes || []).map((n) => <p key={n} className="small muted" style={{ margin: 0 }}>{n}</p>)}
      {table && <TimeInvested gameId={game.id} gameName={game.name} table={table} playing={playing} />}
    </div>
  );
}

// ---- Rolls: the histogram ----------------------------------------------------------------
// One series, so no legend: the title says what the bars are. Bars are thin,
// square at the baseline and rounded at the data end; every label is in ink,
// never in the bar's colour; each bar answers a hover or keyboard focus with
// the exact figure, and the same numbers are there as a table.
const fmt = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

function tipFor(b, chart) {
  const share = chart.total > 0 ? ` (${Math.round((b.value / chart.total) * 100)}%)` : '';
  if (b.of !== undefined) return `${b.label}: ${b.value} of ${b.of} face up`;
  if (b.expected !== undefined) return `${b.label}: came up ${b.value} time${b.value === 1 ? '' : 's'}${share}. A fair roll would give about ${fmt(b.expected)}.`;
  return `${b.label}: ${b.value}${share}`;
}

function Chart({ chart }) {
  const [tip, setTip] = useState(null);
  const max = Math.max(1, ...chart.bars.map((b) => Math.max(b.value, b.of || 0, b.expected || 0)));
  const upright = chart.bars.length >= 4 && chart.bars.every((b) => String(b.label).length <= 3);
  const hasExpected = chart.bars.some((b) => b.expected !== undefined);
  const hasOf = chart.bars.some((b) => b.of !== undefined);
  const size = (v) => `${(v / max) * 100}%`;
  return (
    <figure className="hist" data-chart={chart.id}>
      <figcaption className="hist__title">{chart.title} <span className="muted" style={{ fontWeight: 400 }}>{chart.total} {chart.unit}</span></figcaption>
      {chart.total === 0 && <p className="small muted" style={{ margin: 0 }}>Nothing yet.</p>}
      <div className={upright ? 'hist__cols' : 'hist__rows'} role="list" onMouseLeave={() => setTip(null)}>
        {chart.bars.map((b) => (
          <div key={b.label} role="listitem" tabIndex={0} className={upright ? 'hist__col' : 'hist__row'} aria-label={tipFor(b, chart)}
            onMouseEnter={() => setTip(b.label)} onFocus={() => setTip(b.label)} onBlur={() => setTip(null)}>
            {upright ? (
              <>
                <span className="hist__val">{b.value > 0 ? b.value : ''}</span>
                <span className="hist__track hist__track--up">
                  {b.expected !== undefined && <i className="hist__mark" style={{ bottom: size(b.expected) }} />}
                  <i className="hist__bar" style={{ height: size(b.value) }} />
                </span>
                <span className="hist__label">{b.label}</span>
              </>
            ) : (
              <>
                <span className="hist__label">{b.label}</span>
                <span className="hist__track">
                  {b.of !== undefined && <i className="hist__cap" style={{ width: size(b.of) }} />}
                  {b.expected !== undefined && <i className="hist__mark" style={{ left: size(b.expected) }} />}
                  <i className="hist__bar" style={{ width: size(b.value) }} />
                </span>
                <span className="hist__val">{b.of !== undefined ? `${b.value} of ${b.of}` : b.value}</span>
              </>
            )}
            {tip === b.label && <span className="hist__tip" role="tooltip">{tipFor(b, chart)}</span>}
          </div>
        ))}
      </div>
      {((hasExpected && chart.total > 0) || hasOf) && (
        <p className="tiny muted hist__legend">
          {hasExpected && chart.total > 0 && <><i className="hist__mark hist__mark--key" /> what a fair roll would give over {chart.total} {chart.unit}</>}
          {hasOf && <><i className="hist__bar hist__bar--key" /> face up <i className="hist__cap hist__cap--key" /> in play this quarter</>}
        </p>
      )}
      {chart.note && <p className="tiny muted" style={{ margin: 0 }}>{chart.note}</p>}
      <details className="hist__table">
        <summary>Show as a table</summary>
        <table>
          <thead><tr><th scope="col">Outcome</th><th scope="col">{hasOf ? 'Face up' : 'Times'}</th>{hasOf && <th scope="col">In play</th>}{hasExpected && <th scope="col">Expected</th>}</tr></thead>
          <tbody>{chart.bars.map((b) => <tr key={b.label}><th scope="row">{b.label}</th><td>{b.value}</td>{hasOf && <td>{b.of}</td>}{hasExpected && <td>{b.expected !== undefined ? fmt(b.expected) : ''}</td>}</tr>)}</tbody>
        </table>
      </details>
    </figure>
  );
}

export function RollCharts({ charts }) {
  if (!charts || !charts.length) return <p className="muted">Nothing has been rolled or drawn yet.</p>;
  return <div className="stack-lg">{charts.map((c) => <Chart key={c.id} chart={c} />)}</div>;
}

// ---- What happened: every move, in order ------------------------------------------------
/** Quick, Steady or Slow: how long the table lingers on each thing that happens. */
export function PaceControl({ table, onPace }) {
  if (!table || !table.pace) return null;
  const pace = paceOf(table.pace);
  return (
    <div className="gpace">
      <span className="eyebrow">Pace of play</span>
      <div className="row-wrap" role="group" aria-label="Pace of play">
        {PACE_IDS.map((id) => (
          <button key={id} type="button" className={`chip${pace === id ? ' on' : ''}`} aria-pressed={pace === id} disabled={!table.canPace || !onPace} onClick={() => onPace(id)} style={{ minHeight: 40 }}>{PACES[id].label}</button>
        ))}
      </div>
      <span className="tiny muted">{table.canPace ? `${PACES[pace].label}: ${PACES[pace].note}. It changes how long robots wait and how long you have to answer, never the rules.` : `${PACES[pace].label}. The host sets the pace.`}</span>
    </div>
  );
}

export function Moves({ entries, info, seats, mySeat, table, onPace }) {
  const end = useRef(null);
  const nm = (s) => (s === mySeat ? 'You' : seats[s] ? seats[s].name : `Seat ${Number(s) + 1}`);
  const lines = [];
  for (const e of entries || []) {
    let text = null; let why = null;
    // The end of the game is logged by the kit the same way for every game.
    try { text = e.t === 'over' ? 'Game over' : info.describe(e, nm); why = text && info.explain ? info.explain(e) : null; } catch { text = null; }
    if (text) lines.push({ n: e.n, t: e.t, text, why });
  }
  // Open at the newest move, like a chat: the list reads top to bottom.
  useEffect(() => { if (end.current && end.current.scrollIntoView) end.current.scrollIntoView({ block: 'end' }); }, [lines.length]);
  const first = lines.length ? lines[0].n : 0;
  return (
    <div className="gmoves stack">
      <PaceControl table={table} onPace={onPace} />
      {first > 1 && <p className="tiny muted" style={{ margin: 0 }}>Earlier moves are not kept: this list starts {first - 1} event{first - 1 === 1 ? '' : 's'} into the game.</p>}
      {lines.length === 0 ? <p className="muted">Nothing has happened yet.</p> : (
        <ol className="gmoves__list" aria-label="Everything that has happened, oldest first">
          {lines.map((l) => (
            <li key={l.n} className={`gmoves__line gmoves__line--${l.t}`} data-move={l.n}>
              <span className="gmoves__text">{l.text}</span>
              {l.why && <span className="gmoves__why">{l.why}</span>}
            </li>
          ))}
        </ol>
      )}
      <div ref={end} />
    </div>
  );
}

/** The drawer's contents: the tab strip and the tab that is open. */
export default function GameInfo({ game, info, keyArt, G, seats, mySeat, table, tab, focus, onTab, playing, history, onPace }) {
  const tabs = useMemo(() => infoTabs(info, G), [info, G]);
  const now = tabs.some((t) => t.id === tab) ? tab : 'help';
  const safe = (fn) => { try { return fn(); } catch (e) { console.error('[game info]', e); return null; } };
  const progress = now === 'progress' ? safe(() => info.progress(G)) : null;
  const charts = now === 'rolls' ? safe(() => info.rolls(G)) : null;
  return (
    <div className="ginfo">
      {tabs.length > 1 && (
        <div className="ginfo__tabs" role="tablist" aria-label={`About ${game.name}`}>
          {tabs.map((t) => (
            <button key={t.id} type="button" role="tab" id={`ginfo-tab-${t.id}`} aria-selected={now === t.id} aria-controls="ginfo-panel" className={`ginfo__tab${now === t.id ? ' on' : ''}`} onClick={() => onTab(t.id)}>{t.label}</button>
          ))}
        </div>
      )}
      <div className="ginfo__panel" role="tabpanel" id="ginfo-panel" aria-labelledby={`ginfo-tab-${now}`} tabIndex={-1}>
        {now === 'help' && <HowTo game={game} />}
        {now === 'key' && <GameKey data={info.key} art={keyArt ? (item) => (item.art === null ? null : keyArt(item.art || item.id)) : null} focus={focus} />}
        {now === 'progress' && (progress ? <Progress data={progress} seats={seats} mySeat={mySeat} game={game} table={table} playing={playing} /> : <p className="muted">Progress is not available for this game yet.</p>)}
        {now === 'rolls' && <RollCharts charts={charts} />}
        {now === 'moves' && <Moves entries={history || (G && G.log) || []} info={info} seats={seats} mySeat={mySeat} table={table} onPace={onPace} />}
      </div>
    </div>
  );
}
