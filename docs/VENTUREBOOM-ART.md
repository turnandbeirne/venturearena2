# VentureBoom card art

How the card illustrations get into the game, and which ones are still to come.

## What an illustration is

A whole card, with no text on it: the navy frame, a blank header, the art
window, and the footer band with the logo, on any plain background (white,
grey, a photographed table: the import finds the card by its navy frame). The game
draws all the words itself, so they stay sharp at every size and can be edited
without touching the picture:

- **In a hand, on the table, in lists:** the kind of card (Inventors, Wild,
  BOOM!) in the blank header, and the name on a dark plate at the bottom. On
  all but the smallest cards, founders also show how many of that set you hold
  and other cards show their short rule.
- **When a card is opened:** the card exactly as drawn. Kind and name in the
  header, the full rule in the footer beside the logo, and a small "?" that
  opens the card's real-world story. Nothing covers the art (a browser test
  opens every card in a hand and measures this).

A card with no illustration yet is drawn by the game (colour band, initials,
name), so the deck can be illustrated a few cards at a time.

## Adding or replacing one

```
python3 scripts/import-card-art.py <image> <card-key>
```

The script trims everything outside the card and writes two files, named by the card's
key: `src/games/ventureboom/art/sm/<key>.webp` (240 px wide) and
`art/lg/<key>.webp` (720 px wide). Nothing else needs editing: the game picks
up every file in those folders when it is built. `npm test` fails if a file
does not match a card, is the wrong shape, or is too heavy. It needs Python 3
with Pillow; the original images are not kept in the repository.

The key `back` is the back of the deck. It is shown on the draw pile, with
the number of cards left drawn in the blank oval at its centre. It has no
picture window, so it is imported differently: the box is the whole card
above the footer band, in pixels of the image, and the standard footer is
added beneath it. `--paint-px` paints over a corner that other cards were
lying on in the photo.

```
python3 scripts/import-card-art.py back.jpg back --above-footer-px=40,42,826,994 --paint-px=827,788,796,788,786,796,781,812,779,840,764,995,827,995
```

### A picture for one copy of a card

The deck holds seven Pivots, each with a different line ("Pivot to video.").
A copy can have a picture of its own. `PIVOT_ART` in `cards.js` maps a line to
an art name, and the file is imported under that name:

| Copy (its line) | Art name |
|---|---|
| "We're an AI company now." | `pivot-ai` |
| "Pivot to video." | `pivot-video` |
| "Actually, it's a platform." | `pivot-platform` |
| "We call it a strategic realignment." | `pivot-realignment` |
| "Same product, new logo." | `pivot-new-logo` |
| "It was always a B2B play.", "We're pre-revenue by choice." | none yet: they show `pivot` |

