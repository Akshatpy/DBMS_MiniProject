import { NextResponse } from 'next/server';
import { z } from 'zod';
import { withUser } from '@/lib/db';
import { handler, requireRole } from '@/lib/auth';
import { embedOne, toPgVector } from '@/lib/embedding.mjs';

// Canned queries for the "query plans" panel: each runs EXPLAIN (ANALYZE, BUFFERS) with and
// without its index so the effect of B-tree, GIN and HNSW indexes is visible.
const PLANS = {
  vector_hnsw: {
    label: 'Vector KNN — HNSW index',
    setup: [] as string[],
    sql: `SELECT product_id FROM product_embeddings ORDER BY embedding <=> $1::vector LIMIT 10`,
    needsVector: true,
  },
  vector_exact: {
    label: 'Vector KNN — exact scan (index disabled)',
    setup: ['SET LOCAL enable_indexscan = off'],
    sql: `SELECT product_id FROM product_embeddings ORDER BY embedding <=> $1::vector LIMIT 10`,
    needsVector: true,
  },
  fts_gin: {
    label: 'Full-text search — GIN index',
    setup: [],
    sql: `SELECT product_id, ts_rank_cd(search_tsv, q) AS r FROM products, plainto_tsquery('english', $1) q
           WHERE search_tsv @@ q ORDER BY r DESC LIMIT 10`,
    needsVector: false,
  },
  fts_seq: {
    label: 'Full-text search — sequential scan (index disabled)',
    setup: ['SET LOCAL enable_bitmapscan = off', 'SET LOCAL enable_indexscan = off'],
    sql: `SELECT product_id, ts_rank_cd(search_tsv, q) AS r FROM products, plainto_tsquery('english', $1) q
           WHERE search_tsv @@ q ORDER BY r DESC LIMIT 10`,
    needsVector: false,
  },
  hybrid: {
    label: 'Hybrid search function (RRF)',
    setup: [],
    sql: `SELECT * FROM search_products($2, $1::vector, 'hybrid', 24)`,
    needsVector: true,
  },
} as const;

export const GET = handler(async (req: Request) => {
  const s = await requireRole('admin');
  const p = new URL(req.url).searchParams;
  const key = z.enum(Object.keys(PLANS) as [keyof typeof PLANS]).parse(p.get('plan'));
  const q = (p.get('q') || 'wireless noise cancelling headphones').slice(0, 200);
  const plan = PLANS[key];
  const vec = plan.needsVector ? toPgVector(await embedOne(q)) : null;
  const params = key === 'hybrid' ? [vec, q] : [plan.needsVector ? vec : q];

  const lines = await withUser(s, async (c) => {
    for (const stmt of plan.setup) await c.query(stmt);
    const { rows } = await c.query(`EXPLAIN (ANALYZE, BUFFERS, COSTS OFF) ${plan.sql}`, params);
    return rows.map((r) => r['QUERY PLAN'] as string);
  });
  const exec = lines.find((l) => l.startsWith('Execution Time'));
  return NextResponse.json({ plan: key, label: plan.label, query: q, executionTime: exec, lines });
});
