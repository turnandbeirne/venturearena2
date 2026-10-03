#!/usr/bin/env node
// Operator tools, from a terminal. Talks to a RUNNING server over its admin
// endpoints; it never opens the database itself.
//
//   npm run admin -- stats
//   npm run admin -- set-tier <username-or-email> <free|member|vip|ceo>
//   npm run admin -- reset-link <username-or-email>
//   npm run admin -- feedback [open|planned|done]
//   npm run admin -- respond <feedback-id> <status> "<what you did about it>"
//   npm run admin -- reports
//   npm run admin -- waitlist
//
// Needs two environment variables (set them in your shell, not in a file
// that gets committed):
//   ARENA_URL     where the server is, e.g. https://arena.venturemaker.org
//                 (default http://localhost:8000)
//   ADMIN_TOKEN   the same value the server was started with

const [cmd, ...rest] = process.argv.slice(2);
const base = (process.env.ARENA_URL || 'http://localhost:8000').replace(/\/$/, '');
const token = process.env.ADMIN_TOKEN || '';

const COMMANDS = {
  stats: () => ['stats', {}],
  'set-tier': ([user, tier]) => (user && tier ? ['setTier', { user, tier }] : null),
  'reset-link': ([user]) => (user ? ['resetLink', { user }] : null),
  feedback: ([status]) => ['feedback', status ? { status } : {}],
  respond: ([id, status, ...words]) => (id && status ? ['respondFeedback', { id, status, response: words.join(' ') }] : null),
  reports: () => ['reports', {}],
  waitlist: () => ['waitlist', {}],
};

function usage(problem) {
  if (problem) console.error(`${problem}\n`);
  console.error('Usage: npm run admin -- <command>\n');
  console.error('  stats');
  console.error('  set-tier <username-or-email> <free|member|vip|ceo>');
  console.error('  reset-link <username-or-email>     a one-hour password reset link to send by hand');
  console.error('  feedback [status]');
  console.error('  respond <feedback-id> <status> "<response>"');
  console.error('  reports');
  console.error('  waitlist');
  console.error('\nSet ADMIN_TOKEN (and ARENA_URL unless the server is on localhost:8000).');
  process.exit(2);
}

if (!cmd || cmd === 'help' || cmd === '--help') usage();
if (!COMMANDS[cmd]) usage(`Unknown command "${cmd}".`);
const call = COMMANDS[cmd](rest);
if (!call) usage(`"${cmd}" is missing an argument.`);
if (!token) usage('ADMIN_TOKEN is not set.');

const [action, args] = call;
let res;
try {
  res = await fetch(`${base}/api/admin/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-admin-token': token }, body: JSON.stringify(args) });
} catch (e) {
  console.error(`Could not reach ${base}: ${e.message}`);
  process.exit(1);
}
const body = await res.json().catch(() => ({}));
if (!res.ok) {
  console.error(`${res.status}: ${body.error || 'request refused'}${res.status === 403 ? ' (is ADMIN_TOKEN the same value the server has?)' : ''}`);
  process.exit(1);
}
console.log(JSON.stringify(body, null, 2));
