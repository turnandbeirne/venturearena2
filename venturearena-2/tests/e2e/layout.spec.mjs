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
    const out = { fullscreen, innerWidth: vw, innerHeight: vh, scrollWidth: document.documentElement.scrollWidth, board: null, outside: [], outsideDecor: [], small: [], tight: [], smallest: null, controls: 0 };
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
  let me = null; let other = null; let finishedId = null; let openId = null; let guestUser = null;
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
