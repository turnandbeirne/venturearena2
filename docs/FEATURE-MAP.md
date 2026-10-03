# Feature map

## 1. What this file is

VentureArena v2 is a rebuild meant to carry over everything from two earlier builds: the Sep 12 build and the most recent build (venturearena-vm with VentureFlow at a table). This file lists each feature, says where it lives in the v2 code, and says plainly what changed, what is switched off, and what did not come across. It was made by reading the code, not by running it, so "lives in" means the code is there, not that it was re-tested for this file. If you only read one part, read section 6.

How to read the "where it lives" column:

- `arena/x.js` is `src/server/arena/x.js`. A name in backticks next to it (for example `quickMatch`) is a server action, called by the browser at `POST /api/rpc/<name>`.
- `pages/X.jsx` and `components/X.jsx` are under `src/client/`. `shared/` is `src/shared/`. `games/` is `src/games/`.
- "Old quirk N" refers to the numbered list at the end of the Sep 12 specification.

## 2. Carried over from the Sep 12 build

| Feature | Where it lives in v2 | Notes / differences |
|---|---|---|
| **Accounts and profile** | | |
| Guest entry in one click | `guest` in arena/users.js; pages/Enter.jsx | Every guest gets a generated name. The one-game limit is gone (section 5). |
| Create account, sign in, sign out; a guest upgrades in place | `register`, `login`, `logout` in arena/users.js; pages/SignIn.jsx, pages/Me.jsx | Email and password only. Password minimum is 8 characters (was 6). Games, streak and points stay with the account. |
| Email confirmation | `verifyEmail`, `resendVerification` in arena/users.js; pages/Verify.jsx | The arena sends its own link. Needs a mail key (section 6). |
| Access ladder: guest, unverified, verified, profile at 70% | `A.access`, `A.canSeeBios` in arena/users.js; AccessNotice in pages/Home.jsx | Same gate for bios, deeper matches and introductions. A plain connection request now needs only a free account. |
| Profile fields: headline, stage, industry, looking for, skills, project, goals, social links, city, phone, timezone | `saveProfile` in arena/users.js; components/ProfileFields.jsx; pages/Me.jsx | Skills and phone can now be edited from Me (old quirk 2). |
| Avatar picker (24) and photo | `saveProfile`, `setPhoto`; `GET /api/photo/<id>` in server/http.js | The photo is shrunk to 256 px in the browser and kept in the arena's own storage. |
| 12 colours, ranked choice of three, seat colour assignment | `COLORS`, `assignSeatColors` in shared/profile.js; `startTable` in arena/tables.js | Assigned once, at start, in seat order (old quirk 1). Used by the five classic boards and the seat strip; VentureFlow and VentureBoom draw their own colours. |
| Profile completion score and the 50 / 80 / 100% bonus | `SURVEY_PARTS`, `surveyScore` in shared/profile.js; `recomputeSurvey` in arena/users.js | Same bonus (50 points, three times). Weights changed to make room for the card sort. |
| Onboarding wizard | pages/Onboarding.jsx; `saveProfile`, `cardSort`, `finishOnboarding` | Five steps (was four). The "points earned so far" notice now works (old quirk 3). |
| Location sharing, opt-in on both sides | `setLocation` in arena/users.js; pages/Me.jsx; `haversineKm` in arena/matching.js | Same rules: rounded on the device, distance shown to the nearest 5 km, only when both share. |
| **Daily rhythm** | | |
| Daily check-in and streak | `checkin` in arena/users.js; pages/Home.jsx | Same: 10 points, 15 from day 7, one missed day forgiven. |
| Arena Points ledger and history | `A.award`, `pointsHistory` in arena/users.js; `POINTS` in shared/profile.js; pages/Me.jsx | Same amounts. The profile bonus now has a label (old quirk 4). |
| Topic of the day | `daily`, `replyTopic` in arena/community.js; server/data/daily-content.js | All 90 topics. They rotate by day; nothing is pinned to a calendar date. |
| Daily quiz | `daily`, `answerQuiz` in arena/community.js | All 89 questions. Only today's question can be answered (old quirk 13). |
| **People** | | |
| Friends, now called connections | `connect`, `answerConnection` in arena/social.js; pages/Inbox.jsx, pages/Profile.jsx | Declining deletes the request instead of blocking (old quirk 6). Registered members hold up to 25. |
| Presence and the "online now" strip | `heartbeat` in arena/users.js; `lobby` in arena/tables.js; client/auth.jsx; pages/Home.jsx | Online still means seen in the last 3 minutes. |
| Recent tablemates | `tablemates` in arena/social.js; "Played with you" in pages/People.jsx | Counts finished games together. |
| Challenges: send, accept, decline, cancel, 48-hour expiry | `challenge`, `answerChallenge`, `cancelChallenge` in arena/social.js; components/ChallengeButton.jsx; Home and Inbox | Any game, not only VentureFlow. Daily limits 3 / 10 / unlimited. Expiry is now saved (old quirk 7). |
| Invites and referral codes | `inviteInfo`, `logInvite` in arena/social.js; referral claim inside `register`; components/InvitePanel.jsx; client/main.jsx keeps `?ref=` | Same Text, Email, Share, Copy buttons and 20 points. Only an account under a day old can be referred (old quirk 8). |
| Match suggestions (goals, industry, stage, style, distance) | `recommendations` in arena/matching.js; pages/People.jsx | The scoring was carried over and folded into the wider recommender (section 3). |
| Member public page | `profile` in arena/play.js; pages/Profile.jsx at `/p/<username>` | Was `/member/<id>`. Same notice when a bio is hidden. |
| **Ratings, record and style** | | |
| Result recorded once per game; rating per game | `matchOver`, `eloDeltas` in arena/play.js | The K-factor changed (section 5). |
| Arena rank ladder (Rookie to Mogul) | `arenaRank` in shared/profile.js | Same thresholds. |
| Arena Record: ratings and last 20 games | `profile` in arena/play.js; Record in pages/Profile.jsx; pages/Me.jsx | The badge list did not come across (section 6). |
| Six style dimensions, running average, persona labels | `telemetry` in games/ventureflow/rules.js; `updatePersona` in arena/play.js; `personaLabel` in shared/profile.js | Every game feeds it now, not only VentureFlow. |
| Style radar | StyleRadar in components/ui.jsx | Other people's radar is a Subscriber feature. |
| Result card: placing, rating change, insight line, Rematch, Connect | `debrief` in arena/play.js; pages/Debrief.jsx | It became the Debrief page (section 3). |
| **Tables** | | |
| Tables: open, playing, finished; invite code; the host starts | `createTable`, `joinTable`, `startTable`, `leaveTable` in arena/tables.js; pages/TableRoom.jsx | Seat counts come from each game, not a fixed 2 to 5. |
| Lobby: game cards, "coming soon" and partner links, my tables, open tables | `games`, `lobby`, `EXTRA_CATALOG` in arena/tables.js; pages/Lobby.jsx | Same VentureMaker, Board Game Arena and BoardGameUniverse cards. |
| Resign, and a robot finishing a seat | takeover in arena/tables.js; `CONVERT_SEAT_TO_AI` in games/ventureflow/rules.js | The seat keeps its cash and holdings, as before. |
| Sweep for idle players | `sweepTables` in arena/tables.js, run every 5 seconds | Minutes, not half an hour (section 5). |
| VentureFlow extras: Teach Me, rulebook, sound, music, business naming, asset history, player detail, in-game chat | games/ventureflow/vf/components | The game's own screens, unchanged. |
| **Membership and screens** | | |
| Membership page, plan cards, program list, waitlist | `membership`, `checkout` in arena/community.js; shared/tiers.js; pages/Membership.jsx | The waitlist now records which plan (old quirk 14). Tiers and prices changed (section 5). |
| Home, Play, People, Me screens and the five-tab bar | pages/Home.jsx, Lobby.jsx, People.jsx, Me.jsx; components/Layout.jsx | Tabs are Home, Play, People, Inbox, Me. Membership is a chip in the header. |

