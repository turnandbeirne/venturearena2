// The AI guides: who they are and what a member may ask of them in a day.
// Text and numbers only, shared by the server (which enforces the allowance
// and writes each guide's instructions, server/arena/guides.js) and the pages.
//
// A guide is an AI (Claude, by Anthropic), and is always labelled as one. It
// is a role, not a person: none has a human name or a made-up life story.

export const GUIDES = [
  {
    id: 'coach', name: 'The Coach', role: 'Coach', icon: '\u{1F3AF}',
    blurb: 'Turns what you want into the next thing to do, then asks how it went.',
    starters: ['I have an idea but I do not know where to start.', 'Help me pick one thing to do this week.', 'I keep putting off talking to customers.'],
  },
  {
    id: 'mentor', name: 'The Mentor', role: 'Mentor', icon: '\u{1F393}',
    blurb: 'Has seen it before. Asks the question you were hoping nobody would.',
    starters: ['How do I know if my idea is any good?', 'Should I find a cofounder or start alone?', 'What do first-time founders usually get wrong?'],
  },
  {
    id: 'spark', name: 'The Spark', role: 'Inspiration', icon: '\u{1F4A1}',
    blurb: 'For the days it feels too big. A reframe, a small win, a reason to keep going.',
    starters: ['I feel like I am too late to start.', 'I lost today and I am discouraged.', 'Remind me why small beginnings are fine.'],
  },
  {
    id: 'historian', name: 'The Historian', role: 'Historian', icon: '\u{1F4DC}',
    blurb: 'How real founders and companies actually did it, what it cost, and what it teaches.',
    starters: ['Tell me about a company that nearly failed and came back.', 'How did a famous business find its first customers?', 'What is the story behind a well-known pivot?'],
  },
  {
    id: 'money', name: 'The Money Guide', role: 'Money', icon: '\u{1F4B0}',
    blurb: 'Budgets, saving, credit, cash flow. Personal and business money in plain words.',
    starters: ['Explain cash flow like I am new to it.', 'What is the difference between profit and cash?', 'How does compound interest work?'],
  },
];
export const GUIDE_IDS = GUIDES.map((g) => g.id);
export const guideById = (id) => GUIDES.find((g) => g.id === id) || null;

/** Messages a member may send to the guides in one day (UTC), across all of them. */
export const GUIDE_DAILY = { anonymous: 0, free: 5, member: 30, vip: 80, ceo: 200 };

export const GUIDE_MAX_CHARS = 1500;
/** Shown wherever a member talks to a guide. */
export const GUIDE_NOTICE = 'The guides are AI (Claude, made by Anthropic). They can be wrong, and they teach: they do not give financial, legal or tax advice. What you write here, and the basics of your profile, are sent to Anthropic to write each reply.';
