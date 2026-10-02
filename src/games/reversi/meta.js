// Everything the arena, the lobby card, the how-to-play panel and the static
// SEO page say about this game. Text only: safe to import anywhere.
export default {
  id: 'reversi',
  name: 'Reversi',
  family: 'classic',
  icon: '\u{1F317}', // last quarter moon: a disc half light, half dark (Emoji 1.0)
  tagline: 'Trap a line of discs and flip it. The lead can change on the last move.',
  skills: ['positioning', 'patience', 'planning ahead'],
  seats: { min: 2, max: 2 },
  minutes: '5-10',
  paceSec: 9,
  howTo: [
    'Take turns placing one disc on an empty square. The dots show where you can play.',
    'Your disc must trap at least one straight line of the other player\'s discs between it and another disc of yours. Every trapped disc flips to your colour.',
    'If you have no legal move, your turn is skipped automatically and the other player goes again.',
    'The game ends when neither player can move. The player with more discs wins. An equal count is a draw.',
  ],
  watchFor: 'A corner can never be flipped back, so stay off the squares next to an empty corner and keep your opponent short of good moves.',
  lesson: 'In Reversi the player with the most discs halfway through often loses. Every disc you flip early is a disc your opponent can flip back, and each one opens new moves for them. What lasts is a position that cannot be taken away, such as a corner and the edge built from it, and having more good moves left than the other side. A business works the same way: early revenue that any competitor can win back matters less than a contract, a channel or a reputation they cannot dislodge.',
  reflection: [
    'Who had more discs at the halfway point, and who won? Which numbers in your business look good early but can be flipped back?',
    'Which corner decided the game, and which earlier move gave it away?',
    'Where in your market is there a position that, once taken, cannot be taken back?',
  ],
  seo: {
    title: 'Play Reversi Online Free, With Friends or a Bot | VentureArena',
    description: 'Free online Reversi. No signup: play a bot in one click or invite a friend with a link. Learn corner and mobility strategy and the business lesson behind it.',
    intro: 'Reversi is the classic disc-flipping strategy game on an 8 by 8 board. On VentureArena you can play it free in your browser against a bot or a friend, on a phone or a laptop, with no download and no account.',
    strategy: [
      'Take corners. A corner disc can never be flipped, and it anchors the edges next to it.',
      'Stay off the squares next to an empty corner. A disc there usually hands the corner to your opponent.',
      'Flip fewer discs early. A small, compact group leaves your opponent few moves. A wide spread of discs gives them many.',
      'Count moves, not discs. An opponent who runs out of safe moves has to give you something.',
    ],
  },
};