## 3. Carried over from the most recent build (venturearena-vm + VentureFlow)

| Feature | Where it lives in v2 | Notes / differences |
|---|---|---|
| **Who you are and who you meet** | | |
| Five archetypes from the card sort (eight scenarios), plus risk, pace and collaboration style | `SCENARIOS`, `scoreCardSort` in shared/profile.js; `cardSort` in arena/users.js; CardSort in components/ProfileFields.jsx | The member can override the result. |
| Flippable Player Card with reputation shield and chips | PlayerCard, RepShield in components/ui.jsx; `A.card` in arena/users.js | |
| Stage, "looking for", interests, two conversation starters, mentor capacity | `saveProfile`; components/ProfileFields.jsx | More "looking for" choices, plus a new "I can offer" list (section 4). |
| People: match segments, one reason each, a first-move button, search | `recommendations`, `people` in arena/matching.js; pages/People.jsx | Segments: play with, peers, learn from, cofounders, founders to back, roles and talent. |
| Introductions (mentor, cofounder, investor): accept or decline | `requestIntro`, `answerIntro` in arena/social.js; pages/Inbox.jsx | Both sides must have opted in. Mentors cap how many people they take a quarter. |
| Mixer: one person at a time, with the reason | `mixer` in arena/matching.js; pages/People.jsx | |
| Inbox: requests, introductions, direct messages, notes from the arena | `inbox`, `thread`, `sendMessage` in arena/social.js; pages/Inbox.jsx | Messaging connections is free; messaging anyone is Subscriber. |
| "How the arena sees them" one-line play style | `playStyle` in games/ventureflow/rules.js; `describeStyle` in arena/play.js | |
| **Lobby and tables** | | |
| Lobby: open tables, tables in play, your tables, who is online, "People who fit you" | `lobby` in arena/tables.js; pages/Lobby.jsx | |
| Quick match within 400 rating points | `quickMatch` in arena/tables.js | Returns you to your own open table first. A bot takes the empty seat after about 20 seconds. |
| Join by link while signed out: `/join/<code>` and `/join/<code>/watch` | pages/Join.jsx; `joinTable` in arena/tables.js | |
| Up to 7 people at a table: players and observers, switch before the start | `TABLE_CAPACITY`, `setRole` in arena/tables.js; pages/TableRoom.jsx | Observers chat, watch and join the debrief. |
| Private (invite-only) tables for Subscribers | `createTable`, `setTableSettings`; `private_table` in shared/tiers.js | Also checked on the game connection (`mayWatch` in server/index.js). |
| Open-table limit by tier: 1, 3, 10, 100 | `HOST_LIMIT` in shared/tiers.js | |
| Close stale / close all my tables; stale open tables swept after 2 hours | `closeMyTables`, `sweepTables` in arena/tables.js | |
| Table talk and "question of the table" | `sendChat` in arena/tables.js; components/ChatPanel.jsx; server/realtime.js | |
| Live or turn-based pace | `setTableSettings` (mode) in arena/tables.js | Turn-based allows 24 hours a move. |
| Bots fill empty seats; people always outrank robots | `startTable` in arena/tables.js; server/bots/runner.js | |
| Connect 4 | games/fourinarow | Renamed Four in a Row. |
| **VentureFlow at a table** | | |
| VentureFlow hosted at an arena table | games/ventureflow: rules.js (server side), Board.jsx (browser), vf/ (the game's own engine and screens) | Engine and screens unchanged. The server now runs the game (section 5). |
| Host settings: presets Casual, Classic, Shark tank; scenario, starting conditions, weather, turn clock, robot line-up, fill empty chairs | games/ventureflow/settings.js, Settings.jsx; `setTableSettings` | Checked on the server by `normalizeSettings`. |
| "Suggest to the host" chips; "use the settings from my last table" | games/ventureflow/Settings.jsx | The last settings are remembered in the browser. |
| Named robots with a personality and a skill level | `botLineup` in games/ventureflow/settings.js; vf/game/aiEngine.js | |
| Turn clock: 30 seconds, 4 extensions each | `housekeeping`, `EXTEND_TURN` in games/ventureflow/rules.js | The server owns the clock. |
| Stalled player: nudge at 40 s, notice at 60 s, table vote or host "Replace now" at 80 s | `MARK_STALL`, `KICK_VOTE`, `CONVERT_SEAT_TO_AI` in rules.js; vf/components/GameBoard.jsx | The server decides when a seat is stalled, not a browser. |
| Idle takeover after 3 minutes | `sweepTables` in arena/tables.js; `onLeave` in rules.js | Automatic. No host button needed. |
| Each seat acts only for itself (fortune cards, buyout offers, chat) | `personAction` in rules.js | |
| Bulk buying sent as one move | `queueTrade` in games/ventureflow/Board.jsx | |
| Spectators watch read-only | `seatAccess` in arena/tables.js; vf/components/GameBoard.jsx | |
| Arena ribbon in the game; "Back to VentureArena" at the end | ArenaRibbon in games/ventureflow/Board.jsx; vf/components/GameOverScreen.jsx | |
| Results flow to the arena: placing, net worth, "how you played" lines | `telemetry`, `observations` in rules.js; `matchOver` in arena/play.js | Recorded by the server on the last move. |
| **After the game** | | |
| Debrief room: result, rating change, reflection question with everyone's answers, one-word chips, kudos, connect, lesson card, play again | `debrief`, `answerDebrief`, `giveFeedback` in arena/play.js; pages/Debrief.jsx | Full lesson text for Subscribers. |
| Reputation: up for finishing and kudos, down for leaving | arena/play.js, arena/tables.js | +2 finished game, +3 kudos, -10 when a bot has to finish for you. |
| History: 30 days for free viewers, full for Subscribers; head-to-head for VIP | `HISTORY_DAYS` in shared/tiers.js; `profile` in arena/play.js | |
| **Membership and operations** | | |
| Tier framing and the one feature table | shared/tiers.js; pages/Membership.jsx | CEO members sort first in People and on the Opportunities board. |
| Stripe checkout, billing portal, webhook | `checkout`, `billingPortal`, `A.stripeWebhook` in arena/community.js; `POST /api/stripe/webhook` | Dormant (section 6). |
| Admin sets a member's tier | `A.admin.setTier` in arena/community.js; `POST /api/admin/setTier` | Protected by ADMIN_TOKEN. |
| Feedback loop: suggestion, problem or general; thank-you and reply land in the Inbox | `sendFeedback`, `A.admin.respondFeedback` in arena/community.js; components/FeedbackButton.jsx | |
| Report a member | `report` in arena/social.js; pages/Profile.jsx; `POST /api/admin/reports` | |
| Entry links from venturemaker.org and VentureFlow (`?go=guest`, `?from=`) | pages/Enter.jsx | |

## 4. New in this version

| What | Where it lives | Notes |
|---|---|---|
| One Node server for everything: landing page, lobby, tables, chat, bots | src/server/index.js, src/server/http.js | Run exactly one copy; live games are held in its memory. `/healthz` reports the storage in use. |
| boardgame.io holds the only copy of each game; browsers send moves and nothing else | src/server/bgio.js; `defineGame` in games/kit.js | Rules for building a game are in HOUSE-RULES.md. |
| House seat: the server's own seat for clocks and in-game robots | `house: true` in games/kit.js | Used by VentureFlow and VentureBoom. |
| Bot runner | src/server/bots/runner.js | A bot sees only what a person in that seat would see. Tables in play are picked up again after a restart (`resumeMatches`). |
| Five classic games: Four in a Row, Chess, Checkers, Reversi, Mancala | games/fourinarow, chess, checkers, reversi, mancala | Each has rules, a bot (Rookie, Sharp, Shark), a board, a lesson and reflection questions. Chess uses the open-source chess.js library. |
| VentureBoom, playable | games/ventureboom | 2 to 6 seats. Twelve quarters, or the four-quarter Fiscal Year. Hot Market and Kids' edition options. Earlier builds only listed it. |
| "Play a bot" in one click | `playBots` in arena/tables.js; `/enter?play=<game>` | |
| Static pages for search engines: landing, games index, one page per game, sitemap, robots.txt, 404 | scripts/build-seo.mjs (writes into dist/) | Built from each game's meta.js, so the page and the game cannot drift apart. |
| Board workbench | workbench.html; src/client/workbench.jsx; games/sim.js | Development only: any board against its own bot, no server. |
| Layout measured in a real browser | tests/e2e/ (run with `npm run test:e2e`) | Every board at 360x640, 390x844 and 1280x800; every page at the two phone sizes. |
| Storage drivers: memory, file, Postgres | src/server/store/index.js, postgres.js | Chosen by DATABASE_URL, else DATA_FILE, else memory. |
| Accounts and sessions kept by this server | arena/users.js; src/server/http.js | Scrypt-hashed passwords; a sign-in cookie the page's scripts cannot read, good for 180 days. |
| Security guards | `guardGameSockets` in src/server/bgio.js; server/store/bgio-storage.js; `A.limit` in arena/context.js | A move must come from its own seat; browsers cannot end a game; only tables the arena created exist; rate limits on sign-up, sign-in, chat and messages. |
| Opportunities board | `opportunities`, `postOpportunity`, `respondOpportunity`, `closeOpportunity` in arena/community.js; pages/People.jsx | Asks are free; roles need Subscriber; incubation, investment and challenge posts need VIP. A response arrives as an introduction. |
| "I can offer" list and new match types (founders to back, roles and talent, clients) | `OFFERS` in shared/profile.js; `A.recommend` in arena/matching.js | Feeds cofounder and support-team matching. |
| Vouching, working (CEO) | `vouch` in arena/play.js; pages/Profile.jsx | Worth 25 reputation. The recent build had only the flag. |
| Archetype suggestion after five games | `updatePersona`, `keepArchetype` in arena/play.js; pages/Me.jsx | The member chooses whether to switch. |
| Skill rank per game (Apprentice, Operator, Shark, Mogul) | `skillRank` in shared/profile.js | Shown on the Debrief and the record. |
| Operator endpoints: stats, waitlist, reports, feedback | `POST /api/admin/*` in src/server/http.js | No screen; see section 6. |
| Build checks: every game registered everywhere, bot-versus-bot playout, emoji check | tests/registration.test.js, tests/playout.test.js, scripts/check-emoji.mjs | |
| The venturemaker.org look | src/client/styles.css (tokens at the top); scripts/build-seo.mjs for the static pages | Cream page, navy ink, orange call to action, teal accent, Inter. Game tables stay dark. HOUSE-RULES section 4, rule 12. |
| Game history with each game's chat | `myGames`, `gameRecord` in arena/play.js; pages/History.jsx (`/history`, `/history/<table>`) | A member's own history is complete at every tier. A game's chat opens for the people who were at that table and nobody else. |
| Messages window on every page | `chatList`, `thread`, `markRead` in arena/social.js; components/ChatDock.jsx | Docked in the corner on a wide screen, a sheet from the top bar on a phone. Stays on the same conversation as you move around. Unread counts per conversation (`thread_reads`). Not shown during a game. |
| AI guides: Coach, Mentor, Spark, Historian, Money Guide | src/shared/guides.js; arena/guides.js; pages/Guides.jsx (`/guides`, `/guides/<id>`) | Claude through Anthropic's API (`ANTHROPIC_API_KEY`; "coming soon" without it). Daily allowance: Registered 5, Subscriber 30, VIP 80, CEO 200, and 3,000 a day for the whole site. A conversation per guide, "Start over", "Report this reply" (to the feedback list). "Talk it through with the Coach" from a finished game. Stricter instructions for under-18s. |
| My next steps | `mySteps`, `addStep`, `setStep`, `removeStep` in arena/guides.js; pages/Guides.jsx | A member's own short list. The Coach sees it and asks how each went. |
| Age step: 13 and over, extra care for under-18s | src/shared/age.js; `checkAge`, `confirmAge`, `A.contactOk` in arena/users.js; components/AgeFields.jsx | The date of birth is never stored. An adult and an under-18 connect, message or are introduced only after playing together. Accounts made earlier are asked once. Guests are not asked (see README, known gaps). |
| Info drawer at every table: How to play, Key, Progress, and the dice or deck record | client/game/GameInfo.jsx; each game's `info.js`; `shell.openInfo` in client/game/GameStage.jsx | Links in the table bar ("Progress" with the clock, "Key", "How to play"); VentureFlow has them in its ribbon. A new game gets the tabs by writing data. |
| The Key as a page | pages/GameKeyPage.jsx (`/key/<game>`); `loadGameInfo` in games/boards.js | Linked from every game card in the lobby. `/key/ventureboom#key-<card>` opens at one card. |
| VentureBoom Hall of Fame: a trait, a lesson and a true story for all 43 card names and 5 moves | games/ventureboom/hall-of-fame/stories.js; games/ventureboom/info.js | Each founder card tells the story of the person the rulebook pairs it with. Fact-checked against sources on 2 October 2026; the owner should still read them before quoting. Real names stay off the cards. |
| Histogram of dice rolls and other random draws | `recordRoll`, `rollCharts` in games/kit.js; `RollCharts` in client/game/GameInfo.jsx | No current game rolls dice. VentureBoom shows the cards face up this quarter against how many are in play; VentureFlow shows the weather of each finished month and the fortune cards drawn. |
| Table clock | client/game/clock.jsx; `now` in `A.tableView` | Counted from the server's start time, corrected for a device whose clock is wrong. |
| Time invested | arena/time.js (`timeInvested`, `timeBeat`, `A.gameMs`); `ms` on each result; components/TimeCard.jsx; client/timebeat.js; shared/time.js | Per game and in total on Game history, on Me and in the Progress tab. Time with each AI guide is counted too. Built so the business sandbox can time an idea, a project or a venture by registering a kind. |
| Pace of play: Quick, Steady, Slow | shared/pace.js; `setPace` in arena/tables.js; `botDelay` in server/bots/runner.js; `pauseAfter` in games/ventureboom/rules.js | Steady is the default and is slower than before in VentureBoom: robots hold after each card, combo, Exit and BOOM. Changed from the board (turtle / play / lightning button) or the Moves tab. |
| One action at a time, with what it means | `useAnnouncer` in client/game/hooks.js; `describe`, `explain` in games/ventureboom/info.js | Replaces the three-line feed. Tap it for the full list. |
| "Moves": everything that has happened, scrollable | `Moves` in client/game/GameInfo.jsx; each game's `describe` in info.js | VentureBoom and the five classics. Kept from the moment the browser sat down (the game itself keeps the last 80). VentureFlow keeps its own "What's happened" panel. |
| Countdowns | `Countdown` in client/game/clock.jsx; `useChangedAt` in client/game/hooks.js | VentureBoom: Hard Pass window, choices, next quarter. Every game: "a bot plays for you in ..." in the last minute before an idle seat is taken over, and "To the debrief in ..." at the end with "Stay here". |
| Resign at every table | `resignTable`, `resignOptions` in arena/tables.js; `ResignChoices` in client/game/GameStage.jsx | Concede (two-seat games: ends now, the other player wins, not an abandon) or hand the seat to a bot (the game goes on; counts as leaving). Always behind an "Are you sure?". |
| Invite connections to a table inside the arena | `tableInvitables`, `inviteToTable`, `answerTableInvite` in arena/social.js; components/TableInvites.jsx | Shows in the invited member's Inbox, at the top of their Play page and as a live notice. Text, email and link invites are still there underneath. |
| Open tables near the top of Play | pages/Lobby.jsx | Invitations, your tables, open tables, games in play, then the list of games. |

## 5. Changed on purpose

Where the builds disagreed, this is what each did and which decision v2 took.

| Topic | Sep 12 build | Recent build | v2 |
|---|---|---|---|
| Tiers and prices | Free, Member $0.99, Premium $9.99, VIP $49 | Free, Member $9.99, VIP $49.99, CEO $249 | Guest, Registered (free), Subscriber $9.99, VIP $49, CEO $249, as the new prompt asked (shared/tiers.js). |
| Archetype or persona | Persona read from play only (eight labels, six-axis radar) | Five archetypes from the card sort, plus a one-line play style | Both. The archetype from the survey is the member's label; the radar and persona come from play; play can only suggest a different archetype. |
| Accounts | Supabase Auth: email, guest, Google / Facebook / LinkedIn buttons | Supabase Auth: email and guest | Accounts live in this server: email and password, its own sign-in cookie. |
| Storage | Supabase Postgres with SQL migrations and edge functions | Same, plus row-level security and Realtime | Memory by default, optional file or Postgres (one table, `va_docs`). Supabase is not required. |
| Hosting | Web app on Railway plus Supabase | Static site on Render plus Supabase | One Node process, one copy. |
| Where a game runs | Server replays the move list on every move | Every browser replays a shared move list; VentureFlow is a separate site opened with a signed token | One state on the server; VentureFlow runs inside the arena. |
| Who plays robots and timers | Server, with a sweep every 15 minutes | The host's browser | The server. Closing a tab cannot freeze a table. |
| Who records the result | Server | The host's browser posts the standings | The server, from the rules' own final state. |
| Guests | Exactly one game | No limit | No limit on games. Up to 300 new guests an hour from one address (sized for a classroom). |
| Idle seat | Robot after 30 minutes | Host button after 3 minutes | Automatic after 3 minutes live, 24 hours turn-based. VentureFlow keeps its 80-second vote / replace ladder. |
| Robot seats | Host marks each seat AI or Open | Reserved robot chairs, later relaxed | Robots are never seats while a table is open; they fill what is empty at the start. |
| VentureFlow seats | 2 to 5 | Up to 4 | 2 to 4. |
| Rating K-factor | 32, shared across human opponents; 8 against bots | 40 for the first 10 games, then 20, averaged over opponents | 40 then 20, shared across human opponents; bots are a fixed 1200 at 8. |
| Business stages | idea, building, launched, scaling, exited, investor | idea, pre-revenue, revenue, scaling, exited | The recent five. "Investor" is now something you offer (Capital). |
| Speed signal | Formula tuned to VentureFlow turns | none | Median think time against each game's own pace, so it works for every game. |
| Declined request | Silently blocked the requester (no Decline button) | The Decline button also blocked the requester | Deleted. Blocking is a separate act. |
| Mixer when everyone was shown today | none | Repeated someone | Shows nobody new. |
| Host closes a table in play | none | Table abandoned for everyone | A bot takes the host's seat and the game goes on. |
| Photos | Supabase storage bucket, up to 5 MB | A field for an image link, no upload screen | Shrunk in the browser, kept with the arena's data. |

## 6. Stubbed or not carried over

**Wired, but waiting on configuration**

- Stripe billing: checkout, portal and webhook are written but off until `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` and `PRICE_MEMBER` (plus `PRICE_VIP`, `PRICE_CEO`) are set. Until then the Membership page says "Join the waitlist" and records the plan asked for. Tested with made-up events only, never against a real Stripe account.
- Email: the only email is "confirm your address", sent through Resend when `RESEND_API_KEY` is set. Without the key every new account is marked confirmed automatically.
- Postgres: the driver is tested against an in-process Postgres (PGlite, in tests/store.test.js) and was run once by hand against a local Postgres 16 (register, play, restart, everything still there). It has never run against the live Supabase project.
- No data migration: there is no import script. Members, ratings, history and points in the earlier builds' Supabase databases are not in v2.
- Fine-grained VentureFlow settings are open to everyone until `GATE_CUSTOM_SETTINGS=1`; only then do they become a Subscriber feature.

**Stubbed in the VentureFlow port**

- Global leaderboard: switched off (games/ventureflow/vf/game/globalLeaderboard.js has a blank address). The per-browser leaderboard remains.
- Recap link and "email the recap to a parent or teacher": hidden at an arena table; there is no `/recap` page. The file downloads remain.
- VentureFlow's standalone screens were not brought in: Kids version, pass-and-play, Quick Play and setup, save and resume, career stats, unlocks. They stay on VentureFlow's own site.
- The play-speed slider no longer sets robot pace; the server uses one pace for the table.

**Not carried over from the Sep 12 build**

- Sign in with Google, Facebook or LinkedIn.
- Changing the account email. (Forgotten password is new in this version: `/reset`, `requestPasswordReset`, `resetPassword`; with no mail provider the operator makes the link with `npm run admin -- reset-link`.)
- The badge list on the Arena Record (VentureFlow's seven badges). Only a badge count is stored with each result.
- Table names.
- The "have an invite code?" box in the lobby. Invite links work.
- "Take a break" and a per-table idle timeout (server-only before; turn-based pace now covers the need).
- Server-only leftovers with no v2 counterpart: forum categories, group threads, deleting your own topic reply, a VentureFlow leaderboard view.

**Not carried over from the most recent build**

- The outside-game adapter (launch token, result reporting, external scores). Games now run inside the arena, so a third-party game cannot report a result.
- Picking your own username: the server accepts it (`saveProfile`) but no screen has the field; it is made from the display name.
- The strip of newest player cards on the landing page (the landing page is now static).

**On the server, but with no screen yet**

- Find a member by email (`findByEmail` in arena/matching.js).
- Block a member (`block` in arena/social.js).
- "Client" matches: worked out by the recommender, seen only through the Mixer.
- Admin: no admin screen. Use `npm run admin -- <command>` (scripts/admin.mjs: stats, set-tier, reset-link, feedback, respond, reports, waitlist), which calls `POST /api/admin/*` with the `x-admin-token` header.

**Listed on the Membership page, not built**

- VIP: saved presets (the `saved_presets` flag is not used anywhere), verified badge.
- CEO: hosted events, curated introductions (`curated_intros` is not used), monthly coaching session.
- The eight member programs (lessons library, classes, prizes, pitch reviews, recruiting, coaching, consulting, Matchmaking+) are labels, as they were on Sep 12. What exists today: one lesson per game, and the mentor and cofounder introductions.
- VentureMaker (the game) is a "coming soon" card. Board Game Arena and BoardGameUniverse are outbound links only.
