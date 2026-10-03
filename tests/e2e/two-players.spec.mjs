// Multiplayer, tested the only way that counts: separate browser contexts,
// separate anonymous accounts, nobody reloading. A hosts, B joins by invite
// link, C watches. Seats, chat, settings, moves, the debrief and the rematch
// challenge all have to arrive on the other screens by themselves.
import { openContext, watch, rpc, PHONE, PHONE_TALL, firBoard, discCount, sleep } from './lib.mjs';

const untilSame = async (pages, ms = 6000) => {
  const end = Date.now() + ms; let boards = [];
  while (Date.now() < end) {
    boards = await Promise.all(pages.map(firBoard));
    if (boards.every((b) => b && b === boards[0])) return boards[0];
    await sleep(60);
  }
  throw new Error(`boards differ: ${boards.map((b) => (b || 'none').replace(/[^|,.]+/g, 'X')).join('  vs  ')}`);
};

export default async function twoPlayers({ baseUrl, browser, check, shots }) {
  const ctxA = await openContext(browser, { viewport: PHONE, permissions: ['clipboard-read', 'clipboard-write'], baseUrl });
  const ctxB = await openContext(browser, { viewport: PHONE_TALL });
  const ctxC = await openContext(browser, { viewport: PHONE });
  const A = await ctxA.newPage(); const B = await ctxB.newPage(); const C = await ctxC.newPage();
  const wA = watch(A); const wB = watch(B); const wC = watch(C);
  let tableId = null; let code = null;

  await check.section('seating', async () => {
    // A names themselves on the Me tab (a guest can), then hosts from the lobby.
    await A.goto(`${baseUrl}/enter?go=guest`);
    await A.waitForURL(/\/play$/);
    await A.getByRole('link', { name: 'Me', exact: true }).click();
    await check('a guest can set their table name on the Me tab', async () => {
      await A.getByLabel('Display name').last().fill('Ada');
      await A.getByRole('button', { name: 'Save', exact: true }).click();
      await A.getByRole('status').filter({ hasText: 'Saved' }).waitFor();
    });
    await A.getByRole('link', { name: 'Play', exact: true }).click();
    await A.locator('[data-game-card="fourinarow"]').getByRole('button', { name: 'Host' }).click();
    await check.must('A hosts a Four in a Row table', async () => {
      await A.waitForURL(/\/t\//);
      await A.getByRole('heading', { level: 1, name: 'Four in a Row' }).waitFor();
      tableId = new URL(A.url()).pathname.split('/').pop();
    });
    const viaRpc = (await rpc(ctxA, baseUrl, 'table', { id: tableId })).table.inviteCode;
    await check('"Copy invite link" puts the invite link on the clipboard', async () => {
      await A.getByRole('button', { name: 'Copy invite link' }).click();
      await A.getByRole('status').filter({ hasText: /copied/i }).waitFor();
      const text = await A.evaluate(() => navigator.clipboard.readText());
      if (text !== `${baseUrl}/join/${viaRpc}`) throw new Error(`clipboard has "${text}"`);
    });
    code = viaRpc;

    await rpc(ctxB, baseUrl, 'guest'); await rpc(ctxB, baseUrl, 'saveProfile', { displayName: 'Ben' });
    await B.goto(`${baseUrl}/join/${code}`);
    await check.must('B opens /join/<code> and is seated at the same table', async () => {
      await B.waitForURL(new RegExp(`/t/${tableId}$`));
      await B.locator('.seat[data-seat="you"]').filter({ hasText: 'Ben' }).waitFor();
      await B.locator('.seat[data-seat="other"]').filter({ hasText: 'Ada' }).filter({ hasText: 'host' }).waitFor();
    });
    await check('A sees B take the seat without reloading', async () => { await A.getByText('Ben', { exact: true }).waitFor(); });
    await shots(A, 'table-open-host-360', { fullPage: true });
    await shots(B, 'table-open-guest-390', { fullPage: true });
  });

  await check.section('table talk and settings', async () => {
    await check('A\'s chat line reaches B without a reload', async () => {
      await A.getByLabel('Chat message').fill('Welcome, Ben. Ready?');
      await A.getByRole('button', { name: 'Send', exact: true }).click();
      await B.locator('.chat__log').getByText('Welcome, Ben. Ready?').waitFor();
    });
    await check('B\'s reply reaches A without a reload', async () => {
      await B.getByLabel('Chat message').fill('Ready when you are.');
      await B.getByLabel('Chat message').press('Enter');
      await A.locator('.chat__log').getByText('Ready when you are.').waitFor();
      const mine = await A.locator('.chat__log').getByText('Welcome, Ben. Ready?').count();
      if (mine !== 1) throw new Error(`A sees their own line ${mine} times`);
    });
    await check('B sees the table settings, and sees the host change one', async () => {
      const line = B.locator('[data-table-settings]');
      await line.getByText(/bots fill empty seats/).waitFor();
      await A.getByLabel('Fill empty seats with bots when the game starts').uncheck();
      await line.getByText(/no bots/).waitFor();
      await A.getByLabel('Fill empty seats with bots when the game starts').check();
      await line.getByText(/bots fill empty seats/).waitFor();
    });
    await check('a guest host is told private tables are a Subscriber feature', async () => {
      wA.allow(/HTTP 403.*setTableSettings|status of 403.*setTableSettings/);
      await A.getByRole('button', { name: /Invite only/ }).click();
      await A.getByRole('alert').filter({ hasText: 'Private tables are a Subscriber feature.' }).waitFor();
    });
  });

  await check.section('playing', async () => {
    await A.getByRole('button', { name: 'Start the game' }).click();
    await check.must('both get the board when the host starts (B without reloading)', async () => {
      await A.locator('.stage[data-game="fourinarow"] .fir__col').first().waitFor();
      await B.locator('.stage[data-game="fourinarow"] .fir__col').first().waitFor();
    });
    await check('both start from the same empty board', async () => { const b = await untilSame([A, B]); if (/[^|,.]/.test(b)) throw new Error('the board is not empty'); });
    await check('A (the host) moves first; B cannot move yet', async () => {
      await A.locator('.fir__col--can').first().waitFor();
      await A.getByText('Your move').waitFor();
      if (await B.locator('.fir__col--can').count()) throw new Error('B has clickable columns on A\'s turn');
      if (await B.locator('.fir__col:enabled').count()) throw new Error('B has enabled columns on A\'s turn');
    });
    await check('A\'s move shows on B\'s screen and the turn passes to B', async () => {
      await A.locator('.fir__col').nth(0).click();
      await B.waitForFunction(() => document.querySelectorAll('.fir__hole .fir__disc').length === 1);
      await B.getByText('Your move').waitFor();
      await B.locator('.fir__col--can').first().waitFor();
      await A.getByText('Waiting for Ben').waitFor();
      if (await A.locator('.fir__col--can').count()) throw new Error('A can still move on B\'s turn');
      await untilSame([A, B]);
    });
    await check('B\'s move shows on A\'s screen and the turn comes back', async () => {
      await B.locator('.fir__col').nth(1).click();
      await A.waitForFunction(() => document.querySelectorAll('.fir__hole .fir__disc').length === 2);
      await A.getByText('Your move').waitFor();
      await untilSame([A, B]);
    });

    // C arrives by the watch link while the game is on.
    await rpc(ctxC, baseUrl, 'guest'); await rpc(ctxC, baseUrl, 'saveProfile', { displayName: 'Cy' });
    await C.goto(`${baseUrl}/join/${code}/watch`);
    await check.must('C opens /join/<code>/watch and sees the same board', async () => {
      await C.waitForURL(new RegExp(`/t/${tableId}$`));
      await C.locator('.fir__col').first().waitFor();
      await untilSame([A, B, C]);
    });
    await check('C is read-only: no clickable column, and a click does nothing', async () => {
      await C.getByText(/Watching/).waitFor();
      const can = await C.locator('.fir__col--can').count();
      const enabled = await C.locator('.fir__col:enabled').count();
      if (can || enabled) throw new Error(`${can} clickable, ${enabled} enabled columns`);
      await C.locator('.fir__col').nth(3).click({ force: true });
      await sleep(300);
      if (await discCount(A) !== 2) throw new Error('a spectator click changed the board');
    });
    await check('C can chat; A sees the unread badge and the line', async () => {
      await C.getByRole('button', { name: /^Chat/ }).click();
      await C.getByRole('dialog').getByLabel('Chat message').fill('Good luck, both.');
      await C.getByRole('dialog').getByRole('button', { name: 'Send', exact: true }).click();
      await C.getByRole('dialog').getByText('Good luck, both.').waitFor();
      await A.getByRole('button', { name: 'Chat, 1 new' }).waitFor();
      // The line itself is on A's screen already: nothing has to be opened to see it.
      await A.locator('.stage__ticker').getByText(/Good luck, both\./).waitFor();
      await A.getByRole('button', { name: /^Chat/ }).click();
      await A.getByRole('dialog').getByText('Good luck, both.').waitFor();
      await shots(A, 'stage-chat-drawer-360');
      await A.keyboard.press('Escape');
      await A.getByRole('dialog').waitFor({ state: 'detached' });
      await C.keyboard.press('Escape');
      await C.getByRole('dialog').waitFor({ state: 'detached' });
    });

    await A.locator('.fir__col').nth(0).click();
    await B.waitForFunction(() => document.querySelectorAll('.fir__hole .fir__disc').length === 3);
    const before = await untilSame([A, B, C]);
    await check('B reloads mid-game and comes back to the same board, still able to move', async () => {
      await B.reload();
      await B.locator('.fir__col').first().waitFor();
      await B.waitForFunction(() => document.querySelectorAll('.fir__hole .fir__disc').length === 3);
      const after = await firBoard(B);
      if (after !== before) throw new Error('the board changed across the reload');
      await B.getByText('Your move').waitFor();
      await B.locator('.fir__col--can').first().waitFor();
    });
    await shots(B, 'stage-midgame-390');
    await shots(C, 'stage-watching-360');

    // A stacks column 1, B stacks column 2: A wins on their fourth disc.
    await check.must('turns keep alternating to the end of the game', async () => {
      const turn = async (page, col, total) => {
        await page.locator('.fir__col--can').first().waitFor();
        await page.locator('.fir__col').nth(col).click();
        for (const p of [A, B, C]) await p.waitForFunction((n) => document.querySelectorAll('.fir__hole .fir__disc').length === n, total);
      };
      await turn(B, 1, 4); await turn(A, 0, 5); await turn(B, 1, 6); await turn(A, 0, 7);
      await untilSame([A, B, C]);
    });
    await check('each screen says how it ended', async () => {
      // The result is in the banner above the board; the foot counts down to the debrief.
      await A.locator('.stage__banner').getByText('You won!').waitFor();
      await B.locator('.stage__banner').getByText(/Game over/).waitFor();
      await C.locator('.stage__banner').getByText('Game over: Ada won').waitFor();
      for (const p of [A, B, C]) await p.locator('[data-end-bar] [data-countdown]').waitFor();
    });
    await shots(A, 'stage-won-360');
  });

  await check.section('debrief', async () => {
    await check.must('all three land on the debrief by themselves', async () => {
      const re = new RegExp(`/debrief/${tableId}$`);
      await Promise.all([A.waitForURL(re), B.waitForURL(re), C.waitForURL(re)]);
      await A.getByRole('heading', { level: 1, name: 'You won!' }).waitFor();
      await B.getByRole('heading', { level: 1, name: 'Good game' }).waitFor();
      await C.getByRole('heading', { level: 1, name: 'You watched' }).waitFor();
    });
    await check('A gives B a chip and kudos', async () => {
      const row = A.locator('[data-person]').filter({ hasText: 'Ben' });
      await row.getByRole('button', { name: 'sharp' }).click();
      await row.getByRole('button', { name: 'sharp', pressed: true }).waitFor();
      await row.getByRole('button', { name: 'Kudos', exact: true }).click();
      await row.getByRole('button', { name: 'Kudos sent' }).waitFor();
      const me = (await rpc(ctxB, baseUrl, 'me')).user;
      if (me.chips.sharp !== 1 || me.reputation.kudos !== 1) throw new Error(`B has chips ${JSON.stringify(me.chips)}, kudos ${me.reputation.kudos}`);
      // the chip can be changed, the kudos is not given twice
      await row.getByRole('button', { name: 'bold' }).click();
      await row.getByRole('button', { name: 'bold', pressed: true }).waitFor();
      const again = (await rpc(ctxB, baseUrl, 'me')).user;
      if (again.chips.sharp !== 0 || again.chips.bold !== 1 || again.reputation.kudos !== 1) throw new Error(`after changing the chip: ${JSON.stringify(again.chips)}, kudos ${again.reputation.kudos}`);
    });
    await check('B\'s reflection answer appears on A\'s and C\'s screens without a reload', async () => {
      await B.getByLabel('Your reflection').fill('I should have blocked the first column.');
      await B.getByRole('button', { name: 'Post' }).click();
      await A.getByText('I should have blocked the first column.').waitFor();
      await C.getByText('I should have blocked the first column.').waitFor();
    });
    await check('the watcher can answer too, and the players see it', async () => {
      await C.getByLabel('Your reflection').fill('Ada took the edge and nobody contested it.');
      await C.getByLabel('Your reflection').press('Enter');
      await A.getByText('Ada took the edge and nobody contested it.').waitFor();
    });
    await shots(A, 'debrief-winner-360', { fullPage: true });
    await shots(C, 'debrief-watcher-360', { fullPage: true });

    await check('A\'s rematch challenge reaches B (toast and Inbox badge, no reload)', async () => {
      await A.locator('[data-person]').filter({ hasText: 'Ben' }).getByRole('button', { name: 'Rematch' }).click();
      await A.getByRole('status').filter({ hasText: 'Rematch challenge sent' }).waitFor();
      await B.getByRole('status').filter({ hasText: 'You have a new challenge' }).waitFor();
      await B.locator('.tab .badge').getByText('1').waitFor();
    });
    await check('B finds the challenge on Home and in the Inbox', async () => {
      await B.getByRole('link', { name: /^Home/ }).click();
      await B.getByText('challenged you to Four in a Row').waitFor();
      await B.getByText('Rematch?').waitFor();
      await shots(B, 'home-challenge-390');
      await B.getByRole('link', { name: /^Inbox/ }).click();
      await B.getByText('challenged you to Four in a Row').waitFor();
    });
    await check('B accepts and both end up at the same new table', async () => {
      await B.getByRole('button', { name: 'Accept' }).click();
      await B.waitForURL((u) => /\/t\//.test(u.pathname) && !u.pathname.endsWith(tableId));
      const newId = new URL(B.url()).pathname.split('/').pop();
      await A.getByRole('link', { name: /^Home/ }).click();
      await A.getByRole('button', { name: /Ada vs Ben/ }).click();
      await A.waitForURL(new RegExp(`/t/${newId}$`));
      await A.getByText('Ben', { exact: true }).waitFor();
      await B.locator('.seat').filter({ hasText: 'Ada' }).filter({ hasText: 'host' }).waitFor();
    });
  });

  await check('A: no console errors or failed requests', wA.problems.length === 0, wA.problems.join(' | '));
  await check('B: no console errors or failed requests', wB.problems.length === 0, wB.problems.join(' | '));
  await check('C: no console errors or failed requests', wC.problems.length === 0, wC.problems.join(' | '));
  await ctxA.close(); await ctxB.close(); await ctxC.close();
}
