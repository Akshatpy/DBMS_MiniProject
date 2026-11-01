import 'server-only';
import { withUser } from '../db';
import type { Session } from '../session';

// NOTE: none of these queries filter by seller_id. Row-Level Security on orders/order_items/
// products restricts v_sales_lines and v_low_stock to the signed-in seller's own rows.

export async function getSellerDashboard(session: Session) {
  return withUser(session, async (c) => {
    const kpis = c.query(`
      WITH s AS (SELECT * FROM v_sales_lines WHERE status <> 'cancelled')
      SELECT
        coalesce(sum(line_total) FILTER (WHERE sale_date >  current_date - 30), 0)                              AS revenue_30d,
        coalesce(sum(line_total) FILTER (WHERE sale_date <= current_date - 30 AND sale_date > current_date - 60), 0) AS revenue_prev_30d,
        count(DISTINCT order_id) FILTER (WHERE sale_date > current_date - 30)                                   AS orders_30d,
        coalesce(sum(quantity) FILTER (WHERE sale_date > current_date - 30), 0)                                 AS units_30d,
        coalesce(sum(line_total), 0)                                                                            AS revenue_all_time,
        (SELECT count(*) FROM products WHERE seller_id = $1 AND is_active)                                      AS active_products
      FROM s`, [session.uid]);

    // Monthly trend with month-over-month growth (LAG) and a 3-month moving average
    const monthly = c.query(`
      WITH m AS (
        SELECT date_trunc('month', sale_date)::DATE AS month,
               sum(line_total) AS revenue, sum(quantity) AS units, count(DISTINCT order_id) AS orders
          FROM v_sales_lines WHERE status <> 'cancelled'
         GROUP BY 1)
      SELECT month, revenue, units, orders,
             round(100 * (revenue - lag(revenue) OVER w) / NULLIF(lag(revenue) OVER w, 0), 1) AS mom_growth_pct,
             round(avg(revenue) OVER (w ROWS BETWEEN 2 PRECEDING AND CURRENT ROW), 0)          AS moving_avg_3m
        FROM m
      WINDOW w AS (ORDER BY month)
       ORDER BY month`);

    // Daily revenue for the last 60 days with a 7-day moving average (gaps filled with generate_series)
    const daily = c.query(`
      WITH days AS (SELECT generate_series(current_date - 59, current_date, interval '1 day')::DATE AS day),
           d AS (SELECT sale_date, sum(line_total) AS revenue FROM v_sales_lines
                  WHERE status <> 'cancelled' AND sale_date > current_date - 66 GROUP BY sale_date)
      SELECT days.day, coalesce(d.revenue, 0) AS revenue,
             round(avg(coalesce(d.revenue, 0)) OVER (ORDER BY days.day ROWS BETWEEN 6 PRECEDING AND CURRENT ROW), 0) AS ma7
        FROM days LEFT JOIN d ON d.sale_date = days.day
       ORDER BY days.day`);

    // Top products: overall rank, rank inside their category, and share of the seller's revenue
    const topProducts = c.query(`
      WITH per AS (
        SELECT product_id, product_title, category_id, sum(line_total) AS revenue, sum(quantity) AS units
          FROM v_sales_lines
         WHERE status <> 'cancelled' AND sale_date > current_date - 90
         GROUP BY product_id, product_title, category_id)
      SELECT per.*, c.name AS category,
             rank() OVER (ORDER BY revenue DESC)                          AS overall_rank,
             rank() OVER (PARTITION BY per.category_id ORDER BY revenue DESC) AS category_rank,
             round(100 * revenue / sum(revenue) OVER (), 1)               AS share_pct
        FROM per JOIN categories c USING (category_id)
       ORDER BY revenue DESC
       LIMIT 10`);

    const lowStock = c.query(`SELECT * FROM v_low_stock ORDER BY stock_qty, alert_raised_at`);

    // Orders that still need fulfilment, with only this seller's lines in each
    const toFulfil = c.query(`
      SELECT order_id, status, min(placed_at) AS placed_at,
             json_agg(json_build_object('title', product_title, 'quantity', quantity)) AS lines,
             sum(line_total) AS seller_amount
        FROM v_sales_lines
       WHERE status IN ('pending', 'paid', 'shipped')
       GROUP BY order_id, status
       ORDER BY min(placed_at)
       LIMIT 25`);

    const [k, m, d, t, l, f] = await Promise.all([kpis, monthly, daily, topProducts, lowStock, toFulfil]);
    return { kpis: k.rows[0], monthly: m.rows, daily: d.rows, topProducts: t.rows, lowStock: l.rows, toFulfil: f.rows };
  });
}

export async function getSellerProducts(session: Session, search = '') {
  return withUser(session, async (c) => {
    const { rows } = await c.query(
      `SELECT p.product_id, p.title, p.brand, p.price, p.mrp, p.stock_qty, p.reorder_threshold, p.is_active,
              p.avg_rating, p.review_count, p.image_url, p.updated_at, c.name AS category,
              pe.embedded_at,
              EXISTS (SELECT 1 FROM embedding_jobs j WHERE j.entity_type = 'product'
                         AND j.entity_id = p.product_id AND j.processed_at IS NULL) AS embedding_pending
         FROM products p
         JOIN categories c USING (category_id)
         LEFT JOIN product_embeddings pe USING (product_id)
        WHERE p.seller_id = $1 AND ($2 = '' OR p.title ILIKE '%' || $2 || '%')
        ORDER BY p.stock_qty < p.reorder_threshold DESC, p.title
        LIMIT 200`, [session.uid, search]);
    return rows;
  });
}

export async function getSellerProduct(session: Session, id: number) {
  return withUser(session, async (c) => {
    const { rows } = await c.query(
      `SELECT product_id, title, brand, description, features, price, mrp, stock_qty, reorder_threshold,
              image_url, is_active, category_id
         FROM products WHERE product_id = $1 AND seller_id = $2`, [id, session.uid]);
    return rows[0] ?? null;
  });
}
