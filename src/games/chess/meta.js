// Everything the arena, the lobby card, the how-to-play panel and the static
// SEO page say about this game. Text only: safe to import anywhere.
export default {
  id: 'chess',
  name: 'Chess',
  family: 'classic',
  icon: '\u{265F}', // chess pawn (Emoji 11)
  tagline: 'The original strategy game. Every piece has a job and every move has a cost.',
  skills: ['calculation', 'tactics', 'planning ahead'],
  seats: { min: 2, max: 2 },
  minutes: '10-30',
  paceSec: 20,
  howTo: [
    'White moves first, then players take turns moving one piece. Tap a piece to see where it can go, then tap one of the marked squares.',
    'Each piece moves its own way: rooks in straight lines, bishops on diagonals, the queen both, knights in an L that jumps over pieces, the king one square, pawns forward and capturing diagonally.',
    'Land on an enemy piece to capture it. If your king is attacked (check) you must deal with it on your next move.',
    'Special moves: castling tucks the king behind a rook, a pawn that reaches the far side becomes a queen or another piece you choose, and a pawn can capture en passant right after an enemy pawn runs two squares past it.',
    'Checkmate wins: the king is attacked and has no escape. The game is a draw by stalemate, the same position three times, fifty moves each with no capture or pawn move, or too few pieces left to mate.',
  ],
  watchFor: 'Before every move, ask what your opponent\'s last move now attacks, and which of your pieces has nobody defending it.',
  lesson: 'Chess punishes the move that looks good on its own. A piece that wins a pawn but ends up undefended is a deal that books revenue and leaves a liability, and the bill arrives two moves later. Strong players spend the opening getting every piece working before they attack, the same way a company needs product, sales and cash in place before it picks a fight with a bigger rival. And because each side moves once per turn, tempo is a resource: a move that forces a reply is worth more than a move your opponent can ignore.',
  reflection: [
    'Which piece of yours did the least work this game? What is the idle asset in your business?',
    'Think of the move you lost material on. What did you see, and what did you not check before you played it?',
    'When did you trade pieces, and did the trade favour the side that was already ahead? When does simplifying help you in a negotiation?',
  ],
  seo: {
    title: 'Play Chess Online Free, With Friends or a Bot | VentureArena',
    description: 'Free online chess. No signup: play a bot in one click or invite a friend with a link. Full rules with castling, en passant and promotion, plus the business lesson behind the game.',
    intro: 'Chess is the classic game of strategy on an 8 by 8 board: sixteen pieces a side and one goal, to trap the enemy king. On VentureArena you can play it free in your browser against a bot or a friend, on a phone or a laptop, with no download and no account.',
    strategy: [
      'Fight for the centre. Pawns and pieces on the four middle squares reach both sides of the board and cramp your opponent.',
      'Develop before you attack. Bring out both knights and both bishops and castle before you move any piece twice.',
      'Check every capture, check and threat before you move, yours and theirs. Most games between newer players are decided by a piece left undefended.',
      'When you are ahead in material, trade pieces. When you are behind, keep them on and look for complications.',
    ],
  },
};
