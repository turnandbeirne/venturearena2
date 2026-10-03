// Build the static pages search engines see: the landing page, one page per
// game (its own title, description and full rules text) and a sitemap.
//
// A free games site is found through search. The app itself is a client-side
// bundle a crawler sees as an empty shell, so every game gets a real HTML page
// generated from the same metadata the lobby and the how-to-play panel use.
// Runs after `vite build` and writes into dist/.
import fs from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';

const DIST = path.resolve('dist');
const SITE = (process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : '') || 'http://localhost:8000').replace(/\/$/, '');

// The registry imports game rules with extensionless paths in places; bundle
// it to one file so plain Node can import it.
const tmp = path.resolve('build/.seo-registry.mjs');
await build({ entryPoints: ['src/games/registry.js'], outfile: tmp, bundle: true, platform: 'node', format: 'esm', logLevel: 'silent' });
const { GAMES, GAME_ORDER } = await import(pathToFileURL(tmp).href);
const { TIER_CARDS, TIER_INFO } = await import(pathToFileURL(path.resolve('src/shared/tiers.js')).href);
const { ARCHETYPES } = await import(pathToFileURL(path.resolve('src/shared/profile.js')).href);
fs.rmSync(tmp, { force: true });

// The same drafting-paper backdrop the app uses, served as one cached file.
fs.mkdirSync(DIST, { recursive: true });
fs.copyFileSync(path.resolve('src/client/assets/blueprint.svg'), path.join(DIST, 'blueprint.svg'));

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const metas = GAME_ORDER.map((id) => GAMES[id].meta);

// .hero and header.top sit on the same element as .wrap. They set only their
// vertical padding: a "padding" shorthand there wiped .wrap's 16px side gutter
// and the hero text touched the edge of a phone screen.
const CSS = `
:root{--navy:#132039;--cream:#f9f5f1;--orange:#e2620c;--orange2:#f47b25;--teal:#22c3c3;--tealink:#0b7377;--ink:#132039;--muted:#54627f;--line:#d1d6e0;--card:#fff}
*{box-sizing:border-box}body{margin:0;background:var(--cream) url(/blueprint.svg) 0 0/720px 720px;color:var(--ink);font:16px/1.55 Inter,system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;-webkit-font-smoothing:antialiased}
a{color:#a8480a}h1,h2,h3{line-height:1.12;margin:0 0 .4em;letter-spacing:-.02em}h1{font-size:clamp(2rem,6vw,3.2rem);font-weight:900;letter-spacing:-.025em}h2{font-size:1.5rem;font-weight:900}h3{font-size:1.05rem;font-weight:700}
p{margin:0 0 1em;max-width:68ch}.wrap{max-width:1040px;margin:0 auto;padding:0 16px}
.band{background:var(--navy);color:var(--cream)}.band a{color:#ffb27a}.band .lede{color:rgba(249,245,241,.82)}.band .eyebrow{color:var(--teal)}
header.top{display:flex;align-items:center;justify-content:space-between;gap:12px;padding-top:14px;padding-bottom:14px}.brand{font-weight:900;font-size:1.25rem;letter-spacing:-.02em;color:#fff;text-decoration:none}.brand b{color:var(--teal)}.brand small{display:block;font-weight:500;font-size:.65rem;letter-spacing:.04em;color:rgba(249,245,241,.72)}
.btn{display:inline-flex;align-items:center;justify-content:center;min-height:48px;padding:0 20px;border-radius:10px;font-weight:700;text-decoration:none;background:#fff;border:1px solid var(--line);color:var(--ink)}
.band .btn{background:rgba(255,255,255,.12);border-color:rgba(255,255,255,.2);color:var(--cream)}
.btn.gold,.band .btn.gold{background:var(--orange);border-color:var(--orange);color:#fff}.btn.gold:hover{background:var(--orange2);border-color:var(--orange2)}.btn.big{min-height:56px;font-size:1.1rem;padding:0 28px}
.hero{padding-top:34px;padding-bottom:44px}.lede{font-size:1.1rem;color:var(--muted)}
.grid{display:grid;gap:14px;grid-template-columns:1fr}.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px;display:flex;flex-direction:column;gap:8px;color:var(--ink)}
.card p{margin:0;color:var(--muted);font-size:.93rem}.chips{display:flex;flex-wrap:wrap;gap:6px}.chip{display:inline-flex;align-items:center;gap:6px;font-size:.75rem;padding:3px 10px;border-radius:999px;background:#ede7de;color:var(--ink)}.pip{width:8px;height:8px;border-radius:50%;flex:none}
section{padding:30px 0;border-top:1px solid var(--line)}.eyebrow{font-size:.72rem;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--tealink)}
.row{display:flex;flex-wrap:wrap;gap:10px;align-items:center}ol,ul{padding-left:1.2em;max-width:68ch}li{margin-bottom:.4em}
footer{padding:28px 0 48px;color:var(--muted);font-size:.85rem;border-top:1px solid var(--line)}
.icon{font-size:1.8rem}.price{color:var(--tealink);font-weight:800}
@media(max-width:899px){body{background-size:560px 560px}}
@media(min-width:680px){.grid{grid-template-columns:repeat(2,1fr)}}@media(min-width:960px){.grid.three{grid-template-columns:repeat(3,1fr)}.grid.four{grid-template-columns:repeat(4,1fr)}}
`;

