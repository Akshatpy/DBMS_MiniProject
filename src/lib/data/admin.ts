import 'server-only';
import { withUser } from '../db';
import type { Session } from '../session';

export async function getAdminDashboard(session: Session) {
  return withUser(session, async (c) => {
    const [kpis, monthly, rollup, sellers, searchStats, topQueries, zeroResults, queue] = await Promise.all([
      c.query(`SELECT
                 (SELECT count(*) FROM users WHERE role = 'customer') AS customers,
                 (SELECT count(*) FROM sellers)                       AS sellers,
                 (SELECT count(*) FROM products WHERE is_active)      AS products,
                 (SELECT count(*) FROM orders)                        AS orders,
                 (SELECT count(*) FROM reviews)                       AS reviews,
                 (SELECT count(*) FROM product_embeddings) + (SELECT count(*) FROM review_embeddings) AS vectors,
                 (SELECT count(*) FROM stock_alerts WHERE resolved_at IS NULL) AS open_alerts`),
      c.query(`SELECT * FROM admin_monthly_revenue()`),
      c.query(`SELECT * FROM admin_category_rollup(current_date - 365)`),
      c.query(`SELECT * FROM admin_top_sellers(6)`),
      c.query(`SELECT mode, count(*) AS searches, round(avg(latency_ms), 1) AS avg_latency_ms,
                      round(100.0 * count(*) FILTER (WHERE result_count = 0) / count(*), 1) AS zero_result_pct
                 FROM search_logs GROUP BY mode ORDER BY mode`),
      c.query(`SELECT lower(query) AS query, count(*) AS n, max(created_at) AS last_seen
                 FROM search_logs GROUP BY lower(query)
                HAVING count(*) >= 1 ORDER BY n DESC, last_seen DESC LIMIT 10`),
      c.query(`SELECT lower(query) AS query, mode, count(*) AS n FROM search_logs
                WHERE result_count = 0 GROUP BY lower(query), mode ORDER BY n DESC LIMIT 10`),
      c.query(`SELECT entity_type,
                      count(*) FILTER (WHERE processed_at IS NULL) AS pending,
                      count(*) FILTER (WHERE processed_at IS NOT NULL) AS done,
                      count(*) FILTER (WHERE last_error IS NOT NULL AND processed_at IS NULL) AS failing,
                      max(processed_at) AS last_processed
                 FROM embedding_jobs GROUP BY entity_type ORDER BY entity_type`),
    ]);
    return {
      kpis: kpis.rows[0], monthly: monthly.rows, rollup: rollup.rows, sellers: sellers.rows,
      searchStats: searchStats.rows, topQueries: topQueries.rows, zeroResults: zeroResults.rows, queue: queue.rows,
    };
  });
}

export async function getUsers(session: Session, search: string, role: string) {
  return withUser(session, async (c) => {
    const { rows } = await c.query(
      `SELECT u.user_id, u.email, u.full_name, u.role, u.is_active, u.created_at, u.last_login_at,
              s.store_name,
              (SELECT count(*) FROM orders o WHERE o.user_id = u.user_id) AS order_count
         FROM users u LEFT JOIN sellers s ON s.seller_id = u.user_id
        WHERE ($1 = '' OR u.email ILIKE '%' || $1 || '%' OR u.full_name ILIKE '%' || $1 || '%')
          AND ($2 = '' OR u.role::TEXT = $2)
        ORDER BY u.role, u.user_id
        LIMIT 100`, [search, role]);
    return rows;
  });
}

export async function getEvalRuns(session: Session) {
  return withUser(session, async (c) => {
    const { rows } = await c.query(
      `SELECT DISTINCT ON (mode) run_id, mode, model, k, query_count, precision_at_k, recall_at_k, mrr, ndcg_at_k,
              avg_latency_ms, details, run_at
         FROM eval_runs WHERE coalesce(details->>'set', 'main') = 'main' ORDER BY mode, run_at DESC`);
    return rows;
  });
}
