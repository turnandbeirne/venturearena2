// ============================================================================
// Market history — one row per month, per asset
// ----------------------------------------------------------------------------
// The Market History chart answers a question the board alone can't: "is a
// Tree House expensive right now, or is that just what they cost?" A single
// live price tells a player nothing about whether they are buying a dip or a
// peak, which is exactly the judgement the game is meant to teach.
//
// Two numbers per asset per month:
//
//   price     what one unit cost that month
//   cashFlow  what one unit PAID OUT that month
//
// Keeping both is the point. Price alone rewards guessing; price against
// yield is the actual lesson — a Treasure Chest that pays nothing is a very
// different proposition from a Piggy Bank at the same price.
//
// PURE. Snapshots read already-computed values and never draw from the RNG,
// so adding this cannot shift the environment stream (see game/rng.js).
// ============================================================================
import { ASSETS } from '../data/gameConfig';
import { perUnitIncome } from './players';

/**
 * One month's row. `weatherIncomeAmounts` is that month's already-rolled
 * income table — passed in rather than re-rolled, precisely so no extra RNG
 * draw happens here.
 */
export function marketSnapshot(month, prices, weatherIncomeAmounts) {
  const row = { month, price: {}, cashFlow: {} };
  for (const asset of ASSETS) {
    const price = prices[asset.id];
    row.price[asset.id] = price;
    // totalOwned is deliberately omitted: Tree House rent tapers with how
    // many one player owns, and this row describes the MARKET, not any one
    // player's position. The undiluted figure is the honest headline.
    row.cashFlow[asset.id] = Math.round(perUnitIncome(asset, { price, weatherIncomeAmounts }) * 100) / 100;
  }
  return row;
}

/** Append a month, replacing any existing row for that month (so a resumed
 *  or replayed month can never produce two rows for the same point). */
export function appendSnapshot(history, snapshot) {
  const kept = (history || []).filter((r) => r.month !== snapshot.month);
  return [...kept, snapshot].sort((a, b) => a.month - b.month);
}

/** The series for one asset, as `[{ month, price, cashFlow }]`. */
export function assetSeries(history, assetId) {
  return (history || []).map((r) => ({
    month: r.month,
    price: r.price?.[assetId] ?? 0,
    cashFlow: r.cashFlow?.[assetId] ?? 0,
  }));
}

/**
 * Summary stats for one asset's run so far. `changePct` is measured from the
 * FIRST recorded month rather than the previous one — "up 12% since the game
 * began" is the figure a player can act on; month-to-month noise isn't.
 */
export function assetSummary(history, assetId) {
  const series = assetSeries(history, assetId);
  if (!series.length) return null;
  const prices = series.map((p) => p.price);
  const first = prices[0];
  const last = prices[prices.length - 1];
  const flows = series.map((p) => p.cashFlow);
  return {
    months: series.length,
    first,
    last,
    min: Math.min(...prices),
    max: Math.max(...prices),
    changePct: first > 0 ? ((last - first) / first) * 100 : 0,
    avgCashFlow: flows.reduce((a, b) => a + b, 0) / flows.length,
    lastCashFlow: flows[flows.length - 1],
  };
}
