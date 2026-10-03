// VentureFlow(TM): what the table's Progress, Key and "Luck" tabs show.
// Pure functions of the state every browser already has, plus the game's own
// configuration, so nothing here can drift from the rules.
import {
  ASSETS, WEATHER_ORDER, WEATHER_STAGES, BUSINESS_UPGRADE_TRACKS, OPPORTUNITY_DECK, SETBACK_DECK,
  FINANCIAL_LESSONS, BUSINESS_COST, SKILL_COST, BUSINESS_INCOME_MIN, BUSINESS_INCOME_MAX, GAME_LENGTH_MONTHS,
} from './vf/data/gameConfig.js';
import { netWorth, passiveIncome } from './vf/game/players.js';
import { rollCharts } from '../kit.js';

const usd = (n) => `$${Math.round(Number.isFinite(n) ? n : 0).toLocaleString('en-US')}`;

export function progress(G) {
  const vf = G.vf || {};
  const total = vf.totalMonths || GAME_LENGTH_MONTHS;
  const over = !!G.over || vf.status === 'gameover';
  const month = Math.min(total, Math.max(1, vf.month || 1));
  const players = Array.isArray(vf.players) ? vf.players : [];
  const stage = vf.weather ? WEATHER_STAGES[vf.weather.stageId] : null;
  const notes = [];
  if (stage && !over) notes.push(`The weather is ${stage.name}: ${tidy(stage.blurb)} Nobody can see when it will change.`);
  return {
    stage: { label: over ? `All ${total} months played` : `Month ${month} of ${total}`, done: over ? total : month - 1, of: total, caption: over ? null : `${month - 1} of ${total} months finished` },
    columns: ['Net worth', 'Cash', 'Income a month', 'Businesses', 'Good / bad cards'],
    rows: players.map((p) => {
      const cards = p.fortuneCardHistory || [];
      const good = cards.filter((c) => c.deckId === 'opportunity').length;
      let passive = 0;
      try { passive = passiveIncome(p, { allPlayers: players, prices: vf.assetPrices, month: vf.month, weatherIncomeAmounts: vf.weatherIncomeAmounts }); } catch { passive = 0; }
      return [usd(netWorth(p, vf.assetPrices || {})), usd(p.cash), usd(passive), (p.businesses || []).length, `${good} / ${cards.length - good}`];
    }),
    notes,
  };
}

/**
 * VentureFlow rolls no dice a player can see, but every month has two random
 * outcomes that decide a lot: what the weather was, and which fortune deck
 * each player's card came from.
 */
export function rolls(G) {
  const vf = G.vf || {};
  const charts = rollCharts(G, {
    weather: {
      title: 'The weather, month by month', unit: 'months', faces: WEATHER_ORDER,
      labels: Object.fromEntries(WEATHER_ORDER.map((id) => [id, WEATHER_STAGES[id].name])),
    },
  }).filter((c) => c.id === 'weather');
  const months = Math.max(0, (vf.month || 1) - 1);
  if (!charts.length) charts.push({ id: 'weather', title: 'The weather, month by month', unit: 'months', total: 0, bars: WEATHER_ORDER.map((id) => ({ label: WEATHER_STAGES[id].name, value: 0 })) });
  charts[0].note = charts[0].total < months
    ? `Counted from month ${months - charts[0].total + 1}: this table started before the weather was being recorded. The five kinds always come in the same order; how long each lasts is random.`
    : 'One count for every finished month. The five kinds always come in the same order; how long each lasts is random.';

  let good = 0; let bad = 0;
  for (const p of Array.isArray(vf.players) ? vf.players : []) for (const c of p.fortuneCardHistory || []) { if (c.deckId === 'opportunity') good += 1; else bad += 1; }
  charts.push({
    id: 'fortune', title: 'Fortune cards drawn by the whole table', unit: 'cards', total: good + bad,
    note: 'Each player draws one a month. In good weather three in four are opportunities; in a Stormy Bust three in four are setbacks.',
    bars: [{ label: 'Opportunities', value: good }, { label: 'Setbacks', value: bad }],
  });
  return charts;
}
export const rollsLabel = 'Luck';

