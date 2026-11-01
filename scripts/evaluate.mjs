// Search-quality benchmark: lexical vs semantic vs hybrid on labelled queries (eval/queries.json).
// Metrics @10: Precision, Recall, MRR, nDCG (graded: 2 = concept in title, 1 = concept elsewhere in text).
// Results are written to eval_runs and shown on /admin/search-quality.
import fs from 'node:fs';
import pg from 'pg';
import { embed, toPgVector, EMBEDDING_MODEL } from '../src/lib/embedding.mjs';

const K = 10;
const MODES = ['lexical', 'semantic', 'hybrid'];
// usage: node scripts/evaluate.mjs [--file eval/holdout.json --set holdout] [--variant rrf-adaptive]
const arg = (name, dflt) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : dflt; };
const FILE = arg('file', 'eval/queries.json');
const SET = arg('set', 'main');
const VARIANT = arg('variant', 'current');
const { queries } = JSON.parse(fs.readFileSync(FILE, 'utf8'));
const db = new pg.Client({ connectionString: process.env.OWNER_DATABASE_URL });
await db.connect();

// 1. Ground-truth labels, computed in SQL from the catalog (independent of the retrieval code)
const labels = new Map();
for (const { q, category, concept } of queries) {
  const { rows } = await db.query(
    `SELECT p.product_id,
            CASE WHEN p.title ~* $2 THEN 2 ELSE 1 END AS grade
       FROM products p
      WHERE p.is_active
        AND p.category_id IN (SELECT category_descendants((SELECT category_id FROM categories WHERE name = $1 AND parent_id IS NULL)))
        AND (p.title || ' ' || p.features || ' ' || p.description) ~* $2`, [category, concept]);
  labels.set(q, new Map(rows.map((r) => [r.product_id, r.grade])));
}

// 2. Embed all queries once (timed separately from SQL so latency is reported honestly)
const t0 = performance.now();
const vectors = await embed(queries.map((x) => x.q));
const embedMs = (performance.now() - t0) / queries.length;

const dcg = (grades) => grades.reduce((s, g, i) => s + (2 ** g - 1) / Math.log2(i + 2), 0);

const results = {};
for (const mode of MODES) {
  const perQuery = [];
  let sqlTotal = 0;
  for (const [i, { q, type }] of queries.entries()) {
    const rel = labels.get(q);
    const t1 = performance.now();
    const { rows } = await db.query(
      'SELECT product_id FROM search_products($1, $2::vector, $3::search_mode, $4)',
      [q, toPgVector(vectors[i]), mode, K]);
    sqlTotal += performance.now() - t1;

    const ranked = rows.map((r) => r.product_id);
    const grades = ranked.map((id) => rel.get(id) ?? 0);
    const hits = grades.filter((g) => g > 0).length;
    const ideal = [...rel.values()].sort((a, b) => b - a).slice(0, K);
    const firstHit = grades.findIndex((g) => g > 0);
    perQuery.push({
      query: q, type, relevant: rel.size,
      p: hits / K,
      recall: rel.size ? hits / Math.min(rel.size, K) : 0,   // recall@K capped by what could fit in K
      rr: firstHit >= 0 ? 1 / (firstHit + 1) : 0,
      ndcg: ideal.length ? dcg(grades) / dcg(ideal) : 0,
    });
  }
  const mean = (f, rows = perQuery) => rows.reduce((s, r) => s + f(r), 0) / (rows.length || 1);
  const byType = {};
  for (const t of ['natural_language', 'exact']) {
    const rows = perQuery.filter((r) => r.type === t);
    byType[t] = { n: rows.length, ndcg: mean((r) => r.ndcg, rows), p: mean((r) => r.p, rows), mrr: mean((r) => r.rr, rows) };
  }
  // lexical never needs the query vector, so its latency excludes the embedding step
  const latency = sqlTotal / queries.length + (mode === 'lexical' ? 0 : embedMs);
  results[mode] = {
    p: mean((r) => r.p), recall: mean((r) => r.recall), mrr: mean((r) => r.rr), ndcg: mean((r) => r.ndcg),
    latency, perQuery, byType,
  };
  await db.query(
    `INSERT INTO eval_runs (mode, model, k, query_count, precision_at_k, recall_at_k, mrr, ndcg_at_k, avg_latency_ms, details)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [mode, EMBEDDING_MODEL, K, queries.length, results[mode].p.toFixed(4), results[mode].recall.toFixed(4),
     results[mode].mrr.toFixed(4), results[mode].ndcg.toFixed(4), latency.toFixed(2),
     JSON.stringify({ set: SET, variant: VARIANT, perQuery: perQuery.map((r) => ({ ...r, p: +r.p.toFixed(3), rr: +r.rr.toFixed(3), ndcg: +r.ndcg.toFixed(3) })), byType })]);
}

console.log(`\nSearch quality @${K} over ${queries.length} labelled queries · set=${SET} · variant=${VARIANT} (model ${EMBEDDING_MODEL})\n`);
console.log('mode      nDCG    P@10    Recall  MRR     latency  | nDCG natural  nDCG exact');
for (const m of MODES) {
  const r = results[m];
  console.log(`${m.padEnd(9)} ${r.ndcg.toFixed(3)}   ${r.p.toFixed(3)}   ${r.recall.toFixed(3)}   ${r.mrr.toFixed(3)}   ${r.latency.toFixed(0).padStart(4)} ms  | ${r.byType.natural_language.ndcg.toFixed(3)}         ${r.byType.exact.ndcg.toFixed(3)}`);
}
await db.end();
