// Postgres driver. One table, one row per document:
//
//   va_docs (col text, id text, data jsonb, updated_at timestamptz, primary key (col, id))
//
// The server keeps the working set in memory (see index.js) and this driver
// makes it durable: writes are queued, coalesced per document and applied in
// order by a single worker, so a burst of game moves becomes one upsert per
// table rather than one per move. Works with any Postgres, Supabase included
// (use the connection string from Project Settings > Database).
//
// The driver takes a `query(sql, params)` function instead of a client so the
// tests can run it against an in-process Postgres (tests/store.test.js).

const TABLE_SQL = (table) => `
create table if not exists ${table} (
  col text not null,
  id text not null,
  data jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (col, id)
);
create index if not exists va_docs_col_updated on ${table} (col, updated_at desc);
`;
export const SCHEMA_SQL = TABLE_SQL('va_docs');

/**
 * DATABASE_SCHEMA puts the table in a schema of its own, so this server can
 * live in a database that another application already uses (a Supabase
 * project with its own tables) and never see or touch that application's
 * tables. The name goes into SQL text, so it is a plain lower-case identifier
 * or it is refused.
 */
export function checkSchemaName(name) {
  if (name === undefined || name === null || name === '') return '';
  if (typeof name !== 'string' || !/^[a-z_][a-z0-9_]{0,62}$/.test(name) || /^pg_/.test(name) || name === 'information_schema') {
    throw new Error(`DATABASE_SCHEMA must be a plain name like "arena2" (lower-case letters, digits, underscore), got ${JSON.stringify(name)}`);
  }
  return name;
}

export class PostgresDriver {
  constructor(query, { schema = '', flushMs = 400, onError = (e) => console.error('[store] postgres write failed:', e.message) } = {}) {
    this.kind = 'postgres';
    this.query = query;
    this.schema = checkSchemaName(schema);
    this.table = this.schema ? `${this.schema}.va_docs` : 'va_docs';
    this.flushMs = flushMs;
    this.onError = onError;
    this.pending = new Map(); // "col\u0000id" -> { col, id, data | undefined (delete) }
    this.timer = null;
    this.running = null;
  }
  async loadAll() {
    if (this.schema) {
      // Look before creating: a login that is only allowed inside its own
      // schema may not create schemas, and "create schema if not exists"
      // checks that permission before it checks whether the schema is there.
      const have = await this.query('select 1 from pg_namespace where nspname = $1', [this.schema]);
      if (have.rows.length === 0) await this.query(`create schema ${this.schema}`);
    }
    for (const stmt of TABLE_SQL(this.table).split(';').map((s) => s.trim()).filter(Boolean)) await this.query(stmt);
    // Row level security on, no policies: the table's owner (this server)
    // is unaffected, everyone else is refused. On Supabase a table in the
    // default schema is otherwise served over HTTP to anyone holding the
    // site's public key, and this one holds password hashes and sessions.
    try { await this.query(`alter table ${this.table} enable row level security`); } catch (e) {
      console.error(`[store] could not turn on row level security for ${this.table}: ${e.message}`);
    }
    const res = await this.query(`select col, id, data from ${this.table}`);
    return res.rows.map((r) => ({ col: r.col, id: r.id, data: typeof r.data === 'string' ? JSON.parse(r.data) : r.data }));
  }
  write(col, id, data) { this.pending.set(`${col}\u0000${id}`, { col, id, data }); this.schedule(); }
  remove(col, id) { this.pending.set(`${col}\u0000${id}`, { col, id, data: undefined }); this.schedule(); }
  schedule(delay = this.flushMs) {
    if (this.timer) return;
    this.timer = setTimeout(() => { this.timer = null; this.drain().catch(this.onError); }, delay);
    if (this.timer.unref) this.timer.unref();
  }
  /** jsonb cannot hold \u0000. Drop it (and only it: an escaped backslash before "u0000" is left alone). */
  static encode(data) {
    const json = JSON.stringify(data);
    return json.includes('\\u0000') ? json.replace(/(?<=(?:^|[^\\])(?:\\\\)*)\\u0000/g, '') : json;
  }
  async apply(op) {
    if (op.data === undefined) {
      await this.query(`delete from ${this.table} where col = $1 and id = $2`, [op.col, op.id]);
    } else {
      await this.query(
        `insert into ${this.table} (col, id, data, updated_at) values ($1, $2, $3::jsonb, now()) on conflict (col, id) do update set data = excluded.data, updated_at = now()`,
        [op.col, op.id, PostgresDriver.encode(op.data)],
      );
    }
  }
  async drain() {
    // One worker at a time, however many callers were waiting: re-check
    // after every wait rather than waiting once.
    while (this.running) await this.running;
    if (this.pending.size === 0) return;
    const batch = [...this.pending.values()];
    this.pending.clear();
    // Put an op back unless something newer for the same doc is already queued.
    const requeue = (op) => { const key = `${op.col}\u0000${op.id}`; if (!this.pending.has(key)) this.pending.set(key, op); };
    this.running = (async () => {
      let failed = false; let streak = 0;
      for (let i = 0; i < batch.length; i++) {
        try {
          await this.apply(batch[i]);
          streak = 0;
        } catch (e) {
          // A dropped connection must not lose a write. (Bug: only the op
          // that failed was put back; the loop then stopped and every op
          // behind it in the batch was silently dropped. One failed upsert
          // during a burst lost the rest of the burst for good.)
          failed = true; streak += 1;
          requeue(batch[i]);
          this.onError(e);
          // Two in a row is the connection, not the document: stop hammering
          // it, keep everything, and come back later. One on its own is that
          // document; the rest of the batch still goes through.
          if (streak >= 2) { for (const rest of batch.slice(i + 1)) requeue(rest); break; }
        }
      }
      if (failed) { this.retryMs = Math.min((this.retryMs || this.flushMs) * 2, 30000); this.schedule(this.retryMs); } else this.retryMs = 0;
    })();
    try { await this.running; } finally { this.running = null; }
  }
  async flush() {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    let guard = 0;
    while ((this.pending.size > 0 || this.running) && guard++ < 5) await this.drain();
  }
}

/** Build a query function from a connection string using `pg`. */
export async function pgQueryFromUrl(url) {
  const pg = await import('pg');
  const Pool = pg.default ? pg.default.Pool : pg.Pool;
  // Hosted Postgres reached over the internet (Supabase, a host's "external"
  // address) requires TLS; a local one, or a host's private-network address,
  // may not offer it at all. Ask for TLS unless the address is local or the
  // URL says sslmode=disable, and if the server answers that it has none,
  // connect without. (A wrong guess here is a server that never starts.)
  const local = /localhost|127\.0\.0\.1/.test(url) || /[?&]sslmode=disable\b/.test(url);
  const make = (ssl) => {
    const pool = new Pool({ connectionString: url, max: 4, ssl: ssl ? { rejectUnauthorized: false } : undefined });
    pool.on('error', (e) => console.error('[store] postgres pool error:', e.message));
    return pool;
  };
  let pool = make(!local);
  if (!local) {
    try { await pool.query('select 1'); } catch (e) {
      if (!/does not support SSL/i.test(String(e && e.message))) { await pool.end().catch(() => {}); throw e; }
      await pool.end().catch(() => {});
      console.log('[store] this Postgres does not offer TLS (a private-network address): connecting without it');
      pool = make(false);
    }
  }
  const query = (sql, params) => pool.query(sql, params);
  query.end = () => pool.end();
  return query;
}
