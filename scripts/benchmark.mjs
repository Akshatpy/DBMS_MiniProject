// Index performance study. Compares, with EXPLAIN (ANALYZE):
//   1. pgvector HNSW vs exact scan   (real vectors, then ~85k scaled-up vectors) incl. recall@10
//   2. full-text GIN index vs sequential scan
//   3. B-tree composite index vs sequential scan on orders
// Writes docs/benchmark-results.md. The scaled-up table lives in its own schema and is dropped afterwards.
import fs from 'node:fs';
import pg from 'pg';
import { toPgVector } from '../src/lib/embedding.mjs';

const db = new pg.Client({ connectionString: process.env.OWNER_DATABASE_URL });
await db.connect();
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
// one shared connection => measurements must run strictly one after another
const repeat = async (n, fn) => { const r = []; for (let i = 0; i < n; i++) r.push(await fn()); return r; };

/** Execution time (ms) of a query via EXPLAIN ANALYZE, optionally with planner settings disabled. */
async function timed(sql, params, noIndex = false) {
  await db.query('BEGIN');
  try {
    if (noIndex) await db.query('SET LOCAL enable_indexscan = off; SET LOCAL enable_bitmapscan = off; SET LOCAL enable_indexonlyscan = off');
    const { rows } = await db.query(`EXPLAIN (ANALYZE, FORMAT JSON) ${sql}`, params);
    const plan = rows[0]['QUERY PLAN'][0];
    return plan['Execution Time'];
  } finally {
    await db.query('ROLLBACK');
  }
}
async function ids(sql, params, { noIndex = false, ef } = {}) {
  await db.query('BEGIN');
  try {
    if (noIndex) await db.query('SET LOCAL enable_indexscan = off; SET LOCAL enable_bitmapscan = off');
    if (ef) await db.query(`SET LOCAL hnsw.ef_search = ${ef}`);
    return (await db.query(sql, params)).rows.map((r) => r.id);
  } finally {
    await db.query('ROLLBACK');
  }
}

const out = [];
const md = (s = '') => { out.push(s); console.log(s); };

async function vectorStudy(label, table, idCol, probes) {
  const { rows: [{ n }] } = await db.query(`SELECT count(*)::int AS n FROM ${table}`);
  const q = `SELECT ${idCol} AS id FROM ${table} ORDER BY embedding <=> $1::vector LIMIT 10`;
  const res = {};
  for (const [name, opts] of [['exact scan', { noIndex: true }], ['HNSW ef_search=40', { ef: 40 }], ['HNSW ef_search=200', { ef: 200 }]]) {
    const times = [];
    let recall = 0;
    // untimed warm-up: the first scan of an index pays for loading its pages into cache
    for (let w = 0; w < 5; w++) {
      await db.query('BEGIN');
      if (opts.noIndex) await db.query('SET LOCAL enable_indexscan = off; SET LOCAL enable_bitmapscan = off');
      if (opts.ef) await db.query(`SET LOCAL hnsw.ef_search = ${opts.ef}`);
      await db.query(q, [probes[w]]);
      await db.query('ROLLBACK');
    }
    for (const v of probes) {
      await db.query('BEGIN');
      if (opts.noIndex) await db.query('SET LOCAL enable_indexscan = off; SET LOCAL enable_bitmapscan = off');
      if (opts.ef) await db.query(`SET LOCAL hnsw.ef_search = ${opts.ef}`);
      const { rows } = await db.query(`EXPLAIN (ANALYZE, FORMAT JSON) ${q}`, [v]);
      times.push(rows[0]['QUERY PLAN'][0]['Execution Time']);
      await db.query('ROLLBACK');
      if (!opts.noIndex) {
        const truth = new Set(await ids(q, [v], { noIndex: true }));
        const got = await ids(q, [v], { ef: opts.ef });
        recall += got.filter((x) => truth.has(x)).length / 10;
      }
    }
    res[name] = { ms: median(times), recall: opts.noIndex ? 1 : recall / probes.length };
  }
  md(`| ${label} | ${n.toLocaleString()} | ${res['exact scan'].ms.toFixed(2)} ms | ${res['HNSW ef_search=40'].ms.toFixed(2)} ms (recall ${res['HNSW ef_search=40'].recall.toFixed(3)}) | ${res['HNSW ef_search=200'].ms.toFixed(2)} ms (recall ${res['HNSW ef_search=200'].recall.toFixed(3)}) |`);
  return res;
}

md('# Index performance study\n');
md(`Run: ${new Date().toISOString()} · PostgreSQL ${(await db.query('SHOW server_version')).rows[0].server_version} · pgvector ${(await db.query(`SELECT extversion FROM pg_extension WHERE extname='vector'`)).rows[0].extversion}`);
md('Medians over 20 queries; every figure is the Execution Time reported by EXPLAIN (ANALYZE).\n');

// ------------------------------------------------------------------ 1. vector search
md('## 1. Vector similarity (top-10 by cosine distance)\n');
md('| Table | Vectors | Exact scan | HNSW (ef_search 40) | HNSW (ef_search 200) |');
md('|---|---|---|---|---|');
const probeRows = (await db.query(`SELECT embedding::text AS v FROM product_embeddings ORDER BY random() LIMIT 20`)).rows;
const probes = probeRows.map((r) => r.v);
await vectorStudy('product_embeddings (real)', 'product_embeddings', 'product_id', probes);
await vectorStudy('review_embeddings (real)', 'review_embeddings', 'review_id', probes);

