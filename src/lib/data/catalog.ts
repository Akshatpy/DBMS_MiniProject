import 'server-only';
import { withUser } from '../db';
import type { Session } from '../session';
import type { ProductCard } from './types';

export interface ProductDetail extends ProductCard {
  description: string;
  features: string;
  category_path: string;
  reorder_threshold: number;
  created_at: string;
}

export async function getProduct(session: Session | null, id: number) {
  return withUser(session, async (c) => {
    const { rows } = await c.query<ProductDetail>(
      `SELECT v.*, p.description, p.features, p.reorder_threshold, p.created_at,
              category_path(p.category_id) AS category_path
         FROM v_product_cards v JOIN products p USING (product_id)
        WHERE v.product_id = $1`, [id]);
    if (!rows[0]) return null;

    const [reviews, ratingDist, similar, fbt] = await Promise.all([
      c.query(`SELECT review_id, rating, title, body, verified_purchase, helpful_votes, created_at, reviewer_name, user_id
                 FROM v_public_reviews WHERE product_id = $1
                ORDER BY helpful_votes DESC, created_at DESC LIMIT 20`, [id]),
      c.query(`SELECT r.stars, count(rv.review_id)::INT AS n
                 FROM generate_series(5, 1, -1) AS r(stars)
                 LEFT JOIN reviews rv ON rv.product_id = $1 AND rv.rating = r.stars
                GROUP BY r.stars ORDER BY r.stars DESC`, [id]),
      c.query<ProductCard & { similarity: number }>(
        `SELECT v.*, s.similarity FROM similar_products($1, 8) s JOIN v_product_cards v USING (product_id)
          ORDER BY s.similarity DESC`, [id]),
      c.query<ProductCard & { together_count: number; support: number; confidence: number; lift: number }>(
        `SELECT v.*, f.together_count, f.support, f.confidence, f.lift
           FROM frequently_bought_together($1, 4) f JOIN v_product_cards v USING (product_id)
          ORDER BY f.confidence DESC, f.lift DESC`, [id]),
    ]);
    return {
      product: rows[0],
      reviews: reviews.rows,
      ratingDist: ratingDist.rows as { stars: number; n: number }[],
      similar: similar.rows,
      fbt: fbt.rows,
    };
  });
}

export async function getHomeData(session: Session | null) {
  return withUser(session, async (c) => {
    const [cats, trending, deals, recs] = await Promise.all([
      c.query<{ category_id: number; name: string; slug: string; product_count: number }>(
        `SELECT category_id, name, slug, product_count FROM v_category_tree WHERE depth = 0 ORDER BY name`),
      c.query<ProductCard & { units: number }>(
        `SELECT v.*, t.units FROM trending_products(30, 10) t JOIN v_product_cards v USING (product_id) ORDER BY t.units DESC`),
      c.query<ProductCard>(
        `SELECT * FROM v_product_cards
          WHERE stock_status <> 'out_of_stock' AND avg_rating >= 4 AND review_count >= 3
          ORDER BY discount_pct DESC, review_count DESC LIMIT 10`),
      session?.role === 'customer'
        ? c.query<ProductCard & { similarity: number }>(
            `SELECT v.*, r.similarity FROM recommend_for_me(10) r JOIN v_product_cards v USING (product_id)
              ORDER BY r.similarity DESC`)
        : Promise.resolve({ rows: [] as (ProductCard & { similarity: number })[] }),
    ]);
    return { categories: cats.rows, trending: trending.rows, deals: deals.rows, recommendations: recs.rows };
  });
}

export async function getCategoryOptions() {
  return withUser(null, async (c) => {
    const { rows } = await c.query<{ category_id: number; path: string; depth: number; product_count: number }>(
      `SELECT category_id, path, depth, product_count FROM v_category_tree
        WHERE product_count > 0 ORDER BY path`);
    return rows;
  });
}
