# House rules

How games are built on VentureArena, where a new game must be registered, and the
failures each rule came from. This is a living document: when something breaks in
a new way, fix it, add a row to the table in section 6, and add the rule it
produced.

The short version: **a game is a pure rules module plus a separate React board.
The rules module exports its legality helpers, and the board, the bot and the
server's validator all import them, so there is one definition of "legal" and it
cannot drift.**

## 1. Anatomy of a game

One folder per game under `src/games/<id>/`:

| File | What it is | May import |
|---|---|---|
| `rules.js` | The game. Pure: no React, no DOM, no clock, no `Math.random`. Exports the boardgame.io game (built with `defineGame` from `../kit.js`), the legality helpers (`legalMoves` and friends), `telemetry(G, seat)`, and optionally `housekeeping(G)`, `normalizeSettings(s)`, `onLeave`, `observations`, `playStyle`. | `../kit.js`, own data files |
| `bot.js` | `bot({ G, ctx, seat, level, spec })` returns `{ move, args }` or `null`. `G` is the **player view** for that seat, exactly what a browser there receives. Picks from the legality helpers in `rules.js`. May use `Math.random`. | `./rules.js` |
| `meta.js` | Text and numbers only: name, tagline, seats, how-to-play steps, lesson, reflection questions, SEO copy. Feeds the lobby card, the how-to panel, the debrief and the static SEO page. | nothing |
| `Board.jsx` | The React board. Receives `{ G, ctx, moves, playerID, seats, table, me, shell }`. Draws the game and calls `moves.x(...)`. Legality comes from `rules.js`. | `./rules.js`, `../../client/game/hooks.js` |
| `board.css` | Board styles, every class prefixed with the game's short name. | |
| `client.js` | Two lines: `export { default as Board } from './Board.jsx'; export { theGame as rules } from './rules.js';` plus optional `Settings` and `fullscreen`. | |

Tests live in `tests/rules-<id>.test.js`.

## 2. Registering a new game (every place, in order)

`tests/registration.test.js` fails the build if any of these is missing.

1. **Rules, bot, telemetry, metadata** in `src/games/registry.js`: import them and add an entry to `GAMES`.
2. **Lobby order and landing-page card**: add the id to `GAME_ORDER` in the same file. The lobby card, the landing-page card and the games index are generated from `meta.js` for every id in that list.
3. **Board** in `src/games/boards.js`: `id: () => import('./<id>/client.js')`.
4. **Server games map**: nothing to do. The server registers every entry of `GAMES` with boardgame.io at boot.
5. **Bot dispatch**: nothing to do beyond step 1. The runner (`src/server/bots/runner.js`) calls `GAMES[id].bot`, and `GAMES[id].housekeeping` for the server's own seat.
6. **How-to-play text and SEO page**: fill `howTo`, `watchFor`, `lesson`, `reflection` and `seo` in `meta.js`. `scripts/build-seo.mjs` writes `/games/<id>/` at build time with its own title, description and rules text, and adds it to the sitemap.
7. **Test chain**: `tests/playout.test.js` picks the game up from the registry and plays bot against bot at every seat count from `meta.seats.min` to `meta.seats.max`. Add `tests/rules-<id>.test.js` for the rules themselves.
8. **Feedback scope**: nothing to do. The feedback form lists every registered game.

## 3. Rules every rules module follows

Each of these is enforced by `kit.js` or by a test. The "why" is in section 6.

