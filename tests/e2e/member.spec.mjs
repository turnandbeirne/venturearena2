// The member's road: guest -> account (history kept) -> the five-step profile
// interview -> Home rituals -> Me -> sign out and back in. Then the community
// with a second and third member in their own browsers: matches, the Mixer,
// search, the opportunities board, introductions, messages, connections,
// challenges, the waitlist, feedback, and what each paid tier unlocks.
import { openContext, watch, rpc, admin, memberSession, makePng, playFirToEnd, PHONE, PHONE_TALL, sleep } from './lib.mjs';

const stamp = Date.now().toString(36);
const M1 = { name: 'Ada Lovelace', email: `ada.${stamp}@example.com`, password: 'analytical engine' };
const M2 = { name: 'Ben Okafor', email: `ben.${stamp}@example.com`, password: 'second browser 42' };
// 40 characters, the longest name the server accepts: every list it shows up in must cope.
const LONG_NAME = 'Maximilian Wolfeschlegelsteinhausen-Berg';

const toast = (page, text) => page.locator('.toast').filter({ hasText: text }).waitFor();
const score = async (page) => Number(await page.locator('[data-profile-score]').getAttribute('data-profile-score'));

/** Choose an adult's date of birth in the three menus of a sign-up form. */
async function dob(page, [y, m, d] = ['1990', '04', '17']) {
  await page.getByLabel('Month of birth').selectOption(m);
  await page.getByLabel('Day of birth').selectOption(d);
  await page.getByLabel('Year of birth').selectOption(y);
}

