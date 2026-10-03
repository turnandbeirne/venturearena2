// Layout, measured in a real browser (HOUSE-RULES 4.3: do not eyeball it).
//
//  1. Every game the server lists, at 360x640, 390x844 and 1280x800: no
//     horizontal page scroll, the board inside the viewport, buttons in the
//     stage big enough for a thumb. A game registered later is covered
//     automatically because the list comes from POST /api/rpc/games.
//  2. Every arena page and the static pages at 360x640 and 390x844: no
//     horizontal scroll, nothing wider than the screen, tap targets at least
//     40px tall, no clipped button text, the tab bar covering nothing at the
//     bottom of the page, and no console error or failed request.
//  3. The states people hit when something is gone, and the accessibility
//     basics: contrast, keyboard reach, dialogs, reduced motion.
import {
  openContext, watch, rpc, guestSession, memberSession, cookiesOf, measurePage, measureContrast, playFirToEnd,
  PHONE, PHONE_TALL, DESKTOP, PHONES, vpName, sleep,
} from './lib.mjs';

const settle = async (page) => { await page.evaluate(() => document.fonts.ready.then(() => true)); await sleep(120); };

/** Measure one game stage. */
function measureStage(page) {
  return page.evaluate(() => {
    const vw = window.innerWidth; const vh = window.innerHeight;
    const stage = document.querySelector('.stage');
    const boardBox = document.querySelector('.stage__board');
    const fullscreen = !document.querySelector('.stage__bar');
    const visible = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width >= 1 && r.height >= 1 && cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0; };
    const name = (el) => `${el.tagName.toLowerCase()}${typeof el.className === 'string' && el.className ? `.${el.className.trim().split(/\s+/).join('.')}` : ''} "${(el.getAttribute('aria-label') || el.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 30)}"`;
    const scrolls = (el, stop) => { for (let p = el.parentElement; p && p !== stop; p = p.parentElement) { const cs = getComputedStyle(p); if (/(auto|scroll|hidden|clip)/.test(`${cs.overflowX} ${cs.overflowY}`)) return true; } return false; };
    const out = { fullscreen, innerWidth: vw, innerHeight: vh, scrollWidth: document.documentElement.scrollWidth, board: null, outside: [], outsideDecor: [], small: [], tight: [], smallest: null, controls: 0, hiddenScroll: [], hand: null };
    // A strip that scrolls but shows no scrollbar hides its overflow from
    // anyone with a mouse, and gives a thumb no hint that there is more.
    // (Bug: VentureBoom's hand was one: with eight cards, four were off
    // screen and there was no way to tell, or on a laptop to reach them.
    // This test used to skip everything inside a scrolling parent.)
    if (boardBox) {
      for (const d of boardBox.querySelectorAll('*')) {
        if (!visible(d)) continue;
        const cs = getComputedStyle(d);
        const overX = /(auto|scroll)/.test(cs.overflowX) && d.scrollWidth > d.clientWidth + 2;
        const overY = /(auto|scroll)/.test(cs.overflowY) && d.scrollHeight > d.clientHeight + 2;
        if (!overX && !overY) continue;
        const noBar = cs.scrollbarWidth === 'none' || getComputedStyle(d, '::-webkit-scrollbar').display === 'none';
        if (noBar) out.hiddenScroll.push(`${name(d)}: ${overX ? `${d.scrollWidth - d.clientWidth}px hidden sideways` : `${d.scrollHeight - d.clientHeight}px hidden below`}`);
      }
      // A hand of cards: every card fully on screen and inside the board.
      const handEl = boardBox.querySelector('[aria-label="Your hand"]');
      if (handEl) {
        const box = (boardBox.firstElementChild || boardBox).getBoundingClientRect();
        const cards = [...handEl.querySelectorAll('button')];
        const cut = cards.filter((c) => { const r = c.getBoundingClientRect(); return r.left < box.left - 1 || r.right > box.right + 1 || r.top < box.top - 1 || r.bottom > box.bottom + 1 || r.left < -1 || r.right > vw + 1 || r.bottom > vh + 1; });
        const first = cards[0] ? cards[0].getBoundingClientRect() : null;
        out.hand = { cards: cards.length, cut: cut.map((c) => name(c)), cardW: first ? Math.round(first.width) : 0, cardH: first ? Math.round(first.height) : 0, rows: new Set(cards.map((c) => c.offsetTop)).size };
      }
    }
    const main = boardBox && boardBox.firstElementChild;
    if (main) {
      // The board proper: the game's root, or the one child it centres inside itself.
      let el = main;
      while (el.children.length === 1 && visible(el.children[0])) el = el.children[0];
      const r = el.getBoundingClientRect();
      out.board = { what: name(el), left: Math.round(r.left), top: Math.round(r.top), right: Math.round(r.right), bottom: Math.round(r.bottom), w: Math.round(r.width), h: Math.round(r.height) };
      out.board.inside = r.width > 0 && r.height > 0 && r.left >= -0.5 && r.top >= -0.5 && r.right <= vw + 0.5 && r.bottom <= vh + 0.5;
      if (!fullscreen) {
        for (const d of main.querySelectorAll('*')) {
          if (!visible(d) || scrolls(d, boardBox)) continue;
          const q = d.getBoundingClientRect();
          if (q.left < -1 || q.top < -1 || q.right > vw + 1 || q.bottom > vh + 1) {
            const interactive = d.matches('button, a[href], input, select, [role="button"]');
            (interactive ? out.outside : out.outsideDecor).push(`${name(d)} at ${Math.round(q.left)},${Math.round(q.top)} to ${Math.round(q.right)},${Math.round(q.bottom)}`);
          }
        }
      }
    }
    for (const b of stage.querySelectorAll('button, [role="button"]')) {
      if (b.disabled || !visible(b)) continue;
      const r = b.getBoundingClientRect();
      if (r.bottom < 0 || r.top > vh) continue;
      out.controls += 1;
      const min = Math.round(Math.min(r.width, r.height) * 10) / 10;
      if (!out.smallest || min < out.smallest.min) out.smallest = { min, what: name(b) };
      if (min < 36) out.small.push(`${name(b)}: ${Math.round(r.width)}x${Math.round(r.height)}`);
      else if (min < 40) out.tight.push(`${name(b)}: ${Math.round(r.width)}x${Math.round(r.height)}`);
    }
    return out;
  });
}

/** Clickable things a keyboard cannot reach: pointer cursor, not focusable, nothing focusable around them. */
function unreachable(page) {
  return page.evaluate(() => {
    const focusable = (el) => el.matches('a[href], button, input, select, textarea, summary, [tabindex]:not([tabindex="-1"])') || (el.tagName === 'LABEL' && (el.control || el.querySelector('input, select, textarea')));
    const out = [];
    for (const el of document.querySelectorAll('body *')) {
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;
      if (getComputedStyle(el).cursor !== 'pointer') continue;
      if (el.parentElement && getComputedStyle(el.parentElement).cursor === 'pointer') continue; // inherited
      let ok = false;
      for (let p = el; p; p = p.parentElement) if (focusable(p)) { ok = true; break; }
      if (!ok) out.push(`${el.tagName.toLowerCase()}.${String(el.className).trim().split(/\s+/).join('.')} "${(el.innerText || '').trim().slice(0, 30)}"`);
    }
    return out;
  });
}

