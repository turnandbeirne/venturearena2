// Storage: the in-memory working set, the snapshot file driver, the Postgres
// driver (against an in-process Postgres) and the boardgame.io storage
// adapter with the arena's two safety rules.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { Master } from 'boardgame.io/master';
import { Store, Collection, MemoryDriver, FileDriver, createStore } from '../src/server/store/index.js';
import { PostgresDriver, SCHEMA_SQL } from '../src/server/store/postgres.js';
import { ArenaStorage } from '../src/server/store/bgio-storage.js';
import { createBgio } from '../src/server/bgio.js';
import { defineGame, INVALID_MOVE, refuse } from '../src/games/kit.js';
import { fourInARow } from '../src/games/fourinarow/rules.js';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
/** Poll until `fn()` is truthy (or five seconds pass), so a busy machine cannot make a timer test fail. */
const until = async (fn) => { for (let i = 0; i < 500; i++) { if (await fn()) return true; await wait(10); } return false; };
let tmp;
beforeAll(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'va-store-')); });
afterAll(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

describe('Collection and Store (memory)', () => {
  it('put, get, has, delete; ids are strings', () => {
    const store = new Store(new MemoryDriver());
    const c = store.col('things');
    expect(c).toBeInstanceOf(Collection);
    expect(store.col('things')).toBe(c);
    const doc = { id: 7, name: 'seven' };
    expect(c.put(doc)).toBe(doc);
    expect(c.get(7)).toBe(doc);
    expect(c.get('7')).toBe(doc);
    expect(c.has('7')).toBe(true);
    expect(c.has(8)).toBe(false);
    expect(c.get(null)).toBeUndefined();
    expect(c.get(undefined)).toBeUndefined();
    expect(c.get('nope')).toBeUndefined();
    expect(c.size).toBe(1);
    c.put({ id: '7', name: 'replaced' });
    expect(c.size).toBe(1);
    expect(c.get(7).name).toBe('replaced');
    expect(c.delete(7)).toBe(true);
    expect(c.delete(7)).toBe(false);
    expect(c.size).toBe(0);
    for (const bad of [null, undefined, {}, { id: null }, { id: undefined }]) expect(() => c.put(bad)).toThrow(/needs an id/);
    expect(c.put({ id: 0 }).id).toBe(0); // zero is an id
    expect(c.get(0)).toEqual({ id: 0 });
  });

  it('all, filter, find, count, touch', () => {
    const c = new Store(new MemoryDriver()).col('n');
    for (let i = 1; i <= 5; i++) c.put({ id: i, even: i % 2 === 0 });
    expect(c.all().map((d) => d.id)).toEqual([1, 2, 3, 4, 5]);
    expect(c.filter((d) => d.even).map((d) => d.id)).toEqual([2, 4]);
    expect(c.find((d) => d.even).id).toBe(2);
    expect(c.find((d) => d.id > 9)).toBeUndefined();
    expect(c.count()).toBe(5);
    expect(c.count((d) => !d.even)).toBe(3);
    const d = c.get(3); d.even = true;
    expect(c.touch(d)).toBe(d);
    expect(c.count((x) => x.even)).toBe(3);
    // all() is a copy: changing it does not change the collection.
    c.all().pop();
    expect(c.size).toBe(5);
  });

  it('a prototype name is just another id or collection', () => {
    const store = new Store(new MemoryDriver());
    const c = store.col('__proto__');
    c.put({ id: '__proto__', v: 1 }); c.put({ id: 'constructor', v: 2 });
    expect(c.get('__proto__').v).toBe(1);
    expect(c.get('constructor').v).toBe(2);
    expect(c.get('toString')).toBeUndefined();
    expect(({}).v).toBeUndefined();
  });

  it('every write and delete goes to the driver; load fills the collections; close flushes', async () => {
    const calls = [];
    const driver = { kind: 'spy', loadAll: async () => [{ col: 'users', id: 'u1', data: { id: 'u1', n: 1 } }, { col: 'tables', id: 't1', data: { id: 't1' } }], write: (...a) => calls.push(['write', ...a]), remove: (...a) => calls.push(['remove', ...a]), flush: async () => calls.push(['flush']), close: async () => calls.push(['close']) };
    const store = new Store(driver);
    expect(await store.load()).toBe(2);
    expect(store.col('users').get('u1')).toEqual({ id: 'u1', n: 1 });
    expect(calls).toEqual([]); // loading is not writing
    const doc = store.col('users').put({ id: 5, a: 1 });
    store.col('users').delete(5); store.col('users').delete(5);
    expect(calls).toEqual([['write', 'users', '5', doc], ['remove', 'users', '5']]);
    await store.flush(); await store.close();
    expect(calls.slice(2)).toEqual([['flush'], ['flush'], ['close']]);
  });

  it('createStore picks the driver from the config', async () => {
    const mem = await createStore({});
    expect(mem).toMatchObject({ kind: 'memory', loaded: 0 });
    const file = path.join(tmp, 'created.json');
    const f = await createStore({ dataFile: file });
    expect(f.kind).toBe('file');
    f.store.col('a').put({ id: 1 });
    await f.store.close();
    expect((await createStore({ dataFile: file })).loaded).toBe(1);
  });
});

describe('FileDriver', () => {
  it('round trip: write, flush, reload into a fresh store', async () => {
    const file = path.join(tmp, 'nested', 'dir', 'data.json');
    const store = new Store(new FileDriver(file));
    expect(await store.load()).toBe(0); // no file yet
    store.col('users').put({ id: 'u1', name: 'Ada', tags: ['a', 'b'], nested: { n: 1 }, text: 'emoji \u{1F98A} and "quotes"' });
    store.col('users').put({ id: 'u2', name: 'Bob' });
    store.col('tables').put({ id: 't:1', players: ['u1'] });
    store.col('users').delete('u2');
    expect(fs.existsSync(file)).toBe(false); // debounced
    await store.flush();
    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual({ users: { u1: { id: 'u1', name: 'Ada', tags: ['a', 'b'], nested: { n: 1 }, text: 'emoji \u{1F98A} and "quotes"' } }, tables: { 't:1': { id: 't:1', players: ['u1'] } } });
    expect(fs.existsSync(`${file}.tmp`)).toBe(false); // written to a temp file, then renamed

    const again = new Store(new FileDriver(file));
    expect(await again.load()).toBe(2);
    expect(again.col('users').all()).toEqual(store.col('users').all());
    expect(again.col('tables').get('t:1')).toEqual({ id: 't:1', players: ['u1'] });
    // What was loaded is kept when the next snapshot is written.
    again.col('users').put({ id: 'u3' });
    await again.flush();
    expect(Object.keys(JSON.parse(fs.readFileSync(file, 'utf8')).users).sort()).toEqual(['u1', 'u3']);
    expect(Object.keys(JSON.parse(fs.readFileSync(file, 'utf8')).tables)).toEqual(['t:1']);
  });

  it('a doc mutated in place and put again is saved in its latest form', async () => {
    const file = path.join(tmp, 'mutate.json');
    const store = new Store(new FileDriver(file));
    const u = store.col('users').put({ id: 'u', points: 0 });
    u.points = 10; store.col('users').put(u);
    u.points = 25; store.col('users').touch(u);
    await store.flush();
    expect(JSON.parse(fs.readFileSync(file, 'utf8')).users.u.points).toBe(25);
  });

  it('writes are debounced into one snapshot, which lands without anyone calling flush', async () => {
    const file = path.join(tmp, 'debounce.json');
    const driver = new FileDriver(file, { debounceMs: 15 });
    const save = vi.spyOn(driver, 'save');
    const store = new Store(driver);
    for (let i = 0; i < 50; i++) store.col('n').put({ id: i });
    expect(save).not.toHaveBeenCalled();
    expect(await until(() => fs.existsSync(file))).toBe(true);
    expect(save).toHaveBeenCalledTimes(1);
    expect(Object.keys(JSON.parse(fs.readFileSync(file, 'utf8')).n)).toHaveLength(50);
    await store.flush(); // nothing new: no rewrite
    const mtime = fs.statSync(file).mtimeMs;
    await wait(20); await store.flush();
    expect(fs.statSync(file).mtimeMs).toBe(mtime);
  });

  it('a failed save keeps the previous file intact and the data is written once the disk is back', async () => {
    const file = path.join(tmp, 'atomic.json');
    const store = new Store(new FileDriver(file));
    store.col('a').put({ id: 1, v: 'first' });
    await store.flush();
    // The temp file cannot be created: the path is taken by a directory.
    fs.mkdirSync(`${file}.tmp`);
    store.col('a').put({ id: 1, v: 'second' });
    await expect(store.flush()).rejects.toThrow();
    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual({ a: { 1: { id: 1, v: 'first' } } }); // never a half-written file
    fs.rmdirSync(`${file}.tmp`);
    await store.flush(); // no new write happened in between: the failed one must not be forgotten
    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual({ a: { 1: { id: 1, v: 'second' } } });
  });

  it('a save that fails on the timer does not crash the server; it is retried', async () => {
    const file = path.join(tmp, 'timer.json');
    fs.mkdirSync(`${file}.tmp`);
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    const store = new Store(new FileDriver(file, { debounceMs: 10 }));
    store.col('a').put({ id: 1 });
    expect(await until(() => quiet.mock.calls.length > 0)).toBe(true); // the timer fired, the save failed, and it was logged, not thrown
    expect(fs.existsSync(file)).toBe(false);
    fs.rmdirSync(`${file}.tmp`);
    expect(await until(() => fs.existsSync(file))).toBe(true);
    quiet.mockRestore();
    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual({ a: { 1: { id: 1 } } });
    await store.close();
  });
});

describe('PostgresDriver (in-process Postgres)', () => {
  let db; let seen; let failNext;
  const query = (sql, params) => {
    seen.push(sql.trim().split(/\s+/).slice(0, 2).join(' ').toLowerCase());
    if (failNext && failNext(sql, params)) return Promise.reject(new Error('connection reset'));
    return db.query(sql, params);
  };
  const rows = async () => (await db.query('select col, id, data from va_docs order by col, id')).rows;
  const fresh = async (opts = {}) => { const driver = new PostgresDriver(query, { flushMs: 5000, onError: () => {}, ...opts }); const store = new Store(driver); await store.load(); seen.length = 0; return { driver, store }; };

  beforeAll(async () => { db = new PGlite(); await db.query('select 1'); }, 60000);
  afterAll(async () => { await db.close(); });
  beforeEach(async () => { seen = []; failNext = null; await db.query('drop table if exists va_docs'); });

  it('creates its schema on first load, and loading twice is harmless', async () => {
    const store = new Store(new PostgresDriver(query));
    expect(await store.load()).toBe(0);
    const cols = (await db.query("select column_name, data_type from information_schema.columns where table_name = 'va_docs' order by ordinal_position")).rows;
    expect(cols.map((c) => [c.column_name, c.data_type])).toEqual([['col', 'text'], ['id', 'text'], ['data', 'jsonb'], ['updated_at', 'timestamp with time zone']]);
    const idx = (await db.query("select indexname from pg_indexes where tablename = 'va_docs'")).rows.map((r) => r.indexname).sort();
    expect(idx).toEqual(['va_docs_col_updated', 'va_docs_pkey']);
    expect(await new Store(new PostgresDriver(query)).load()).toBe(0);
    expect(SCHEMA_SQL).toMatch(/primary key \(col, id\)/);
  });

  it('DATABASE_SCHEMA: lives in its own schema, next to another application\'s tables, and touches nothing else', async () => {
    // Someone else's table, in the default schema, with the same name on purpose.
    await db.query('create table va_docs (col text, id text, data jsonb, primary key (col, id))');
    await db.query("insert into va_docs values ('users', 'theirs', '{\"name\":\"not ours\"}')");
    await db.query('drop schema if exists arena2 cascade');
    await db.query('drop schema if exists arena3 cascade');

    const a = new Store(new PostgresDriver(query, { schema: 'arena2', flushMs: 5000 }));
    expect(await a.load()).toBe(0); // the other application's row is not ours to load
    a.col('users').put({ id: 'u1', name: 'Ada' });
    await a.flush();
    const b = new Store(new PostgresDriver(query, { schema: 'arena3', flushMs: 5000 }));
    expect(await b.load()).toBe(0); // nor is another copy's
    a.col('users').delete('u1'); a.col('users').put({ id: 'u2', name: 'Bo' });
    await a.flush();

    expect((await db.query('select id from arena2.va_docs')).rows).toEqual([{ id: 'u2' }]);
    expect((await db.query('select count(*)::int as n from arena3.va_docs')).rows[0].n).toBe(0);
    expect(await rows()).toEqual([{ col: 'users', id: 'theirs', data: { name: 'not ours' } }]);
    const idx = (await db.query("select schemaname from pg_indexes where indexname = 'va_docs_col_updated'")).rows.map((r) => r.schemaname).sort();
    expect(idx).toEqual(['arena2', 'arena3']);
    const again = new Store(new PostgresDriver(query, { schema: 'arena2' }));
    expect(await again.load()).toBe(1);

    // The name goes into SQL, so it is a plain identifier or it is refused.
    for (const bad of ['arena 2', 'a;drop table x', '"x"', 'Arena2', '1abc', 'a'.repeat(64), 'pg_catalog', 'public; --']) {
      expect(() => new PostgresDriver(query, { schema: bad }), bad).toThrow(/DATABASE_SCHEMA/);
    }
    const { loadConfig } = await import('../src/server/config.js');
    expect(loadConfig({}).databaseSchema).toBe('');
    expect(loadConfig({ DATABASE_SCHEMA: ' arena2 ' }).databaseSchema).toBe('arena2');
  });

  it('the table is closed to a database\'s public data API (row level security on, no policies)', async () => {
    // On Supabase every table in the default schema is served over HTTP to
    // anyone holding the site's public key unless row level security is on.
    // Ours holds password hashes and sessions.
    await new Store(new PostgresDriver(query)).load();
    await db.query('drop schema if exists arena2 cascade');
    await db.query('drop schema if exists arena3 cascade');
    await new Store(new PostgresDriver(query, { schema: 'arena2' })).load();
    const rls = (await db.query("select n.nspname as schema, c.relrowsecurity as on from pg_class c join pg_namespace n on n.oid = c.relnamespace where c.relname = 'va_docs' and c.relkind = 'r' order by 1")).rows;
    expect(rls).toEqual([{ schema: 'arena2', on: true }, { schema: 'public', on: true }]);
    expect((await db.query("select count(*)::int as n from pg_policies where tablename = 'va_docs'")).rows[0].n).toBe(0);
  });

  it('upserts: a new doc is inserted, a changed doc updates the same row', async () => {
    const { store } = await fresh();
    const u = store.col('users').put({ id: 'u1', name: 'Ada', n: 1 });
    await store.flush();
    expect(await rows()).toEqual([{ col: 'users', id: 'u1', data: { id: 'u1', name: 'Ada', n: 1 } }]);
    const first = (await db.query('select updated_at from va_docs')).rows[0].updated_at;
    await wait(15);
    u.n = 2; store.col('users').put(u);
    await store.flush();
    expect(await rows()).toEqual([{ col: 'users', id: 'u1', data: { id: 'u1', name: 'Ada', n: 2 } }]);
    expect((await db.query('select updated_at from va_docs')).rows[0].updated_at.getTime()).toBeGreaterThan(first.getTime());
    // The same id in two collections is two rows.
    store.col('tables').put({ id: 'u1', kind: 'table' });
    await store.flush();
    expect((await rows()).map((r) => r.col)).toEqual(['tables', 'users']);
  });

  it('deletes', async () => {
    const { store } = await fresh();
    store.col('users').put({ id: 'u1' }); store.col('users').put({ id: 'u2' });
    await store.flush();
    store.col('users').delete('u1');
    await store.flush();
    expect((await rows()).map((r) => r.id)).toEqual(['u2']);
    // Delete then write again before the flush: the doc exists.
    store.col('users').delete('u2'); store.col('users').put({ id: 'u2', back: true });
    await store.flush();
    expect(await rows()).toEqual([{ col: 'users', id: 'u2', data: { id: 'u2', back: true } }]);
  });

  it('coalesces a burst of writes to one doc into one statement', async () => {
    const { store, driver } = await fresh();
    const t = store.col('tables').put({ id: 't1', move: 0 });
    for (let i = 1; i <= 200; i++) { t.move = i; store.col('tables').put(t); }
    store.col('users').put({ id: 'u1' });
    expect(driver.pending.size).toBe(2);
    await store.flush();
    expect(seen).toEqual(['insert into', 'insert into']);
    expect((await rows()).find((r) => r.col === 'tables').data.move).toBe(200);
    // Write then delete before the flush is one delete and no insert.
    seen.length = 0;
    store.col('users').put({ id: 'gone', v: 1 }); store.col('users').put({ id: 'gone', v: 2 }); store.col('users').delete('gone');
    await store.flush();
    expect(seen).toEqual(['delete from']);
    expect((await rows()).some((r) => r.id === 'gone')).toBe(false);
    // Nothing pending: no statements at all.
    seen.length = 0;
    await store.flush();
    expect(seen).toEqual([]);
  });

  it('the timer drains the queue without anyone calling flush', async () => {
    const { store } = await fresh({ flushMs: 10 });
    store.col('users').put({ id: 'u1' });
    expect(await rows()).toEqual([]);
    expect(await until(async () => (await rows()).length === 1)).toBe(true);
    expect((await rows()).map((r) => r.id)).toEqual(['u1']);
  });

  it('reloads everything into a fresh store, exactly', async () => {
    const { store } = await fresh();
    const docs = {
      users: [{ id: 'u1', name: 'Ada \u{1F98A}', email: "o'brien@example.com", nested: { deep: [1, 2, { x: null }] }, flag: false, zero: 0, empty: '' }, { id: 'a:b"c\\d', note: 'odd id' }],
      tables: [{ id: 't1', players: ['u1'], seats: null, settings: { size: 2 } }],
      bgio_state: [{ id: 't1', state: { G: { board: [null, 0, 1] }, ctx: { turn: 1 }, _stateID: 3 } }],
    };
    for (const [col, list] of Object.entries(docs)) for (const d of list) store.col(col).put(d);
    await store.close();
    const again = new Store(new PostgresDriver(query));
    expect(await again.load()).toBe(4);
    for (const [col, list] of Object.entries(docs)) {
      expect(again.col(col).size).toBe(list.length);
      for (const d of list) expect(again.col(col).get(d.id)).toEqual(d);
    }
    expect(typeof again.col('users').get('u1')).toBe('object'); // jsonb comes back as an object, not a string
  });

  it('a failed write is retried and nothing queued behind it is lost', async () => {
    const errors = [];
    const { store } = await fresh({ onError: (e) => errors.push(e.message) });
    for (let i = 1; i <= 5; i++) store.col('users').put({ id: `u${i}` });
    store.col('users').delete('u9');
    let failures = 2;
    failNext = (sql) => /^insert/i.test(sql.trim()) && failures-- > 0; // the connection drops twice
    await store.flush();
    failNext = null;
    expect(errors).toEqual(['connection reset', 'connection reset']);
    expect((await rows()).map((r) => r.id)).toEqual(['u1', 'u2', 'u3', 'u4', 'u5']);
  });

  it('after a failure, a newer write to the same doc is the one that lands', async () => {
    const { store, driver } = await fresh();
    const u = store.col('users').put({ id: 'u1', v: 'old' });
    let first = true;
    failNext = () => { if (!first) return false; first = false; store.col('users').put({ ...u, v: 'new' }); return true; };
    await driver.drain();
    failNext = null;
    await store.flush();
    expect(await rows()).toEqual([{ col: 'users', id: 'u1', data: { id: 'u1', v: 'new' } }]);
  });

  it('one doc Postgres keeps refusing does not hold up the others, and is still queued', async () => {
    const errors = [];
    const { store, driver } = await fresh({ onError: (e) => errors.push(e.message) });
    store.col('users').put({ id: 'bad' });
    store.col('users').put({ id: 'good1' }); store.col('users').put({ id: 'good2' });
    failNext = (sql, params) => params && params[1] === 'bad';
    await store.flush();
    expect((await rows()).map((r) => r.id)).toEqual(['good1', 'good2']);
    expect(driver.pending.size).toBe(1); // not dropped: it goes through when the database takes it
    expect(errors.length).toBeGreaterThan(0);
    failNext = null;
    await store.flush();
    expect((await rows()).map((r) => r.id)).toEqual(['bad', 'good1', 'good2']);
    if (driver.timer) { clearTimeout(driver.timer); driver.timer = null; }
  });

  it('a NUL character in a member\'s text does not make their whole document unsaveable', async () => {
    // jsonb cannot hold \u0000: before, one such character meant the doc failed on every retry, forever.
    const { store } = await fresh();
    store.col('reports').put({ id: 'r1', body: 'nul \u0000 byte', literal: 'the text \\u0000 typed out', mixed: 'slash \\\u0000 nul', twice: '\u0000\u0000x' });
    await store.flush();
    expect(await rows()).toEqual([{ col: 'reports', id: 'r1', data: { id: 'r1', body: 'nul  byte', literal: 'the text \\u0000 typed out', mixed: 'slash \\ nul', twice: 'x' } }]);
  });

  it('overlapping drains never write an older version over a newer one', async () => {
    const { store, driver } = await fresh();
    const d = store.col('tables').put({ id: 't', v: 1 });
    const a = driver.drain();
    d.v = 2; store.col('tables').put(d);
    const b = driver.drain();
    d.v = 3; store.col('tables').put(d);
    const c = driver.drain();
    await Promise.all([a, b, c]);
    await store.flush();
    expect((await rows())[0].data.v).toBe(3);
  });
});

describe('ArenaStorage (boardgame.io storage)', () => {
  // A game with hidden information, to see what a sync would hand out.
  const secretGame = defineGame({
    name: 'secret-test', minPlayers: 2, maxPlayers: 2, secret: true,
    setup: () => ({ turnP: '0', secret: { deck: ['DECK-MARKER'] }, players: { 0: { hand: ['HAND-ZERO'] }, 1: { hand: ['HAND-ONE'] } }, counts: [1, 1] }),
    moves: { pass: ({ G, playerID }) => { if (refuse(G, playerID)) return INVALID_MOVE; G.turnP = String(1 - Number(playerID)); return undefined; } },
  });
  const state0 = { G: { board: [], secret: 'S' }, ctx: { turn: 1 }, plugins: { random: { data: { prngstate: 'SEED' } } }, _stateID: 0, _undo: [1], _redo: [2], deltalog: [{ a: 1 }] };
  const meta0 = { gameName: 'x', players: { 0: { id: 0, credentials: 'c0' }, 1: { id: 1, credentials: 'c1' } } };

  it('stores only matches the arena created', async () => {
    const store = new Store(new MemoryDriver());
    const db = new ArenaStorage(store);
    await db.connect();
    await db.createMatch('rogue', { initialState: state0, metadata: meta0 });
    await db.setState('rogue', state0, []);
    await db.setMetadata('rogue', meta0);
    expect(store.col('bgio_state').size).toBe(0);
    expect(store.col('bgio_meta').size).toBe(0);
    expect(await db.fetch('rogue', { state: true, metadata: true, log: true, initialState: true })).toEqual({ state: undefined, metadata: undefined, log: [], initialState: undefined });
    expect(await db.listMatches()).toEqual([]);
    expect(db.peek('rogue')).toBeUndefined();

    await db.createArenaMatch('ours', { initialState: state0, metadata: meta0 });
    expect(await db.listMatches()).toEqual(['ours']);
    expect(db.peek('ours')).toBe(state0);
    const next = { ...state0, _stateID: 1 };
    await db.setState('ours', next, [{ move: 1 }]);
    expect(db.peek('ours')._stateID).toBe(1);
    await db.setMetadata('ours', { ...meta0, updatedAt: 5 });
    expect((await db.fetch('ours', { metadata: true })).metadata.updatedAt).toBe(5);
  });

  it('a socket syncing to an unknown match id creates nothing (real boardgame.io Master)', async () => {
    const store = new Store(new MemoryDriver());
    const db = new ArenaStorage(store);
    const sent = [];
    const master = new Master(fourInARow, db, { send: (p) => sent.push(p), sendAll: () => {} });
    for (let i = 0; i < 25; i++) await master.onSync(`junk-${i}`, null, undefined, 2);
    expect(store.col('bgio_state').size).toBe(0);
    expect(store.col('bgio_meta').size).toBe(0);
    expect(await db.listMatches()).toEqual([]);
    // And a move on one of them goes nowhere.
    await master.onUpdate({ type: 'MAKE_MOVE', payload: { type: 'drop', args: [0], playerID: '0' } }, 0, 'junk-1', '0');
    expect(store.col('bgio_state').size).toBe(0);
  });

  it('never returns a real initialState: G is empty, the PRNG state and undo stacks are gone', async () => {
    const db = new ArenaStorage(new Store(new MemoryDriver()));
    await db.createArenaMatch('m', { initialState: state0, metadata: meta0 });
    const out = await db.fetch('m', { state: true, initialState: true, log: true, metadata: true });
    expect(out.state).toBe(state0);
    expect(out.initialState.G).toEqual({});
    expect(out.initialState.plugins).toEqual({});
    expect(out.initialState._undo).toEqual([]);
    expect(out.initialState._redo).toEqual([]);
    expect(out.initialState.deltalog).toEqual([]);
    expect(JSON.stringify(out.initialState)).not.toContain('SEED');
    expect(out.log).toEqual([]);
    expect(Object.keys(await db.fetch('m', {}))).toEqual([]);
    expect(Object.keys(await db.fetch('m', { state: true }))).toEqual(['state']);
    expect(state0.G).toEqual({ board: [], secret: 'S' }); // the stored state itself is untouched
  });

  it('what a sync sends as initialState holds no hand, no deck and no seed, at the start and after moves', async () => {
    const store = new Store(new MemoryDriver());
    const db = new ArenaStorage(store);
    const sent = [];
    const master = new Master(secretGame, db, { send: (p) => sent.push(p), sendAll: () => {} });
    const { InitializeGame, ProcessGameConfig } = await import('boardgame.io/internal');
    const initialState = InitializeGame({ game: ProcessGameConfig(secretGame), numPlayers: 2, setupData: {} });
    expect(JSON.stringify(initialState)).toContain('HAND-ONE'); // the thing being protected is really there
    await db.createArenaMatch('m', { initialState, metadata: { gameName: 'secret-test', players: { 0: { id: 0 }, 1: { id: 1 } } } });
    await master.onSync('m', '0', undefined, 2);
    await master.onUpdate({ type: 'MAKE_MOVE', payload: { type: 'pass', args: [], playerID: '0' } }, 0, 'm', '0');
    expect(db.peek('m')._stateID).toBe(1);
    await master.onSync('m', null, undefined, 2);
    const syncs = sent.filter((p) => p.type === 'sync');
    expect(syncs).toHaveLength(2);
    for (const s of syncs) {
      const init = JSON.stringify(s.args[1].initialState);
      for (const marker of ['HAND-ZERO', 'HAND-ONE', 'DECK-MARKER', 'prngstate']) expect(init).not.toContain(marker);
      expect(s.args[1].initialState.G).toEqual({});
      expect(s.args[1].log).toEqual([]);
    }
    // No credentials in what is sent either.
    expect(JSON.stringify(syncs)).not.toContain('credentials');
  });

  it('tells listeners about every state change, and one broken listener does not silence the rest', async () => {
    const db = new ArenaStorage(new Store(new MemoryDriver()));
    const got = [];
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    db.onState(() => { throw new Error('listener bug'); });
    db.onState((id, state, deltalog) => got.push([id, state._stateID, deltalog]));
    await db.createArenaMatch('m', { initialState: state0, metadata: meta0 });
    await db.setState('m', { ...state0, _stateID: 1 }, [{ action: { payload: { playerID: '0' } } }]);
    await db.setState('m', { ...state0, _stateID: 2 });
    await db.setState('rogue', { ...state0, _stateID: 9 }, []);
    expect(got).toEqual([['m', 0, []], ['m', 1, [{ action: { payload: { playerID: '0' } } }]], ['m', 2, []]]);
    expect(quiet).toHaveBeenCalledTimes(3);
    quiet.mockRestore();
  });

  it('wipe removes the match and stops further writes to it', async () => {
    const store = new Store(new MemoryDriver());
    const db = new ArenaStorage(store);
    await db.createArenaMatch('m', { initialState: state0, metadata: meta0 });
    await db.wipe('m');
    expect(store.col('bgio_state').size).toBe(0);
    expect(store.col('bgio_meta').size).toBe(0);
    await db.setState('m', state0, []);
    expect(db.peek('m')).toBeUndefined();
    await db.wipe('m'); // twice is fine
  });

  it('after a restart, matches loaded from the database are still the arena\'s', async () => {
    const file = path.join(tmp, 'bgio.json');
    const s1 = new Store(new FileDriver(file));
    const db1 = new ArenaStorage(s1);
    await db1.createArenaMatch('m', { initialState: state0, metadata: meta0 });
    await s1.close();
    const s2 = new Store(new FileDriver(file));
    await s2.load();
    const db2 = new ArenaStorage(s2);
    expect(db2.peek('m')._stateID).toBe(0);
    await db2.setState('m', { ...state0, _stateID: 1 }, []);
    expect(db2.peek('m')._stateID).toBe(1);
    await db2.setState('other', state0, []);
    expect(db2.peek('other')).toBeUndefined();
  });

  it('createBgio: every seat, bots included, gets its own credentials; moves are validated and serialised', async () => {
    const store = new Store(new MemoryDriver());
    const bgio = createBgio({ store });
    const { credentials, house } = await bgio.createMatch('t1', 'fourinarow', 2, { arena: true }, ['Ada', 'Bot']);
    expect(credentials).toHaveLength(2);
    expect(new Set(credentials).size).toBe(2);
    for (const c of credentials) expect(c).toMatch(/^[A-Za-z0-9_-]{24}$/);
    expect(house).toBe(null);
    const meta = store.col('bgio_meta').get('t1').metadata;
    expect(Object.values(meta.players).map((p) => [p.name, p.credentials])).toEqual([['Ada', credentials[0]], ['Bot', credentials[1]]]);
    expect(meta.unlisted).toBe(true);
    // Out of turn is refused; ten moves fired at once are applied one after another.
    expect(await bgio.submit('t1', 'fourinarow', 1, 'drop', [0])).toBe(false);
    const results = await Promise.all([0, 1, 0, 1, 0, 1].map((seat, i) => bgio.submit('t1', 'fourinarow', seat, 'drop', [i])));
    expect(results).toEqual([true, true, true, true, true, true]);
    expect(bgio.state('t1')._stateID).toBe(6);
    expect(await bgio.submit('nope', 'fourinarow', 0, 'drop', [0])).toBe(false);
    const fresh = await bgio.revokeSeat('t1', 1);
    expect(fresh).not.toBe(credentials[1]);
    expect(store.col('bgio_meta').get('t1').metadata.players[1].credentials).toBe(fresh);
    expect(store.col('bgio_meta').get('t1').metadata.players[0].credentials).toBe(credentials[0]);
    expect(await bgio.revokeSeat('nope', 0)).toBe(null);
    await bgio.wipe('t1');
    expect(bgio.state('t1')).toBeUndefined();
  });
});
