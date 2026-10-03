// Pace of play: how long the table lingers on each thing that happens.
// A table has one pace for everyone at it. It scales the pauses that exist for
// people to follow the game (a bot's thinking time, the hold after a card is
// played, the time to answer); it never changes a rule.
export const PACES = {
  quick: { label: 'Quick', factor: 0.55, note: 'for people who know the game' },
  steady: { label: 'Steady', factor: 1, note: 'time to read each move' },
  slow: { label: 'Slow', factor: 1.8, note: 'for learning, or playing with children' },
};
export const PACE_IDS = Object.keys(PACES);
export const DEFAULT_PACE = 'steady';
export const paceOf = (p) => (Object.prototype.hasOwnProperty.call(PACES, p) ? p : DEFAULT_PACE);
export const paceFactor = (p) => PACES[paceOf(p)].factor;