1. **Turn order is our own field.** `G.turnP` is the seat (as a string) whose turn it is. boardgame.io's own turn never advances; every seat is always "active" as far as boardgame.io is concerned. Every move starts with `if (refuse(G, playerID)) return INVALID_MOVE;`.
2. **When several seats owe a response at once** (a reaction window, a choice someone else is waiting on), list them in `G.waiting` (array of seat numbers). `actingSeats(G)` returns `G.waiting` when it is non-empty, else `[G.turnP]`. The board's "your move", the bot runner and the idle sweep all use `actingSeats`. Bots answer a non-empty `G.waiting` at once, with no thinking delay.
3. **Every move is `client: false`.** `defineGame` does this for you. The browser never runs a move.
4. **Hidden information.** `playerView` is `PlayerView.STRIP_SECRETS`, set by `defineGame`. Private data lives ONLY in `G.players[seat]` (stripped for everyone else) and `G.secret` (stripped for everyone). Anything the table may know about a hidden thing goes in a public mirror, e.g. `G.counts[seat]` for hand sizes. Never put a secret in the log, in a notice, or in a public field "just for a moment". Pass `secret: true` to `defineGame` so move arguments are redacted from boardgame.io's own log.
5. **Matches persist; `setup()` never re-runs.** A field added after launch does not exist in games already in progress. Guard it where it is WRITTEN: `if (!Array.isArray(G.log)) G.log = [];`. `pushLog` and `countMove` do this for their own fields. Readers use `Array.isArray(x) ? x : []`.
6. **No "last thing that happened" slot.** History is `G.log`: append-only, capped at 80 entries, each with a monotonic counter `n` (`pushLog(G, { t: 'kind', p: seat, ... })`). Boards key animations and toasts off `n` with `useLogFeed` and `lastOf`.
7. **Terminal conditions are checked before anything else.** In a move: apply the move, then check for the end of the game, and only then hand over the turn. End with `finish(G, placements, { reason, scores })`; it is idempotent.
8. **Refuse moves while a round is resolving.** Set `G.resolving = true` while the game is between states that players must not act in; `refuse()` rejects ordinary moves until it is cleared.
9. **Every game has a mercy limit.** `countMove(G)` each move; past the limit, end the game on the current standing. A stalemate must end.
10. **The house seat.** A game that needs timers, or runs its own robots inside its engine, passes `house: true` to `defineGame`. It gets one extra boardgame.io player id whose credentials never leave the server. Guard those moves with `isHouse(G, playerID)`. `housekeeping(G, { now, seats, table })` returns `{ move, args, afterMs }` when the house should act, or `null`. Add `exact: true` when `afterMs` is a real deadline (a turn clock): the runner shortens other chores when nobody is watching, never that one.
11. **A game that replaces a player itself says so.** If the engine hands a seat to a robot (idle, voted out), log `{ t: 'takeover', p: seat, reason }`. The table marks the seat and revokes its credentials from that entry.
12. **Placements.** `G.over.placements[seat]` is 1 for first place; ties share a number. `scores` is optional and shown in the debrief.
13. **No time and no randomness of your own.** Use the `random` argument boardgame.io passes to moves and to `setup` (`random.Shuffle`, `random.Die`, `random.Number`). Its state is server-side only.

## 4. Rules every board follows

1. **Phones first.** Design at 360 x 640, then widen. Touch targets are at least 40 px.
2. **Size the board from the space it has.** `useFit(ref, cols, rows)` measures the container and returns a cell size; never hard-code a board size or guess from the viewport.
3. **Measure in a real browser.** `npm run test:e2e` opens every board at 360 x 640 and 390 x 844 in Chromium and asserts no horizontal scroll, the board inside the viewport, and tap targets large enough. Do not eyeball a layout and call it done.
4. **No emoji newer than Emoji 11.** Older phones draw them as empty boxes. `npm run check:emoji` fails the build on one.
5. **Colour is never the only signal.** Seats have a colour from the member's ranked choice (`seats[i].hex`); pieces also differ by shape, mark or label.
6. **Animations key off the log counter**, so a new event animates once and a re-render never replays it.
7. **The board never decides legality.** It asks `rules.js`.
8. **Nothing a player needs is off screen.** No strip scrolls sideways with its scrollbar hidden; rows of buttons wrap. A hand of cards is sized from the measured space so that every card shows at once (see `ventureboom/hand-layout.js`), and scrolls down with a visible scrollbar only when even the smallest tappable card cannot fit them all.
9. **Words are drawn, never painted.** Card and board artwork carries no text; names and rules are drawn by the board on top (see `docs/VENTUREBOOM-ART.md`).
10. **Sound follows the log.** A sound is played once per new log entry (`useLogFeed`), never on a render, never before the player has touched the page, and always with a mute control that is remembered (`ventureboom/sounds.js`).
11. Board CSS classes are prefixed (`fir__`, `rev__`, ...). The arena's own classes are unprefixed and a board must not restyle them.
12. **Two palettes, kept apart.** The pages wear venturemaker.org's colours (cream page, navy ink, orange call to action, teal accent, Inter); a game is played on a dark table (`.stage`), because the card art and the boards were drawn for it. Page styles use ONLY the semantic tokens at the top of `src/client/styles.css` (`--bg --surface --ink --ink-soft --rule --accent ...`); `.stage` gives those tokens their dark values, so one rule styles a button in both places. The old names (`--navy --gold --cream --muted --line`) are the table's palette and are for boards. `tests/theme.test.js` fails if a page rule uses one. The page's backdrop is drafting paper (`src/client/assets/blueprint.svg`: a faint grid with sketches of building a business); it stays faint (the same test caps its opacities), and anything with more than a line or two of text sits on a white card, never straight on the paper.