export default async function member({ baseUrl, browser, check, shots, adminToken }) {
  const ctx1 = await openContext(browser, { viewport: PHONE });
  const p1 = await ctx1.newPage();
  const w1 = watch(p1);
  let me1 = null;

  // ---- guest -> account ------------------------------------------------------------
  await check.section('guest to member', async () => {
    await p1.goto(`${baseUrl}/enter?play=fourinarow`);
    await p1.locator('.fir__col--can').first().waitFor();
    await playFirToEnd(p1);
    if (!/\/debrief\//.test(p1.url())) await p1.getByRole('button', { name: 'See the debrief' }).click();
    await p1.waitForURL(/\/debrief\//);
    await p1.getByRole('link', { name: 'Me', exact: true }).click();
    await check.must('a guest\'s Me tab shows the game they just played and offers an account', async () => {
      await p1.getByRole('heading', { name: 'Keep your progress' }).waitFor();
      await p1.locator('[data-history="fourinarow"]').getByText(/2 players/).waitFor();
    });
    await shots(p1, 'me-guest-360', { fullPage: true });
    const before = (await rpc(ctx1, baseUrl, 'me')).user;
    await p1.getByLabel('Display name').first().fill(M1.name);
    await p1.getByLabel('Email').fill(M1.email);
    await p1.getByLabel('Password').fill(M1.password);
    await check('an account cannot be created until a date of birth is chosen', async () => {
      if (!(await p1.getByRole('button', { name: 'Create my free account' }).isDisabled())) throw new Error('the button is enabled with no date of birth');
    });
    await dob(p1);
    await p1.getByRole('button', { name: 'Create my free account' }).click();
    await check.must('creating the account opens the profile interview', async () => {
      await p1.waitForURL(/\/onboarding$/);
      await p1.getByText('Step 1 of 5').waitFor();
    });
    me1 = (await rpc(ctx1, baseUrl, 'me')).user;
    await check('the account is the same person: id, the game and the points carried over', me1.id === before.id && !me1.isGuest && me1.stats.games === 1 && me1.points >= before.points,
      `id ${me1.id === before.id ? 'kept' : 'CHANGED'}, games ${me1.stats.games}, points ${before.points} -> ${me1.points}`);
  });

  // ---- onboarding -------------------------------------------------------------------
  await check.section('onboarding', async () => {
    await check.must('step 1: name, avatar and colours', async () => {
      const name = p1.getByLabel('Display name');
      if (await name.inputValue() !== M1.name) throw new Error(`the name field shows "${await name.inputValue()}"`);
      await p1.getByRole('button', { name: /^Avatar 8:/ }).click();
      await p1.getByRole('button', { name: 'Teal', exact: true }).click();
      await p1.getByRole('button', { name: 'Plum', exact: true }).click();
      await p1.getByRole('button', { name: 'Teal, choice 1' }).waitFor();
      await p1.getByText('Your colours: 1. Teal').waitFor();
      await shots(p1, 'onboarding-1-360', { fullPage: true });
      await p1.getByRole('button', { name: 'Next' }).click();
      await p1.getByText('Step 2 of 5').waitFor();
    });
    await check.must('step 2: eight scenarios, then the archetype reveal', async () => {
      for (let i = 1; i <= 8; i++) {
        await p1.getByText(`Scenario ${i} of 8`).waitFor();
        if (i === 2) { // Back returns to the previous scenario and forgets its answer
          await p1.getByRole('button', { name: 'Previous scenario' }).click();
          await p1.getByText('Scenario 1 of 8').waitFor();
          await p1.locator('.choice').first().click();
          await p1.getByText('Scenario 2 of 8').waitFor();
        }
        if (i === 1) await shots(p1, 'onboarding-2-scenario-360', { fullPage: true });
        await p1.locator('.choice').nth(i % 3).click();
      }
      await p1.locator('[data-archetype]').waitFor();
      const arch = await p1.locator('[data-archetype] h1').innerText();
      if (!/^(Builder|Trader|Operator|Backer|Analyst)$/.test(arch.trim())) throw new Error(`reveal shows "${arch}"`);
      await shots(p1, 'onboarding-2-reveal-360', { fullPage: true });
      await p1.getByRole('button', { name: 'Keep this card' }).click();
      await p1.getByRole('heading', { name: 'Your card' }).waitFor();
      await p1.getByRole('button', { name: 'Next' }).click();
      await p1.getByText('Step 3 of 5').waitFor();
      return arch.trim();
    });
    await check.must('step 3: business (stage, industry, interests)', async () => {
      await p1.getByRole('button', { name: /^Pre-revenue/ }).click();
      await p1.getByLabel('Industry').fill('fintech');
      await p1.getByRole('button', { name: 'SaaS', exact: true }).click();
      await p1.getByRole('button', { name: 'Fintech', exact: true }).click();
      await shots(p1, 'onboarding-3-360', { fullPage: true });
      await p1.getByRole('button', { name: 'Next' }).click();
      await p1.getByText('Step 4 of 5').waitFor();
    });
    await check.must('step 4: looking for and offering', async () => {
      await p1.getByRole('button', { name: /^Peers at my stage/ }).click();
      await p1.getByRole('button', { name: /^A cofounder/ }).click();
      await p1.getByRole('button', { name: /^A mentor/ }).click();
      await shots(p1, 'onboarding-4-360', { fullPage: true });
      await p1.getByRole('button', { name: 'Next' }).click();
      await p1.getByText('Step 5 of 5').waitFor();
    });
    await check('the interview pays Arena Points as it goes', async () => { await p1.getByText(/\+50 Arena Points earned so far/).waitFor(); });
    await check.must('step 5: contact, then "Enter the arena" lands on Home', async () => {
      await p1.getByText(M1.email).waitFor();
      await shots(p1, 'onboarding-5-360', { fullPage: true });
      await p1.getByRole('button', { name: 'Enter the arena' }).click();
      await p1.waitForURL(/\/home$/);
    });
  });

  // ---- Home ------------------------------------------------------------------------------
  await check.section('home', async () => {
    await check('Home greets the member by name with streak, points and rank', async () => {
      await p1.getByRole('heading', { level: 1, name: M1.name }).waitFor();
      // The check-in happens by showing up: the streak and its points land a moment after the page does.
      await p1.locator('[data-stat="streak"] b').getByText('1', { exact: true }).waitFor();
      await toast(p1, 'Day 1 streak: +10 Arena Points');
      await p1.waitForFunction(() => Number(document.querySelector('[data-stat="points"] b').innerText) >= 70);
      const streak = await p1.locator('[data-stat="streak"] b').innerText();
      const points = Number(await p1.locator('[data-stat="points"] b').innerText());
      const rank = await p1.locator('[data-stat="rank"] b').innerText();
      if (streak !== '1' || !(points >= 70) || rank !== 'Rookie') throw new Error(`streak ${streak}, points ${points}, rank ${rank}`);
      return `streak ${streak}, ${points} points, ${rank}`;
    });
    await check('the topic of the day takes a reply', async () => {
      await p1.getByLabel('Your take').fill('Charge for it on day one, even if it is a dollar.');
      await p1.getByRole('button', { name: 'Post' }).click();
      await p1.getByText('Charge for it on day one, even if it is a dollar.').waitFor();
      await toast(p1, '+5 Arena Points');
      if (await p1.getByLabel('Your take').inputValue() !== '') throw new Error('the box was not cleared');
    });
    await check('the daily quiz shows right or wrong and the explanation', async () => {
      await p1.locator('[data-quiz-option="open"]').first().waitFor();
      const n = await p1.locator('[data-quiz-option]').count();
      await p1.locator('[data-quiz-option]').nth(n - 1).click();
      const result = await p1.locator('[data-quiz-result]').getAttribute('data-quiz-result');
      const text = await p1.locator('[data-quiz-result]').innerText();
      const right = await p1.locator('[data-quiz-option="right"]').count();
      const wrong = await p1.locator('[data-quiz-option="wrong"]').count();
      if (right !== 1 || (result === 'incorrect') !== (wrong === 1)) throw new Error(`result ${result}, ${right} right, ${wrong} wrong marked`);
      if (!new RegExp(result === 'correct' ? '^Correct\\.' : '^Not quite\\.').test(text) || text.length < 30) throw new Error(`text "${text}"`);
      if (await p1.locator('[data-quiz-option]:enabled').count()) throw new Error('the quiz can be answered twice');
      return result;
    });
    await shots(p1, 'home-member-360', { fullPage: true });
    await check('the quiz answer is still there after a reload', async () => {
      await p1.reload();
      await p1.locator('[data-quiz-result]').waitFor();
      await p1.getByText('Charge for it on day one, even if it is a dollar.').waitFor();
    });
  });

  // ---- Me ------------------------------------------------------------------------------------
  await check.section('me', async () => {
    await p1.getByRole('link', { name: 'Me', exact: true }).click();
    await check.must('Me shows the record kept from the guest game and 60% complete', async () => {
      await p1.locator('[data-profile-score]').waitFor();
      await p1.locator('[data-history="fourinarow"]').getByRole('link', { name: /Record and chat of this/ }).waitFor();
      const s = await score(p1);
      if (s !== 60) throw new Error(`profile is ${s}%`);
    });
    await check('below 70% the member is told what the gate is', async () => { await p1.getByText(/70% unlocks bios and introductions/).waitFor(); });
    await check('editing a section and saving moves completion to the 70% gate', async () => {
      await p1.getByRole('button', { name: 'Business profile' }).click();
      await p1.getByLabel('One line about you').fill('Mathematician turned founder, analytical engines');
      await p1.getByRole('button', { name: 'Save', exact: true }).click();
      await toast(p1, 'Saved');
      await p1.locator('[data-profile-score="70"]').waitFor();
      const u = (await rpc(ctx1, baseUrl, 'me')).user;
      if (u.access.level !== 'ready' || !u.access.canSeeBios) throw new Error(`access level is ${u.access.level}`);
    });
    await check('another section: goals saved, 80% and the bonus points', async () => {
      await p1.getByRole('button', { name: 'Looking for and offering' }).click();
      await p1.getByLabel('Goals').fill('Find a cofounder who can sell');
      await p1.getByRole('button', { name: 'Save', exact: true }).click();
      await toast(p1, 'Saved. +50 Arena Points');
      await p1.locator('[data-profile-score="80"]').waitFor();
    });
    await check('a photo uploads and replaces the avatar on the card', async () => {
      await p1.getByRole('button', { name: 'Name, avatar and colours' }).click();
      await p1.getByRole('button', { name: 'Upload a photo' }).waitFor();
      await p1.locator('input[type="file"]').setInputFiles({ name: 'me.png', mimeType: 'image/png', buffer: makePng(64) });
      const img = p1.locator('.pcard .avatar img');
      await img.waitFor();
      await p1.waitForFunction(() => { const i = document.querySelector('.pcard .avatar img'); return i && i.complete && i.naturalWidth > 0; });
      const src = await img.getAttribute('src');
      if (!/^\/api\/photo\//.test(src)) throw new Error(`src is ${src}`);
      await p1.getByRole('button', { name: 'Change photo' }).waitFor();
    });
    await shots(p1, 'me-member-360', { fullPage: true });
    await check('the player card flips from the keyboard', async () => {
      const card = p1.locator('.pcard[role="button"]').first();
      await card.focus();
      await p1.keyboard.press('Enter');
      await card.getByText('Looking for').waitFor();
      await p1.keyboard.press('Space');
      await card.getByText('Tap to flip', { exact: true }).waitFor();
    });
    await check('sign out returns to the landing page', async () => {
      await p1.getByRole('button', { name: 'Sign out' }).click();
      await p1.getByRole('link', { name: 'Enter the Arena' }).first().waitFor();
      if ((await rpc(ctx1, baseUrl, 'me')).user !== null) throw new Error('the session is still alive');
    });
    await check('a wrong password is refused with a clear message', async () => {
      w1.allow(/401.*\/api\/rpc\/login/);
      await p1.goto(`${baseUrl}/signin`);
      await p1.getByLabel('Email').fill(M1.email);
      await p1.getByLabel('Password').fill('not the password');
      await p1.getByRole('button', { name: 'Sign in' }).click();
      await p1.getByRole('alert').filter({ hasText: 'Email or password is not right.' }).waitFor();
      await shots(p1, 'signin-error-360');
      if (await p1.getByLabel('Email').inputValue() !== M1.email) throw new Error('the email was cleared');
    });
    await check.must('the right password signs back in to the same account', async () => {
      await p1.getByLabel('Password').fill(M1.password);
      await p1.getByRole('button', { name: 'Sign in' }).click();
      await p1.waitForURL(/\/play$/);
      const u = (await rpc(ctx1, baseUrl, 'me')).user;
      if (u.id !== me1.id || u.surveyScore !== 80 || u.stats.games !== 1) throw new Error('not the same account');
      me1 = u;
    });
  });

  // ---- the community: a second and a third member ------------------------------------------
  const ctx2 = await openContext(browser, { viewport: PHONE_TALL });
  const p2 = await ctx2.newPage();
  const w2 = watch(p2);
  const ctx3 = await openContext(browser, { viewport: PHONE });
  const p3 = await ctx3.newPage();
  const w3 = watch(p3);
  let me2 = null; let me3 = null;

  await check.section('second member', async () => {
    await p2.goto(`${baseUrl}/signin?mode=create`);
    await p2.getByLabel('Display name').fill(M2.name);
    await p2.getByLabel('Email').fill(M2.email);
    await p2.getByLabel(/^Password/).fill(M2.password);
    await dob(p2);
    await p2.getByRole('button', { name: 'Create account' }).click();
    await check.must('a new visitor can create an account from /signin and skip the interview', async () => {
      await p2.waitForURL(/\/onboarding$/);
      await p2.getByRole('button', { name: 'Skip for now' }).click();
      await p2.waitForURL(/\/home$/);
    });
    await rpc(ctx2, baseUrl, 'cardSort', { picks: [1, 1, 2, 1, 0, 2, 2, 1] });
    await rpc(ctx2, baseUrl, 'saveProfile', { colorRanks: ['brick'], headline: 'Operator, two exits in logistics', stage: 'pre_revenue', industry: 'fintech', interests: ['SaaS', 'Marketplaces'], intent: ['peers', 'cofounder'], goals: 'Meet builders', currentProject: 'Freight marketplace', skills: 'operations, sales' });
    me2 = (await rpc(ctx2, baseUrl, 'me')).user;
    me3 = (await memberSession(ctx3, baseUrl, LONG_NAME, { stage: 'scaling', offers: ['mentoring', 'investing'], openToMentoring: 3, intent: ['play'] })).user;
    await check('both extra members have a finished profile', me2.access.canSeeBios && me3.access.canSeeBios, `${me2.surveyScore}% and ${me3.surveyScore}%`);
  });

  await check.section('people', async () => {
    await p1.getByRole('link', { name: 'People', exact: true }).click();
    await check.must('Matches: "Play with" lists the other members with a reason', async () => {
      await p1.getByRole('heading', { level: 1, name: 'People' }).waitFor();
      await p1.locator('.grid .card').filter({ hasText: M2.name }).first().waitFor();
      await p1.locator('.grid .card').filter({ hasText: LONG_NAME }).first().waitFor();
    });
    await check('Peers lists the member at the same stage', async () => {
      await p1.locator('[data-segment="peer"]').click();
      await p1.getByText(/Same stage as you \(pre-revenue\)/).first().waitFor();
    });
    await check('for a free member the mentor, cofounder and investor segments are locked', async () => {
      for (const [seg, feature] of [['mentor', 'mentor_match'], ['cofounder', 'cofounder_match'], ['venture', 'investor_match']]) {
        await p1.locator(`[data-segment="${seg}"]`).click();
        await p1.locator(`[data-locked="${feature}"]`).waitFor();
      }
      if (!(await p1.getByRole('button', { name: 'A mentor', exact: true }).isDisabled())) throw new Error('the Mixer mentor button is enabled');
      await shots(p1, 'people-locked-360', { fullPage: true });
      await p1.locator('[data-segment="playmate"]').click();
    });
    await check('Mixer: "Introduce me to someone" shows one person and why', async () => {
      await p1.getByRole('button', { name: 'Introduce me to someone' }).click();
      await p1.getByText('Why:').waitFor();
      await p1.getByRole('button', { name: 'Next person' }).waitFor();
      await p1.getByRole('link', { name: 'See profile' }).waitFor();
      await shots(p1, 'people-mixer-360', { fullPage: true });
    });
    await check('Everyone: search finds a member, and says so when nobody matches', async () => {
      await p1.getByRole('tab', { name: 'Everyone' }).click();
      await p1.getByLabel('Search people').fill('ben');
      await p1.locator('.card').filter({ hasText: M2.name }).waitFor();
      await p1.waitForFunction((n) => !document.body.innerText.includes(n), LONG_NAME);
      await p1.getByLabel('Search people').fill('zzzz-nobody');
      await p1.getByText('Nobody matches that yet.').waitFor();
      await p1.getByLabel('Search people').fill('');
      await p1.locator('.card').filter({ hasText: LONG_NAME }).waitFor();
      await shots(p1, 'people-everyone-360', { fullPage: true });
    });

    const title = 'Cofounder wanted: sales lead for a fintech';
    await check.must('Opportunities: a member posts an ask', async () => {
      await p1.getByRole('tab', { name: 'Opportunities' }).click();
      await p1.getByRole('button', { name: 'Post something' }).click();
      const locked = await p1.getByLabel('Kind of post').locator('option:disabled').count();
      if (locked !== 4) throw new Error(`${locked} kinds are locked for a free member, expected 4`);
      await p1.getByLabel('Title').fill(title);
      await p1.getByLabel('Details').fill('I build the product. Looking for someone who has sold to banks and wants equity.');
      await p1.getByRole('button', { name: 'Post', exact: true }).click();
      await p1.locator('[data-opportunity]').filter({ hasText: title }).getByText('0 responses').waitFor();
      await shots(p1, 'people-board-360', { fullPage: true });
    });
    await p2.goto(`${baseUrl}/people`);
    await check.must('the other member responds to it', async () => {
      await p2.getByRole('tab', { name: 'Opportunities' }).click();
      const post = p2.locator('[data-opportunity]').filter({ hasText: title });
      await post.getByRole('button', { name: 'I am interested' }).click();
      await post.getByRole('button', { name: 'Intro requested' }).waitFor();
    });
    await check('the poster\'s Inbox badge shows the introduction without a reload', async () => { await p1.locator('.tab .badge').getByText('1').waitFor(); });
    await p2.getByRole('link', { name: /^Inbox/ }).click();
    await p1.getByRole('link', { name: /^Inbox/ }).click();
    await check.must('the poster sees the introduction in the Inbox and accepts', async () => {
      const intro = p1.locator('.card').filter({ hasText: M2.name }).filter({ hasText: 'opportunity' });
      await intro.getByText(`Re: ${title}.`).waitFor();
      await shots(p1, 'inbox-intro-360', { fullPage: true });
      await intro.getByRole('button', { name: 'Accept' }).click();
      await p1.locator('a.card').filter({ hasText: M2.name }).waitFor();
      await p1.locator('.tab .badge').waitFor({ state: 'detached' });
    });
    await check.must('the two can now message each other, and messages arrive live', async () => {
      // B was told (a note from the arena) and sees the new connection without reloading.
      await p2.locator('a.card').filter({ hasText: M1.name }).click();
      await p2.waitForURL(new RegExp(`/inbox/${me1.id}$`));
      await p1.locator('a.card').filter({ hasText: M2.name }).click();
      await p1.getByLabel('Message', { exact: true }).fill('Hello Ben, thanks for answering.');
      await p1.getByRole('button', { name: 'Send' }).click();
      await p1.locator('.bubble.mine').filter({ hasText: 'Hello Ben, thanks for answering.' }).waitFor();
      await p2.locator('.bubble:not(.mine)').filter({ hasText: 'Hello Ben, thanks for answering.' }).waitFor();
      await p2.getByLabel('Message', { exact: true }).fill('Glad to. Shall we play first?');
      await p2.getByLabel('Message', { exact: true }).press('Enter');
      await p1.locator('.bubble:not(.mine)').filter({ hasText: 'Glad to. Shall we play first?' }).waitFor();
      await shots(p1, 'inbox-thread-360');
    });

    await check.must('a connection request from a profile page arrives in the Inbox', async () => {
      await p3.goto(`${baseUrl}/p/${me1.username}`);
      await p3.getByRole('button', { name: '+ Connect' }).click();
      await toast(p3, 'Connection request sent');
      await p3.getByText('Requested', { exact: true }).waitFor();
      await shots(p3, 'profile-360', { fullPage: true });
      await p1.locator('.tab .badge').getByText('1').waitFor();
      await p1.getByRole('button', { name: 'Back to the inbox' }).click();
      const req = p1.locator('.card').filter({ hasText: LONG_NAME }).filter({ has: p1.getByRole('button', { name: 'Accept' }) });
      await req.waitFor();
      await shots(p1, 'inbox-request-360', { fullPage: true });
      await req.getByRole('button', { name: 'Accept' }).click();
      await p1.locator('a.card').filter({ hasText: LONG_NAME }).waitFor();
      await p3.reload();
      await p3.getByText('Connected', { exact: true }).waitFor();
      await p3.getByRole('link', { name: 'Message' }).waitFor();
    });

    await check('the challenge dialog closes on Escape and gives focus back', async () => {
      await p2.goto(`${baseUrl}/p/${me1.username}`);
      const open = p2.getByRole('button', { name: 'Challenge', exact: true });
      await open.click();
      await p2.getByRole('dialog', { name: `Challenge ${M1.name}` }).waitFor();
      await shots(p2, 'challenge-drawer-390');
      await p2.keyboard.press('Escape');
      await p2.getByRole('dialog').waitFor({ state: 'detached' });
      if (!(await open.evaluate((el) => el === document.activeElement))) throw new Error('focus did not return to the button');
    });
    await check.must('challenge -> accept -> both at the same table', async () => {
      await p2.getByRole('button', { name: 'Challenge', exact: true }).click();
      await p2.getByRole('dialog').getByLabel('Message').fill('Best of one?');
      await p2.getByRole('dialog').getByRole('button', { name: /Four in a Row/ }).click();
      await toast(p2, `Challenge sent to ${M1.name}`);
      await toast(p1, 'You have a new challenge').catch(() => {}); // only shown off the Inbox page
      const card = p1.locator('.card').filter({ hasText: 'challenged you to Four in a Row' });
      await card.getByText('Best of one?').waitFor();
      await card.getByRole('button', { name: 'Accept' }).click();
      await p1.waitForURL(/\/t\//);
      const id = new URL(p1.url()).pathname.split('/').pop();
      await p2.goto(`${baseUrl}/home`);
      await p2.getByRole('button', { name: new RegExp(`${M2.name} vs ${M1.name}`) }).click();
      await p2.waitForURL(new RegExp(`/t/${id}$`));
      await p2.locator('.seat[data-seat="you"]').filter({ hasText: M2.name }).filter({ hasText: 'host' }).waitFor();
      await p1.locator('.seat[data-seat="you"]').filter({ hasText: M1.name }).waitFor();
      await p2.getByRole('button', { name: 'Start the game' }).click();
      await p1.locator('.stage[data-game="fourinarow"] .fir__col').first().waitFor();
      await p2.locator('.fir__col--can').first().waitFor();
    });
    // Leave the game so nobody is mid-table for the rest of the spec.
    p1.once('dialog', (d) => d.accept());
    await p1.getByRole('button', { name: 'Leave the table' }).click();
    await p1.waitForURL(/\/play$/);
  });

  // ---- membership, feedback ----------------------------------------------------------------
  await check.section('membership and feedback', async () => {
    await p1.goto(`${baseUrl}/membership`);
    await check('"Join the waitlist" records the plan and says so', async () => {
      await p1.getByRole('button', { name: 'Join the waitlist' }).first().click();
      await p1.getByText(/Noted: you are on the list for Subscriber/).waitFor();
      const list = (await admin(ctx1, baseUrl, adminToken, 'waitlist')).items;
      if (!list.some((w) => w.email === M1.email && w.tier === 'member')) throw new Error('not on the waitlist');
    });
    await shots(p1, 'membership-360', { fullPage: true });
    await check('Feedback: send, thank-you, and a note in the Inbox', async () => {
      await p1.getByRole('button', { name: 'Feedback' }).first().click();
      const dlg = p1.getByRole('dialog', { name: 'Tell the arena' });
      await dlg.waitFor();
      if (!(await dlg.getByRole('button', { name: 'Send' }).isDisabled())) throw new Error('Send is enabled with nothing written');
      await dlg.getByRole('button', { name: 'Report a problem' }).click();
      await dlg.getByLabel('About').selectOption('membership');
      await dlg.getByLabel('Your feedback').fill('The waitlist notice could say when plans open.');
      await shots(p1, 'feedback-drawer-360');
      await dlg.getByRole('button', { name: 'Send' }).click();
      await dlg.getByText('Sent. Thank you.').waitFor();
      await dlg.getByRole('button', { name: 'Close' }).click();
      await dlg.waitFor({ state: 'detached' });
      await p1.getByRole('link', { name: /^Inbox/ }).click();
      await p1.getByText('Thanks for the problem report about membership.').waitFor();
      const items = (await admin(ctx1, baseUrl, adminToken, 'feedback')).items;
      if (!items.some((f) => f.page === '/membership' && f.kind === 'problem' && f.scope === 'membership')) throw new Error('the feedback was not logged with its page');
    });
  });

  // ---- tiers -------------------------------------------------------------------------------------
  await check.section('tiers', async () => {
    await p1.goto(`${baseUrl}/play`);
    await p1.locator('[data-game-card="fourinarow"]').getByRole('button', { name: 'Host' }).click();
    await p1.waitForURL(/\/t\//);
    const id = new URL(p1.url()).pathname.split('/').pop();
    await check('a free member is refused a private table', async () => {
      w1.allow(/403.*setTableSettings/);
      await p1.getByRole('button', { name: /Invite only/ }).click();
      await p1.getByRole('alert').filter({ hasText: 'Private tables are a Subscriber feature.' }).waitFor();
      if ((await rpc(ctx1, baseUrl, 'table', { id })).table.visibility !== 'public') throw new Error('the table went private');
    });
    await admin(ctx1, baseUrl, adminToken, 'setTier', { user: M1.email, tier: 'member' });
    await check('made a Subscriber, the lock goes without a reload and the toggle works', async () => {
      await p1.getByRole('button', { name: 'Invite only', exact: true }).waitFor();
      await p1.getByRole('button', { name: 'Invite only', exact: true }).click();
      await p1.getByRole('button', { name: 'Invite only', exact: true, pressed: true }).waitFor();
      if ((await rpc(ctx1, baseUrl, 'table', { id })).table.visibility !== 'private') throw new Error('the table is still public');
      await p1.getByRole('link', { name: 'Membership: Subscriber' }).waitFor();
      await p1.getByRole('alert').waitFor({ state: 'detached' });
    });
    await p1.getByRole('button', { name: 'Leave', exact: true }).click();
    await p1.waitForURL(/\/play$/);
    await p1.getByRole('link', { name: 'People', exact: true }).click();
    await check('Subscriber: mentor and cofounder segments unlock, investor stays locked', async () => {
      await p1.locator('[data-segment="mentor"]').click();
      await p1.locator('[data-locked]').waitFor({ state: 'detached' });
      // The third member mentors and is two stages ahead: a real match, with the reason.
      // (They connected earlier in this spec, so the first move reads "Connected".)
      await p1.locator('.card').filter({ hasText: LONG_NAME }).getByRole('button', { name: 'Connected' }).waitFor();
      await p1.getByText(/two steps ahead of you and open to mentoring/).waitFor();
      await shots(p1, 'people-mentor-unlocked-360', { fullPage: true });
      await p1.locator('[data-segment="cofounder"]').click();
      await p1.locator('[data-locked]').waitFor({ state: 'detached' });
      await p1.locator('[data-segment="venture"]').click();
      await p1.locator('[data-locked="investor_match"]').waitFor();
      if (await p1.getByRole('button', { name: 'A mentor', exact: true }).isDisabled()) throw new Error('the Mixer mentor button is still disabled');
    });
    await check('VIP: the investor segment unlocks while the page is open', async () => {
      await admin(ctx1, baseUrl, adminToken, 'setTier', { user: me1.username, tier: 'vip' });
      await p1.locator('[data-locked]').waitFor({ state: 'detached' });
      await p1.locator('[data-empty-segment="venture"]').waitFor();
    });
    await check('CEO: can vouch for a member from their profile', async () => {
      await admin(ctx1, baseUrl, adminToken, 'setTier', { user: me1.username, tier: 'ceo' });
      await p1.goto(`${baseUrl}/p/${me2.username}`);
      await p1.getByRole('button', { name: 'Vouch' }).click();
      await toast(p1, 'Vouched');
      await p1.getByText(/Vouched ×1/).waitFor();
      await shots(p1, 'profile-as-ceo-360', { fullPage: true });
    });
  });

  // ---- forgotten password (a throwaway member: a reset signs every old session out) ----------
  await check.section('forgotten password', async () => {
    const ctxOld = await openContext(browser, { viewport: PHONE });
    const lost = await memberSession(ctxOld, baseUrl, 'Forgetful Fran');
    const ctxNew = await openContext(browser, { viewport: PHONE });
    const pr = await ctxNew.newPage();
    const wr = watch(pr);
    await check.must('Sign in links to the reset form', async () => {
      await pr.goto(`${baseUrl}/signin`);
      await pr.getByRole('link', { name: 'Forgot your password?' }).click();
      await pr.getByRole('heading', { name: 'Forgot your password?' }).waitFor();
      await shots(pr, 'reset-ask-360');
    });
    await check('with no mail provider the page says so instead of promising an email', async () => {
      await pr.getByLabel('Email').fill(lost.email);
      await pr.getByRole('button', { name: 'Send the link' }).click();
      await pr.getByRole('heading', { name: 'Email is not set up here yet' }).waitFor();
    });
    let link = '';
    await check.must('the operator can make a reset link', async () => {
      const made = await admin(ctxNew, baseUrl, adminToken, 'resetLink', { user: lost.email });
      link = made.link;
      if (!link.startsWith(`${baseUrl}/reset?token=`)) throw new Error(`unexpected link ${link}`);
    });
    await check.must('the link sets a new password and signs in', async () => {
      await pr.goto(link);
      await pr.getByRole('heading', { name: 'Choose a new password' }).waitFor();
      await shots(pr, 'reset-choose-360');
      await pr.getByLabel(/^New password/).fill('a brand new password');
      await pr.getByRole('button', { name: 'Save and sign in' }).click();
      await pr.waitForURL(/\/play$/);
      const u = (await rpc(ctxNew, baseUrl, 'me')).user;
      if (!u || u.id !== lost.user.id) throw new Error('signed in as someone else');
    });
    await check('the browser that held the old session is signed out', async () => {
      if ((await rpc(ctxOld, baseUrl, 'me')).user !== null) throw new Error('the old session is still alive');
    });
    await check('the same link does not work twice', async () => {
      wr.allow(/400.*\/api\/rpc\/resetPassword/);
      await pr.goto(link);
      await pr.getByLabel(/^New password/).fill('yet another password');
      await pr.getByRole('button', { name: 'Save and sign in' }).click();
      await pr.getByRole('alert').filter({ hasText: 'expired or was already used' }).waitFor();
    });
    await check('reset pages: no console errors or failed requests', wr.problems.length === 0, wr.problems.join(' | '));
    await ctxOld.close(); await ctxNew.close();
  });

  await sleep(200);
  await check('member 1: no console errors or failed requests', w1.problems.length === 0, w1.problems.join(' | '));
  await check('member 2: no console errors or failed requests', w2.problems.length === 0, w2.problems.join(' | '));
  await check('member 3: no console errors or failed requests', w3.problems.length === 0, w3.problems.join(' | '));
  await ctx1.close(); await ctx2.close(); await ctx3.close();
}
