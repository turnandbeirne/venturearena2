# VentureArena

A community of entrepreneurs who play. Aspiring founders and curious minds meet
peers, mentors, investors and seasoned operators at a game table, and the games
are how they find each other. Made by [VentureMaker](https://venturemaker.org),
whose learning games (VentureFlow, VentureBoom) are hosted here next to freely
licensed classics (Four in a Row, Reversi, Checkers, Mancala, Chess).

This is **one Node server**. It serves the landing page, the lobby, the game
tables, chat and the bots. Games run on [boardgame.io](https://boardgame.io).

| Read this | For |
|---|---|
| `README.md` (this file) | Running, testing and deploying |
| `HOUSE-RULES.md` | How a game is built, every place a new game is registered, past failures and the rule each produced |
| `docs/FEATURE-MAP.md` | What carried over from the two earlier builds, what changed, what is still a stub |
| `docs/VENTUREBOOM-RULINGS.md` | Rulings the VentureBoom rulebook left open, for you to confirm |
| `AGENTS.md` / `CLAUDE.md` | What an AI assistant may never do here without your say-so |
| `.env.example` | Every setting, by name |

## Run it on your computer

Needs Node 20 or newer.

```
npm install
npm run build
npm start
```

Open http://localhost:8000. With no settings it keeps everything in memory, so
a restart starts empty. To keep data between restarts on your own machine:

```
DATA_FILE=./data/arena.json npm start
```

For development with hot reload (`http://localhost:5173/enter`):

```
npm run dev
```

One board on its own, without the arena around it:
`http://localhost:5173/workbench.html?game=fourinarow`

## Tests

```
npm test            # rules, bot-vs-bot playouts at every seat count, the arena, storage, HTTP and sockets
npm run test:e2e    # real Chromium: landing to first move, two players and a watcher, a member's whole journey, layouts
```

`npm run test:e2e` starts its own server on the in-memory store. It never uses
`DATABASE_URL`, `DATA_FILE` or Stripe keys, whatever your shell has set.
Screenshots land in `tests/e2e/shots/`.

The layout spec measures every page and every board at 360 x 640, 390 x 844 and
1280 x 800: no horizontal scroll, board inside the viewport, tap targets large
enough. `npm run build` fails on any emoji newer than Emoji 11.

## Deploy

### The two rules

1. **Exactly one copy of the server.** Live game state, turn clocks and bot
   timers are in the server's memory. A second copy would hold its own version
   of every table. No autoscaling, one instance, one replica. The database makes
   a restart safe; it does not make a second copy safe.
2. **The host must pass WebSockets.** Render and Railway do by default. If you
   put a proxy or CDN in front, turn WebSockets on there too.

### Render

`render.yaml` is a Blueprint for one web service, `venturearena2`. In the
Render dashboard: New > Blueprint, pick the repository. It asks for one value,
`DATABASE_URL` (see "Sharing a Supabase project" below), sets the rest itself,
including a random `ADMIN_TOKEN`, and turns `NOINDEX` on so a playtest copy
stays out of search engines.

The web service uses Render's Starter size (the free one sleeps after 15 idle
minutes, which ends live tables). The server uses about 80 MB of memory with
thirty tables running, so Starter is enough to begin with.

### Running it next to an earlier build

This build's code shares nothing with the earlier ones, and
`tests/standalone.test.js` keeps it that way: no address of the earlier
Supabase projects, the VentureFlow site or the first arena appears anywhere in
the source. To keep the two apart:

| Thing | Earlier build | This build |
|---|---|---|
| Code | its own repository | a NEW repository; never a branch or folder of the old one |
| Site | `venturearena` (static site) | `venturearena2` (web service), a different address |
| Data | Supabase project, `public` schema | the same Supabase project, its own schema `arena2` and its own login that can reach nothing else |
| Accounts | Supabase Auth | this server's own; testers register again |
| Search engines | indexed | `NOINDEX=1` |
| Email, billing, domain | as they are | none set: no emails sent, no payments taken, no DNS change |

Do not give this build the earlier build's main database password, Stripe keys
or domain while both are being compared.

### Sharing a Supabase project (its own schema, its own login)

The server keeps everything in ONE table, `va_docs`. With `DATABASE_SCHEMA=arena2`
that table lives in a schema called `arena2`, which Supabase's data API does not
serve and the other application never looks at. Give it a login of its own that
is allowed inside that schema and nowhere else:

1. Supabase dashboard > SQL Editor. Run this once, with a long password of your
   own choosing in place of the placeholder (letters and digits only keeps the
   connection string simple):

   ```sql
   create role arena2_app login password 'CHOOSE-A-LONG-PASSWORD' connection limit 10;
   create schema arena2;
   grant usage, create on schema arena2 to arena2_app;
   ```

2. Supabase > Connect > "Session pooler". Copy that connection string and
   change the user and password in it to the new login. The user is the role
   name, a dot, then your project reference:

   ```
   postgresql://arena2_app.<project-ref>:<the password>@<pooler host>:5432/postgres
   ```

3. Paste it as `DATABASE_URL` when the Blueprint asks (or later under the
   service's Environment tab). `DATABASE_SCHEMA=arena2` is already set by the
   Blueprint.

What this gives you: the new server cannot read, change or drop the earlier
build's tables (tried against a local Postgres 16 with exactly these three
statements: every attempt outside `arena2` is refused). The table also has row
level security on with no policies, so even in the default schema it is closed
to the data API.

What the two builds still share: the database machine itself. Its memory and
connection slots, its backups (restoring the project to an earlier time takes
both builds back), and its outages.

To remove this build's data later: `drop schema arena2 cascade; drop role arena2_app;`
Nothing else is affected.

Prefer no sharing at all? Create a Render Postgres (or a new Supabase project),
use its connection string as `DATABASE_URL`, and remove `DATABASE_SCHEMA`.

### Railway

New project from the repository. Build command `npm ci --include=dev && npm run build`,
start command `npm start`, replicas **1**, health check path `/healthz`.

### Anywhere else

`Dockerfile` builds one image that runs `node build/server.cjs` on port 8000.

### Settings

Set these in the host's dashboard. `.env.example` has the full list with notes.

| Setting | Needed? | What it does |
|---|---|---|
| `NODE_ENV=production` | yes | Secure cookies, proxy headers |
| `DATABASE_URL` | yes, for a real launch | Any Postgres. Without it (or `DATA_FILE`) every restart starts empty |
| `DATABASE_SCHEMA` | when the database is shared | Keeps this server's one table in a schema of its own, e.g. `arena2` |
| `ADMIN_TOKEN` | yes | A long random string; enables the operator commands below |
| `TRUSTED_PROXY_HOPS` | yes | `1` on Render or Railway; add 1 for each extra proxy (Cloudflare). Without it the per-address rate limits can be dodged |
| `PUBLIC_URL` | once you have a domain | `https://arena.venturemaker.org`. Render and Railway supply their own address until then |
| `ALLOWED_ORIGINS` | rarely | Only if a proxy in front rewrites the Host header and the game board never connects: list the site's addresses |
| `NOINDEX=1` | for a playtest copy | Tells search engines to stay away |
| `RESEND_API_KEY`, `MAIL_FROM` | recommended | Confirmation and password-reset emails. Without a key, new accounts count as verified and reset links are made by hand |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `PRICE_MEMBER`, `PRICE_VIP`, `PRICE_CEO` | when you sell | Until set, Membership collects a waitlist |

### AI guides (Anthropic)

The Coach, Mentor, Spark, Historian and Money Guide are Claude, through
Anthropic's API. Create a key at platform.claude.com (Settings > API keys), set
a monthly spend limit there, and add it in your host's dashboard as
`ANTHROPIC_API_KEY`. Without it the Guides page says "coming soon" and nothing
else changes. `/healthz` reports `"guides": "on"` once the key is seen.

The default model is `claude-haiku-4-5-20251001` (the cheapest; a message costs
a fraction of a cent). `GUIDE_MODEL` changes it. A member's daily allowance is
`GUIDE_DAILY` in `src/shared/guides.js`; `GUIDE_SITE_DAILY_CAP` (default 3000)
is the most the whole site may send in a day.

### Database (any Postgres)

On first start the server creates one table, `va_docs`, and keeps everything in
it as JSON documents. It does not read or change any other table. On a database
of its own, `DATABASE_URL` is all it needs. On a database another application
uses, also set `DATABASE_SCHEMA` (see "Sharing a Supabase project" above).
From Render, use Supabase's "Session pooler" connection string: the direct one
is IPv6 only, which Render cannot reach.

Nothing from the earlier builds' databases is imported. Members of the earlier
builds would register again.

### Billing (Stripe)

1. Create three monthly prices: $9.99 (Subscriber), $49 (VIP), $249 (CEO).
   Put their ids in `PRICE_MEMBER`, `PRICE_VIP`, `PRICE_CEO`.
2. Add a webhook to `https://<your site>/api/stripe/webhook` for the events
   `checkout.session.completed`, `customer.subscription.created`,
   `customer.subscription.updated` and `customer.subscription.deleted`. Put its signing secret in
   `STRIPE_WEBHOOK_SECRET`.
3. Set `STRIPE_SECRET_KEY`. The Membership page switches from waitlist to
   checkout on the next restart.

Billing has been tested with made-up Stripe events only. Run one real purchase
in Stripe's test mode before taking money.

### The "Play now" button on venturemaker.org

```html
<a href="https://arena.venturemaker.org/?from=venturemaker&go=guest">Play now</a>
```

That link puts a visitor at a table as a guest with no form. To send them
straight into one game against bots:
`https://arena.venturemaker.org/enter?play=ventureflow&from=venturemaker`

## Operating it

With `ADMIN_TOKEN` set on the server and in your shell (and `ARENA_URL` pointing
at the site):

```
npm run admin -- stats
npm run admin -- set-tier someone@example.com vip
npm run admin -- reset-link someone@example.com
npm run admin -- feedback new
npm run admin -- respond 12 done "Fixed: the board now fits small phones."
npm run admin -- reports
npm run admin -- waitlist
```

`/healthz` answers `{ ok, store, uptime }`. The first log line after a start
says which storage is in use and how many live tables were resumed.

## Where things are

```
src/games/<id>/        one folder per game: rules.js (pure), bot.js, meta.js, Board.jsx
src/games/kit.js       the helpers every rules module uses
src/games/registry.js  the list of games (server side); boards.js is the browser side
src/server/            the server: arena/ (accounts, tables, play, social, matching, community),
                       bots/runner.js, store/ (memory, file, Postgres), http.js, realtime.js, bgio.js
src/client/            the web app (React)
src/shared/            tiers.js (the one feature table), profile.js (survey, archetypes, stages), age.js
src/client/styles.css  the look: venturemaker.org's colours as tokens at the top; .stage keeps game tables dark
scripts/               build, SEO pages, emoji check, admin
tests/                 vitest suites; tests/e2e/ runs in a real browser
```

To add a game, follow `HOUSE-RULES.md` section 2. `tests/registration.test.js`
fails the build if a registration step is missed.

## Known gaps before a public launch

- **Ages: get legal advice before inviting under-18s.** Accounts ask for a date of birth and refuse under-13s, and an adult and an under-18 cannot contact each other privately until they have played together. That is a sensible floor, not a compliance review. Guests are NOT asked their age (they give no email and cannot message anyone, but they can type in a table's chat). There is no parental consent step, no moderation queue for chat, and the Report button sends a note to the operator rather than hiding anything. An account closed by the age check is kept for the operator to remove: `npm run admin` has no delete command yet.
- **AI guides.** What members type to the guides, with the basics of their profile, is sent to Anthropic's API to write each reply; say so in your privacy notice. The guides are instructed not to give financial, legal or tax advice and to be careful with under-18s, but a language model can still be wrong or say something it should not: "Report this reply" puts the reply in the feedback list (`npm run admin -- feedback`), and nobody reviews replies before a member sees them. Set a monthly spend limit in the Anthropic Console as well as `GUIDE_SITE_DAILY_CAP`. The guides were tested against a stand-in, not against Anthropic's service: send one message after deploying and read the log if it fails (`[guides]` lines name the error type).
- Table chat, direct messages and guide conversations are kept without a time limit, and there is no "delete my messages" or "delete my account" for members yet.
- No Content-Security-Policy header yet.
- Login is rate limited per address, not per account; there is no lockout.
- A member can block someone through the API, but there is no Block button or unblock yet.
- Stripe is verified with stubbed events; Postgres with an in-process database and one manual run against a local Postgres 16, not against Supabase.
- `npm audit` reports advisories in packages that boardgame.io 0.50.2 (its latest release) brings with it: `svelte` (its debug panel, switched off here), `@koa/cors` and `cookie` (its lobby API, which this server never lets a request reach). `npm audit fix --force` would downgrade boardgame.io and break the site; do not run it.
- `docs/VENTUREBOOM-RULINGS.md` lists ten places where the VentureBoom rulebook needed a ruling. Confirm or change them.
- `docs/FEATURE-MAP.md` section 6 lists every stub and everything not carried over.