## 5. Working on this codebase with an AI assistant

`AGENTS.md` is the binding version. In short: an assistant never commits, pushes,
deletes data, touches a production database, or reads secret files (`.env`, keys,
tokens) without the owner's explicit permission for that specific action. It
proposes; the owner approves.

For any bug: write the test first and **prove it fails without the fix**, then fix it.

## 6. Past failures and the rule each one produced

| # | What went wrong | Where | Rule it produced |
|---|---|---|---|
| 1 | Files uploaded by hand through the GitHub web uploader landed in the wrong folder three times; stale copies were re-uploaded twice. | First arena build | Code moves through git branches and pull requests. Nobody uploads files by hand. |
| 2 | Host settings reserved chairs for robots, which locked people out of the table. | Arena tables | People always outrank robots. Robots are never seats while a table is open; they fill what is empty at start (`tables.js start()`). |
| 3 | Any browser could dismiss any player's fortune card. | VentureFlow online | An action belongs to one seat. The server checks the seat on every move; everyone else gets a timed peek. |
| 4 | One network round trip per unit bought made bulk buying crawl. | VentureFlow online | Every trade carries a quantity; the client coalesces a burst into one move. |
| 5 | Host settings form lost edits when a background refresh re-rendered it. | Arena table room | A form owns its draft until the save lands; props are compared by content, not identity. |
| 6 | Chat let a browser speak as any human seat (a hot-seat feature leaking into online play). | VentureFlow online | The online seat is the only speaker. The server sets the speaker from the seat, never from the request. |
| 7 | Robots were played by "the host's browser". When the host closed the tab, the table froze. | First arena build | The server plays every robot and runs every timer (the bot runner and the house seat). No browser is special. |
| 8 | Online state was rebuilt in each browser by replaying a shared move list; a single non-deterministic line would silently desync a table. | First arena build | One authoritative state on the server. Browsers receive state; they never compute it (`client: false`). |
| 9 | Seat colours were assigned when the seating panel was first viewed, before most people had sat down, so ranked colour choices were ignored. | Sep 12 build | Colours are assigned once, at start, in seat order (`assignSeatColors`). |
| 10 | Declining a connection request silently blocked the requester. | Sep 12 build | Decline deletes the request. Blocking is a separate, deliberate action. |
| 11 | A challenge past its deadline stayed "pending" forever, because the status write was rolled back by the error that reported it. | Sep 12 build | Expiry is written when it is noticed, before any error is raised (`social.js expire()`). |
| 12 | Any existing member who opened a `?ref=` link credited the inviter with a referral. | Sep 12 build | Only an account less than a day old can be referred, once. |
| 13 | The quiz endpoint accepted an answer for any question id. | Sep 12 build | Only today's question can be answered. |
| 14 | boardgame.io 0.50 sends `initialState` to every browser at sync without running it through `playerView`: the full starting state, shuffled deck and every hand included. | Found building this version | Our storage adapter never returns a real initial state (`bgio-storage.js fetch()`). |
| 15 | boardgame.io creates a match on demand when any socket syncs to an unknown match id: an open door to filling the server's memory. | Found building this version | Only match ids the arena created are ever stored (`bgio-storage.js createMatch()`). |
| 16 | boardgame.io mounts its own lobby REST API on `/games/*`, which lets anyone create matches and collides with the SEO pages. | Found building this version | Our HTTP middleware answers everything under `/games` and never falls through (`http.js`). |
| 17 | boardgame.io's socket wrapper pulled in socket.io 3.1 while the app assumed 4.x. `socket.data` did not exist, the realtime handshake threw, and the connection closed with no error anywhere. | Found building this version | `package.json` overrides the wrapper onto the app's socket.io; realtime uses a plain property; every new socket feature is tried in a real browser before it is built on. |
| 18 | Two "Start" clicks in the same tick both passed the "is it open" check and created the match twice. | Found building this version | State that guards an async action is flipped BEFORE the first `await` (`tables.js start()`: status `starting`). |
| 19 | A bot and a person moving at the same instant both read state N; the second move was dropped as stale with no error. | Found building this version | Server-made moves go through the same per-match queue as browser moves (`bgio.js submit()`). |
| 20 | boardgame.io checks a socket's credentials against the player id the socket CLAIMS, then runs the move as `action.payload.playerID` without comparing the two. Anyone seated could move, or resign, as any other seat, a bot or the house included. | Found testing this version | The game socket guard drops any move whose payload seat differs from the authenticated seat (`bgio.js guardGameSockets`, rule 1). |
| 21 | boardgame.io runs `GAME_EVENT` actions sent by a browser (`endGame`, `endTurn`...), whatever the game's `events` setting says. One message ended a table with placements the sender chose, and the arena recorded them. | Found testing this version | A browser may send `MAKE_MOVE` and nothing else (`guardGameSockets`, rule 2). The end of a game is `G.over`, written by a move. |
| 22 | A "sync" for a made-up match id with `numPlayers` in the millions made boardgame.io build that game in memory. No session needed. | Found testing this version | Sync and update are only passed through for match ids the arena created (`guardGameSockets`, rule 3). |
| 23 | A cookie with broken percent-encoding (`va_s=%E0%A4%A`) threw inside the realtime handshake: an unhandled rejection, which stops a Node process. One request took down every live table. | Found testing this version | Anything that parses what a stranger sent returns a value and never throws (`http.js parseCookies`). Handshake code is wrapped. |
| 24 | A private table's match id appears in members' game histories, and the game socket carries no session, so anyone who learned the id could watch the table. | Found testing this version | Sync on a private table requires the arena session cookie of someone at that table (`index.js mayWatch`). |
| 25 | Bots answered a reaction window ("anyone play a Hard Pass?") at their thinking pace, so with three bots every played card waited three seconds for nothing. | VentureBoom | A bot with nothing to think about answers at once: when `G.waiting` is non-empty the runner replies in about 150 to 270 ms (`runner.js`). |
| 26 | With nobody watching, the runner shortens house chores so robot-only tables finish quickly. It also shortened VentureFlow's turn clock, ending a person's turn they had every right to. | VentureFlow port | A chore that is a real deadline says so: `housekeeping` returns `exact: true` and the runner always keeps its time. |
| 27 | VentureFlow replaces an idle or voted-out player with a robot inside its own engine. The arena did not know: the seat still counted as a person, kept its credentials and its rating was untouched. | VentureFlow port | A game that takes a seat over says so in its log, `pushLog(G, { t: 'takeover', p: seat, reason })`. The table reads it, marks the seat, revokes its credentials and applies the reputation cost (`tables.js matchState`). |
| 28 | Every move sends the whole table state to every browser. VentureFlow's state passes 150 KB; one game measured 59 MB down the wire per browser. | VentureFlow port | Game sockets compress messages over 2 KB (`index.js`, `perMessageDeflate`). Keep `G` lean anyway: logs are capped, nothing is stored twice. |
| 29 | Registering kept the guest's session token, so a token that had been in a shared or borrowed browser as a guest would stay valid for the new account. | Found reviewing this version | A change of identity is a new session: register and login always issue a fresh token and delete the old one (`users.js`). |
| 30 | The guest limit was 20 an hour per address. A classroom or an event arrives from one address, and the 21st student would have been locked out. | Found reviewing this version | Limits per address are sized for a room full of people (`GUESTS_PER_HOUR = 300`); abuse is handled by what a guest may do, not by how many may arrive. |
| 31 | The People page built a stage's display name by reformatting its id ("pre revenue") while the profile used the names table ("pre-revenue"): the same fact, written two ways on two screens. | Found in the browser run | Display names come from the one table in `shared/profile.js` (`STAGES`), never from reformatting an id. |
| 32 | boardgame.io passes its allowed-origins list to socket.io under a key socket.io 4 does not read (`cors.origins`). The list restricted nothing: the socket endpoint answered `Access-Control-Allow-Origin: *` and any website could open game and realtime sockets from its visitors' browsers. | Found reviewing this version | Sockets are opened only by this site's own pages (`index.js socketGate`): the page's Origin must be the host the request was sent to, or `PUBLIC_URL` / `ALLOWED_ORIGINS`. A library's security setting is tested from the outside before it is relied on. |
| 33 | The accounts had no way back in for someone who forgot a password; the earlier builds got that for free from Supabase Auth, and it was lost in the move to the arena's own accounts. | Found comparing this version with the earlier builds | When a library is replaced, list what it did that nobody had to write (`docs/FEATURE-MAP.md`). Reset links are random, stored as a hash, single use, one hour, and end every other session (`users.js`). |
| 34 | The Postgres connection asked for TLS on every address that was not `localhost`. A host's private-network database address offers no TLS, so the server would have failed to start on the very setup its own deploy file creates. | Found preparing the first deploy | Ask for TLS, and if the server answers that it has none, connect without (`postgres.js pgQueryFromUrl`). A deploy file is tried against the real thing it describes before it is called done. |
| 35 | The VentureFlow port still carried the address of the standalone game's recap-email service: dead code here, but one un-hidden button away from two builds sharing a backend. | Found preparing a side-by-side playtest | A build that must stand alone is checked for it: `tests/standalone.test.js` fails on any address of an earlier build's services. |
| 36 | Asked to share a Supabase project with the earlier build, the one table would have gone into the default schema, where Supabase serves every table over HTTP to anyone holding the site's public key unless row level security is on. It holds password hashes and sessions. | Found preparing a shared-database deploy | The table gets row level security with no policies at creation, wherever it lives, and a shared database means its own schema and its own login (`DATABASE_SCHEMA`, `postgres.js`). Before putting a table in someone's database, ask what else in that database can see it. |
| 37 | `.gitignore` had the line `data/`, meant for a local data folder at the top of the project. Without a leading slash it matches a folder called `data` anywhere, so `src/games/ventureflow/vf/data` was silently left out of the first push: 320 files arrived instead of 322 and the site could not have been built from the repository. | First push of this version | Folder lines in `.gitignore` start with a slash. `tests/standalone.test.js` fails if the ignore file hides any file the project needs. After a first push, the repository is compared with the source file by file before anything builds from it. |
| 38 | VentureBoom's hand was one row that scrolled sideways with its scrollbar hidden. Dealt eight cards on a phone, four were off screen with nothing to say so, and on a laptop a mouse could not reach them at all: a player could not see half their hand. The layout test passed, because it skipped everything inside a scrolling parent. | First playtest of this version, reported by the owner | Nothing a player needs is ever off screen: a hand is sized from the measured space so every card shows (`ventureboom/hand-layout.js`), rows of buttons wrap, and no strip scrolls with its scrollbar hidden. The layout test now fails on a hidden-scrollbar strip in any game and on any hand card that is cut off. |
| 39 | Renaming a card would have changed its key (the key was the slug of the name). Keys are written into the log of every game in progress and into the address of the card's story page: tables mid-game would have shown a raw key where the name used to be. | Renaming "It's-Like-X-for-Y Yuri" | A name can change; a key cannot. A renamed card pins its old key (`ventureboom/cards.js`, third entry of a founder), and a test holds it there. |
| 40 | The illustrated card frame invites the name into its header, which holds one line. The longest names shrank until they could not be read on a phone. | Card art, tried at real sizes before building | Text over artwork is laid out at the smallest size it will be shown, with the longest string it must hold, before the layout is chosen. In a hand the name goes on a plate with room for two or three lines; the frame's own layout is used when the card is opened. |
| 41 | A fullscreen game (VentureFlow) already has a chat inside it. Docking the arena's chat beside every game put two chat boxes on one screen. | Persistent chat | The stage docks its chat only for games that do not bring their own (`GameStage.jsx`). Before adding a feature to every game, look at what each game already has. |
| 42 | On an opened card the rule is written in the footer band. Hard Pass and Hostile Takeover have four-line rules, and the panel grew 8 px up over the bottom of the picture: only seen once those cards had art. | Card art, second batch | A panel that holds text of varying length is measured with its LONGEST text. `layout.spec` opens every card in the hand and fails if the rule reaches the picture or leaves the card. |
| 43 | Card art arrived in three different frames (logo in the middle of the footer; grey boxes where the text goes). The board writes its text at fixed places, so two of the frames put words on top of a logo or on a pale box. | Card art, second batch | One frame for the whole deck. An illustration in another frame is set into the standard one on import (`import-card-art.py --reframe`), never special-cased in CSS. |
| 44 | The art import found the card by looking for "not white". Art sent as a photo on a wooden table, or on grey, would have kept the table as part of the card. | Card art, third batch | Find a thing by what it IS (the navy frame), not by what the background is not. Corners are squared with the frame's colour on import, so no background can show where the game rounds them. |
| 45 | Market Research's picture breaks out of its border: the hat rises into the header band, and the card's name was drawn on top of it. | Card art, third batch | Text drawn over artwork keeps to the part of a band the artwork is known to leave free (header words: top 11.4% of the card). `layout.spec` measures the name on every opened card. |
| 46 | The Messages button was added to the phone's top bar next to the brand, Feedback and the membership chip: every page became 34 px wider than a 360 px screen and scrolled sideways. | Chat window, built | A bar that holds several things names which ONE shrinks when they do not fit (the membership chip, with an ellipsis). `layout.spec` already measures every page for sideways scroll; that is what caught it. |
| 47 | The tab bar was "about 58 px" tall (its content decided) while the page padding, the toast and the new messages sheet were all placed from a `--tabbar: 58px` variable. The sheet's Send row sat 3 px under the tab bar. | Chat window, built | A size that other things are positioned from is SET, not left to the content: the tab bar's height is `var(--tabbar)`. |
| 48 | An unread badge hung outside the corner of its 40 px button, which made the button's content wider than the button: the same measurement that catches clipped button text. | Chat window, built | Badges sit inside the box of the thing they count. |
| 49 | Registration now needs a date of birth, and an adult and an under-18 may not be connected by a link alone. The referral step runs AFTER the account is saved and calls the connection code, which now refuses that pair: a teen signing up from an adult's invite would have seen an error for a registration that had gone through. | Age step, caught in review before it ran | A step that runs after the point of no return never throws for an expected case: it checks first (`contactOk`) and takes the lesser path. Tested with exactly that pair. |

## 7. Conventions

- Comments explain **why**, and name the bug that motivated them. What the code does is the code's job.
- Seats are numbers in our code, strings where boardgame.io needs a player id (`String(seat)`).
- Money, scores and counters are integers.
- One game never imports another game.
- **Ages.** Accounts are for 13 and over. The date of birth is used once and never stored (`src/shared/age.js`); an under-18's record holds only the day they turn 18. An adult and an under-18 can connect, message or be introduced only after finishing a game at the same table (`A.contactOk`). Any new way for two members to reach each other privately calls `A.contactOk` first, and nothing a member can see about someone else says whether they are under 18.
- **Other people's words.** A table's chat can be re-read by the people who were at that table and nobody else (`gameRecord`). Direct messages are between two members. Neither is ever shown to a third member, at any tier.
- A browser sends moves and nothing else. Anything the server must decide (who is seated, who may watch, when a game ended) is decided from the server's own records, never from a field in the request.
- `README.md` covers running and deploying; `docs/FEATURE-MAP.md` lists what each earlier build contributed and what is still a stub; `docs/VENTUREBOOM-ART.md` covers card illustrations.
