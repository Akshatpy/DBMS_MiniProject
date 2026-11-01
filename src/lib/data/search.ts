import 'server-only';
import { withUser } from '../db';
import type { Session } from '../session';
import { embedOne, toPgVector } from '../embedding.mjs';
import type { SearchHit, SearchParams } from './types';

export interface SearchResult {
  hits: SearchHit[];
  timings: { embedMs: number; sqlMs: number };
}

export async function searchProducts(session: Session | null, p: SearchParams): Promise<SearchResult> {
  const q = p.q.trim().slice(0, 500);
  const t0 = performance.now();
  // lexical mode never needs the vector, so skip the model entirely
  const embedding = p.mode === 'lexical' ? null : toPgVector(await embedOne(q));
  const embedMs = performance.now() - t0;

  return withUser(session, async (c) => {
    const t1 = performance.now();
    const { rows } = await c.query<SearchHit>(
      `SELECT s.score, s.lexical_rank, s.semantic_rank, s.review_rank, s.semantic_similarity,
              s.matched_review_id, s.matched_review_similarity,
              r.body AS matched_review_body, r.rating AS matched_review_rating,
              p.*
         FROM search_products($1, $2::vector, $3::search_mode, $4, $5, $6, $7, $8, $9) s
         JOIN v_product_cards p USING (product_id)
         LEFT JOIN reviews r ON r.review_id = s.matched_review_id
        ORDER BY s.score DESC, s.product_id`,
      [q, embedding, p.mode, p.limit ?? 24, p.categoryId ?? null, p.minPrice ?? null,
       p.maxPrice ?? null, p.minRating ?? null, p.inStock ?? false]);
    const sqlMs = performance.now() - t1;

    await c.query(
      `INSERT INTO search_logs (user_id, query, mode, filters, result_count, latency_ms)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [session?.uid ?? null, q, p.mode,
       JSON.stringify({ categoryId: p.categoryId, minPrice: p.minPrice, maxPrice: p.maxPrice,
                        minRating: p.minRating, inStock: p.inStock }),
       rows.length, Math.round((embedMs + sqlMs) * 100) / 100]);
    return { hits: rows, timings: { embedMs, sqlMs } };
  });
}

/** Typo-tolerant title suggestions using pg_trgm similarity */
export async function suggestTitles(q: string) {
  return withUser(null, async (c) => {
    const { rows } = await c.query<{ product_id: number; title: string; sim: number }>(
      `SELECT product_id, title, similarity(title, $1) AS sim
         FROM products
        WHERE is_active AND title % $1
        ORDER BY sim DESC
        LIMIT 6`, [q]);
    return rows;
  });
}
