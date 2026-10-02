// Everything the arena, the lobby card, the how-to-play panel and the static
// SEO page say about this game. Text only: safe to import anywhere.
export default {
  id: 'mancala',
  name: 'Mancala',
  family: 'classic',
  icon: '\u{1F330}', // chestnut (Emoji 1.0): the game is played with seeds
  tagline: 'Sow your stones round the board and bank more than your rival.',
  skills: ['counting', 'tempo', 'planning ahead'],
  seats: { min: 2, max: 2 },
  minutes: '5-10',
  paceSec: 8,
  howTo: [
    'On your turn pick one of your six pits. All its stones are lifted and dropped one at a time into the next pits, counter-clockwise.',
    'Your own store gets a stone as you pass it. Your opponent\'s store is skipped.',
    'If your last stone lands in your store, you move again.',
    'If your last stone lands in an empty pit on your side and the pit across from it has stones, you capture both into your store.',
    'When one side has no stones left, the other player keeps what is still on their side. Most stones in the store wins. Equal stores is a draw.',
  ],
  watchFor: 'Count before you lift: a pit whose stones end exactly in your store gives you another move.',
  lesson: 'Mancala rewards counting before acting. A move that ends in your store buys a second move at no cost, the way a well sequenced week lets one piece of work unlock the next. It also punishes hoarding: stones piled in one pit look like strength, but they are inventory your opponent can capture or that you must eventually hand over. Cash in the store is the only number that counts at the end, just as banked revenue counts and pipeline does not.',
  reflection: [
    'Which move gave you an extra turn, and did you count it out first or find it by luck?',
    'Where in your business are you holding a big pile in play that would be safer banked?',
    'When did you give your opponent stones in order to set up something better? What is the business version of that trade?',
  ],
  seo: {
    title: 'Play Mancala Online Free, With Friends or a Bot | VentureArena',
    description: 'Free online Mancala. No signup: play a bot in one click or invite a friend with a link. Learn the extra-turn and capture rules and the business lesson behind them.',
    intro: 'Mancala is one of the oldest counting games in the world: two rows of six pits, four stones in each, and a store for each player. On VentureArena you can play it free in your browser against a bot or a friend, on a phone or a laptop, with no download and no account.',
    strategy: [
      'Start with the pit that ends in your store. With four stones in each pit, your third pit, counting in the direction of play, does exactly that and gives you a second move.',
      'Keep the pit next to your store empty or nearly empty. A single stone there is a free extra turn whenever you need one.',
      'Look for empty pits on your side. If you can land your last stone in one while the pit across from it is full, you capture the lot.',
      'Late in the game, count what is left on each side. The player with stones still in their pits when the other runs out keeps all of them.',
    ],
  },
};
