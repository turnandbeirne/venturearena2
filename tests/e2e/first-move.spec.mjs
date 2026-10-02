// A guest must reach their first move within 60 seconds of landing. This walks
// the path a stranger takes: landing page, "Enter the Arena", the lobby, "Play
// a bot" on the first game card, a move on the board. Then the rest of the
// loop: play to the end, the debrief, a reflection answer, "Play again".
import { openContext, watch, PHONE, playFirToEnd, discCount, sleep } from './lib.mjs';

export default async function firstMove({ baseUrl, browser, check, shots }) {
  await check.section('landing to first move', async () => {
    const ctx = await openContext(browser, { viewport: PHONE });
    const page = await ctx.newPage();
    const w = watch(page);
    const t0 = Date.now();

    await page.goto(`${baseUrl}/`);
    await check.must('the landing page shows "Enter the Arena"', async () => { await page.getByRole('link', { name: 'Enter the Arena' }).first().waitFor(); });
    await shots(page, 'landing-360');
    await page.getByRole('link', { name: 'Enter the Arena' }).first().click();

    await check.must('a guest lands in the lobby with no form', async () => {
      await page.waitForURL(/\/play$/);
      await page.locator('[data-game-card]').first().waitFor();
    });
    const firstId = await page.locator('[data-game-card]').first().getAttribute('data-game-card');
    await shots(page, 'lobby-360');
    await page.locator('[data-game-card]').first().getByRole('button', { name: 'Play a bot' }).click();

    await check.must(`"Play a bot" on the first card (${firstId}) opens a board`, async () => {
      await page.waitForURL(/\/t\//);
      await page.locator(`.stage[data-game="${firstId}"]`).waitFor();
    });
    // The first move itself: Four in a Row is a legal column; any other game
    // must at least show an enabled control on its board.
    let moved = false;
    if (firstId === 'fourinarow') {
      moved = await check.must('the board takes a first move', async () => {
        await page.locator('.fir__col--can').first().waitFor();
        await page.locator('.fir__col--can').nth(3).click();
        await page.waitForFunction(() => document.querySelectorAll('.fir__hole .fir__disc').length >= 1);
      });
    } else {
      moved = await check.must('the board is interactive', async () => { await page.locator('.stage button:enabled, .stage [role="button"]').first().waitFor(); });
    }
    const secs = (Date.now() - t0) / 1000;
    await check('landing to first move takes under 60 s', moved && secs < 60, `${secs.toFixed(1)} s`);
    check.info('landing to first move (seconds, wall clock)', secs.toFixed(2));
    await shots(page, 'first-move-360');

    // ---- the rest of the loop, on Four in a Row -----------------------------------
    if (firstId !== 'fourinarow') {
      await page.goto(`${baseUrl}/play`);
      await page.locator('[data-game-card="fourinarow"]').getByRole('button', { name: 'Play a bot' }).click();
      await page.locator('.fir__col--can').first().waitFor();
    }
    await check.must('playing legal moves ends the game', async () => { const r = await playFirToEnd(page); return `${r.moves} moves`; });
    await check('the finished board offers the debrief', async () => {
      if (!/\/debrief\//.test(page.url())) { await shots(page, 'game-over-360'); await page.getByRole('button', { name: 'See the debrief' }).click(); }
      await page.waitForURL(/\/debrief\//);
    });
    await check.must('the debrief shows the result, the standings and one question', async () => {
      const h1 = page.getByRole('heading', { level: 1, name: /You won!|Good game|A draw|Runner-up/ });
      await h1.waitFor();
      const title = (await h1.innerText()).trim();
      await page.getByText(/^(1st|2nd)$/).first().waitFor();
      await page.getByLabel('Your reflection').waitFor();
      return title;
    });
    await shots(page, 'debrief-360', { fullPage: true });
    await check('a reflection answer posts and shows', async () => {
      await page.getByLabel('Your reflection').fill('I chased my own line and missed the block.');
      await page.getByRole('button', { name: 'Post' }).click();
      await page.getByText('I chased my own line and missed the block.').waitFor();
      if (await page.getByLabel('Your reflection').count()) throw new Error('the answer box is still there');
    });
    await check('"Play again" starts a new game on a fresh board', async () => {
      const before = page.url();
      await page.getByRole('button', { name: 'Play again' }).click();
      await page.waitForURL((u) => /\/t\//.test(u.pathname) && u.href !== before);
      await page.locator('.fir__col--can').first().waitFor();
      if (await discCount(page) !== 0) throw new Error('the new board is not empty');
    });
    // Quick match with nobody else around: the table waits, then a bot takes
    // the empty seat and the game starts on its own (QUICK_MATCH_BOT_AFTER_MS, swept every 5 s).
    await check('"Quick match" seats a bot when nobody shows, without a reload', async () => {
      await page.goto(`${baseUrl}/play`);
      await page.locator('[data-game-card="fourinarow"]').getByRole('button', { name: 'Quick match' }).click();
      await page.waitForURL(/\/t\//);
      await page.getByText(/Looking for players\. A bot will take the empty seat/).waitFor();
      await shots(page, 'quick-match-waiting-360');
      const t1 = Date.now();
      await page.locator('.fir__col--can').first().waitFor({ timeout: 15000 });
      return `${((Date.now() - t1) / 1000).toFixed(1)} s until the bot sat down`;
    });
    await check('"Your tables" in the lobby lists the games in play, with a way back in', async () => {
      await page.goto(`${baseUrl}/play`);
      await page.getByRole('heading', { name: 'Your tables' }).waitFor();
      await page.getByRole('button', { name: 'Rejoin' }).first().click();
      await page.locator('.stage[data-game="fourinarow"]').waitFor();
    });
    await check('no console errors or failed requests on the way', w.problems.length === 0, w.problems.join(' | '));
    await ctx.close();
  });

  // ---- the other front doors ---------------------------------------------------------
  const game = 'fourinarow';
  const doors = [
    [`/enter?play=${game}`, /\/t\//, `.stage[data-game="${game}"]`, 'straight onto a board'],
    ['/?go=guest', /\/play$/, '[data-game-card]', 'into the lobby'],
    ['/?from=venturemaker&go=guest', /\/play$/, '[data-game-card]', 'into the lobby'],
  ];
  for (const [url, urlRe, selector, what] of doors) {
    await check.section(url, async () => {
      const ctx = await openContext(browser, { viewport: PHONE });
      const page = await ctx.newPage();
      const w = watch(page);
      const t0 = Date.now();
      await page.goto(`${baseUrl}${url}`);
      await check(`${url} lands a new visitor ${what}`, async () => {
        await page.waitForURL(urlRe);
        await page.locator(selector).first().waitFor();
        if (url.includes('play=')) await page.locator('.fir__col--can').first().waitFor();
        return `${((Date.now() - t0) / 1000).toFixed(1)} s`;
      });
      await sleep(150);
      await check(`${url}: no console errors or failed requests`, w.problems.length === 0, w.problems.join(' | '));
      await ctx.close();
    });
  }
}
