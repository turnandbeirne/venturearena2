// Everything the arena, the lobby card, the how-to-play panel, the debrief and
// the static SEO page say about VentureBoom. Text only: safe to import anywhere.
// Per the owner's rulebook, no real person is named here or on any card.
export default {
  id: 'ventureboom',
  name: 'VentureBoom',
  brand: 'VentureBoom™',
  family: 'venturemaker',
  icon: '\u{1F4A5}', // collision (Emoji 1.0)
  tagline: 'Collect founders, cash out Exits, and dodge the BOOM that bankrupts you. A VentureMaker™ learning game.',
  skills: ['deal making', 'risk', 'portfolio thinking'],
  seats: { min: 2, max: 6, defaultSize: 4 },
  minutes: '15-40',
  paceSec: 10,
  hasSettings: true,
  howTo: [
    'You start each round (a "quarter") with 8 cards, one of them a Pivot. On your turn, play as many cards as you like, then draw one card to end your turn.',
    'Founder cards come in six sets of five. Tap three or more from one set and bank them as an Exit: Seed (3 cards) $3M, Series A (4) $6M, Dream Team (all 5) $10M. One founder from each of the six sets is a Full-Stack Company, $15M. Unicorns are wild.',
    'Or spend founders on rivals: two of a set is a Poach (steal a random card), three is an Acqui-hire (name a card and take it if they hold it), and five different cards is a Portfolio Review (take any card from the discard pile).',
    'Action cards bend the turn: Market Research peeks at the top three cards, Reorg shuffles the deck, Out of Office ends a turn without drawing, Hostile Takeover ends yours and gives the next player two, Ask a Mentor makes a player hand you a card.',
    'Any player can stop an action or an Exit with a Hard Pass, even off-turn. A Hard Pass can be Hard Passed back.',
    'Draw a BOOM and your Pivot saves you: you slide the BOOM back into the deck wherever you like, in secret. Draw a BOOM with no Pivot and you are bankrupt: the round ends, everyone else scores $1M for surviving, and all hands are thrown in.',
    'After the last quarter the highest total valuation wins. Ties go to fewer bankruptcies, then to more Dream Team and Full-Stack Exits.',
  ],
  rulesText: [
    {
      h: 'The goal',
      p: 'VentureBoom is played over 12 rounds, called quarters (4 in the short Fiscal Year game). In every quarter you collect founder cards, cash sets of them out as Exits for valuation, and try not to be the player who draws a BOOM without a Pivot. The highest total valuation after the last quarter wins.',
    },
    {
      h: 'Setting up a quarter',
      p: 'The deck has 70 cards. Every quarter the BOOM and Pivot cards are taken out, each player is dealt one Pivot, and the leftover Pivots are shuffled back in. Everyone is then dealt seven more cards, for a hand of eight. Finally BOOM cards equal to the number of players minus one are shuffled into the draw pile. Round one starts with the first seat; after that the player to the left of whoever went bankrupt starts.',
    },
    {
      h: 'Your turn',
      p: 'A turn is play, then draw. You may play as many cards as you like, one at a time, each one finishing before the next: action cards, founder combos and Exits. Then you end your turn by drawing the top card of the draw pile. There is no hand limit. Hostile Takeover and Out of Office end a turn without drawing.',
    },
    {
      h: 'Action cards',
      p: 'Market Research lets you secretly look at the top three cards of the draw pile. Reorg shuffles the draw pile. Out of Office ends one turn without drawing. Hostile Takeover ends your turn without drawing and makes the next player take two turns; if that player passes it on, the turns stack by two each time. Ask a Mentor picks a player, who must give you one card of their choice. Hard Pass stops any action, combo or Exit except a BOOM or a Pivot; it can be played at any time, even when it is not your turn, and a Hard Pass can itself be Hard Passed.',
    },
    {
      h: 'Founders and combos',
      p: 'There are six founder sets of five cards each: Inventors, Innovators, Operators, Investors, Hustlers and Connectors. A founder has no power alone. Two from the same set is a Poach: steal a random card from any player. Three from the same set is an Acqui-hire: name a card, and if the player you choose holds it, they give it to you. Five cards with five different names, of any type, is a Portfolio Review: take any card from the discard pile. The two Unicorn cards are wild and count as any founder in any set.',
    },
    {
      h: 'Exits and what they are worth',
      p: 'On your turn you can lay a set face up as an Exit and score it right away. A Seed Exit is three from the same set, worth $3M. A Series A Exit is four from the same set, worth $6M. A Dream Team is all five from one set, worth $10M. A Full-Stack Company is one founder from each of the six sets, worth $15M. You may make several Exits in one turn. An Exit can be stopped with a Hard Pass, in which case the deal falls through and its cards go to the discard pile. In the Hot Market variant, Exit values double in the last three quarters.',
    },
    {
      h: 'BOOMs and Pivots',
      p: 'When you draw a BOOM it is revealed at once. If you hold a Pivot, it is spent to cancel the BOOM, you secretly put the BOOM back anywhere in the draw pile, and your turn ends. If you have no Pivot you are bankrupt and the quarter ends immediately. A BOOM and a Pivot cannot be stopped with a Hard Pass.',
    },
    {
      h: 'Ending a quarter and winning',
      p: 'A quarter ends the moment one player goes bankrupt. That player scores nothing more this quarter, although Exits they banked earlier still count, and takes one bankruptcy mark. Every other player scores a $1M survival bonus. All hands and Exit areas are gathered and the next quarter is dealt. After the final quarter the highest total valuation wins; ties go to the player with fewer bankruptcies, then to the player with more Dream Team and Full-Stack Exits. In the Kids\' edition there are no Hostile Takeover cards and a bankrupt player keeps their hand for the next quarter.',
    },
  ],
  watchFor: 'Cards in your hand are worth nothing when the quarter ends. Bank an Exit when you have one, count how thin the draw pile is getting, and keep a Hard Pass for the deal that matters.',
  lesson: 'VentureBoom teaches portfolio thinking. No single card wins: sets do. A hand full of one kind of founder looks strong, but it takes a team, a mix of inventors, operators, investors and people who can sell and connect, to make the biggest Exit on the table, the Full-Stack Company. Founders who diversify their skills and relationships are the ones still standing after the boom rounds that wipe out specialists. Notice the second lesson too: value in your hand is not value. A set you were saving for a bigger Exit is worth nothing if the BOOM lands first, which is why real founders take money off the table, keep some runway (a Pivot) in reserve, and watch the market (the thinning draw pile) before they bet the company on one more draw.',
  reflection: [
    'Which entrepreneur type did you find hardest to collect, and who do you know like that?',
    'When did you know the boom was coming, and what did you do about it?',
    'Did you bank small Exits early or hold out for a bigger one? What would make you choose differently in a real business?',
    'Who at the table stopped one of your deals, and what could you have done to protect it?',
  ],
  seo: {
    title: 'Play VentureBoom™ Online Free: the Startup Card Game of Founders, Exits and BOOMs | VentureArena',
    description: 'VentureBoom™ is a free online card game for 2 to 6 players from VentureMaker™. Collect founder sets, cash them out as Exits, block rival deals with a Hard Pass and survive the BOOM. Play bots or friends in your browser.',
    intro: 'VentureBoom™ is a push-your-luck card game about building a startup. Each short round you collect founders in six skill sets, bank them as Exits for valuation, and try not to draw the BOOM that bankrupts you. On VentureArena you can play it free in your browser, on a phone or a laptop, against bots or with friends, and every card links to a short lesson on the real business idea behind it.',
    strategy: [
      'Bank early. A Seed Exit on the table scores $3M; the same three cards in your hand score nothing when someone goes bankrupt.',
      'Count the deck. Every BOOM dealt into the quarter stays in the draw pile, so the thinner the pile, the more dangerous each draw. Use Market Research before a blind draw late in a quarter.',
      'Protect your Pivot. With no Pivot in hand, Out of Office and Hostile Takeover are your way out of a draw you do not like.',
      'Collect across sets as well as within them. One founder from each of the six sets is worth more than any single set.',
      'Save a Hard Pass for a rival\'s big Exit or for a Hostile Takeover aimed at you, and expect yours to be Hard Passed too.',
    ],
  },
};