The four Out of Office cards share two pictures (`OOO_ART`): the hammock
(`out-of-office`, the card's own picture) on "Currently on a beach..." and
"Back Monday...", and the pool (`out-of-office-pool`) on "I am away with
limited access to consequences." and "For urgent matters...".

A copy with no picture of its own shows the card's picture (`pivot`). The
picture changes nothing about what the card is or does. Where the game names
a card without saying which copy (the log), it shows the card's picture.
Other cards with several copies (Hard Pass has five) can be given per-copy
pictures the same way.

### An illustration in an earlier card frame

Two earlier frames exist: one with the logo in the middle of the footer, and
one with grey boxes where the text goes. The game writes on the standard
frame (blank header, logo at the left of the footer), so for these add
`--reframe`:

```
python3 scripts/import-card-art.py <image> <card-key> --reframe
```

It lifts the picture, with its gold border, out of the old frame and sets it
into the standard one (`scripts/card-frame.webp`). The picture itself is not
redrawn. Imported this way so far: `pivot-ai`, `pivot-video`,
`pivot-platform`, `pivot-realignment`, `pivot-new-logo`, `out-of-office`,
`hard-pass`, `hostile-takeover`, `out-of-office-pool`. `disrupto-the-great` too: it was drawn in
the standard frame, but with a purple band across the header where the name
goes.

A card whose layout is none of the known ones needs to be told where its
picture is, as fractions of the card (left, top, right, bottom):

```
python3 scripts/import-card-art.py reorg.jpg reorg --reframe --window=0.058,0.041,0.944,0.817
```

`reorg` was imported this way: it was drawn with no header band. It also has
a strip painted across the bottom of the picture with the word "Reorg" and two
bars. That strip is part of the artwork and was left as drawn; a clean
version of the picture can replace it with the same command.

A photo where the card lies on a stack, or has other cards over a corner,
cannot be trimmed to the card. Give the picture's box in pixels of the photo
instead (left, top, right, bottom, measured to the outside of the gold border):

```
python3 scripts/import-card-art.py photo.jpg moonshot-molly --reframe --window-px=100,211,764,977
```

The box runs along the picture's own gold border: the thicker, inner one. The
thin gold line outside it belongs to the frame, and the standard frame already
has it. (Measured to the outer line, a card comes out with three lines where
the rest of the deck has two.) `kpi-kevin`, drawn on a frame with a taller
header, was imported the same way: `--window-px=130,289,1053,1355`.

The second versions of `its-like-x-for-y-yuri`, `moonshot-molly`,
`blockchain-brad`, `disrupto-the-great` and `widget-wendy` were imported this
way, and replaced the first versions.

A picture drawn with NO gold border (`duct-tape-dana`, `prototype-pete`,
`patent-pending-priya`) is set inside the standard frame's own border, so it
matches the rest of the deck. The box is then the picture alone:

```
python3 scripts/import-card-art.py photo.jpg prototype-pete --reframe --no-border --window-px=100,210,764,977
```

### Art that breaks out of its border

On `market-research` the detective's hat rises out of the picture into the
header band. That is kept. The words in the header stay in the top 11.4% of
the card so the name never sits on such a picture (a browser test measures it).

## The 43 cards and their keys

A key never changes, even if the card is renamed (keys are written into games
in progress and into the address of the card's real-world story page).

| Card | Key (file name) | Kind |
|---|---|---|
| Server Fire | `server-fire` | BOOM |
| Co-Founder Breakup | `co-founder-breakup` | BOOM |
| The Lawsuit | `the-lawsuit` | BOOM |
| The Bubble Pops | `the-bubble-pops` | BOOM |
| Runway Ran Out | `runway-ran-out` | BOOM |
| Pivot | `pivot` | Action |
| Hard Pass | `hard-pass` | Action |
| Hostile Takeover | `hostile-takeover` | Action |
| Out of Office | `out-of-office` | Action |
| Market Research | `market-research` | Action |
| Reorg | `reorg` | Action |
| Ask a Mentor | `ask-a-mentor` | Action |
| Duct Tape Dana | `duct-tape-dana` | Inventors |
| Prototype Pete | `prototype-pete` | Inventors |
| Patent Pending Priya | `patent-pending-priya` | Inventors |
| Sir Solders-a-Lot | `sir-solders-a-lot` | Inventors |
| Widget Wendy | `widget-wendy` | Inventors |
| Disrupto the Great | `disrupto-the-great` | Innovators |
| Blockchain Brad | `blockchain-brad` | Innovators |
| Moonshot Molly | `moonshot-molly` | Innovators |
| Forever-Beta Bea | `forever-beta-bea` | Innovators |
| Like-X-for-Y Yuri | `its-like-x-for-y-yuri` | Innovators |
| Gantt Chart Gary | `gantt-chart-gary` | Operators |
| Process Patty | `process-patty` | Operators |
| KPI Kevin | `kpi-kevin` | Operators |
| SOP Sofia | `sop-sofia` | Operators |
| Actually-Ships-It Ashok | `actually-ships-it-ashok` | Operators |
| Term Sheet Terry | `term-sheet-terry` | Investors |
| Due Diligence Dee | `due-diligence-dee` | Investors |
| Angel Annie | `angel-annie` | Investors |
| Cap Table Carl | `cap-table-carl` | Investors |
| Keep-Me-Posted Phil | `keep-me-posted-phil` | Investors |
| Cold Call Carla | `cold-call-carla` | Hustlers |
| Hashtag Hank | `hashtag-hank` | Hustlers |
| Pitch Deck Penny | `pitch-deck-penny` | Hustlers |
| Closer Clyde | `closer-clyde` | Hustlers |
| Swag Bag Sam | `swag-bag-sam` | Hustlers |
| Warm Intro Walt | `warm-intro-walt` | Connectors |
| Name-Drop Nina | `name-drop-nina` | Connectors |
| Conference Badge Bob | `conference-badge-bob` | Connectors |
| Rolodex Rita | `rolodex-rita` | Connectors |
| Let's-Grab-Coffee Lou | `lets-grab-coffee-lou` | Connectors |
| Unicorn | `unicorn` | Wild |

Illustrated so far: all 43 cards.

Plus 6 per-copy pictures: `out-of-office-pool`, `pivot-ai`, `pivot-new-logo`, `pivot-platform`, `pivot-realignment`, `pivot-video`.

Plus the back of the deck: `back`.

Run `npm test` to print the current list.

## The "?" and the real-world stories

Each card links to `https://venturemaker.org/ventureboom/hof/<key>` (founders)
or `https://venturemaker.org/ventureboom/dynamics/<topic>` (everything else).
Those pages did not exist on venturemaker.org when this was written (2026-10-02):
the links land on its home page until they are published.