export default async function layout({ baseUrl, browser, check, shots }) {
  const { games } = await (await fetch(`${baseUrl}/api/rpc/games`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).json();
  check.info('games listed by the server', games.map((g) => g.id).join(', '));

  // One guest for every board and viewport: fresh browsers, the same account
  // (the server allows 20 new guests an hour per address).
  const seed = await openContext(browser, { viewport: PHONE });
  await guestSession(seed, baseUrl, 'Layout Guest');
  const guestCookies = await cookiesOf(seed);

  // ---- 1. every game ----------------------------------------------------------------------
  for (const g of games) {
    for (const vp of [PHONE, PHONE_TALL, DESKTOP]) {
      const tag = `${g.id} @ ${vpName(vp)}`;
      await check.section(tag, async () => {
        const ctx = await openContext(browser, { viewport: vp, cookies: guestCookies });
        const page = await ctx.newPage();
        const w = watch(page);
        try {
          await page.goto(`${baseUrl}/enter?play=${encodeURIComponent(g.id)}`);
          await check.must(`${tag}: the board opens`, async () => {
            await page.locator(`.stage[data-game="${g.id}"]`).waitFor();
            await page.waitForFunction(() => { const b = document.querySelector('.stage__board'); const c = b && b.firstElementChild; if (!c) return false; const r = c.getBoundingClientRect(); return r.width > 0 && r.height > 0 && c.querySelector('*'); });
          });
          await settle(page); await sleep(350); // the bot may open; entry animations finish
          const m = await measureStage(page);
          await shots(page, `game-${g.id}-${vpName(vp)}`);
          const phone = vp.width < 800;
          await check(`${tag}: no horizontal page scroll`, m.scrollWidth <= m.innerWidth, `scrollWidth ${m.scrollWidth} vs innerWidth ${m.innerWidth}`);
          if (m.fullscreen) {
            await check(`${tag}: a fullscreen game shows an interactive control`, m.controls > 0, `${m.controls} enabled controls visible`);
          } else {
            await check(`${tag}: the board is fully inside the viewport`, !!(m.board && m.board.inside) && m.outside.length === 0,
              m.board ? `${m.board.what} ${m.board.w}x${m.board.h} at ${m.board.left},${m.board.top}-${m.board.right},${m.board.bottom} in ${m.innerWidth}x${m.innerHeight}${m.outside.length ? `; outside: ${m.outside.slice(0, 4).join('; ')}` : ''}` : 'no board element');
            if (m.outsideDecor.length) check.warn(`${tag}: ${m.outsideDecor.length} non-interactive element(s) reach past the viewport`, m.outsideDecor.slice(0, 3).join('; '));
            if (phone) {
              await check(`${tag}: every enabled button in the stage is at least 36px`, m.small.length === 0, m.small.slice(0, 6).join('; '));
              if (m.tight.length) check.warn(`${tag}: ${m.tight.length} button(s) under 40px`, m.tight.slice(0, 6).join('; '));
            }
          }
          // Table talk is always on screen: a docked window beside the board on a
          // wide screen, a one-line strip showing the latest message on a phone.
          const talk = await page.evaluate(() => {
            const vw = window.innerWidth; const vh = window.innerHeight;
            const box = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height, shown: r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none', inside: r.left >= -1 && r.top >= -1 && r.right <= vw + 1 && r.bottom <= vh + 1 }; };
            const dock = document.querySelector('.stage__chat');
            return { dock: box(dock), input: box(dock && dock.querySelector('[aria-label="Chat message"]')), ticker: box(document.querySelector('.stage__ticker')), board: box(document.querySelector('.stage__board')) };
          });
          if (m.fullscreen) {
            // VentureFlow has its own chat panel inside the game and a "Table talk" link.
            await check(`${tag}: the game's own chat or its Table talk link is on the page`, await page.getByRole('button', { name: /^Table talk/ }).count() > 0);
          } else if (!phone) {
            await check(`${tag}: a chat window is docked beside the board, with a box to type in`, !!(talk.dock && talk.dock.shown && talk.dock.inside && talk.input && talk.input.shown && talk.input.inside && talk.dock.w >= 260), JSON.stringify(talk.dock));
            await check(`${tag}: the chat window does not cover the board`, !!(talk.dock && talk.board && talk.board.r <= talk.dock.l + 1), talk.dock && talk.board ? `board ends at ${Math.round(talk.board.r)}, chat starts at ${Math.round(talk.dock.l)}` : 'missing');
          } else {
            await check(`${tag}: a chat strip is always on screen`, !!(talk.ticker && talk.ticker.shown && talk.ticker.inside && talk.ticker.h >= 36), JSON.stringify(talk.ticker));
          }
          await check(`${tag}: nothing is hidden in a strip that scrolls without a scrollbar`, m.hiddenScroll.length === 0, m.hiddenScroll.slice(0, 4).join('; '));
          if (m.hand) {
            await check(`${tag}: every card in your hand is fully visible`, m.hand.cards >= 7 && m.hand.cut.length === 0, `${m.hand.cards} cards in ${m.hand.rows} row(s) at ${m.hand.cardW}x${m.hand.cardH}; cut off: ${m.hand.cut.length ? m.hand.cut.join('; ') : 'none'}`);
            await check(`${tag}: hand cards are big enough to tap`, m.hand.cardW >= 44, `${m.hand.cardW}x${m.hand.cardH}`);
            check.info(`${tag}: hand`, `${m.hand.cards} cards, ${m.hand.rows} row(s), each ${m.hand.cardW}x${m.hand.cardH}`);
          }
          if (g.id === 'ventureboom') {
            await check(`${tag}: a card opens to its full view, with the "?" that leads to its real-world story`, async () => {
              await page.locator('[aria-label="Your hand"] button').first().click();
              await page.getByRole('button', { name: 'Card details' }).click();
              const dlg = page.getByRole('dialog');
              await dlg.waitFor();
              const q = dlg.locator('.vb__q').first();
              await q.waitFor();
              const a = await q.evaluate((el) => { const r = el.getBoundingClientRect(); return { tag: el.tagName, text: el.textContent, label: el.getAttribute('aria-label'), inside: r.left >= 0 && r.right <= window.innerWidth && r.top >= 0 && r.bottom <= window.innerHeight, round: getComputedStyle(el).borderRadius }; });
              if (a.tag !== 'BUTTON') throw new Error(`the "?" is a <${a.tag.toLowerCase()}>: at a table it opens the Key, it does not leave the site`);
              if (a.text !== '?' || !/real-world story/.test(a.label || '')) throw new Error(`label: ${a.text} / ${a.label}`);
              if (!a.inside) throw new Error('the "?" is off screen');
              await shots(page, `ventureboom-card-open-${vpName(vp)}`);
              // The "?" opens the Key at this card, with its true story open.
              // (It used to link to a page on venturemaker.org that did not exist.)
              const cardName = (await dlg.getByRole('heading').first().textContent()).trim();
              await q.click();
              const keyDlg = page.getByRole('dialog', { name: /Key to VentureBoom/ });
              await keyDlg.waitFor();
              if (await page.getByRole('dialog').count() !== 1) throw new Error('the Key opened on top of the card instead of replacing it');
              const f = await keyDlg.locator('.gkey__item--focus').evaluate((el) => {
                const d = el.querySelector('details'); const panel = el.closest('.drawer__panel'); const r = el.getBoundingClientRect(); const pr = panel.getBoundingClientRect();
                return { name: el.querySelector('.gkey__name').firstChild.textContent, open: !!(d && d.open), story: d ? d.querySelector('p').textContent.length : 0, who: d ? d.querySelector('summary b').textContent : '', top: Math.round(r.top - pr.top), panelH: Math.round(pr.height), img: !!el.querySelector('img') };
              });
              if (f.name !== cardName) throw new Error(`opened at "${f.name}", not at "${cardName}"`);
              if (!f.open || f.story < 120 || !f.who) throw new Error(`the story is not open: ${JSON.stringify(f)}`);
              if (f.top < 0 || f.top > f.panelH - 60) throw new Error(`the card's entry is not in view (${f.top}px into a ${f.panelH}px panel)`);
              await shots(page, `ventureboom-key-at-card-${vpName(vp)}`);
              await page.keyboard.press('Escape');
              await page.getByRole('dialog').waitFor({ state: 'detached' });
              await page.getByRole('button', { name: 'Clear selection' }).click();
            });
            // (Bug: Hard Pass and Hostile Takeover have four-line rules, and
            // the rule panel grew 8 px up over the bottom of the picture.)
            await check(`${tag}: on every card in the hand, opened, the rule sits in the footer and never over the picture`, async () => {
              const n = await page.locator('[aria-label="Your hand"] button').count();
              const seen = [];
              for (let i = 0; i < n; i++) {
                const card = page.locator('[aria-label="Your hand"] button').nth(i);
                const name = ((await card.getAttribute('aria-label')) || '').split(',')[0];
                if (seen.includes(name)) continue;
                seen.push(name);
                await card.click();
                await page.getByRole('button', { name: 'Card details' }).click();
                const dlg = page.getByRole('dialog');
                await dlg.waitFor();
                const m = await dlg.evaluate((el) => {
                  const big = el.querySelector('.vb__big'); const rule = el.querySelector('.vb__big-rule'); const head = el.querySelector('.vb__big-name');
                  if (!big || !rule) return null; // not illustrated yet: drawn by the game
                  const b = big.getBoundingClientRect(); const r = rule.getBoundingClientRect(); const h = head.getBoundingClientRect();
                  // The picture, with its border, ends 82.7% of the way down the card.
                  // Art may break out of its border into the header band (Market
                  // Research's hat reaches up to 9.8% of the card), so the name ends above that.
                  return { over: Math.round((b.top + b.height * 0.828 - r.top) * 10) / 10, below: Math.round((r.bottom - b.bottom) * 10) / 10, nameWide: Math.round(h.width - b.width * 0.92), nameLow: Math.round((h.bottom - (b.top + b.height * 0.114)) * 10) / 10 };
                });
                if (m && m.nameLow > 0.5) throw new Error(`${name}: the name ends ${m.nameLow}px too low in the header, where a picture may reach`);
                if (m && (m.over > 0 || m.below > 0)) throw new Error(`${name}: the rule ${m.over > 0 ? `covers ${m.over}px of the picture` : `hangs ${m.below}px below the card`}`);
                if (m && m.nameWide > 0) throw new Error(`${name}: the name is ${m.nameWide}px wider than the header`);
                await dlg.getByRole('button', { name: 'Close', exact: true }).click();
                await dlg.waitFor({ state: 'detached' });
                await page.getByRole('button', { name: 'Clear selection' }).click();
              }
            });
            await check(`${tag}: the draw pile shows the drawn card back with the number of cards left in its blank centre`, async () => {
              const m = await page.evaluate(() => {
                const c = document.querySelector('.vb__pile .vb__card--backart'); if (!c) return null;
                const n = c.querySelector('.vb__back-count'); const im = c.querySelector('img');
                const cr = c.getBoundingClientRect(); const nr = n.getBoundingClientRect();
                return { count: n.textContent, font: parseFloat(getComputedStyle(n).fontSize), cx: ((nr.left + nr.right) / 2 - cr.left) / cr.width, cy: ((nr.top + nr.bottom) / 2 - cr.top) / cr.height, textW: n.scrollWidth, boxW: cr.width * 0.4, loaded: im.complete && im.naturalWidth > 0 };
              });
              if (!m) throw new Error('the draw pile is not showing the drawn back');
              if (!m.loaded) throw new Error('the picture did not load');
              if (!/^\d+$/.test(m.count)) throw new Error(`count reads "${m.count}"`);
              if (m.font < 12) throw new Error(`the count is ${m.font}px: too small to read`);
              // The blank oval is centred 50% across and 49% down, and is 40% of the card wide.
              if (Math.abs(m.cx - 0.5) > 0.03 || Math.abs(m.cy - 0.49) > 0.03) throw new Error(`the count is at ${Math.round(m.cx * 100)}% / ${Math.round(m.cy * 100)}%, outside the blank centre`);
            });
            await check(`${tag}: sound can be muted, and the choice is remembered after a reload`, async () => {
              await page.getByRole('button', { name: 'Mute sounds' }).click();
              await page.getByRole('button', { name: 'Turn sounds on' }).waitFor();
              await page.reload();
              await page.locator('[aria-label="Your hand"] button').first().waitFor();
              await page.getByRole('button', { name: 'Turn sounds on' }).waitFor();
              await page.getByRole('button', { name: 'Turn sounds on' }).click();
              await page.getByRole('button', { name: 'Mute sounds' }).waitFor();
            });
          }
          // ---- progress, key, how to play, and what the dice or the deck have done -------------
          const bar = m.fullscreen ? page : page.locator('.stage__bar');
          const progBtn = bar.getByRole('button', { name: /^Progress/ });
          await check(`${tag}: Progress, Key and How to play are on screen, with a clock that runs`, async () => {
            await progBtn.waitFor();
            await bar.getByRole('button', { name: 'Key', exact: true }).waitFor();
            if (!m.fullscreen) await bar.getByRole('button', { name: 'How to play' }).waitFor();
            const clock = page.locator('[data-clock]').first();
            const t1 = await clock.textContent();
            if (!/^\d+:\d\d$/.test(t1)) throw new Error(`the clock reads "${t1}"`);
            await sleep(1150);
            const t2 = await clock.textContent();
            if (t1 === t2) throw new Error(`the clock stood still at ${t1}`);
            if (m.fullscreen) return `${t1} then ${t2}`;
            const b = await page.evaluate(() => {
              const row = document.querySelector('.stage__bar'); const vw = window.innerWidth;
              const out = [...row.children].filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && (r.left < -0.5 || r.right > vw + 0.5); }).map((el) => el.textContent.trim());
              const h = row.querySelector('h1').getBoundingClientRect();
              const kids = [...row.children].map((el) => el.getBoundingClientRect()).filter((r) => r.width > 0).sort((x, y) => x.left - y.left);
              let overlap = 0; for (let i = 1; i < kids.length; i++) overlap = Math.max(overlap, kids[i - 1].right - kids[i].left);
              return { out, name: Math.round(h.width), overlap: Math.round(overlap), rowH: Math.round(row.getBoundingClientRect().height) };
            });
            if (b.out.length) throw new Error(`off screen: ${b.out.join(', ')}`);
            if (b.overlap > 0) throw new Error(`controls overlap by ${b.overlap}px`);
            if (b.name < 70) throw new Error(`only ${b.name}px left for the game's name`);
            if (b.rowH > 60) throw new Error(`the bar is ${b.rowH}px tall: it wrapped`);
            return `${t1} then ${t2}; ${b.name}px for the name`;
          });
          await check(`${tag}: the info drawer shows progress for every seat, the key, and each tab fits`, async () => {
            await progBtn.click();
            const dlg = page.getByRole('dialog');
            await dlg.waitFor();
            const title = await dlg.getByRole('heading').first().textContent();
            if (!/progress/i.test(title)) throw new Error(`the drawer is titled "${title}"`);
            const seats = await dlg.locator('[data-progress-seat]').count();
            const want = m.fullscreen ? 2 : await page.locator('.stage__seat').count();
            if (seats < want) throw new Error(`${seats} seats in Progress, ${want} at the table`);
            await dlg.locator('[role="progressbar"]').waitFor();
            await dlg.getByText('This game').waitFor();
            await dlg.getByText(/^Your time in /).waitFor();
            const fits = async (what) => {
              const o = await dlg.evaluate((el) => {
                const pr = el.getBoundingClientRect();
                const wide = [...el.querySelectorAll('*')].filter((x) => { const r = x.getBoundingClientRect(); return r.width > 0 && !x.closest('.ginfo__tabs') && (r.right > pr.right + 0.5 || r.left < pr.left - 0.5); }).map((x) => `${x.tagName.toLowerCase()}.${String(x.className).split(' ')[0]}`);
                return { sw: el.scrollWidth, cw: el.clientWidth, wide: wide.slice(0, 4), vw: window.innerWidth, right: Math.round(pr.right), left: Math.round(pr.left) };
              });
              if (o.sw > o.cw + 1 || o.wide.length) throw new Error(`${what}: wider than the drawer (${o.sw}/${o.cw}) ${o.wide.join(', ')}`);
              if (o.left < 0 || o.right > o.vw) throw new Error(`${what}: the drawer is off screen`);
            };
            await fits('Progress');
            await shots(page, `info-progress-${g.id}-${vpName(vp)}`);
            const names = await dlg.getByRole('tab').allTextContents();
            if (names[0] !== 'Rules' || !names.includes('Key') || !names.includes('Progress')) throw new Error(`tabs: ${names.join(', ')}`);
            if (!m.fullscreen && !names.includes('Moves')) throw new Error(`no Moves tab: ${names.join(', ')}`);
            const strip = await dlg.locator('.ginfo__tabs').evaluate((el) => ({ sw: el.scrollWidth, cw: el.clientWidth }));
            if (strip.sw > strip.cw + 1) throw new Error(`the tabs do not fit: ${strip.sw}px of tabs in ${strip.cw}px`);
            for (const name of names) {
              await dlg.getByRole('tab', { name, exact: true }).click();
              if (name === 'Key') {
                await dlg.locator('[data-key-item]').nth(3).waitFor();
                if (g.id === 'ventureboom') {
                  await dlg.locator('.gkey__art').first().waitFor();
                  const n = await dlg.locator('[data-key-item]').count();
                  if (n !== 48) throw new Error(`${n} entries in the VentureBoom key: 43 card names and 5 moves are 48`);
                  await page.waitForFunction(() => { const im = document.querySelector('.gkey__art'); return im && im.complete && im.naturalWidth > 0; });
                }
              } else if (name === 'Rules') {
                await dlg.locator('ol li').first().waitFor();
              } else if (name === 'Moves') {
                await dlg.getByRole('group', { name: 'Pace of play' }).waitFor();
                const pressed = await dlg.getByRole('group', { name: 'Pace of play' }).locator('[aria-pressed="true"]').allTextContents();
                if (pressed.join() !== 'Steady') throw new Error(`pace shows as "${pressed.join()}"`);
              } else if (name !== 'Progress') {
                // the record of the dice, or of the deck
                await dlg.locator('.hist').first().waitFor();
                const h = await dlg.locator('.hist').first().evaluate((el) => {
                  const bars = [...el.querySelectorAll('.hist__bar')].map((b) => b.getBoundingClientRect());
                  const labels = [...el.querySelectorAll('.hist__label')];
                  return { bars: bars.length, thick: Math.max(0, ...bars.map((r) => Math.min(r.width || 99, r.height || 99))), cut: labels.filter((l) => l.scrollWidth > l.clientWidth + 1).map((l) => l.textContent), table: !!el.querySelector('details table') };
                });
                if (h.bars < 2) throw new Error(`only ${h.bars} bars`);
                if (h.thick > 24) throw new Error(`bars are ${h.thick}px thick`);
                if (h.cut.length) throw new Error(`labels cut off: ${h.cut.join(', ')}`);
                if (!h.table) throw new Error('no table view of the numbers');
                await dlg.locator('.hist__row, .hist__col').first().focus();
                await dlg.locator('.hist__tip').waitFor();
              }
              await fits(name);
              if (name !== 'Progress') await shots(page, `info-${name.toLowerCase().replace(/\W+/g, '-')}-${g.id}-${vpName(vp)}`);
            }
            await page.keyboard.press('Escape');
            await dlg.waitFor({ state: 'detached' });
            if (!(await progBtn.evaluate((el) => el === document.activeElement))) throw new Error('focus did not return to the Progress button');
            return `tabs: ${names.join(', ')}`;
          });
          if (g.id === 'ventureboom') {
            // (Bug: three robots played a card each inside two seconds and the
            // feed showed the last three lines at once. Nobody could read what
            // had been done to them.)
            await check(`${tag}: what just happened is on the table with what it means, and opens the list of every move`, async () => {
              const now = page.locator('.vb__now').first();
              await now.waitFor({ timeout: 15000 });
              const a = await now.evaluate((el) => {
                const r = el.getBoundingClientRect(); const side = el.closest('.vb__side').getBoundingClientRect();
                const cut = [...el.children].filter((c) => { const b = c.getBoundingClientRect(); return b.height > 0 && (b.bottom > side.bottom + 0.5 || b.top < side.top - 0.5 || b.right > side.right + 0.5); }).map((c) => c.className);
                return { tag: el.tagName, text: el.querySelector('.vb__now-text').textContent, h: Math.round(r.height), cut };
              });
              if (a.tag !== 'BUTTON') throw new Error('the announcement is not a button');
              if (a.text.length < 8) throw new Error(`the announcement reads "${a.text}"`);
              if (a.cut.length) throw new Error(`cut off by the table: ${a.cut.join(', ')}`);
              if (a.h < 36) throw new Error(`only ${a.h}px tall: too small to tap`);
              await now.click();
              const dlg = page.getByRole('dialog', { name: /what happened/ });
              await dlg.waitFor();
              const n = await dlg.locator('[data-move]').count();
              if (n < 1) throw new Error('the list of moves is empty');
              const last = await dlg.locator('[data-move]').last().evaluate((el) => { const r = el.getBoundingClientRect(); const p = el.closest('.drawer__panel').getBoundingClientRect(); return r.bottom <= p.bottom + 1 && r.top >= p.top; });
              if (!last) throw new Error('the list did not open at the newest move');
              await shots(page, `ventureboom-moves-${vpName(vp)}`);
              await page.keyboard.press('Escape');
              await dlg.waitFor({ state: 'detached' });
              return `"${a.text}", ${n} moves listed`;
            });
            await check(`${tag}: the pace button slows the table down, and the server agrees`, async () => {
              const btn = page.getByRole('button', { name: /^Pace of play: Steady/ });
              await btn.waitFor();
              await btn.click();
              await page.getByRole('button', { name: /^Pace of play: Slow/ }).waitFor();
              const id = new URL(page.url()).pathname.split('/').pop();
              const t = await rpc(ctx, baseUrl, 'table', { id });
              if (t.table.pace !== 'slow') throw new Error(`the server says ${t.table.pace}`);
              await page.getByRole('button', { name: /^Pace of play: Slow/ }).click();
              await page.getByRole('button', { name: /^Pace of play: Quick/ }).waitFor();
            });
          }
          check.info(`${tag}: measured`, `scrollWidth ${m.scrollWidth}/${m.innerWidth}${m.board ? `, board ${m.board.w}x${m.board.h}` : ''}, smallest button ${m.smallest ? `${m.smallest.min}px ${m.smallest.what}` : 'none'}${m.fullscreen ? ', fullscreen' : ''}`);
          await check(`${tag}: no console errors or failed requests`, w.problems.length === 0, w.problems.join(' | '));
        } finally {
          const id = new URL(page.url()).pathname.split('/').pop();
          await rpc(ctx, baseUrl, 'leaveTable', { id }).catch(() => {});
          await ctx.close();
        }
      });
    }
  }

  // ---- 2. every page --------------------------------------------------------------------------
  // A member with a history, a second member and a guest, so no page is measured empty.
  const mctx = await openContext(browser, { viewport: PHONE });
  const octx = await openContext(browser, { viewport: PHONE });
  const fctx = await openContext(browser, { viewport: PHONE });
  let me = null; let other = null; let friend = null; let finishedId = null; let openId = null; let guestUser = null;
  await check.section('page fixtures', async () => {
    me = (await memberSession(mctx, baseUrl, 'Grace Hopper', { intent: ['peers', 'mentor', 'play'] })).user;
    other = (await memberSession(octx, baseUrl, 'Bartholomew Featherstonehaugh-Cholmondeley'.slice(0, 40), { stage: 'pre_revenue' })).user;
    guestUser = (await rpc(seed, baseUrl, 'me')).user;
    const page = await mctx.newPage();
    await page.goto(`${baseUrl}/enter?play=fourinarow`);
    await page.locator('.fir__col--can').first().waitFor();
    finishedId = new URL(page.url()).pathname.split('/').pop();
    await playFirToEnd(page);
    await page.waitForURL(/\/debrief\//, { timeout: 10000 });
    await page.close();
    await rpc(mctx, baseUrl, 'answerDebrief', { id: finishedId, answer: 'I played not to lose, and lost anyway.' });
    // Something was said at that table, so its record has a chat to show.
    await rpc(mctx, baseUrl, 'sendChat', { id: finishedId, body: 'Good game. I should have taken the centre column sooner.' });
    // A connection with a conversation, for the chat window: two messages each way, one of them long.
    friend = (await memberSession(fctx, baseUrl, 'Ada Lovelace')).user;
    await rpc(fctx, baseUrl, 'connect', { userId: me.id });
    await rpc(mctx, baseUrl, 'answerConnection', { userId: friend.id, accept: true });
    await rpc(fctx, baseUrl, 'sendMessage', { toId: me.id, body: 'That Four in a Row ending was brutal. Rematch tomorrow?' });
    await rpc(mctx, baseUrl, 'sendMessage', { toId: friend.id, body: 'Yes. Same time.' });
    await rpc(fctx, baseUrl, 'sendMessage', { toId: me.id, body: 'Also: I read the note you posted about selling before building. I tried it this week with a landing page and three calls, and two of the three said they would pay. Supercalifragilisticexpialidocious-level-relief.' });
    await rpc(mctx, baseUrl, 'replyTopic', { body: 'Sell it before you build it, then build only what was bought.' });
    await rpc(mctx, baseUrl, 'sendFeedback', { kind: 'suggestion', scope: 'arena', body: 'A fixture note for the layout test.', page: '/home' });
    await rpc(mctx, baseUrl, 'postOpportunity', { kind: 'seeking_cofounder', title: 'Technical cofounder for a compiler startup', body: 'I have the customers and the roadmap. Looking for someone who has shipped developer tools before.' });
    await rpc(octx, baseUrl, 'connect', { userId: me.id });
    await rpc(octx, baseUrl, 'challenge', { userId: me.id, gameId: 'fourinarow', message: 'First to four. Loser buys the coffee.' });
    await rpc(octx, baseUrl, 'respondOpportunity', { id: (await rpc(octx, baseUrl, 'opportunities', {})).items[0].id, note: 'I have built two compilers.' });
    const t = (await rpc(mctx, baseUrl, 'createTable', { gameId: 'fourinarow' })).table;
    openId = t.id;
    await rpc(seed, baseUrl, 'joinTable', { code: t.inviteCode, role: 'player' });
    await rpc(seed, baseUrl, 'sendChat', { id: openId, body: 'Hello from the second seat.' });
    await check('fixtures are in place', !!(finishedId && openId && other.username));
  });
  const memberCookies = await cookiesOf(mctx);

  const PAGES = [
    // [name, url, ready selector, session: 'member' | 'none', before-measure action]
    ['home', '/home', '[data-quiz-option]', 'member'],
    ['play', '/play', '[data-game-card]', 'member'],
    ['people', '/people', '[data-segment]', 'member'],
    ['people-board', '/people', '[data-segment]', 'member', async (p) => { await p.getByRole('tab', { name: 'Opportunities' }).click(); await p.locator('[data-opportunity]').first().waitFor(); await p.getByRole('button', { name: 'Post something' }).click(); await p.getByLabel('Title').waitFor(); }],
    ['people-everyone', '/people', '[data-segment]', 'member', async (p) => { await p.getByRole('tab', { name: 'Everyone' }).click(); await p.locator('.card').filter({ hasText: 'Bartholomew' }).first().waitFor(); }],
    ['inbox', '/inbox', 'h1', 'member', async (p) => { await p.getByText('Connection requests').waitFor(); }],
    ['inbox-thread', () => `/inbox/${other.id}`, '.chat__log', 'member'],
    ['me', '/me', '[data-profile-score]', 'member', async (p) => { await p.getByText('Arena record').waitFor(); }],
    ['guides', '/guides', '[data-guide]', 'member', async (p) => { await p.locator('[data-guides]').waitFor(); await p.getByLabel('A new next step').fill('Call three freelancers about invoicing'); await p.getByRole('button', { name: 'Add' }).click(); await p.locator('.steps__row').first().waitFor(); }],
    ['guide-empty', '/guides/mentor', '.guide__log', 'member', async (p) => { await p.getByText('Try asking').waitFor(); }],
    ['guide-conversation', () => `/guides/coach?game=${finishedId}`, '.guide__log', 'member', async (p) => { await p.getByText('About your').waitFor(); await p.getByLabel('Ask The Coach').fill('What should I take from that game? I rushed every move and I am not sure whether that was the problem or whether I just had bad luck with the columns.'); await p.getByRole('button', { name: 'Ask' }).click(); await p.locator('.guide__reply').first().waitFor(); }],
    ['history', '/history', '[data-history-row]', 'member', async (p) => { await p.locator('[data-time-total]').waitFor(); }],
    ['key-ventureboom', '/key/ventureboom', '[data-key-item]', 'member', async (p) => { await p.locator('.gkey__art').first().waitFor(); await p.locator('[data-key-item="prototype-pete"] summary').click(); await p.locator('[data-key-item="prototype-pete"] details p').waitFor(); }],
    ['key-ventureboom-set', '/key/ventureboom#key-angel-annie', '.gkey__item--focus', 'member', async (p) => { await p.locator('.gkey__item--focus details[open]').waitFor(); }],
    ['key-ventureflow', '/key/ventureflow', '[data-key-item]', 'member'],
    ['key-chess', '/key/chess', '[data-key-item]', 'member'],
    ['history-record', () => `/history/${finishedId}`, '.histchat', 'member', async (p) => { await p.getByText('Good game. I should have taken').waitFor(); }],
    ['chat-window', '/home', '[data-quiz-option]', 'member', async (p) => { await p.locator('.chatdock__launch--bar').click(); await p.locator('.chatdock__person').first().waitFor(); }],
    ['chat-conversation', '/play', '[data-game-card]', 'member', async (p) => { await p.locator('.chatdock__launch--bar').click(); await p.locator('.chatdock__person', { hasText: 'Ada Lovelace' }).click(); await p.locator('.chatdock__log .bubble').first().waitFor(); }],
    ['me-identity', '/me', '[data-profile-score]', 'member', async (p) => { await p.getByRole('button', { name: 'Name, avatar and colours' }).click(); await p.getByRole('button', { name: 'Upload a photo' }).waitFor(); }],
    ['me-business', '/me', '[data-profile-score]', 'member', async (p) => { await p.getByRole('button', { name: 'Business profile' }).click(); await p.getByLabel('Industry').waitFor(); }],
    ['me-want', '/me', '[data-profile-score]', 'member', async (p) => { await p.getByRole('button', { name: 'Looking for and offering' }).click(); await p.getByLabel('Goals').waitFor(); }],
    ['me-contact', '/me', '[data-profile-score]', 'member', async (p) => { await p.getByRole('button', { name: 'Contact, links and conversation starters' }).click(); await p.getByLabel('LinkedIn').waitFor(); }],
    ['membership', '/membership', 'h1', 'member', async (p) => { await p.getByRole('button', { name: 'Join the waitlist' }).first().waitFor(); }],
    ['signin', '/signin', 'form', 'none'],
    ['signin-create', '/signin?mode=create', 'form', 'none'],
    ['reset', '/reset', 'form', 'none'],
    ['reset-choose', '/reset?token=abc', 'form', 'none'],
    ['enter', '/enter', 'h1', 'none'],
    ['onboarding-1', '/onboarding', '.progress', 'member'],
    ['onboarding-2', '/onboarding', '.progress', 'member', async (p) => { await p.getByRole('button', { name: 'Next' }).click(); await p.getByText('Step 2 of 5').waitFor(); await p.getByRole('button', { name: 'Sort the cards again' }).click(); await p.getByText('Scenario 1 of 8').waitFor(); }],
    ['onboarding-3', '/onboarding', '.progress', 'member', async (p) => { for (const n of [2, 3]) { await p.getByRole('button', { name: 'Next' }).click(); await p.getByText(`Step ${n} of 5`).waitFor(); } }],
    ['onboarding-4', '/onboarding', '.progress', 'member', async (p) => { for (const n of [2, 3, 4]) { await p.getByRole('button', { name: 'Next' }).click(); await p.getByText(`Step ${n} of 5`).waitFor(); } }],
    ['onboarding-5', '/onboarding', '.progress', 'member', async (p) => { for (const n of [2, 3, 4, 5]) { await p.getByRole('button', { name: 'Next' }).click(); await p.getByText(`Step ${n} of 5`).waitFor(); } }],
    ['table-open-host', () => `/t/${openId}`, '.seat', 'member', async (p) => { await p.getByText('Layout Guest').first().waitFor(); await p.getByText('Hello from the second seat.').waitFor(); }],
    ['debrief', () => `/debrief/${finishedId}`, 'h1', 'member', async (p) => { await p.getByText('Reflection').waitFor(); }],
    ['profile', () => `/p/${other.username}`, '.pcard', 'member'],
    ['static-landing', '/', 'h1', 'none'],
    ['static-games', '/games/', 'h1', 'none'],
    ...games.map((g) => [`static-game-${g.id}`, `/games/${g.id}/`, 'h1', 'none']),
    ['static-404', '/games/not-a-game/', 'h1', 'none', null, /404/],
  ];

  const numbers = [];
  for (const vp of PHONES) {
    const withSession = await openContext(browser, { viewport: vp, cookies: memberCookies });
    const without = await openContext(browser, { viewport: vp });
    for (const [name, url, ready, session, act, allow] of PAGES) {
      const tag = `${name} @ ${vpName(vp)}`;
      await check.section(tag, async () => {
        const ctx = session === 'member' ? withSession : without;
        const page = await ctx.newPage();
        const w = watch(page);
        if (allow) w.allow(allow);
        try {
          await page.goto(baseUrl + (typeof url === 'function' ? url() : url));
          await page.locator(ready).first().waitFor();
          if (act) await act(page);
          await settle(page);
          const m = await measurePage(page);
          await shots(page, `page-${name}-${vpName(vp)}-top`);
          await page.evaluate(() => { document.scrollingElement.scrollTop = document.scrollingElement.scrollHeight; });
          await sleep(60);
          if (m.scrollHeight > vp.height + 40) await shots(page, `page-${name}-${vpName(vp)}-bottom`);
          const bad = [];
          if (m.scrollWidth > m.innerWidth) bad.push(`horizontal scroll: scrollWidth ${m.scrollWidth} vs innerWidth ${m.innerWidth}`);
          if (m.wide.length) bad.push(`wider than the viewport: ${m.wide.slice(0, 3).join('; ')}`);
          if (m.small.length) bad.push(`tap targets under 40px: ${m.small.slice(0, 5).join('; ')}${m.small.length > 5 ? ` (+${m.small.length - 5} more)` : ''}`);
          if (m.clipped.length) bad.push(`clipped button text: ${m.clipped.slice(0, 3).join('; ')}`);
          if (m.covered.length) bad.push(m.covered.slice(0, 3).join('; '));
          if (m.unlabelled.length) bad.push(`controls with no name: ${m.unlabelled.slice(0, 3).join('; ')}`);
          await check(`${tag}: layout`, bad.length === 0, bad.join(' || '));
          numbers.push(`${name}@${vp.width}: ${m.scrollWidth}/${m.innerWidth}, min tap ${m.smallest ? `${m.smallest.h}px` : '-'}`);
          check.info(`${tag}: measured`, `scrollWidth ${m.scrollWidth}/${m.innerWidth}, smallest tap target ${m.smallest ? `${m.smallest.h}px tall (${m.smallest.name})` : 'none'}`);
          await check(`${tag}: no console errors or failed requests`, w.problems.length === 0, w.problems.join(' | '));
        } finally { await page.close(); }
      });
    }
    await withSession.close(); await without.close();
  }

  // ---- the wide-screen side rail -------------------------------------------------------------
  await check.section('wide screen', async () => {
    const ctx = await openContext(browser, { viewport: DESKTOP, cookies: memberCookies });
    const page = await ctx.newPage();
    const w = watch(page);
    for (const [name, url, ready] of [['home', '/home', '[data-quiz-option]'], ['play', '/play', '[data-game-card]'], ['people', '/people', '[data-segment]'], ['me', '/me', '[data-profile-score]'], ['table-open-host', `/t/${openId}`, '.seat'], ['debrief', `/debrief/${finishedId}`, 'h1'], ['membership', '/membership', 'h1']]) {
      await page.goto(baseUrl + url);
      await page.locator(ready).first().waitFor();
      await settle(page);
      const m = await page.evaluate(() => {
        const rail = document.querySelector('.tabbar').getBoundingClientRect(); const main = document.querySelector('.main').getBoundingClientRect();
        const fb = [...document.querySelectorAll('button')].filter((b) => b.innerText.trim() === 'Feedback' && b.getBoundingClientRect().width > 0).map((b) => b.getBoundingClientRect());
        return { sw: document.documentElement.scrollWidth, iw: window.innerWidth, railW: Math.round(rail.width), railH: Math.round(rail.height), railLeft: Math.round(rail.left), mainLeft: Math.round(main.left), feedback: fb.length, feedbackInRail: fb.length === 1 && fb[0].right <= rail.right + 1 };
      });
      await shots(page, `wide-${name}-1280x800`);
      const inTable = url.startsWith('/t/');
      await check(`${name} @ 1280x800: side rail on the left, content beside it, no horizontal scroll`, m.sw <= m.iw && m.railLeft === 0 && m.railW >= 180 && m.railW <= 240 && m.mainLeft >= m.railW && m.railH >= 780 && (inTable ? m.feedback === 0 : m.feedbackInRail),
        `scrollWidth ${m.sw}/${m.iw}, rail ${m.railW}x${m.railH} at x=${m.railLeft}, content from x=${m.mainLeft}, feedback buttons visible ${m.feedback}`);
    }
    await check('wide screen: no console errors or failed requests', w.problems.length === 0, w.problems.join(' | '));
    await ctx.close();
  });

  // ---- 3. when something is gone ----------------------------------------------------------------
  await check.section('error and empty states', async () => {
    const ctx = await openContext(browser, { viewport: PHONE, cookies: guestCookies });
    const page = await ctx.newPage();
    const w = watch(page);
    w.allow(/HTTP 40[34]|status of 40[34]/);
    const state = async (name, url, text, button, maxMs = 3000) => {
      await check(`${name}: says what happened and offers a way back`, async () => {
        const t0 = Date.now();
        await page.goto(baseUrl + url);
        await page.getByText(text).first().waitFor({ timeout: maxMs });
        await page.getByRole(button[0], { name: button[1] }).waitFor();
        const ms = Date.now() - t0;
        const m = await measurePage(page);
        await shots(page, `state-${name}-360`);
        if (m.scrollWidth > m.innerWidth || m.small.length) throw new Error(`layout: ${m.scrollWidth}/${m.innerWidth}, small ${m.small.join('; ')}`);
        return `${ms} ms`;
      });
    };
    await state('a table that does not exist', '/t/00000000-0000-4000-8000-000000000000', 'Table not found. It may have closed.', ['button', 'Back to the lobby']);
    await state('a debrief that does not exist', '/debrief/00000000-0000-4000-8000-000000000000', 'That game does not exist, or it was closed before it finished.', ['link', 'Back to the arena']);
    await state('a debrief for a game still being set up', `/debrief/${openId}`, 'The debrief opens when the game ends.', ['link', 'Go to the table']);
    await state('a profile that does not exist', '/p/nobody-by-this-name', 'No such member.', ['link', 'See who is in the arena']);
    await state('an invite link that is no longer valid', '/join/zzzzzzzz', 'That invite link is no longer valid.', ['button', 'Go to the lobby']);
    await state('a conversation with nobody', '/inbox/00000000-0000-4000-8000-000000000000', 'No such member', ['link', 'Back to the inbox']);

    await check('a guest at a table sees it close when the host closes it, without reloading', async () => {
      await page.goto(`${baseUrl}/t/${openId}`);
      await page.locator('.seat[data-seat="you"]').filter({ hasText: 'Layout Guest' }).waitFor();
      await rpc(mctx, baseUrl, 'closeMyTables', {});
      await page.getByText('The host closed this table.').waitFor();
      await page.getByRole('button', { name: 'Back to the lobby' }).click();
      await page.waitForURL(/\/play$/);
    });
    await check('an empty Inbox and a guest\'s People page explain themselves', async () => {
      await page.goto(`${baseUrl}/inbox`);
      await page.getByText('Connect with someone after a game and they will appear here.').waitFor();
      await shots(page, 'state-inbox-empty-360');
      await page.goto(`${baseUrl}/people`);
      await page.getByText('You are playing as a guest.').waitFor();
      await shots(page, 'state-people-guest-360');
    });
    await check('error states: nothing unexpected in the console', w.problems.length === 0, w.problems.join(' | '));
    await ctx.close();
  });

  // ---- the chat window ---------------------------------------------------------------------------------
  // "A persistent chat window with players I've connected with": it is there
  // on every page, it stays on the same conversation as you move around, and
  // a message arrives in it without a reload.
  await check.section('chat window', async () => {
    // A member of their own, so the unread count is known whatever ran before.
    const cctx = await openContext(browser, { viewport: DESKTOP });
    const chatter = (await memberSession(cctx, baseUrl, 'Chat Tester')).user;
    await rpc(fctx, baseUrl, 'connect', { userId: chatter.id });
    await rpc(cctx, baseUrl, 'answerConnection', { userId: friend.id, accept: true });
    await rpc(fctx, baseUrl, 'sendMessage', { toId: chatter.id, body: 'First message, waiting for you.' });
    await rpc(fctx, baseUrl, 'sendMessage', { toId: chatter.id, body: 'Averyveryveryveryveryveryveryveryveryveryveryveryveryverylongwordwithnospacesatall' });
    const page = await cctx.newPage();
    const w = watch(page);
    await page.goto(`${baseUrl}/home`);
    await page.locator('[data-quiz-option]').first().waitFor();
    await settle(page);
    const launch = page.locator('.chatdock__launch--dock');
    await check('wide: a Messages button sits in the bottom right corner of every page, showing what is unread', async () => {
      await launch.waitFor();
      const m = await launch.evaluate((el) => { const r = el.getBoundingClientRect(); return { right: Math.round(window.innerWidth - r.right), bottom: Math.round(window.innerHeight - r.bottom), h: Math.round(r.height), label: el.getAttribute('aria-label'), badge: el.querySelector('.chatdock__badge') ? el.querySelector('.chatdock__badge').textContent : null }; });
      if (m.right < 0 || m.right > 40 || m.bottom !== 0) throw new Error(`at right ${m.right}, bottom ${m.bottom}`);
      if (m.h < 40) throw new Error(`only ${m.h}px tall`);
      if (m.badge !== '2' || m.label !== 'Messages, 2 unread') throw new Error(`badge "${m.badge}", label "${m.label}"`);
    });
    await check('wide: closed, the button covers nothing you can press at the bottom of a page', async () => {
      const m = await measurePage(page);
      if (m.covered.length) throw new Error(m.covered.slice(0, 3).join('; '));
    });
    await launch.click();
    const dock = page.locator('.chatdock');
    await check('wide: it opens as a window that stays inside the screen and off the side rail', async () => {
      await dock.waitFor();
      await page.locator('.chatdock__person').first().waitFor();
      const m = await page.evaluate(() => { const d = document.querySelector('.chatdock').getBoundingClientRect(); const rail = document.querySelector('.tabbar').getBoundingClientRect(); return { l: d.left, r: d.right, t: d.top, b: d.bottom, w: d.width, h: d.height, railR: rail.right, iw: window.innerWidth, ih: window.innerHeight }; });
      if (m.l < m.railR || m.r > m.iw || m.t < 0 || m.b > m.ih + 1) throw new Error(JSON.stringify(m));
      if (m.w < 300 || m.h < 360) throw new Error(`too small to use: ${m.w}x${m.h}`);
    });
    await shots(page, 'chat-window-list-1280x800');
    await page.locator('.chatdock__person', { hasText: 'Ada Lovelace' }).click();
    await check('wide: a conversation shows both messages; a long unbroken word wraps instead of pushing the window sideways', async () => {
      await page.locator('.chatdock__log .bubble').nth(1).waitFor();
      const m = await page.evaluate(() => { const log = document.querySelector('.chatdock__log'); const bubbles = [...log.querySelectorAll('.bubble')].map((b) => b.getBoundingClientRect()); const l = log.getBoundingClientRect(); return { n: bubbles.length, overflow: log.scrollWidth > log.clientWidth + 1, outside: bubbles.filter((b) => b.right > l.right + 1 || b.left < l.left - 1).length }; });
      if (m.n !== 2 || m.overflow || m.outside) throw new Error(JSON.stringify(m));
    });
    await check('wide: reading a conversation clears its unread count for both the window and the server', async () => {
      const list = await rpc(cctx, baseUrl, 'chatList');
      if (list.unread !== 0) throw new Error(`the server still counts ${list.unread} unread`);
    });
    await check('wide: a message typed here is sent, appears at once, and reaches the other member', async () => {
      await page.getByLabel('Message Ada Lovelace').fill('Got them both. Talk tomorrow.');
      await page.keyboard.press('Enter');
      await page.locator('.chatdock__log .bubble.mine', { hasText: 'Got them both' }).waitFor();
      const theirs = await rpc(fctx, baseUrl, 'thread', { userId: chatter.id, peek: true });
      if (theirs.messages[theirs.messages.length - 1].body !== 'Got them both. Talk tomorrow.') throw new Error('the other member did not get it');
    });
    await check('wide: a message from the other member arrives in the open window without a reload', async () => {
      await rpc(fctx, baseUrl, 'sendMessage', { toId: chatter.id, body: 'Live reply, no refresh needed.' });
      await page.locator('.chatdock__log .bubble', { hasText: 'Live reply, no refresh needed.' }).waitFor({ timeout: 5000 });
    });
    await check('wide: the window stays open on the same conversation when you go to another page', async () => {
      await page.getByRole('link', { name: 'Play', exact: true }).click();
      await page.locator('[data-game-card]').first().waitFor();
      await page.locator('.chatdock__log .bubble', { hasText: 'Live reply, no refresh needed.' }).waitFor();
      await page.getByRole('link', { name: 'People', exact: true }).click();
      await page.locator('[data-segment]').first().waitFor();
      if (!(await page.locator('.chatdock__title', { hasText: 'Ada Lovelace' }).isVisible())) throw new Error('the conversation was closed by moving to another page');
    });
    await shots(page, 'chat-window-conversation-1280x800');
    await check('wide: and after a reload', async () => {
      await page.reload();
      await page.locator('.chatdock__log .bubble', { hasText: 'Live reply, no refresh needed.' }).waitFor();
    });
    await check('wide: Escape closes it; a message that arrives while it is closed is counted on the button and announced', async () => {
      await page.getByLabel('Message Ada Lovelace').focus();
      await page.keyboard.press('Escape');
      await dock.waitFor({ state: 'detached' });
      await launch.waitFor();
      if (await launch.locator('.chatdock__badge').count()) throw new Error('a badge is showing with nothing unread');
      await rpc(fctx, baseUrl, 'sendMessage', { toId: chatter.id, body: 'One more while you were away.' });
      await launch.locator('.chatdock__badge', { hasText: '1' }).waitFor({ timeout: 5000 });
      await page.locator('.toast', { hasText: 'New message from Ada Lovelace' }).waitFor({ timeout: 3000 });
    });
    await check('wide: it is not on top of a game: the table has its own chat there', async () => {
      await launch.click(); await dock.waitFor();
      await page.goto(`${baseUrl}/enter?play=fourinarow`);
      await page.locator('.fir__col--can').first().waitFor();
      const m = await page.evaluate(() => { const d = document.querySelector('.chatdock'); const s = document.querySelector('.stage'); if (!d || !s) return { missing: true }; const r = d.getBoundingClientRect(); const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return { covered: !d.contains(top), stageChat: !!document.querySelector('.stage__chat') }; });
      if (m.missing) return; // not rendered at all is fine too
      if (!m.covered) throw new Error('the messages window is drawn over the game');
      if (!m.stageChat) throw new Error('the table chat is missing');
      await rpc(cctx, baseUrl, 'closeMyTables', {}).catch(() => {});
    });
    await check('chat window (wide): no console errors or failed requests', w.problems.length === 0, w.problems.join(' | '));
    await page.close();

    // The same window on a phone: a sheet between the top bar and the tab bar.
    // (Reopening the window in the last check read everything, so one more arrives.)
    for (const vp of PHONES) {
      await rpc(cctx, baseUrl, 'markRead', { userId: friend.id });
      await rpc(fctx, baseUrl, 'sendMessage', { toId: chatter.id, body: `One for the ${vp.width}px phone.` });
      const pctx = await openContext(browser, { viewport: vp, cookies: await cookiesOf(cctx) });
      const p = await pctx.newPage();
      const pw = watch(p);
      await p.goto(`${baseUrl}/home`);
      await p.locator('[data-quiz-option]').first().waitFor();
      await check(`${vpName(vp)}: the Messages button is in the top bar, big enough to tap, with the unread count`, async () => {
        const b = p.locator('.chatdock__launch--bar');
        await b.locator('.chatdock__badge').waitFor({ timeout: 5000 });
        const m = await b.evaluate((el) => { const r = el.getBoundingClientRect(); return { w: r.width, h: r.height, inside: r.right <= window.innerWidth && r.left >= 0, badge: el.querySelector('.chatdock__badge') ? el.querySelector('.chatdock__badge').textContent : null }; });
        if (m.w < 40 || m.h < 40 || !m.inside) throw new Error(JSON.stringify(m));
        if (m.badge !== '1') throw new Error(`badge "${m.badge}", expected 1`);
        if (await p.locator('.chatdock__launch--dock').isVisible()) throw new Error('the corner button for wide screens is showing on a phone');
      });
      await p.locator('.chatdock__launch--bar').click();
      await p.locator('.chatdock__person', { hasText: 'Ada Lovelace' }).click();
      await p.locator('.chatdock__log .bubble').first().waitFor();
      await settle(p);
      await check(`${vpName(vp)}: the conversation fills the space between the top bar and the tab bar, and covers neither`, async () => {
        const m = await p.evaluate(() => { const d = document.querySelector('.chatdock').getBoundingClientRect(); const bar = document.querySelector('.brandbar').getBoundingClientRect(); const tabs = document.querySelector('.tabbar').getBoundingClientRect(); const send = document.querySelector('.chatdock__send button').getBoundingClientRect(); const input = document.querySelector('.chatdock__send input').getBoundingClientRect(); return { top: Math.round(d.top), bottom: Math.round(d.bottom), barBottom: Math.round(bar.bottom), tabsTop: Math.round(tabs.top), w: Math.round(d.width), iw: window.innerWidth, sendBottom: Math.round(send.bottom), sendH: Math.round(send.height), inputW: Math.round(input.width), sw: document.documentElement.scrollWidth }; });
        if (m.top < m.barBottom - 1) throw new Error(`covers the top bar: window top ${m.top}, bar bottom ${m.barBottom}`);
        if (m.bottom > m.tabsTop + 1) throw new Error(`covers the tab bar: window bottom ${m.bottom}, tabs top ${m.tabsTop}`);
        if (m.sendBottom > m.tabsTop + 1) throw new Error('the Send button is under the tab bar');
        if (m.w !== m.iw || m.sw > m.iw) throw new Error(`width ${m.w} of ${m.iw}, page scrollWidth ${m.sw}`);
        if (m.sendH < 40 || m.inputW < 160) throw new Error(`send ${m.sendH}px tall, input ${m.inputW}px wide`);
      });
      await shots(p, `chat-window-conversation-${vpName(vp)}`);
      await check(`${vpName(vp)}: chat window: no console errors or failed requests`, pw.problems.length === 0, pw.problems.join(' | '));
      await pctx.close();
    }
    await cctx.close();
  });

  // ---- the AI guides -------------------------------------------------------------------------------------
  await check.section('guides', async () => {
    const gctx = await openContext(browser, { viewport: DESKTOP });
    await memberSession(gctx, baseUrl, 'Guide Tester');
    const page = await gctx.newPage();
    const w = watch(page);
    await page.goto(`${baseUrl}/guides`);
    await check('the Guides tab lists five AI guides, each labelled as AI, with today\'s allowance', async () => {
      await page.locator('[data-guide]').nth(4).waitFor();
      const m = await page.evaluate(() => ({ n: document.querySelectorAll('[data-guide]').length, ai: [...document.querySelectorAll('[data-guide]')].every((c) => /^AI /.test(c.querySelector('.tiny').innerText)), left: document.querySelector('[data-guides="on"]').dataset.left, notice: /They can be wrong/.test(document.body.innerText) && /sent to Anthropic/.test(document.body.innerText) }));
      if (m.n !== 5 || !m.ai || m.left !== '5' || !m.notice) throw new Error(JSON.stringify(m));
    });
    await page.locator('[data-guide="historian"]').click();
    await check('asking a starter question shows the question, a thinking line, then the reply, and uses one message', async () => {
      await page.getByText('Try asking').waitFor();
      await page.locator('.choice').first().click();
      await page.locator('.guide__reply').first().waitFor({ timeout: 8000 });
      const m = await page.evaluate(() => ({ mine: document.querySelectorAll('.guide__log .bubble.mine').length, replies: document.querySelectorAll('.guide__reply').length, left: document.querySelector('[data-left]').dataset.left, wraps: getComputedStyle(document.querySelector('.guide__text')).whiteSpace, wide: document.querySelector('.guide__log').scrollWidth > document.querySelector('.guide__log').clientWidth + 1 }));
      if (m.mine !== 1 || m.replies !== 1 || m.left !== '4' || m.wraps !== 'pre-wrap' || m.wide) throw new Error(JSON.stringify(m));
    });
    await check('Enter sends, Shift+Enter makes a new line, and the conversation is still there after a reload', async () => {
      const box = page.getByLabel('Ask The Historian');
      await box.fill('First line'); await box.press('Shift+Enter'); await box.pressSequentially('second line');
      if ((await box.inputValue()) !== 'First line\nsecond line') throw new Error(`the box holds ${JSON.stringify(await box.inputValue())}`);
      await box.press('Enter');
      await page.locator('.guide__reply').nth(1).waitFor({ timeout: 8000 });
      await page.reload();
      await page.locator('.guide__reply').nth(1).waitFor();
    });
    await shots(page, 'guide-conversation-1280x800');
    await check('the guides are in the side rail, and the messages allowance is on the Membership page', async () => {
      await page.getByRole('link', { name: 'Guides', exact: true }).waitFor();
      // (Bug: the rule that shares the phone's tab bar between six tabs also stretched each rail link down the screen.)
      const rail = await page.evaluate(() => [...document.querySelectorAll('.tabbar .tab')].map((t) => Math.round(t.getBoundingClientRect().height)));
      if (rail.length !== 6 || Math.max(...rail) > 56) throw new Error(`rail links are ${rail.join(', ')} px tall`);
      await page.goto(`${baseUrl}/membership`);
      await page.getByText('AI guides: 5 messages a day').waitFor();
    });
    await check('guides: no console errors or failed requests', w.problems.length === 0, w.problems.join(' | '));
    await gctx.close();

    const guestCtx = await openContext(browser, { viewport: PHONE });
    await guestSession(guestCtx, baseUrl);
    const gp = await guestCtx.newPage();
    await gp.goto(`${baseUrl}/guides/coach`);
    await check('a guest sees what the guides are and is offered an account, with no box to type in', async () => {
      await gp.getByText('The guides are for members.').waitFor();
      if (await gp.locator('.guide__send').count()) throw new Error('a guest was given the question box');
    });
    await guestCtx.close();
  });

  // ---- the age question for an account made before it existed ------------------------------------------
  await check.section('age question', async () => {
    for (const vp of [PHONE, DESKTOP]) {
      const ctx = await openContext(browser, { viewport: vp, cookies: memberCookies });
      const page = await ctx.newPage();
      // The server says this member has not been asked yet.
      await page.route('**/api/rpc/me', async (route) => { const res = await route.fetch(); const body = await res.json(); if (body.user) body.user.needsAge = true; await route.fulfill({ response: res, json: body }); });
      await page.goto(`${baseUrl}/home`);
      const gate = page.getByRole('dialog', { name: 'One quick question' });
      await check(`${vpName(vp)}: a member who has not been asked sees the question on top of the page, and cannot dismiss it`, async () => {
        await gate.waitFor();
        await page.keyboard.press('Escape');
        await page.mouse.click(4, 4);
        if (!(await gate.isVisible())) throw new Error('Escape or a click outside closed it');
        const m = await gate.evaluate((el) => { const r = el.getBoundingClientRect(); const selects = [...el.querySelectorAll('select')].map((s) => s.getBoundingClientRect()); return { inside: r.left >= 0 && r.right <= window.innerWidth && r.top >= 0 && r.bottom <= window.innerHeight, selects: selects.length, minH: Math.min(...selects.map((s) => s.height)), minW: Math.min(...selects.map((s) => s.width)), disabled: el.querySelector('button.gold').disabled }; });
        if (!m.inside) throw new Error('part of the question is off screen');
        if (m.selects !== 3 || m.minH < 40 || m.minW < 60) throw new Error(JSON.stringify(m));
        if (!m.disabled) throw new Error('Continue is enabled before a date is chosen');
      });
      await check(`${vpName(vp)}: choosing month, day and year enables Continue`, async () => {
        await page.getByLabel('Month of birth').selectOption('04'); await page.getByLabel('Day of birth').selectOption('17'); await page.getByLabel('Year of birth').selectOption('1990');
        if (await gate.getByRole('button', { name: 'Continue' }).isDisabled()) throw new Error('still disabled');
      });
      await shots(page, `age-question-${vpName(vp)}`);
      await ctx.close();
    }
  });

  // ---- accessibility basics ------------------------------------------------------------------------
  await check.section('accessibility', async () => {
    const ctx = await openContext(browser, { viewport: PHONE, cookies: memberCookies });
    const page = await ctx.newPage();
    let worst = null; const failing = [];
    for (const [name, url, ready] of [['home', '/home', '[data-quiz-option]'], ['play', '/play', '[data-game-card]'], ['people', '/people', '[data-segment]'], ['me', '/me', '[data-profile-score]'], ['inbox', '/inbox', 'h1'], ['membership', '/membership', 'h1'], ['debrief', `/debrief/${finishedId}`, 'h1'], ['signin', '/signin', 'form']]) {
      await page.goto(baseUrl + url);
      await page.locator(ready).first().waitFor();
      await settle(page);
      const rows = await measureContrast(page);
      for (const r of rows) { if (!worst || r.ratio < worst.ratio) worst = { ...r, page: name }; if (r.ratio < 4.5) failing.push(`${name}: ${r.what} ${r.ratio}:1 at ${r.px}px`); }
      const lost = await unreachable(page);
      await check(`${name}: everything clickable can be reached with the keyboard`, lost.length === 0, lost.slice(0, 4).join('; '));
    }
    await check('muted and small text is at least 4.5:1 against what is behind it', failing.length === 0, failing.slice(0, 6).join(' | '));
    check.info('lowest contrast measured for muted text, labels, tabs and placeholders', worst ? `${worst.ratio}:1 (${worst.what}, ${worst.px}px, on ${worst.page})` : 'none');
    const token = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--muted').trim());
    check.info('--muted token', token);

    await page.goto(`${baseUrl}/home`);
    await page.locator('[data-quiz-option]').first().waitFor();
    await check('the Feedback dialog: focus moves in, Tab stays in, Escape closes, focus returns', async () => {
      const open = page.getByRole('button', { name: 'Feedback' }).first();
      await open.focus();
      await page.keyboard.press('Enter');
      const dlg = page.getByRole('dialog', { name: 'Tell the arena' });
      await dlg.waitFor();
      if (!(await page.evaluate(() => !!document.activeElement.closest('[role="dialog"]')))) throw new Error('focus is not in the dialog');
      for (let i = 0; i < 12; i++) { await page.keyboard.press('Tab'); if (!(await page.evaluate(() => !!document.activeElement.closest('[role="dialog"]')))) throw new Error(`Tab ${i + 1} left the dialog`); }
      await page.keyboard.press('Escape');
      await dlg.waitFor({ state: 'detached' });
      if (!(await open.evaluate((el) => el === document.activeElement))) throw new Error('focus did not return to the Feedback button');
    });
    await check('keyboard focus is visible (a gold outline on a tabbed-to button)', async () => {
      await page.keyboard.press('Tab');
      const o = await page.evaluate(() => { const cs = getComputedStyle(document.activeElement); return { style: cs.outlineStyle, width: cs.outlineWidth, color: cs.outlineColor, tag: document.activeElement.tagName }; });
      if (o.style === 'none' || parseFloat(o.width) < 2) throw new Error(JSON.stringify(o));
      return `${o.width} ${o.style} ${o.color} on <${o.tag.toLowerCase()}>`;
    });
    await ctx.close();

    const g = await openContext(browser, { viewport: PHONE, cookies: guestCookies, reducedMotion: 'reduce' });
    const gp = await g.newPage();
    await gp.goto(`${baseUrl}/enter?play=fourinarow`);
    await gp.locator('.fir__col--can').first().waitFor();
    await check('in a game: "How to play" and "Chat" are dialogs that close on Escape and give focus back', async () => {
      for (const [btn, title] of [['How to play', /How to play/], [/^Chat/, 'Table talk']]) {
        const open = gp.getByRole('button', { name: btn });
        await open.click();
        await gp.getByRole('dialog', { name: title }).waitFor();
        if (title !== 'Table talk') await shots(gp, 'stage-help-drawer-360');
        await gp.keyboard.press('Escape');
        await gp.getByRole('dialog').waitFor({ state: 'detached' });
        if (!(await open.evaluate((el) => el === document.activeElement))) throw new Error(`focus did not return to "${btn}"`);
      }
    });
    await check('prefers-reduced-motion: no pop, no confetti, no disc-drop animation', async () => {
      const r = await gp.evaluate(() => {
        const pop = document.createElement('div'); pop.className = 'pop'; document.body.appendChild(pop);
        const con = document.createElement('span'); con.className = 'confetti'; document.body.appendChild(con);
        const out = { reduce: matchMedia('(prefers-reduced-motion: reduce)').matches, pop: getComputedStyle(pop).animationName, confetti: getComputedStyle(con).display };
        pop.remove(); con.remove();
        return out;
      });
      if (!r.reduce || r.pop !== 'none' || r.confetti !== 'none') throw new Error(JSON.stringify(r));
      await gp.locator('.fir__col--can').nth(2).click();
      await gp.locator('.fir__disc').first().waitFor();
      const anim = await gp.evaluate(() => getComputedStyle(document.querySelector('.fir__disc')).animationName);
      if (anim !== 'none') throw new Error(`disc animation is ${anim}`);
    });
    const id = new URL(gp.url()).pathname.split('/').pop();
    await rpc(g, baseUrl, 'leaveTable', { id }).catch(() => {});
    await g.close();
  });

  check.info('page numbers (scrollWidth/innerWidth, smallest tap target)', numbers.join(' ; '));
  await seed.close(); await mctx.close(); await octx.close();
}