// Scale-up: perturb every real vector with Gaussian noise (5 noisy copies each) to emulate a larger catalog
await db.query('DROP SCHEMA IF EXISTS bench CASCADE; CREATE SCHEMA bench');
await db.query('CREATE UNLOGGED TABLE bench.vecs (id BIGINT PRIMARY KEY, embedding vector(384) NOT NULL)');
const real = (await db.query(`SELECT embedding::text AS v FROM (SELECT embedding FROM product_embeddings UNION ALL SELECT embedding FROM review_embeddings) t`)).rows;
const gauss = () => Math.sqrt(-2 * Math.log(1 - Math.random())) * Math.cos(2 * Math.PI * Math.random());
const COPIES = 5, NOISE = 0.02;
let nextId = 0, buf = [];
const flush = async () => {
  if (!buf.length) return;
  await db.query('INSERT INTO bench.vecs SELECT * FROM unnest($1::bigint[], $2::vector[])',
    [buf.map((b) => b[0]), buf.map((b) => b[1])]);
  buf = [];
};
for (const { v } of real) {
  const base = JSON.parse(v);
  for (let c = 0; c < COPIES; c++) {
    const noisy = base.map((x) => x + NOISE * gauss());
    const norm = Math.hypot(...noisy);
    buf.push([nextId++, toPgVector(noisy.map((x) => x / norm))]);
    if (buf.length >= 500) await flush();
  }
}
await flush();
const t0 = performance.now();
await db.query(`CREATE INDEX bench_hnsw ON bench.vecs USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64)`);
const buildSec = (performance.now() - t0) / 1000;
await db.query('ANALYZE bench.vecs');
await db.query('SET search_path = bench, public');
await vectorStudy('scaled-up (real + noisy copies)', 'bench.vecs', 'id', probes);
const size = (await db.query(`SELECT pg_size_pretty(pg_relation_size('bench.bench_hnsw')) AS idx, pg_size_pretty(pg_relation_size('bench.vecs')) AS tbl`)).rows[0];
md(`\nHNSW build on the scaled-up set: ${buildSec.toFixed(1)} s · index ${size.idx} vs heap ${size.tbl}.`);
await db.query('RESET search_path');
await db.query('DROP SCHEMA bench CASCADE');

// ------------------------------------------------------------------ 2. full-text search
md('\n## 2. Full-text search (GIN on weighted tsvector)\n');
md('| Query term(s) | Matches | Seq scan | GIN index | Speed-up |');
md('|---|---|---|---|---|');
for (const term of ['headphones', 'dog toy', 'stainless steel', 'waterproof', 'yoga']) {
  const sql = `SELECT product_id FROM products WHERE search_tsv @@ plainto_tsquery('english', $1)`;
  const hits = (await db.query(sql, [term])).rowCount;
  const seq = median(await repeat(5, () => timed(sql, [term], true)));
  const gin = median(await repeat(5, () => timed(sql, [term], false)));
  md(`| ${term} | ${hits} | ${seq.toFixed(2)} ms | ${gin.toFixed(2)} ms | ${(seq / gin).toFixed(1)}× |`);
}

// ------------------------------------------------------------------ 3. B-tree
md('\n## 3. B-tree composite index `orders (user_id, placed_at DESC)`\n');
const heavy = (await db.query(`SELECT user_id FROM orders GROUP BY user_id ORDER BY count(*) DESC LIMIT 1`)).rows[0].user_id;
const ordSql = `SELECT order_id, placed_at, total_amount FROM orders WHERE user_id = $1 ORDER BY placed_at DESC LIMIT 20`;
const seqO = median(await repeat(7, () => timed(ordSql, [heavy], true)));
const idxO = median(await repeat(7, () => timed(ordSql, [heavy], false)));
md('| Query | Seq scan + sort | B-tree index | Speed-up |');
md('|---|---|---|---|');
md(`| latest 20 orders of one customer (${(await db.query('SELECT count(*)::int n FROM orders')).rows[0].n.toLocaleString()} orders) | ${seqO.toFixed(2)} ms | ${idxO.toFixed(2)} ms | ${(seqO / idxO).toFixed(1)}× |`);

md('\n## 4. Materialized view vs live aggregation\n');
const live = `SELECT date_trunc('month', o.placed_at) m, sum(oi.quantity * oi.unit_price) FROM orders o JOIN order_items oi USING (order_id) WHERE o.status <> 'cancelled' GROUP BY 1`;
const mv = `SELECT date_trunc('month', sale_date) m, sum(revenue) FROM mv_daily_sales GROUP BY 1`;
const liveMs = median(await repeat(5, () => timed(live, [])));
const mvMs = median(await repeat(5, () => timed(mv, [])));
md('| Monthly revenue report | Live join + aggregate | Materialized view | Speed-up |');
md('|---|---|---|---|');
md(`| platform-wide | ${liveMs.toFixed(2)} ms | ${mvMs.toFixed(2)} ms | ${(liveMs / mvMs).toFixed(1)}× |`);

fs.mkdirSync('docs', { recursive: true });
fs.writeFileSync('docs/benchmark-results.md', out.join('\n') + '\n');
console.log('\nWrote docs/benchmark-results.md');
await db.end();
