import { useMemo, useState } from 'react';
import { ASSETS } from '../data/gameConfig';
import { assetSeries, assetSummary } from '../game/marketHistory';
import { playSound } from '../audio/soundEngine';

// One hue per asset, chosen to echo each asset's own icon (piggy pink,
// lemonade yellow, tree house green, treasure blue) and then VALIDATED as a
// set rather than eyeballed:
//
//   node scripts/validate_palette.js "#e87ba4,#eda100,#008300,#2a78d6" \
//     --mode light --pairs all
//
//   worst all-pairs CVD ΔE 13.0 (protan) — clears the ≥8 target
//   worst normal-vision ΔE 19.6          — clears the ≥15 floor
//
// `--pairs all` is the right pairlist because these are small multiples.
// The validator does WARN that yellow and pink fall under 3:1 against a
// cream surface; that warning obligates relief, which this chart carries —
// every panel is titled with its asset's icon and name, every panel shows
// its numbers as text, and there is a full table view. Colour is never the
// only thing telling two panels apart.
//
// Light values only: VentureFlow has no dark surface (see styles/theme.css —
// the unlockable themes all sit on cream/white).
const ASSET_COLORS = {
  piggy: '#e87ba4',
  lemonade: '#eda100',
  treehouse: '#008300',
  treasure: '#2a78d6',
};
const FALLBACK_COLOR = '#2a78d6';

const W = 300;
const H = 132;
const PAD_L = 38;
const PAD_R = 12;
const PAD_T = 10;
const PAD_B = 22;

function money(n) {
  return `$${Math.round(n).toLocaleString()}`;
}

function preciseMoney(n) {
  if (n === 0) return '$0';
  return Math.abs(n) < 10 ? `$${n.toFixed(2)}` : money(n);
}

/**
 * One asset's price across the months played, as an inline-SVG line chart.
 *
 * ONE axis, deliberately. Price and cash flow are different measures on
 * wildly different scales (a Tree House costs hundreds and pays tens), and
 * a second y-axis is the single most misleading thing a chart can do — it
 * lets the author decide, by choosing scales, whether the two lines appear
 * to move together. Cash flow is therefore surfaced as a NUMBER on the
 * selected month rather than as a second line.
 */
