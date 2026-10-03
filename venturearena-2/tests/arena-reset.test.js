// Forgotten password: the link is the only proof of identity, so every way
// it could be wrong, reused, leaked or guessed is tested here.
import { describe, it, expect } from 'vitest';
import { makeArena, member } from './helpers.js';

let n = 0;
const ip = () => ({ ip: `reset-ip-${++n}` });
const err = (p) => p.then(() => { throw new Error('expected a refusal'); }, (e) => e);
const tokenOf = (mail) => /reset\?token=([0-9a-f]+)/.exec(mail.text)[1];

function arenaWithMail() {
  const A = makeArena();
  const mails = [];
  A.mailer = async (m) => { mails.push(m); };
  return { A, mails };
}

describe('forgotten password', () => {
  it('mails a link, the link sets a new password and signs out every old session', async () => {
    const { A, mails } = arenaWithMail();
    const ada = await member(A, 'Ada');
    const old = await A.call('login', null, { email: 'ada@example.com', password: 'correct horse' }, ip());
    expect(A.userForToken(old.setSession).id).toBe(ada.id);
    mails.length = 0;

    expect(await A.call('requestPasswordReset', null, { email: 'Ada@Example.com' }, ip())).toEqual({ ok: true, mail: true });
    expect(mails).toHaveLength(1);
    expect(mails[0].to).toBe('ada@example.com');
    expect(mails[0].text).toContain('http://test/reset?token=');
    const token = tokenOf(mails[0]);

    const r = await A.call('resetPassword', null, { token, password: 'brand new pass' }, ip());
    expect(r.user.id).toBe(ada.id);
    expect(A.userForToken(r.setSession).id).toBe(ada.id);
    expect(A.userForToken(old.setSession)).toBe(null);
    expect((await err(A.call('login', null, { email: 'ada@example.com', password: 'correct horse' }, ip()))).status).toBe(401);
    expect((await A.call('login', null, { email: 'ada@example.com', password: 'brand new pass' }, ip())).user.id).toBe(ada.id);
  });

  it('a link works once, and not after an hour', async () => {
    const { A, mails } = arenaWithMail();
    await member(A, 'Ada'); mails.length = 0;
    await A.call('requestPasswordReset', null, { email: 'ada@example.com' }, ip());
    const token = tokenOf(mails[0]);
    await A.call('resetPassword', null, { token, password: 'brand new pass' }, ip());
    expect((await err(A.call('resetPassword', null, { token, password: 'another pass 1' }, ip()))).message).toMatch(/expired or was already used/);

    await A.call('requestPasswordReset', null, { email: 'ada@example.com' }, ip());
    const late = tokenOf(mails[1]);
    A.advance(61 * 60 * 1000);
    expect((await err(A.call('resetPassword', null, { token: late, password: 'another pass 1' }, ip()))).message).toMatch(/expired/);
    expect((await A.call('login', null, { email: 'ada@example.com', password: 'brand new pass' }, ip())).user).toBeTruthy();
  });

  it('a short password is refused and leaves the link usable', async () => {
    const { A, mails } = arenaWithMail();
    await member(A, 'Ada'); mails.length = 0;
    await A.call('requestPasswordReset', null, { email: 'ada@example.com' }, ip());
    const token = tokenOf(mails[0]);
    expect((await err(A.call('resetPassword', null, { token, password: 'short' }, ip()))).message).toMatch(/at least 8/);
    expect((await A.call('resetPassword', null, { token, password: 'long enough now' }, ip())).user).toBeTruthy();
  });

  it('answers the same for an unknown address, and sends nothing', async () => {
    const { A, mails } = arenaWithMail();
    await member(A, 'Ada'); mails.length = 0;
    expect(await A.call('requestPasswordReset', null, { email: 'nobody@example.com' }, ip())).toEqual({ ok: true, mail: true });
    expect(mails).toHaveLength(0);
    expect((await err(A.call('requestPasswordReset', null, { email: 'not an email' }, ip()))).message).toMatch(/email address/);
  });

  it('wrong, empty and non-string tokens are refused', async () => {
    const { A, mails } = arenaWithMail();
    const ada = await member(A, 'Ada'); mails.length = 0;
    await A.call('requestPasswordReset', null, { email: 'ada@example.com' }, ip());
    for (const token of ['', 'f'.repeat(64), null, 42, {}, ['x'], A.user(ada.id).reset.hash]) {
      expect((await err(A.call('resetPassword', null, { token, password: 'brand new pass' }, ip()))).message, String(token)).toMatch(/expired or was already used/);
    }
    expect((await A.call('login', null, { email: 'ada@example.com', password: 'correct horse' }, ip())).user).toBeTruthy();
  });

  it('the token is stored only as a hash and never appears in what a browser receives', async () => {
    const { A, mails } = arenaWithMail();
    const ada = await member(A, 'Ada'); mails.length = 0;
    await A.call('requestPasswordReset', null, { email: 'ada@example.com' }, ip());
    const token = tokenOf(mails[0]);
    const stored = A.user(ada.id);
    expect(JSON.stringify(stored)).not.toContain(token);
    const self = JSON.stringify(A.selfView(stored));
    expect(self).not.toContain('"reset"');
    expect(self).not.toContain(stored.reset.hash);
    expect(JSON.stringify(A.card(stored, null))).not.toContain(stored.reset.hash);
  });

  it('is rate limited per account and per address', async () => {
    const { A, mails } = arenaWithMail();
    await member(A, 'Ada'); mails.length = 0;
    for (let i = 0; i < 3; i++) await A.call('requestPasswordReset', null, { email: 'ada@example.com' }, ip());
    // The fourth is answered like the others (a refusal would reveal the account exists) but sends nothing.
    expect(await A.call('requestPasswordReset', null, { email: 'ada@example.com' }, ip())).toEqual({ ok: true, mail: true });
    expect(mails).toHaveLength(3);
    const one = { ip: 'one-address' };
    for (let i = 0; i < 6; i++) await A.call('requestPasswordReset', null, { email: `x${i}@example.com` }, one);
    expect((await err(A.call('requestPasswordReset', null, { email: 'x9@example.com' }, one))).status).toBe(429);
  });

  it('without a mail provider it says so, and the operator can make a link', async () => {
    const A = makeArena();
    const ada = await member(A, 'Ada');
    expect(await A.call('requestPasswordReset', null, { email: 'ada@example.com' }, ip())).toEqual({ ok: true, mail: false });
    expect(A.user(ada.id).reset).toBeFalsy();
    const made = A.admin.resetLink('ada@example.com');
    expect(made.link).toMatch(/^http:\/\/test\/reset\?token=[0-9a-f]{64}$/);
    const token = /token=([0-9a-f]+)/.exec(made.link)[1];
    expect((await A.call('resetPassword', null, { token, password: 'brand new pass' }, ip())).user.id).toBe(ada.id);
    expect((await err(Promise.resolve().then(() => A.admin.resetLink('nobody@example.com')))).status).toBe(404);
  });
});
