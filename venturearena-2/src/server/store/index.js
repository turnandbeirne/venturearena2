// ============================================================================
// Storage: one in-process working set, optionally written through to a durable
// backend.
// ----------------------------------------------------------------------------
// Live game state lives in this process (that is why the site runs as exactly
// ONE replica; see README "Deploying"). So the design is deliberately simple:
// every collection is a Map in memory, reads are synchronous, and a driver
// decides what happens to writes:
//
//   memory    nothing is kept across restarts (development, tests)
//   file      the whole working set is snapshotted to one JSON file
//   postgres  each write is queued and upserted into one table
//
// On boot the driver loads what it has into the Maps. Nothing else in the
// server knows which driver is in use.
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';

export class Collection {
  constructor(name, driver) {
    this.name = name;
    this.driver = driver;
    this.docs = new Map();
  }
  get(id) { return id === null || id === undefined ? undefined : this.docs.get(String(id)); }
  has(id) { return this.docs.has(String(id)); }
  /** Insert or replace. The doc must carry an `id`. Returns the doc. */
  put(doc) {
    if (!doc || doc.id === undefined || doc.id === null) throw new Error(`${this.name}: put() needs an id`);
    this.docs.set(String(doc.id), doc);
    this.driver.write(this.name, String(doc.id), doc);
    return doc;
  }
  /** Re-persist a doc that was mutated in place. */
  touch(doc) { return this.put(doc); }
  delete(id) {
    if (!this.docs.delete(String(id))) return false;
    this.driver.remove(this.name, String(id));
    return true;
  }
  all() { return [...this.docs.values()]; }
  filter(fn) { const out = []; for (const d of this.docs.values()) if (fn(d)) out.push(d); return out; }
  find(fn) { for (const d of this.docs.values()) if (fn(d)) return d; return undefined; }
  count(fn) { if (!fn) return this.docs.size; let n = 0; for (const d of this.docs.values()) if (fn(d)) n++; return n; }
  get size() { return this.docs.size; }
}

export class Store {
  constructor(driver) {
    this.driver = driver;
    this.cols = new Map();
  }
  col(name) {
    let c = this.cols.get(name);
    if (!c) { c = new Collection(name, this.driver); this.cols.set(name, c); }
    return c;
  }
  /** Load everything the driver has. Call once at boot. */
  async load() {
    const rows = await this.driver.loadAll();
    for (const { col, id, data } of rows) this.col(col).docs.set(String(id), data);
    return rows.length;
  }
  /** Wait until every queued write has reached the backend. */
  async flush() { await this.driver.flush(); }
  async close() { await this.driver.flush(); if (this.driver.close) await this.driver.close(); }
}

// ---- drivers ---------------------------------------------------------------

export class MemoryDriver {
  constructor() { this.kind = 'memory'; }
  async loadAll() { return []; }
  write() {}
  remove() {}
  async flush() {}
}

/**
 * Snapshot driver: fine for one small box with a disk. Writes are debounced
 * and atomic (write to a temp file, then rename), so a crash mid-write never
 * leaves a half-written file behind.
 */
export class FileDriver {
  constructor(file, { debounceMs = 1500 } = {}) {
    this.kind = 'file';
    this.file = file;
    this.debounceMs = debounceMs;
    this.data = new Map(); // col -> Map(id -> data)
    this.timer = null;
    this.dirty = false;
    this.retryMs = debounceMs;
  }
  async loadAll() {
    if (!fs.existsSync(this.file)) return [];
    const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    const rows = [];
    for (const [col, docs] of Object.entries(raw)) {
      const m = new Map();
      for (const [id, data] of Object.entries(docs)) { m.set(id, data); rows.push({ col, id, data }); }
      this.data.set(col, m);
    }
    return rows;
  }
  bucket(col) { let m = this.data.get(col); if (!m) { m = new Map(); this.data.set(col, m); } return m; }
  write(col, id, data) { this.bucket(col).set(id, data); this.schedule(); }
  remove(col, id) { this.bucket(col).delete(id); this.schedule(); }
  schedule(delay = this.debounceMs) {
    this.dirty = true;
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      // (Bug: save() ran bare in this timer, so a full disk was an uncaught
      // exception and took the whole server, every live table included,
      // down with it.) Log it, keep the data in memory, try again later.
      try { this.save(); } catch (e) {
        console.error('[store] snapshot failed, will retry:', e.message);
        this.retryMs = Math.min(this.retryMs * 2, 30000);
        this.schedule(this.retryMs);
      }
    }, delay);
    if (this.timer.unref) this.timer.unref();
  }
  save() {
    if (!this.dirty) return;
    const out = {};
    for (const [col, m] of this.data) out[col] = Object.fromEntries(m);
    fs.mkdirSync(path.dirname(path.resolve(this.file)), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(out));
    fs.renameSync(tmp, this.file);
    // Clean only once the snapshot is on disk. (Bug: `dirty` was cleared
    // before the write, so a save that failed was forgotten: nothing was
    // written again until some later change, and a shutdown flush after a
    // failed save wrote nothing at all.)
    this.dirty = false;
    this.retryMs = this.debounceMs;
  }
  async flush() { if (this.timer) { clearTimeout(this.timer); this.timer = null; } this.save(); }
}

export async function createStore(config = {}) {
  let driver;
  if (config.databaseUrl) {
    const { PostgresDriver, pgQueryFromUrl } = await import('./postgres.js');
    driver = new PostgresDriver(await pgQueryFromUrl(config.databaseUrl), { schema: config.databaseSchema || '' });
  } else if (config.dataFile) {
    driver = new FileDriver(config.dataFile);
  } else {
    driver = new MemoryDriver();
  }
  const store = new Store(driver);
  const loaded = await store.load();
  return { store, loaded, kind: driver.kind };
}
