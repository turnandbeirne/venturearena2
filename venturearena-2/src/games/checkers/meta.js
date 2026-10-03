// Everything the arena, the lobby card, the how-to-play panel and the static
// SEO page say about this game. Text only: safe to import anywhere.
export default {
  id: 'checkers',
  name: 'Checkers',
  family: 'classic',
  icon: '\u{1F3C1}', // chequered flag: the board pattern (Emoji 1.0)
  tagline: 'Jump, capture, crown a king. Every capture is forced, so set the trap first.',
  skills: ['planning ahead', 'trade-offs', 'tempo'],
  seats: { min: 2, max: 2 },
  minutes: '5-15',
  paceSec: 8,
  howTo: [
    'Pieces move one square diagonally forward on the dark squares. Tap a piece, then tap a marked square.',
    'Capture by jumping over a piece next to yours into the empty square behind it. If you can capture, you must.',
    'If the same piece can jump again after a capture, it keeps jumping in the same turn.',
    'A piece that reaches the far row is crowned a king and its move ends. Kings move and capture backwards as well as forwards.',
    'You win when the other player has no pieces left or cannot move. Forty moves each with no capture and only kings moving is a draw.',
  ],
  watchFor: 'Because captures are forced, you can offer one piece to pull an opponent out of position and take two back.',
  lesson: 'In Checkers a capture is not a choice: if it is there, you must take it. Strong players use that rule against the other side, giving up one piece to drag a defender out of place and win two. Businesses have forced moves too: a competitor has to answer a price cut, a deadline or a key customer\'s demand, and knowing what they are obliged to do next lets you plan past it. The back row teaches the other half: every piece you push forward stops guarding home, so growth always spends some of your defence.',
  reflection: [
    'Which exchange did you offer on purpose, and which did you walk into? What would have told them apart beforehand?',
    'What is a forced move in your business: something a competitor, a customer or you have to respond to?',
    'When did you leave your back row, and what did it cost? What do you leave unguarded as you grow?',
  ],
  seo: {
    title: 'Play Checkers Online Free, With Friends or a Bot | VentureArena',
    description: 'Free online Checkers (English draughts). No signup: play a bot in one click or invite a friend with a link. Learn forced captures, the two-for-one and the business lesson behind them.',
    intro: 'Checkers, also called English draughts, is the classic jumping game on the dark squares of an 8 by 8 board. On VentureArena you can play it free in your browser against a bot or a friend, on a phone or a laptop, with no download and no account.',
    strategy: [
      'Keep your back row at home as long as you can. An opponent cannot crown a king on a square you still guard.',
      'Move in pairs. A piece with a friend behind it cannot be jumped.',
      'Look for the two-for-one. Offer a piece when the forced capture leaves the capturing piece open to a double jump.',
      'Trade when you are ahead. With fewer pieces on the board, one extra piece decides the game.',
    ],
  },
};