function AssetChart({ asset, series, selectedMonth, onSelect }) {
  const color = ASSET_COLORS[asset.id] || FALLBACK_COLOR;
  const prices = series.map((p) => p.price);
  const max = Math.max(...prices);
  const min = Math.min(...prices);
  // Pad the band so a flat-ish line doesn't render as a jagged mess at the
  // top of the box, and never divide by zero on a genuinely flat series.
  const span = max - min || Math.max(1, max * 0.1);
  const lo = min - span * 0.15;
  const hi = max + span * 0.15;

  const plotW = W - PAD_L - PAD_R;
  const plotH = H - PAD_T - PAD_B;
  const lastMonth = series[series.length - 1]?.month || 1;
  const firstMonth = series[0]?.month || 1;
  const monthSpan = lastMonth - firstMonth || 1;

  const x = (m) => PAD_L + ((m - firstMonth) / monthSpan) * plotW;
  const y = (v) => PAD_T + plotH - ((v - lo) / (hi - lo)) * plotH;

  const path = series.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(p.month).toFixed(1)} ${y(p.price).toFixed(1)}`).join(' ');
  const area = series.length > 1 ? `${path} L ${x(lastMonth).toFixed(1)} ${PAD_T + plotH} L ${x(firstMonth).toFixed(1)} ${PAD_T + plotH} Z` : '';

  const selected = series.find((p) => p.month === selectedMonth) || series[series.length - 1];

  return (
    <svg
      className="vf-market__svg"
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={`${asset.name} price from month ${firstMonth} to month ${lastMonth}. Lowest ${money(min)}, highest ${money(max)}.`}
    >
      {/* Recessive grid — three lines, labelled, so the numbers are readable
          as text and never depend on the series colour. */}
      {[0, 0.5, 1].map((t) => {
        const v = lo + (hi - lo) * (1 - t);
        return (
          <g key={t}>
            <line x1={PAD_L} x2={W - PAD_R} y1={PAD_T + plotH * t} y2={PAD_T + plotH * t} stroke="#d8d4cc" strokeWidth="1" />
            <text x={PAD_L - 6} y={PAD_T + plotH * t + 3.5} textAnchor="end" className="vf-market__tick">
              {money(v)}
            </text>
          </g>
        );
      })}

      {area && <path d={area} fill={color} opacity="0.1" />}
      <path d={path} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />

      {/* Markers: ≥8px hit targets, with a 2px surface ring so overlapping
          points stay separable. Only rendered when they won't collide. */}
      {series.map((p) => {
        const isSel = p.month === selected?.month;
        const dense = series.length > 14;
        return (
          <g key={p.month}>
            {(!dense || isSel) && (
              <circle cx={x(p.month)} cy={y(p.price)} r={isSel ? 5 : 3.2} fill={color} stroke="#fffdf8" strokeWidth="2" />
            )}
            {/* Invisible generous hit area — always present, even when the
                visible dot is suppressed for density. */}
            <circle
              cx={x(p.month)}
              cy={y(p.price)}
              r={Math.max(9, plotW / series.length / 1.6)}
              fill="transparent"
              style={{ cursor: 'pointer' }}
              onClick={() => onSelect(p.month)}
              onMouseEnter={() => onSelect(p.month)}
            >
              <title>{`Month ${p.month}: ${preciseMoney(p.price)} · pays ${preciseMoney(p.cashFlow)}/mo`}</title>
            </circle>
          </g>
        );
      })}

      {selected && (
        <line
          x1={x(selected.month)}
          x2={x(selected.month)}
          y1={PAD_T}
          y2={PAD_T + plotH}
          stroke={color}
          strokeWidth="1"
          strokeDasharray="3 3"
          opacity="0.55"
        />
      )}

      <text x={PAD_L} y={H - 6} className="vf-market__tick">
        Mo {firstMonth}
      </text>
      <text x={W - PAD_R} y={H - 6} textAnchor="end" className="vf-market__tick">
        Mo {lastMonth}
      </text>
    </svg>
  );
}

/**
 * Market History — a small multiple per asset rather than four lines on one
 * chart, because the assets' prices live on completely different scales and
 * a shared axis would flatten Piggy Banks into a straight line at the bottom.
 */
export default function MarketHistoryModal({ open, history, onClose }) {
  const [selectedMonth, setSelectedMonth] = useState(null);
  const [showTable, setShowTable] = useState(false);

  const rows = useMemo(() => history || [], [history]);

  if (!open) return null;

  function handleClose() {
    playSound('click');
    onClose();
  }

  // One real month is enough to draw: the player still gets today's price,
  // today's payout and today's yield, which is most of the value. Only a
  // genuinely empty history has nothing to show.
  const enoughData = rows.length >= 1;
  const firstRecorded = rows.length ? rows[0].month : 1;
  // A game resumed from a build that predated this feature starts recording
  // mid-game. Saying so is the difference between a chart that looks broken
  // and one that is honestly young.
  const partial = firstRecorded > 1;

  return (
    <div className="vf-modal-overlay" onClick={handleClose}>
      <div className="vf-card vf-market" onClick={(e) => e.stopPropagation()}>
        <div className="vf-market__header">
          <span className="vf-market__title">📈 Market History</span>
          <button
            type="button"
            className="vf-btn vf-btn--sm vf-btn--ghost"
            onClick={() => {
              playSound('click');
              setShowTable((v) => !v);
            }}
          >
            {showTable ? 'Show charts' : 'Show table'}
          </button>
          <button type="button" className="vf-btn vf-btn--sm vf-btn--ghost" onClick={handleClose}>
            Close
          </button>
        </div>

        {!enoughData ? (
          <p className="vf-market__empty">
            Nothing recorded yet — start a game and this fills in month by month. It tracks what each thing costs
            and what it pays you, so you can tell a bargain from a bad month.
          </p>
        ) : (
          <>
            {partial && (
              <p className="vf-market__partial">
                📌 This game started before price tracking existed, so it begins at month {firstRecorded}. Months 1–
                {firstRecorded - 1} weren&rsquo;t recorded and can&rsquo;t be reconstructed — a new game tracks
                everything from month 1.
              </p>
            )}
            {showTable ? (
          <div className="vf-market__tablewrap vf-scroll">
            <table className="vf-market__table">
              <thead>
                <tr>
                  <th scope="col">Month</th>
                  {ASSETS.map((a) => (
                    <th scope="col" key={a.id}>
                      {a.icon} {a.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.month}>
                    <th scope="row">{r.month}</th>
                    {ASSETS.map((a) => (
                      <td key={a.id}>
                        {preciseMoney(r.price[a.id])}
                        <span className="vf-market__cellflow"> · {preciseMoney(r.cashFlow[a.id])}/mo</span>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="vf-market__grid vf-scroll">
            {ASSETS.map((asset) => {
              const series = assetSeries(rows, asset.id);
              const summary = assetSummary(rows, asset.id);
              const point = series.find((p) => p.month === selectedMonth) || series[series.length - 1];
              const up = summary.changePct >= 0;
              return (
                <div key={asset.id} className="vf-market__panel">
                  <div className="vf-market__panel-head">
                    <span className="vf-market__panel-name">
                      {asset.icon} {asset.name}
                    </span>
                    {summary.months > 1 ? (
                      <span className={`vf-market__delta ${up ? 'is-up' : 'is-down'}`}>
                        {up ? '▲' : '▼'} {Math.abs(summary.changePct).toFixed(0)}% since month {firstRecorded}
                      </span>
                    ) : (
                      <span className="vf-market__delta vf-market__delta--none">first reading</span>
                    )}
                  </div>

                  <AssetChart asset={asset} series={series} selectedMonth={selectedMonth} onSelect={setSelectedMonth} />

                  {/* The readout Michael asked for: tap a point, get the month,
                      what it cost, and what it paid. Values are text in ink
                      colours — the coloured line carries identity, never the
                      numbers. */}
                  <div className="vf-market__readout">
                    <span className="vf-market__readout-month">Month {point.month}</span>
                    <span className="vf-market__readout-price">{preciseMoney(point.price)} each</span>
                    <span className="vf-market__readout-flow">
                      pays {preciseMoney(point.cashFlow)}/mo
                      {point.price > 0 && point.cashFlow > 0
                        ? ` · ${((point.cashFlow / point.price) * 100).toFixed(1)}% yield`
                        : ''}
                    </span>
                  </div>
                  <div className="vf-market__range">
                    Low {preciseMoney(summary.min)} · High {preciseMoney(summary.max)} · Avg payout{' '}
                    {preciseMoney(summary.avgCashFlow)}/mo
                  </div>
                </div>
              );
            })}
          </div>
            )}
          </>
        )}

        <p className="vf-market__hint">
          💡 A high price isn&rsquo;t the same as a good deal. Compare what something costs with what it pays you every
          month — that percentage is the part that actually grows your money.
        </p>
      </div>
    </div>
  );
}
