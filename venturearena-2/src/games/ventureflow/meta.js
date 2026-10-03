// Everything the arena, the lobby card, the how-to-play panel and the static
// SEO page say about VentureFlow. Text only: safe to import anywhere.
// The rules overview is drawn from the game's own rulebook (vf/data/rulebook.js);
// tests/rules-ventureflow.test.js checks the figures quoted here against the
// game's config so the page cannot drift from the rules.
export default {
  id: 'ventureflow',
  name: 'VentureFlow',
  brand: 'VentureFlow™',
  family: 'venturemaker',
  icon: '\u{1F4B8}', // money with wings (Emoji 1.0)
  tagline: 'Turn an allowance into an empire. 24 months of buying, building and riding the weather.',
  skills: ['cash flow', 'investing', 'business building'],
  seats: { min: 2, max: 4, defaultSize: 4 },
  minutes: '15-25',
  // A thoughtful turn takes most of a minute: several purchases, maybe a business.
  paceSec: 45,
  hasSettings: true,
  howTo: [
    'Everyone starts with the same cash and gets the same allowance every month. The game runs for 24 months.',
    'On your turn do as much as you can afford: buy or sell Piggy Banks, Seasoned Services, Tree Houses and Treasure Chests, learn a skill, start a business, or reinvest in a business you own.',
    'Press "Done!" to pass. When everyone has gone the month wraps up: everybody is paid, everybody draws a fortune card, prices drift and the economic weather may change.',
    'A business costs $300 and one skill token (a skill costs $100) and pays you every month from then on. Open your own player card to grow it with Marketing, Sales, Operations and R&D.',
    'Highest net worth after month 24 wins: your cash, plus what you own at today\'s prices, plus everything you have invested in your businesses.',
  ],
  rulesText: [
    { h: 'The goal', p: 'VentureFlow runs for 24 months. Whoever has the highest net worth when the last month ends, wins. Net worth is the cash in your pocket, plus what everything you own is worth right now, plus everything you have invested into your businesses. Cash sitting still does nothing; the game is about turning cash into things that earn.' },
    { h: 'How a turn works', p: 'On your turn you can do as much as you can afford: buy things, sell things, learn a skill, start a business, and reinvest in businesses you already own. There is no limit on the number of actions, only on your cash. Press "Done!" to pass. Once every player has gone, the month wraps up in this order: R&D projects that are due pay off, neglected businesses lose a little income, a buyout offer may appear, everyone gets paid, everyone draws a fortune card, prices drift, badges are awarded, and the weather may change. A table seats up to 4 players; robots fill any chairs people leave empty.' },
    { h: 'Where money comes from', p: 'Your allowance arrives every month no matter what, and it is the only money you get for free ($150 a month on the standard setting). Every business you own pays its monthly income. Some things you buy pay rent or interest just for owning them. Each player draws one fortune card a month: some hand you cash, some cost you cash, some move prices. And a buyer may offer to buy one of your businesses outright for a big one-time payday.' },
    { h: 'What you can buy', p: 'Four things, from safe to risky. The Piggy Bank (about $50) is very safe and pays a little interest every month. Seasoned Services (about $75) is medium risk and pays an amount that is rerolled every month with the weather. The Tree House (about $250) pays rent every month, and the rent drops a bit once the whole table owns more than two between them. The Treasure Chest (about $100) is high risk and pays nothing monthly: you only make money if its price goes up. Prices move every month with the weather plus a random wobble of their own. Anything you sell in the same turn you bought it returns 10% less.' },
    { h: 'Starting and growing a business', p: 'A business costs $300 plus 1 skill token, and pays $30 to $70 a month from then on. A skill token costs $100, so learn first, then build. Four investment tracks grow a business: Marketing is a revenue bump that lasts 3 months and then fades; Sales is a permanent bump, up to 3 levels; Operations makes every other upgrade on that business cheaper; R&D costs the most, takes 2 months and always pays something permanent. Every payoff is a percentage of that business\'s current income, so reinvesting early compounds.' },
    { h: 'Neglect and decline', p: 'Leave a business alone for 6 months with no investment of any kind and it starts to slide, losing 5% to 10% of its income every 3 months until you tend to it again. Buying any upgrade, even the cheapest one, resets the clock.' },
    { h: 'Buyout offers', p: 'Roughly once every 6 months a buyer approaches one random business owner about their most valuable business. If it is you, the game pauses and you decide: take the cash, or keep the monthly income. The offer is a multiple of a year of that business\'s revenue, from a lowball 1x to a very rare 15x, so the bigger you have grown it, the bigger the cheque. Selling ends that monthly income for good.' },
    { h: 'The economic weather', p: 'The economy cycles through five kinds of weather in order, on a timer nobody can see: Sunny Boom, Cloudy Peak, Rainy Dip, Stormy Bust and Rainbow Rebound. The weather pushes every price up or down, moves business revenue, and decides how likely a good fortune card is versus a bad one. Storms are not only bad news: everything is cheaper to buy, and the cycle always turns. The host chooses how hard the weather swings: Gentle, Normal, Rough or Severe.' },
    { h: 'Fortune cards', p: 'At the end of every month each player draws one card. Some are opportunities, some are setbacks, and which deck is more likely depends on the weather. A card about a thing only affects players who own that thing. Setbacks are meant to be survivable, not fatal: a business can never be driven to zero income, and nothing you already bought is confiscated.' },
    { h: 'Scenarios, clock and robots', p: 'The host picks the scenario: Classic Growth, Passive Income Race, Survive the Crash (you start mid-storm) or Business Sprint (three businesses running by month 12). Net worth after 24 months decides the ranking in every scenario. A table can play on a clock: 30 seconds a turn, with 4 extensions each. Robots with their own personalities and skill levels fill the chairs people leave empty, and a robot finishes the game for anyone who leaves.' },
  ],
  watchFor: 'Buy a skill early, then a business. Spread out so one crash cannot sink you, and never let a business go quiet for six months.',
  lesson: 'VentureFlow is about the timing of money. The players who win rarely raise the most; they raise before they need to and spend into proven demand. Look at your lowest cash point: that is the moment your venture was actually at risk.',
  reflection: [
    'When was your cash the tightest, and what decision put it there?',
    'Who would you have partnered with in round 6, and why?',
    'Did you raise too early, too late, or just right?',
  ],
  seo: {
    title: 'Play VentureFlow Online Free: The Cash Flow and Business Building Game | VentureArena',
    description: 'Free online VentureFlow. Turn a monthly allowance into businesses, rent and investments over 24 months, against friends or robot rivals. Learn cash flow, diversification and compounding by playing.',
    intro: 'VentureFlow is a 24-month money game by VentureMaker. Everyone starts with the same cash and the same allowance; what you buy, when you build a business and how you ride the economic weather decides who finishes richest. On VentureArena you can play it free in your browser with up to four people, with robots filling the empty chairs, on a phone or a laptop.',
    strategy: [
      'Buy a skill early, then a business. A business out-earns everything else in the game over 24 months.',
      'Spread out. Owning one of everything protects you when one thing crashes: that is what diversification means.',
      'Reinvest in what you already own before starting something new. Percentage payoffs compound on a bigger base.',
      'Marketing is a spike, not a strategy. Sales and R&D are permanent; campaigns fade.',
      'Never let a business go quiet for six months. A cheap upgrade costs less than the income you lose to decline.',
    ],
  },
};
