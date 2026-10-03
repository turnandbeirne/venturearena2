// VentureBoom(TM): the Hall of Fame. The real business behind every card.
//
// The rulebook keeps real people OFF the cards: every founder card is an
// original parody character, and "the real person lives only on the Hall of
// Fame page". This folder is that page, inside the app. It is the only place
// in the game where a real name appears, which is why it is a folder of its
// own: tests/rules-ventureboom.test.js reads every file beside the cards and
// fails if one of them names a real entrepreneur, and tests/game-info.test.js
// checks that nothing but the Key (info.js) reads this file.
//
// For each card: the trait it stands for, the lesson, and one short true story
// of a venturemaster that shows it. Each founder card tells the story of the
// person the rulebook's Hall of Fame pairs it with.
//
// House rules for this file:
//  * Facts only, in our own words. No invented quotes, no quoted speech at all.
//  * Figures are rounded and say "about" when they are.
//  * One story per card, three to five sentences. `who` names the people or
//    company so the Key can show it as the story's heading.
//  * Keyed by card key (cards.js) for cards, and by DYNAMICS id for moves.
//  * tests/game-info.test.js fails if a card has no story.

export const STORY_NOTE = 'Short summaries written for the game. Figures are rounded; look the story up before you quote it.';

export const STORIES = {
  // ---- BOOMs: the five ways a startup dies in this game ----------------------
  'server-fire': {
    trait: 'Operational risk',
    lesson: 'Something will break. The only question is whether you planned for it before it did.',
    who: 'Amazon Web Services, 2017',
    story: 'On 28 February 2017 an engineer fixing a billing problem in Amazon\'s S3 storage service typed a command that took far more servers offline than intended. S3 in the eastern United States was down for about four hours, and a long list of other companies\' websites and apps went down with it. Amazon published what happened and changed its tools so that capacity could only be removed slowly and never below a safe minimum.',
  },
  'co-founder-breakup': {
    trait: 'Founder conflict',
    lesson: 'Agree who owns what, who decides what and what happens if someone leaves, in writing, while everyone still likes each other.',
    who: 'Snapchat and Reggie Brown',
    story: 'Reggie Brown worked on the disappearing-photo idea with Evan Spiegel and Bobby Murphy at Stanford in 2011 and was pushed out that summer, before the company had any agreement about who owned what. He sued in 2013. The company settled in 2014 for about $158 million and acknowledged his part in the original idea.',
  },
  'the-lawsuit': {
    trait: 'Legal and intellectual-property risk',
    lesson: 'Know whose ideas you are building on. A product that sells well can still be ordered off the shelves.',
    who: 'Polaroid v. Kodak',
    story: 'Kodak launched its own instant cameras in 1976 and Polaroid sued within days, saying they copied its patents. Nearly ten years later a court agreed. Kodak had to leave the instant-photography business in 1986, leaving about 16 million camera owners with no film to buy and owed compensation, and in 1991 it paid Polaroid about $925 million.',
  },
  'the-bubble-pops': {
    trait: 'Market cycles and hype',
    lesson: 'When everything is going up, prices stop telling you which businesses are good. Build one that survives the day the mood changes.',
    who: 'Pets.com and the dot-com crash',
    story: 'Pets.com sold shares to the public in February 2000, weeks before the Nasdaq index peaked. It was selling pet food online for less than it cost to buy and ship, and when the market turned nobody would fund the losses. It closed in November 2000, about nine months after its share sale. The Nasdaq went on to lose more than three quarters of its value by late 2002.',
  },
  'runway-ran-out': {
    trait: 'Burn rate and runway',
    lesson: 'Runway is the cash you have divided by the cash you spend each month. Spending ahead of proven demand shortens it faster than anything else.',
    who: 'Webvan',
    story: 'Webvan raised hundreds of millions of dollars in 1999 to deliver groceries ordered online and signed a contract worth about a billion dollars to build automated warehouses across the United States, before its first city was making money. Orders never came close to filling the warehouses. It ran out of cash and filed for bankruptcy in July 2001.',
  },

  // ---- saves and stops -----------------------------------------------------------
  pivot: {
    trait: 'The pivot',
    lesson: 'When the plan is failing, look at what is quietly working inside it. That may be the real business.',
    who: 'Stewart Butterfield and Slack',
    story: 'Stewart Butterfield\'s company spent years building an online game called Glitch and shut it down in 2012 for lack of players. The chat tool the team had built for themselves to make the game was the part that worked. They released it as Slack, and Salesforce bought the company in 2021 for about $27.7 billion.',
  },
  'hard-pass': {
    trait: 'Rejection',
    lesson: 'A no tells you about one person on one day. Collect them, learn from them, keep going.',
    who: 'Brian Acton and WhatsApp',
    story: 'In 2009 Brian Acton, an engineer who had spent years at Yahoo, applied for jobs at Twitter and at Facebook. Both turned him down, and he said so publicly at the time, adding that he was looking forward to whatever came next. What came next was WhatsApp, which his friend and former Yahoo colleague Jan Koum had set up earlier that year and which Acton joined as co-founder that autumn. In 2014 Facebook bought it for about $19 billion.',
  },

  // ---- action cards ----------------------------------------------------------------
  'hostile-takeover': {
    trait: 'Hostile acquisitions',
    lesson: 'If you sell shares to the public, the shareholders decide who owns the company. A board that says no can still be outbid.',
    who: 'Kraft and Cadbury',
    story: 'In 2009 Kraft Foods offered to buy Cadbury, the British chocolate maker. Cadbury\'s board rejected the offer, so Kraft took it straight to Cadbury\'s shareholders. After months of public argument Kraft raised its bid to about £11.5 billion in January 2010, and Cadbury\'s board gave in and recommended it. The deal was so unpopular in Britain that the country\'s takeover rules were tightened afterwards.',
  },
  'out-of-office': {
    trait: 'Strategic patience',
    lesson: 'You do not have to act on every turn. Stepping back to think is a decision, and sometimes the best one available.',
    who: 'Bill Gates and the Think Week',
    story: 'For years Bill Gates took a week away from Microsoft twice a year, alone in a cabin, with a stack of papers written by people across the company about where technology was going. He read, thought and wrote back. After one of those weeks in 1995 he sent Microsoft\'s senior managers a long memo giving the internet the highest level of importance, and the company changed course.',
  },
  'market-research': {
    trait: 'Customer discovery',
    lesson: 'Find out whether people will pay before you build the whole thing.',
    who: 'Nick Swinmurn and Zappos',
    story: 'In 1999 Nick Swinmurn wanted to know whether people would buy shoes online without trying them on. He photographed shoes at local shops and posted the pictures on a website. When someone ordered a pair he went back to the shop, bought it at full price and posted it. He made nothing on those sales and learned what he needed: people would buy. Amazon bought Zappos ten years later in a deal worth about $1.2 billion when it closed.',
  },
  reorg: {
    trait: 'Restructuring',
    lesson: 'Doing fewer things is a strategy. A reshuffle only helps if something is actually stopped.',
    who: 'Steve Jobs at Apple, 1997',
    story: 'When Steve Jobs returned to Apple in 1997 the company was losing about a billion dollars a year and selling dozens of overlapping products. He cut most of them and drew a grid of four boxes: one desktop and one portable computer for consumers, and one of each for professionals. Apple was profitable again the following year.',
  },
  'ask-a-mentor': {
    trait: 'Mentorship',
    lesson: 'Someone has already made the mistake you are about to make. Ask them.',
    who: 'Bill Campbell',
    story: 'Bill Campbell was a college football coach before he went into business and ran the software company Intuit. In Silicon Valley he became the person chief executives called for advice: Steve Jobs at Apple, and Larry Page and Eric Schmidt at Google, among many others. He was known simply as the Coach, and he routinely refused to be paid for it.',
  },
  unicorn: {
    trait: 'Valuation and hype',
    lesson: 'A valuation is a price someone paid for a small slice on one day. It is not money in the bank.',
    who: 'Aileen Lee, and WeWork',
    story: 'The investor Aileen Lee coined the word unicorn in 2013 for young American software companies valued at a billion dollars or more, because she could find only 39 of them. WeWork later showed what the label does not tell you. It was valued at $47 billion in early 2019, tried to sell shares to the public that September, and saw its value fall by more than three quarters within weeks once outside investors read the accounts.',
  },

  // ---- moves ---------------------------------------------------------------------------
  poach: {
    trait: 'Talent wars',
    lesson: 'The people are the company. They can walk out of the door, and your rivals know it.',
    who: 'The traitorous eight',
    story: 'In 1957 eight engineers left Shockley Semiconductor together, tired of how William Shockley ran it, and started Fairchild Semiconductor. People who later left Fairchild went on to start Intel, AMD and dozens of other firms. Much of Silicon Valley traces back to that one walk-out.',
  },
  acquihire: {
    trait: 'Buying teams, not products',
    lesson: 'Sometimes the fastest way to hire a great team is to buy the company they work for.',
    who: 'Facebook and FriendFeed',
    story: 'In 2009 Facebook bought FriendFeed, a small social site with twelve staff, founded by four former Google engineers, for a price reported at around $50 million. The product was left to fade away. The people were the point: one of the founders, Bret Taylor, became Facebook\'s chief technology officer the following year.',
  },
  review: {
    trait: 'Diversification and the power law',
    lesson: 'Spread your bets, and expect one or two of them to produce most of the result.',
    who: 'Y Combinator',
    story: 'Y Combinator funds hundreds of startups a year with a small amount each. In 2012 its co-founder Paul Graham worked out that just two of them, Dropbox and Airbnb, made up about three quarters of the value of every company it had funded up to then. Most of the rest returned little or nothing, and the approach still worked.',
  },
  exits: {
    trait: 'Acquisitions and public share sales',
    lesson: 'Value in your hand is worth nothing until you bank it. An exit turns it into something real.',
    who: 'Instagram',
    story: 'Instagram launched in October 2010. In April 2012, with 13 employees and no revenue, it agreed to be bought by Facebook for about a billion dollars in cash and shares. A year and a half from launch to exit is unusually fast; what is typical is that the founders chose to bank a certain result over an uncertain bigger one.',
  },
  survival: {
    trait: 'Default alive',
    lesson: 'A business that takes in more than it spends can keep playing for as long as it likes.',
    who: 'Mailchimp',
    story: 'Ben Chestnut and Dan Kurzius, with a third partner who later left, started Mailchimp in 2001 as a side project of their web design firm. They never took money from outside investors and grew only as fast as their customers paid for. Twenty years later they sold the company to Intuit for about $12 billion. The phrase default alive is Paul Graham\'s, from a 2015 essay asking founders whether they would reach profit on the cash they already had.',
  },

  // ---- Inventors: make the thing work ----------------------------------------------------
  'duct-tape-dana': {
    trait: 'Resourcefulness',
    lesson: 'A small budget makes you find the cheap way to learn. That is often the better way.',
    who: 'The Wright brothers',
    story: 'Wilbur and Orville Wright ran a bicycle shop in Dayton, Ohio, and paid for their flying experiments out of what it earned, about a thousand dollars in all. After two disappointing gliders they built their own wind tunnel from a wooden box and tested some two hundred wing shapes in it before designing the aircraft that worked. On 17 December 1903 they made the first controlled, powered aeroplane flights. A rival project backed by tens of thousands of dollars of government money had crashed into a river nine days earlier.',
  },
  'prototype-pete': {
    trait: 'Iteration',
    lesson: 'Each failed version is a lesson you paid for. Change one thing and try again.',
    who: 'James Dyson',
    story: 'James Dyson got fed up with a vacuum cleaner that lost suction as its bag filled. Over about five years he built 5,127 prototypes of a bagless one, changing one thing at a time. Established makers turned the finished design down, partly because they made good money selling bags, so he eventually started his own company to sell it.',
  },
  'patent-pending-priya': {
    trait: 'Protecting an invention',
    lesson: 'Get your claim on paper early, and remember that filing is only the start: a patent protects a business, it is not one.',
    who: 'Thomas Edison',
    story: 'Thomas Edison was granted 1,093 patents in the United States, more than any other person of his time. In 1876 he set up a laboratory at Menlo Park in New Jersey whose only product was inventions, with a team working on many at once. His patent for a practical electric lamp was granted in January 1880, and he then built the power stations and wiring needed to sell light, because the patent alone earned nothing.',
  },
  'sir-solders-a-lot': {
    trait: 'Craft',
    lesson: 'Someone on the team has to be able to actually build it.',
    who: 'Steve Wozniak and the Apple I',
    story: 'Steve Wozniak designed the first Apple computer in 1976 and built the early ones by hand. A local shop, the Byte Shop, ordered fifty, on the condition that they arrived assembled rather than as kits. Wozniak and Steve Jobs put them together in the Jobs family home, and that order was the start of Apple as a business.',
  },
  'widget-wendy': {
    trait: 'Solving your own problem',
    lesson: 'The best product ideas often start with something that annoys you every day.',
    who: 'Josephine Cochrane',
    story: 'Josephine Cochrane wanted her dishes washed faster and without the chips that came from washing them by hand. She designed a machine that held each dish in a wire rack and sprayed it with hot soapy water under pressure, and patented it in 1886. Hotels and restaurants were her first customers. She showed it at the 1893 World\'s Fair in Chicago, where it won an award, and the company she founded later became part of KitchenAid.',
  },

  // ---- Innovators: see a new way ---------------------------------------------------------
  'disrupto-the-great': {
    trait: 'Disruption',
    lesson: 'The newcomer that looks like a toy to the market leader is the one to watch.',
    who: 'Steve Jobs and the iPhone',
    story: 'When Steve Jobs showed the first iPhone in January 2007, Apple had never made a phone, and bosses at several established phone makers said in public that it did not worry them: it was expensive, had no keyboard and could not even copy and paste. It went on sale that June. Nokia was then the largest phone maker in the world. Six years later Nokia agreed to sell its phone business to Microsoft.',
  },
  'blockchain-brad': {
    trait: 'New technology',
    lesson: 'A new technology is worth what people can build with it. Start with the problem, then pick the tool.',
    who: 'Vitalik Buterin and Ethereum',
    story: 'Vitalik Buterin was nineteen and writing for a magazine about Bitcoin when, in late 2013, he published a paper proposing a blockchain that could run programs as well as keep track of coins. He and a small group sold the new currency in advance in 2014 to pay for the work, raising about $18 million, and the Ethereum network went live in July 2015. A great deal of hype followed, along with a lot of projects that had a blockchain and no problem to solve.',
  },
  'moonshot-molly': {
    trait: 'Ambition',
    lesson: 'A very big goal attracts people and money that a safe one never will. It also needs enough cash to survive being wrong a few times.',
    who: 'Elon Musk and SpaceX',
    story: 'The first three rockets SpaceX launched, between 2006 and 2008, all failed. Elon Musk has said the company had money for one more attempt. The fourth launch, in September 2008, reached orbit, and a few months later NASA awarded SpaceX a contract worth about $1.6 billion to carry cargo to the space station.',
  },
  'forever-beta-bea': {
    trait: 'Shipping, then improving',
    lesson: 'A product nobody can use teaches you nothing. Release it, then keep changing it.',
    who: 'Reed Hastings and Netflix',
    story: 'Netflix opened in 1998 with a simple website that rented DVDs by post. It never stopped changing the product after that. It switched to monthly subscriptions in 1999, began streaming films over the internet in 2007 and in 2013 released House of Cards, the first series it had commissioned itself, each time replacing a business that was still working. In 2000 it had offered to sell itself to Blockbuster for $50 million and was turned down. Blockbuster filed for bankruptcy ten years later.',
  },
  'its-like-x-for-y-yuri': {
    trait: 'The one-line pitch',
    lesson: 'If you can say what it is in one line, people can repeat it for you. After that the business has to stand on its own numbers.',
    who: 'Brian Chesky and Airbnb',
    story: 'In October 2007 Brian Chesky and Joe Gebbia could not pay the rent on their San Francisco flat. A design conference had filled every hotel in the city, so they put three air mattresses on their floor and offered a bed and breakfast for $80 a night. They called it AirBed and Breakfast. The name was the whole pitch, and three guests came. The following year seven well-known investors were offered a tenth of the company for $150,000. Five said no and two did not reply.',
  },

  // ---- Operators: make it repeatable -------------------------------------------------------
  'gantt-chart-gary': {
    trait: 'Planning the work',
    lesson: 'Break the job into steps, put them in order and time them. Then you can see where the hours go.',
    who: 'Henry Ford',
    story: 'In 1913 Henry Ford\'s factory at Highland Park in Michigan began building cars on a moving line, with each worker doing one timed step as the car came past. The time taken to assemble a Model T chassis fell from about twelve and a half hours to about an hour and a half. The price fell with it, from about $850 when the car was launched in 1908 to under $300 in the 1920s, and Ford sold some fifteen million of them.',
  },
  'process-patty': {
    trait: 'Process',
    lesson: 'Work out the best way to do a job once, then do it the same way every time.',
    who: 'Ray Kroc',
    story: 'In 1954 Ray Kroc, a salesman of milkshake machines, visited a hamburger restaurant in California run by Richard and Maurice McDonald. The brothers had cut their menu to nine items and laid out the kitchen like an assembly line, with each person doing one job. Kroc saw that the system, not the hamburger, was the product. He opened his first franchised restaurant in Illinois in 1955 and required every one after it to follow the same procedures to the letter.',
  },
  'kpi-kevin': {
    trait: 'Measurement',
    lesson: 'Pick the few numbers that show whether you are winning, and look at them often.',
    who: 'Andy Grove and John Doerr',
    story: 'At Intel in the 1970s Andy Grove managed by objectives and key results: a short list of goals, each with a number that would show whether it had been met. John Doerr learned the method there and in 1999 taught it to a startup of about forty people that he had just invested in. Google still uses it.',
  },
  'sop-sofia': {
    trait: 'Standards',
    lesson: 'Find the best known way to do the job, write it down and run every site the same way. Then anyone can do it right, and anyone can improve it.',
    who: 'Sam Walton',
    story: 'Sam Walton opened the first Walmart in Rogers, Arkansas, in 1962. As the chain grew he ran every store to the same standards, visited them constantly in a small plane he flew himself, and gathered his managers every Saturday morning to compare results and copy whatever was working. In the 1980s Walmart built its own satellite network, linking every store to head office so that it could track each store\'s sales and stock.',
  },
  'actually-ships-it-ashok': {
    trait: 'Execution',
    lesson: 'An idea is worth what you can deliver. Operations is where promises are kept.',
    who: 'Jeff Bezos',
    story: 'Jeff Bezos started Amazon in 1994 in a rented house near Seattle and began selling books online in July 1995, packing the first orders himself. The promise was always delivery: a wider choice, arriving sooner. In 2005 Amazon launched Prime, which offered unlimited two-day delivery in the United States for $79 a year. To keep that promise it built one of the largest networks of warehouses in the world.',
  },

  // ---- Investors: fund it and judge the risk ---------------------------------------------------
  'term-sheet-terry': {
    trait: 'Deal terms',
    lesson: 'The headline number is only one line of the deal. Read the rest.',
    who: 'Warren Buffett and Goldman Sachs',
    story: 'In September 2008, eight days after the bank Lehman Brothers collapsed, Warren Buffett\'s company put $5 billion into the bank Goldman Sachs. He did not simply buy shares. The terms gave him special shares paying 10 per cent a year, a bonus if the bank bought them back, and the right to buy another $5 billion of ordinary shares later at a fixed price. Goldman bought the special shares back in 2011, and the deal earned Berkshire Hathaway more than $3 billion.',
  },
  'due-diligence-dee': {
    trait: 'Due diligence',
    lesson: 'Before you invest, work out what would have to be true for it to go wrong, and check. Famous names around the table are not evidence.',
    who: 'Charlie Munger',
    story: 'Charlie Munger was Warren Buffett\'s business partner for more than fifty years. He was known for asking how an investment could fail before asking how it could succeed, and for saying no to almost everything. In 1972 he urged a reluctant Buffett to buy See\'s Candies for $25 million, about three times the value of its assets, because customers stayed loyal to it even when prices rose. See\'s has since earned about $2 billion before tax.',
  },
  'angel-annie': {
    trait: 'Angel investing',
    lesson: 'The earliest money is a bet on people, made before there is anything to measure.',
    who: 'Ron Conway',
    story: 'Ron Conway has been putting small sums into very young companies in Silicon Valley since the 1990s. He was an early investor in Google, PayPal, Facebook and Twitter, among several hundred others. He has said that about six in ten of the companies he backs go out of business, and that only one or two in ten return more than he put in.',
  },
  'cap-table-carl': {
    trait: 'Ownership',
    lesson: 'Know what share of the company you hold and what each new deal does to it.',
    who: 'Georges Doriot',
    story: 'Georges Doriot, a professor at Harvard Business School, helped found American Research and Development in 1946 and ran it for twenty-five years. It was one of the first firms set up to invest in new companies. In 1957 it put $70,000 into a start-up founded by two engineers, Digital Equipment Corporation, in return for about 70 per cent of the shares. When Digital sold shares to the public in 1966 that stake was worth about $38 million, and by 1971 it was worth about $355 million. The founders had built a great company and owned a small part of it.',
  },
  'keep-me-posted-phil': {
    trait: 'Commitment',
    lesson: 'Plenty of investors ask to be kept posted. The one who commits early, before the proof, gets the stake.',
    who: 'Peter Thiel and Facebook',
    story: 'In the summer of 2004 Peter Thiel put $500,000 into Facebook, which was a few months old. He was the first investor from outside the company. The money went in as a loan that would turn into shares, about a tenth of the company, if Facebook reached a target number of users by the end of the year. It missed the target narrowly and Thiel converted the loan anyway. He sold most of those shares after Facebook went public in 2012 for more than a billion dollars in total.',
  },

  // ---- Hustlers: sell it ------------------------------------------------------------------------
  'cold-call-carla': {
    trait: 'Direct selling',
    lesson: 'Talk to the customer yourself. Most people never ask for the sale.',
    who: 'Mary Kay Ash',
    story: 'Mary Kay Ash spent twenty-five years in direct sales and left after a man she had trained was promoted over her at twice her pay. In 1963 she started her own cosmetics company in Dallas with $5,000 and a small team of saleswomen, who sold to customers in their homes. She rewarded her best sellers in public, most famously with pink Cadillacs. The company now sells in dozens of countries.',
  },
  'hashtag-hank': {
    trait: 'Attention',
    lesson: 'Attention is only worth something when there is a product at the other end of it.',
    who: 'Gary Vaynerchuk',
    story: 'Gary Vaynerchuk worked from the age of fourteen in his family\'s liquor shop in New Jersey. He put the shop online in the late 1990s, and in 2006 he started a daily video show on the internet in which he tasted wines and talked about them in plain language. He has said the business grew from a few million dollars to about $60 million a year in sales. The audience mattered because there was a shop behind it with wine to sell.',
  },
  'pitch-deck-penny': {
    trait: 'Pitching',
    lesson: 'Show, do not tell. A pitch works when the other person sees the result for themselves.',
    who: 'Sara Blakely and Spanx',
    story: 'Sara Blakely started Spanx in 2000 with $5,000 of savings from a job selling fax machines. Hosiery mills turned her down one after another until one owner agreed to make her product. She then got ten minutes with a buyer at the department store Neiman Marcus. Partway through she could see she was losing the buyer, so she asked her to come to the ladies\' room and showed her the difference the product made. The store placed an order.',
  },
  'closer-clyde': {
    trait: 'Closing the sale',
    lesson: 'Put the product in the customer\'s hands. People buy what they have already tried.',
    who: 'Estée Lauder',
    story: 'Estée Lauder started her company in New York in 1946 with four skin-care products. Her first big order, about $800 of products for the department store Saks Fifth Avenue, sold out in two days. She stood at the counter herself, put the cream on customers\' hands and gave away small samples with every purchase, a practice the whole industry later copied.',
  },
  'swag-bag-sam': {
    trait: 'Brand',
    lesson: 'A name and a face people trust is worth as much as the product. It only lasts if the product is good.',
    who: 'Madam C. J. Walker',
    story: 'Sarah Breedlove was born in Louisiana in 1867, the daughter of parents who had been enslaved, and worked as a washerwoman. In the early 1900s she began selling her own hair-care treatment for Black women, under the name Madam C. J. Walker, with her own picture on the tin. She trained thousands of women as sales agents. By her death in 1919 she was one of the wealthiest self-made women in America.',
  },

  // ---- Connectors: bring the right people together -------------------------------------------------
  'warm-intro-walt': {
    trait: 'Introductions',
    lesson: 'A meeting arranged by someone both sides trust starts halfway to yes.',
    who: 'Reid Hoffman',
    story: 'Reid Hoffman started LinkedIn in 2002 on the idea that business runs on introductions from people you already know. He worked the same way himself. In 2004 the people behind a new website for students were looking for money, and Hoffman, who thought he was too close to a competing business to lead the deal, introduced Mark Zuckerberg to his former colleague Peter Thiel. Thiel became Facebook\'s first outside investor, and Hoffman invested alongside him.',
  },
  'name-drop-nina': {
    trait: 'Borrowed credibility',
    lesson: 'A respected name beside yours opens doors. Earn it honestly and make sure the product deserves it.',
    who: 'Arianna Huffington',
    story: 'When Arianna Huffington launched the Huffington Post in May 2005 it had no reputation and no readers. What it had was her address book. She asked hundreds of well-known friends and contacts, among them politicians, actors and writers, to write for the site, and their names brought the first audience. AOL bought the company six years later for $315 million.',
  },
  'conference-badge-bob': {
    trait: 'Bringing people together',
    lesson: 'Put interesting people from different fields in one room and things happen that none of them planned.',
    who: 'Richard Saul Wurman and TED',
    story: 'In 1984 Richard Saul Wurman, an architect and designer, held a conference in Monterey, California, for people working in technology, entertainment and design, three fields he saw coming together. The first one lost money and he did not hold another until 1990. After that it ran every year, with short talks and an invited audience. He sold it in 2001, and its talks have since been watched online billions of times.',
  },
  'rolodex-rita': {
    trait: 'Your network',
    lesson: 'A network becomes more valuable to everyone each time someone joins it.',
    who: 'Mark Zuckerberg',
    story: 'Mark Zuckerberg launched Facebook from his room at Harvard on 4 February 2004. It was open only to Harvard students, who signed up with their real names, and within a month more than half the undergraduates had joined. It then opened one university at a time, so that each new member arrived to find people they already knew. Opening to everyone came later, in 2006.',
  },
  'lets-grab-coffee-lou': {
    trait: 'A place to meet',
    lesson: 'People do business where it is easy to meet. Build that place and you are in the middle of every conversation.',
    who: 'Howard Schultz and Starbucks',
    story: 'On a trip to Milan in 1983 Howard Schultz noticed that the city\'s espresso bars were where people met, every day, between home and work. Starbucks, where he worked, only sold coffee beans, and its owners did not want to run cafes. He left to start his own. By his own count he asked 242 people for money and 217 said no. In 1987 he bought Starbucks with his backers and turned it into the meeting place he had seen.',
  },
};

/** What each founder set stands for, in a line: the trait the five cards share. */
export const SET_TRAITS = {
  inventors: { trait: 'Makers', line: 'They make the thing work. Without one, a startup has an idea and nothing to show.' },
  innovators: { trait: 'Visionaries', line: 'They see a different way to do it. Without one, a startup copies what already exists.' },
  operators: { trait: 'Builders of systems', line: 'They make it happen the same way every day. Without one, a startup cannot grow past its founders.' },
  investors: { trait: 'Backers', line: 'They fund it and judge the risk. Without one, a startup runs out of runway.' },
  hustlers: { trait: 'Sellers', line: 'They get the customer to say yes. Without one, a startup has a product and no revenue.' },
  connectors: { trait: 'Networkers', line: 'They bring the right people together. Without one, a startup never meets the people it needs.' },
};