function page({ title, description, canonical, body, jsonLd, noSession = false }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${esc(SITE + canonical)}">
<meta name="theme-color" content="#132039">
<meta property="og:type" content="website">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${esc(SITE + canonical)}">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
${jsonLd ? `<script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, '\\u003c')}</script>` : ''}
<style>${CSS}</style>
${noSession ? '' : `<script>
// Returning members skip the brochure. A referral code and the
// venturemaker.org "play now" link are handed to the app.
(function(){try{var q=new URLSearchParams(location.search);var ref=q.get('ref');if(ref)localStorage.setItem('va.ref',ref.toUpperCase().slice(0,12));
if(q.get('go')==='guest'){location.replace('/enter?go=guest'+(q.get('from')?'&from='+encodeURIComponent(q.get('from')):''));return}
if(/(?:^|; )va_in=1/.test(document.cookie)&&!q.get('stay')){location.replace('/home')}}catch(e){}})();
</script>`}
</head>
<body>
${body}
</body>
</html>
`;
}

// The navy strip across the top, as on venturemaker.org.
const top = `<div class="band"><header class="top wrap"><a class="brand" href="/">Venture<b>Arena</b><small>by VentureMaker&trade;</small></a><nav class="row"><a href="/games/">Games</a><a class="btn" href="/signin">Sign in</a></nav></header></div>`;
const foot = `<footer><div class="wrap"><p>VentureArena is made by <a href="https://venturemaker.org" rel="noopener">VentureMaker</a>: games that teach entrepreneurship, business and finance. VentureFlow and VentureBoom are VentureMaker learning games.</p><p><a href="/games/">All games</a> &middot; <a href="/membership">Membership</a> &middot; <a href="/signin">Sign in</a></p></div></footer>`;

function gameCard(m) {
  return `<article class="card"><div class="row"><span class="icon" aria-hidden="true">${m.icon}</span><div><h3><a href="/games/${m.id}/">${esc(m.name)}</a></h3><div class="eyebrow">${m.seats.min === m.seats.max ? m.seats.min : `${m.seats.min}-${m.seats.max}`} players &middot; ${esc(m.minutes)} min</div></div></div><p>${esc(m.tagline)}</p><div class="chips">${m.skills.slice(0, 3).map((s) => `<span class="chip">${esc(s)}</span>`).join('')}</div><div class="row"><a class="btn gold" href="/enter?play=${m.id}">Play now</a><a class="btn" href="/games/${m.id}/">How to play</a></div></article>`;
}

// ---- landing page ----------------------------------------------------------------
const venture = metas.filter((m) => m.family === 'venturemaker');
const classic = metas.filter((m) => m.family !== 'venturemaker');
const landing = page({
  title: 'VentureArena: Play Business Strategy Games and Meet Other Entrepreneurs',
  description: 'A free community for entrepreneurs who play. Strategy games about business, entrepreneurship and finance against real people or bots, then cofounders, mentors and investors matched on how you play.',
  canonical: '/',
  jsonLd: { '@context': 'https://schema.org', '@type': 'WebSite', name: 'VentureArena', url: SITE, description: 'A community of entrepreneurs who play.' },
  body: `${top}
<main>
<div class="band"><div class="wrap hero">
  <p class="eyebrow">A community of entrepreneurs who play</p>
  <h1>Play business.<br>Meet your people.</h1>
  <p class="lede">VentureArena is where aspiring entrepreneurs and curious minds connect with peers, mentors, investors, seasoned founders and future clients. The fastest way to get to know a kindred spirit is to play together, so every introduction here starts at a game table.</p>
  <div class="row"><a class="btn gold big" href="/enter?go=guest">Enter the Arena</a><span class="lede" style="font-size:.95rem">No signup. Play first, add an email later.</span></div>
</div></div>
<section><div class="wrap">
  <p class="eyebrow">VentureMaker games</p><h2>Games that teach the real thing</h2>
  <p class="lede">Original strategy games about entrepreneurship, business and finance. Fun first, and every round is a decision a founder actually faces.</p>
  <div class="grid">${venture.map(gameCard).join('')}</div>
</div></section>
<section><div class="wrap">
  <p class="eyebrow">Classic strategy</p><h2>Timeless games, with a business lesson attached</h2>
  <div class="grid three">${classic.map(gameCard).join('')}</div>
</div></section>
<section><div class="wrap">
  <p class="eyebrow">How it works</p><h2>Play, debrief, connect</h2>
  <div class="grid three">
    <article class="card"><h3>Play</h3><p>Sit down with real people or with bots that fill the empty seats. Every game is turn-based and works on a phone.</p></article>
    <article class="card"><h3>Debrief</h3><p>After every game: one business question everyone answers, one word for how each other played, and a lesson card.</p></article>
    <article class="card"><h3>Connect</h3><p>Playmates, peers, mentors, cofounders and investors, matched on how you actually play, your stage and what you are looking for.</p></article>
  </div>
</div></section>
<section><div class="wrap">
  <p class="eyebrow">Both sides of the table</p><h2>For people starting out, and people who have done it</h2>
  <div class="grid">
    <article class="card"><h3>Aspiring entrepreneurs</h3><p>Practice business, finance and startup decisions in games you will want to replay. Find peers at your stage, a mentor a few steps ahead, a cofounder whose strengths are not yours, and your first clients.</p></article>
    <article class="card"><h3>Experienced founders, mentors and investors</h3><p>Meet the next generation by playing them. Find interns and hires, teams and companies to incubate, ventures worth backing, and teams to tackle a real business challenge.</p></article>
  </div>
  <div class="chips" style="margin-top:16px">${Object.values(ARCHETYPES).map((a) => `<span class="chip"><span class="pip" style="background:${a.color}"></span>${esc(a.name)}: ${esc(a.tagline.toLowerCase())}</span>`).join('')}</div>
  <p class="lede" style="margin-top:10px;font-size:.95rem">Five archetypes. Find yours in three minutes, then find your complement.</p>
</div></section>
<section><div class="wrap">
  <p class="eyebrow">Membership</p><h2>Playing and making friends is always free</h2>
  <div class="grid four">${TIER_CARDS.map((t) => `<article class="card"><div class="eyebrow">${esc(TIER_INFO[t.id].name)}</div><h3>${esc(TIER_INFO[t.id].frame)}</h3><div class="price">${esc(TIER_INFO[t.id].priceLabel)}</div><p>${esc(t.human)}</p></article>`).join('')}</div>
</div></section>
</main>
${foot}`,
});

// ---- one page per game ---------------------------------------------------------------
function gamePage(m) {
  const others = metas.filter((x) => x.id !== m.id).slice(0, 6);
  const faq = [
    { q: `Is ${m.name} free to play online?`, a: `Yes. ${m.name} on VentureArena is free, runs in your browser on a phone or a computer, and needs no download or account.` },
    { q: `Can I play ${m.name} with friends?`, a: `Yes. Open a table and send the invite link. Up to 7 people can be at a table: ${m.seats.max === m.seats.min ? `${m.seats.max} play` : `${m.seats.min} to ${m.seats.max} play`} and the rest watch and chat. Bots fill empty seats if you want them to.` },
    { q: `Can I play ${m.name} against a computer?`, a: `Yes. Choose "Play a bot" and a game starts in one click.` },
  ];
  return page({
    title: m.seo.title,
    description: m.seo.description,
    canonical: `/games/${m.id}/`,
    noSession: true,
    jsonLd: [
      { '@context': 'https://schema.org', '@type': 'VideoGame', name: m.name, url: `${SITE}/games/${m.id}/`, description: m.seo.description, genre: 'Strategy', gamePlatform: 'Web browser', applicationCategory: 'Game', operatingSystem: 'Any', numberOfPlayers: { '@type': 'QuantitativeValue', minValue: m.seats.min, maxValue: m.seats.max }, offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' }, publisher: { '@type': 'Organization', name: 'VentureMaker' } },
      { '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: faq.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })) },
    ],
    body: `${top}
<main>
<div class="band"><div class="wrap hero">
  <p class="eyebrow">${m.family === 'venturemaker' ? 'A VentureMaker learning game' : 'Classic strategy game'} &middot; ${m.seats.min === m.seats.max ? m.seats.min : `${m.seats.min}-${m.seats.max}`} players &middot; ${esc(m.minutes)} minutes</p>
  <h1><span aria-hidden="true">${m.icon}</span> ${esc(m.name)}</h1>
  <p class="lede">${esc(m.seo.intro)}</p>
  <div class="row"><a class="btn gold big" href="/enter?play=${m.id}">Play ${esc(m.name)} now</a><a class="btn" href="/enter?next=/play">Play with friends</a></div>
</div></div>
<section><div class="wrap"><h2>How to play ${esc(m.name)}</h2><ol>${m.howTo.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>${(m.rulesText || []).map((r) => `<h3>${esc(r.h)}</h3><p>${esc(r.p)}</p>`).join('')}</div></section>
${m.seo.strategy && m.seo.strategy.length ? `<section><div class="wrap"><h2>${esc(m.name)} strategy tips</h2><ul>${m.seo.strategy.map((s) => `<li>${esc(s)}</li>`).join('')}</ul></div></section>` : ''}
<section><div class="wrap"><h2>The business lesson</h2><p>${esc(m.lesson)}</p><p class="lede" style="font-size:.95rem">After every game on VentureArena the table answers one question together. For ${esc(m.name)}, one of them is: <em>${esc(m.reflection[0])}</em></p><div class="chips">${m.skills.map((s) => `<span class="chip">${esc(s)}</span>`).join('')}</div></div></section>
<section><div class="wrap"><h2>Questions</h2>${faq.map((f) => `<h3>${esc(f.q)}</h3><p>${esc(f.a)}</p>`).join('')}</div></section>
${others.length ? `<section><div class="wrap"><h2>More games</h2><div class="grid three">${others.map(gameCard).join('')}</div></div></section>` : ''}
</main>
${foot}`,
  });
}

const index = page({
  title: 'Free Online Strategy Games for Entrepreneurs | VentureArena',
  description: `Play ${metas.map((m) => m.name).join(', ')} free in your browser, against bots or other entrepreneurs.`,
  canonical: '/games/',
  noSession: true,
  body: `${top}<main><div class="wrap hero"><h1>Games</h1><p class="lede">Every game is free, turn-based and playable on a phone. Play a bot in one click or invite friends with a link.</p><div class="grid three">${metas.map(gameCard).join('')}</div></div></main>${foot}`,
});

const notFound = page({ title: 'Not found | VentureArena', description: 'That page does not exist.', canonical: '/404', noSession: true, body: `${top}<main><div class="wrap hero"><h1>That page is not here</h1><p class="lede">Try the <a href="/games/">games</a>, or go <a href="/">home</a>.</p></div></main>${foot}` });

function write(rel, html) { const file = path.join(DIST, rel); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, html); }
if (!fs.existsSync(DIST)) throw new Error('dist/ is missing: run "vite build" first');
write('landing.html', landing);
write('games/index.html', index);
write('404.html', notFound);
for (const m of metas) write(`games/${m.id}/index.html`, gamePage(m));
const today = new Date().toISOString().slice(0, 10);
write('sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${['/', '/games/', ...metas.map((m) => `/games/${m.id}/`)].map((u) => `  <url><loc>${SITE}${u}</loc><lastmod>${today}</lastmod></url>`).join('\n')}\n</urlset>\n`);
write('robots.txt', `User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /t/\nDisallow: /debrief/\nDisallow: /inbox\nSitemap: ${SITE}/sitemap.xml\n`);
console.log(`SEO: landing page, games index and ${metas.length} game pages written to dist/ (site ${SITE})`);
