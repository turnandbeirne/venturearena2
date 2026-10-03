# VentureBoom: rulings to confirm

VentureBoom is built from the "Venture Boom: Rulebook & Deck v1" document. A
tabletop rulebook leaves some things to the people at the table; a computer has
to pick one answer. These are the places where it did. Each is marked
"Digital reading" or commented in `src/games/ventureboom/rules.js`, and each is
a small change if you want the other answer.

| # | Question the rulebook leaves open | What the game does now |
|---|---|---|
| 1 | Hostile Takeover "stacks (+2 each time it's passed on)". What does a player who is under a takeover pass on? | The turns they still owe, plus 2. Passed straight on, that is 2, then 4, then 6. |
| 2 | Portfolio Review: which discards can you pick from? | The whole discard pile, including the five cards you just played to make the Review. |
| 3 | Kids' edition: "a bankrupt player keeps their hand". Do they also get the normal deal? | Yes. Their cards are set aside, everyone gets the normal deal, and the kept cards are handed back on top. (If that would leave too few cards to draw, they get a normal deal only.) |
| 4 | Hot Market: when are Exits doubled? | In the last three rounds of the game. |
| 5 | What if a round somehow never draws a BOOM? | After 120 turns the round ends with nobody bankrupt and everyone takes the $1M survival bonus. This is a safety net; it should not happen in a real game. |
| 6 | Can a combo be made of Unicorns only? | A same-set combo needs at least one real founder. The one exception: two Unicorns make a Poach. |
| 7 | When a BOOM bankrupts someone, where does the card go? | It stays face up for the rest of the round, so the table can count the BOOMs left. |
| 8 | Who sees which card moved? | An Acqui-hire's result (named card, hit or miss) is public. A Poach and a Mentor gift are private: only the two players involved see the card. |
| 9 | When you draw a BOOM while holding a Pivot, do you choose whether to use it? | No. The Pivot is spent automatically (there is never a reason to keep it), then you secretly choose where the BOOM goes back in the deck. |
| 10 | What does a founder card teach? | Founder cards show the business dynamic of the play they enable (Poach, Acqui-hire, Portfolio Review, Exits), taken from the rulebook's Business Dynamics table, since founders are only ever played in sets. |

Timing online (not in the rulebook): the table has 9 seconds to answer a card
with a Hard Pass, 20 seconds for a choice someone else is waiting on, and 7
seconds between rounds. After that the game answers "no" or makes the default
choice for anyone who has not.

Known rough edges:

- Bots answer a reaction window almost at once, and people take a moment. A
  sharp player could read who is thinking about a Hard Pass from the delay.
- The BOOM overlay and the round summary can overlap for a moment at the end of
  a round.
