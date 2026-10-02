// Everything the arena, the lobby card, the how-to-play panel and the static
// SEO page say about this game. Text only: safe to import anywhere.
export default {
  id: 'fourinarow',
  name: 'Four in a Row',
  family: 'classic',
  icon: '\u{1F534}', // red circle (Emoji 1.0)
  tagline: 'Drop discs, line up four. Two minutes to learn, a career to master.',
  skills: ['pattern recognition', 'positioning', 'patience'],
  seats: { min: 2, max: 2 },
  minutes: '3-5',
  howTo: [
    'Take turns dropping one disc into any column that still has room. It falls to the lowest empty space.',
    'Line up four of your own discs in a row, across, down or diagonally, to win.',
    'If the board fills up with no four in a row, the game is a draw.',
  ],
  watchFor: 'Control the centre column, and build threats in two directions at once.',
  lesson: 'Four in a Row rewards players who build threats in two directions at once. In business the same move is called optionality: make choices that leave you two good next steps, and force competitors into one. Watch how often the winner controlled the centre column: the centre is where the most lines pass through, just as the most valuable position in a market is the one the most customer journeys pass through.',
  reflection: [
    'Which move did you regret, and what would you have needed to see earlier?',
    'Did you play to win or play not to lose? When does each make sense in a business?',
    'What did the centre column teach you about positioning?',
  ],
  seo: {
    title: 'Play Four in a Row Online Free, With Friends or a Bot | VentureArena',
    description: 'Free online Four in a Row. No signup: play a bot in one click or invite a friend with a link. Learn the centre-column strategy and the business lesson behind it.',
    intro: 'Four in a Row is the classic vertical line-up game on a 7 by 6 grid. On VentureArena you can play it free in your browser against a bot or a friend, on a phone or a laptop, with no download and no account.',
    strategy: [
      'Open in the centre. A disc in the middle column can be part of more winning lines than a disc anywhere else.',
      'Count the threats. A position where you have two different ways to make four on your next move cannot be blocked.',
      'Watch the row under a threat. Do not drop the disc that lets your opponent land on their winning square.',
    ],
  },
};