// ---- the Key ------------------------------------------------------------------------
const ASSET_NOTES = {
  piggy: { trait: 'Saving', lesson: 'Safe money grows slowly. It is there so that a bad month does not force you to sell something good.' },
  lemonade: { trait: 'A small business you buy into', lesson: 'Income that changes with the season is still income. Expect the swings and plan around them.' },
  treehouse: { trait: 'Rental property', lesson: 'An asset that pays you every month is worth more than its price tag suggests, and the more of them one owner has, the less each one pays.' },
  treasure: { trait: 'Speculation', lesson: 'It pays nothing while you hold it. Its whole value is what someone else will pay next, which is why it swings the most.' },
};
const TRACK_NOTES = {
  marketing: 'Attention fades. Marketing has to be kept up to keep working.',
  sales: 'A customer you keep is worth more than a campaign.',
  ops: 'Getting cheaper to run makes every later investment go further.',
  rnd: 'The slow, uncertain bet is where the biggest jumps come from.',
};
const pct = (n) => `${Math.round(n * 100)}%`;
/** The game's own wording, with its dashes turned into commas so the Key reads as one voice. */
const tidy = (t) => String(t || '').replace(/\s*[—–]\s*/g, ', ').replace(/’/g, '\'');
const fortune = (deck) => (c) => ({ id: c.id, name: c.title, icon: c.icon, power: tidy(c.flavor), lesson: tidy(c.why), trait: deck });

export const key = {
  intro: 'Four things to buy, businesses to build, an economy that changes with the weather, and one fortune card a month. Every part of it works the way the real thing does.',
  groups: [
    {
      id: 'assets', name: 'What you can buy', icon: '\u{1F6D2}',
      blurb: 'From safe to risky. Prices move every month with the weather.',
      items: ASSETS.map((a) => ({ id: a.id, name: a.name, icon: a.icon, count: `about $${a.basePrice} · ${a.riskLabel}`, power: tidy(a.tagline), ...(ASSET_NOTES[a.id] || {}) })),
    },
    {
      id: 'business', name: 'Businesses', icon: '\u{1F3EA}',
      blurb: `A business costs $${BUSINESS_COST} and one skill token (a skill costs $${SKILL_COST}) and pays $${BUSINESS_INCOME_MIN} to $${BUSINESS_INCOME_MAX} a month from then on. Four ways to grow one:`,
      items: Object.values(BUSINESS_UPGRADE_TRACKS).map((t) => ({ id: t.id, name: t.name, icon: t.icon, count: `$${t.cost}`, power: tidy(t.blurb), lesson: TRACK_NOTES[t.id] })),
    },
    {
      id: 'weather', name: 'The economic weather', icon: '\u{1F326}\u{FE0F}',
      blurb: 'The economy moves through five kinds of weather, always in this order, on a timer nobody can see.',
      items: WEATHER_ORDER.map((id) => {
        const s = WEATHER_STAGES[id];
        return { id, name: s.name, icon: s.icon, count: `lasts ${s.minMonths} to ${s.maxMonths} months`, power: `${tidy(s.blurb)} A fortune card drawn in this weather is an opportunity ${pct(s.deckWeight.opportunity)} of the time.` };
      }),
    },
    {
      id: 'opportunities', name: 'Fortune cards: opportunities', icon: '\u{1F340}',
      blurb: `${OPPORTUNITY_DECK.length} cards. A card about a thing only helps the players who own that thing.`,
      items: OPPORTUNITY_DECK.map(fortune('Opportunity')),
    },
    {
      id: 'setbacks', name: 'Fortune cards: setbacks', icon: '\u{26A1}',
      blurb: `${SETBACK_DECK.length} cards. Setbacks are meant to be survivable, and each one is something that really happens to businesses.`,
      items: SETBACK_DECK.map(fortune('Setback')),
    },
    {
      id: 'ideas', name: 'The ideas behind the game', icon: '\u{1F4A1}',
      items: Object.entries(FINANCIAL_LESSONS).map(([id, l]) => ({ id, name: l.title, icon: l.icon, power: tidy(l.blurb) })),
    },
  ],
};
