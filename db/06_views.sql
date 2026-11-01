-- =====================================================================
-- 06  Views, materialized views and analytics functions
-- =====================================================================

-- ---------------------------------------------------------------------
-- Ordinary views
-- security_invoker = true  -> the querying role's privileges AND Row-Level Security apply
-- (default views run with the owner's rights and would bypass RLS)
-- ---------------------------------------------------------------------

-- Product "card" used across the UI
CREATE VIEW v_product_cards WITH (security_invoker = true) AS
SELECT p.product_id,
       p.title,
       p.brand,
       p.price,
       p.mrp,
       round(100 * (1 - p.price / NULLIF(p.mrp, 0)))::INT        AS discount_pct,
       p.image_url,
       p.avg_rating,
       p.review_count,
       p.stock_qty,
       CASE WHEN p.stock_qty = 0                   THEN 'out_of_stock'
            WHEN p.stock_qty < p.reorder_threshold THEN 'low_stock'
            ELSE 'in_stock' END                                   AS stock_status,
       p.category_id,
       c.name                                                     AS category_name,
       coalesce(pc.name, c.name)                                  AS top_category_name,
       p.seller_id,
       s.store_name,
       p.is_active
  FROM products p
  JOIN categories c       ON c.category_id = p.category_id
  LEFT JOIN categories pc ON pc.category_id = c.parent_id
  JOIN sellers s          ON s.seller_id = p.seller_id;

-- Public review feed: exposes only a masked reviewer name ("Priya S."), never email/phone.
-- Deliberately NOT security_invoker: it reads users.full_name, which the app role cannot.
CREATE VIEW v_public_reviews AS
SELECT r.review_id,
       r.product_id,
       r.rating,
       r.title,
       r.body,
       r.verified_purchase,
       r.helpful_votes,
       r.created_at,
       r.user_id,
       coalesce(split_part(u.full_name, ' ', 1) || ' ' ||
                left(NULLIF(split_part(u.full_name, ' ', 2), ''), 1) || '.',
                'Former customer')                               AS reviewer_name
  FROM reviews r
  LEFT JOIN users u ON u.user_id = r.user_id;

-- Every sold line with its order context. Under RLS a seller sees only lines of their own
-- products, a customer only their own orders, an admin everything — same view, same SQL.
CREATE VIEW v_sales_lines WITH (security_invoker = true) AS
SELECT o.order_id,
       o.placed_at,
       (o.placed_at AT TIME ZONE 'Asia/Kolkata')::DATE AS sale_date,
       o.status,
       o.user_id                                        AS customer_id,
       oi.product_id,
       p.title                                          AS product_title,
       p.seller_id,
       p.category_id,
       oi.quantity,
       oi.unit_price,
       oi.line_total
  FROM order_items oi
  JOIN orders o   ON o.order_id = oi.order_id
  JOIN products p ON p.product_id = oi.product_id;

-- Open low-stock alerts with product context
CREATE VIEW v_low_stock WITH (security_invoker = true) AS
SELECT a.alert_id, a.created_at AS alert_raised_at, p.product_id, p.title, p.seller_id,
       p.stock_qty, p.reorder_threshold, p.image_url
  FROM stock_alerts a
  JOIN products p ON p.product_id = a.product_id
 WHERE a.resolved_at IS NULL;

-- Category hierarchy with full path and depth (recursive CTE inside a view)
CREATE VIEW v_category_tree AS
WITH RECURSIVE tree AS (
  SELECT category_id, parent_id, name, slug, name::TEXT AS path, 0 AS depth, category_id AS root_id
    FROM categories WHERE parent_id IS NULL
  UNION ALL
  SELECT c.category_id, c.parent_id, c.name, c.slug, t.path || ' > ' || c.name, t.depth + 1, t.root_id
    FROM categories c JOIN tree t ON c.parent_id = t.category_id
)
SELECT t.*,
       (SELECT count(*) FROM products p
         WHERE p.is_active AND p.category_id IN (SELECT category_descendants(t.category_id))) AS product_count
  FROM tree t;

-- ---------------------------------------------------------------------
-- Materialized views (pre-computed, refreshed by CALL refresh_analytics())
-- Each has a UNIQUE index so it can be refreshed CONCURRENTLY (readers are never blocked).
-- ---------------------------------------------------------------------

-- Daily revenue cube at (day, seller, category) grain
CREATE MATERIALIZED VIEW mv_daily_sales AS
SELECT (o.placed_at AT TIME ZONE 'Asia/Kolkata')::DATE AS sale_date,
       p.seller_id,
       p.category_id,
       count(DISTINCT o.order_id)                       AS orders,
       sum(oi.quantity)::BIGINT                         AS units,
       sum(oi.line_total)                               AS revenue
  FROM orders o
  JOIN order_items oi USING (order_id)
  JOIN products p     USING (product_id)
 WHERE o.status <> 'cancelled'
 GROUP BY 1, 2, 3;

CREATE UNIQUE INDEX uq_mv_daily_sales ON mv_daily_sales (sale_date, seller_id, category_id);
CREATE INDEX idx_mv_daily_sales_seller ON mv_daily_sales (seller_id, sale_date);

-- Association rules over order history ("frequently bought together")
--   support(A,B)    = P(A and B)       = orders with both / all orders
--   confidence(A→B) = P(B | A)         = orders with both / orders with A
--   lift(A→B)       = confidence / P(B)  (> 1 means bought together more than by chance)
CREATE MATERIALIZED VIEW mv_product_pairs AS
WITH baskets AS (
  SELECT oi.order_id, oi.product_id
    FROM order_items oi
    JOIN orders o USING (order_id)
   WHERE o.status <> 'cancelled'
),
n AS (SELECT count(DISTINCT order_id)::NUMERIC AS total FROM baskets),
item AS (SELECT product_id, count(*)::NUMERIC AS cnt FROM baskets GROUP BY product_id),
pairs AS (
  SELECT a.product_id AS a_id, b.product_id AS b_id, count(*)::NUMERIC AS cnt
    FROM baskets a
    JOIN baskets b ON a.order_id = b.order_id AND a.product_id <> b.product_id
   GROUP BY a.product_id, b.product_id
  HAVING count(*) >= 3                       -- minimum support count
)
SELECT pr.a_id                                         AS product_id,
       pr.b_id                                         AS related_product_id,
       pr.cnt::INT                                     AS together_count,
       round(pr.cnt / n.total, 6)                      AS support,
       round(pr.cnt / ia.cnt, 4)                       AS confidence,
       round((pr.cnt / ia.cnt) / (ib.cnt / n.total), 3) AS lift
  FROM pairs pr
  JOIN item ia ON ia.product_id = pr.a_id
  JOIN item ib ON ib.product_id = pr.b_id
 CROSS JOIN n;

CREATE UNIQUE INDEX uq_mv_product_pairs ON mv_product_pairs (product_id, related_product_id);

CREATE FUNCTION frequently_bought_together(p_product_id BIGINT, p_limit INT DEFAULT 6)
RETURNS TABLE (product_id BIGINT, together_count INT, support NUMERIC, confidence NUMERIC, lift NUMERIC)
LANGUAGE sql STABLE AS $$
  SELECT m.related_product_id, m.together_count, m.support, m.confidence, m.lift
    FROM mv_product_pairs m
    JOIN products p ON p.product_id = m.related_product_id AND p.is_active
   WHERE m.product_id = p_product_id
     AND m.lift > 1
   ORDER BY m.confidence DESC, m.lift DESC
   LIMIT p_limit
$$;

-- Best sellers over the last N days. SECURITY DEFINER because anonymous visitors cannot read
-- orders under RLS; it only exposes aggregate unit counts, never who bought what.
CREATE FUNCTION trending_products(p_days INT DEFAULT 30, p_limit INT DEFAULT 12)
RETURNS TABLE (product_id BIGINT, units BIGINT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT oi.product_id, sum(oi.quantity)::BIGINT AS units
    FROM orders o
    JOIN order_items oi USING (order_id)
    JOIN products p ON p.product_id = oi.product_id AND p.is_active AND p.stock_qty > 0
   WHERE o.status <> 'cancelled'
     AND o.placed_at >= now() - make_interval(days => p_days)
   GROUP BY oi.product_id
   ORDER BY units DESC, oi.product_id
   LIMIT p_limit
$$;

CREATE PROCEDURE refresh_analytics()
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- callable by the owner (scripts) or by an admin through the app
  IF session_user <> current_user AND NOT is_admin() THEN
    RAISE EXCEPTION 'Admin privileges required' USING ERRCODE = '42501';
  END IF;
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_daily_sales;
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_product_pairs;
  PERFORM refresh_all_taste_profiles();
END $$;

-- ---------------------------------------------------------------------
-- Admin analytics (SECURITY DEFINER + explicit admin check, since materialized
-- views cannot carry Row-Level Security policies)
-- ---------------------------------------------------------------------

-- Platform revenue by month with month-over-month growth (LAG) and 3-month moving average
CREATE FUNCTION admin_monthly_revenue()
RETURNS TABLE (month DATE, revenue NUMERIC, orders BIGINT, units BIGINT,
               mom_growth_pct NUMERIC, moving_avg_3m NUMERIC, cumulative_revenue NUMERIC)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
#variable_conflict use_column
BEGIN
  PERFORM assert_admin();
  RETURN QUERY
  WITH m AS (
    SELECT date_trunc('month', d.sale_date)::DATE AS month,
           sum(d.revenue) AS revenue, sum(d.units)::BIGINT AS units
      FROM mv_daily_sales d
     GROUP BY 1
  ), o AS (
    SELECT date_trunc('month', (placed_at AT TIME ZONE 'Asia/Kolkata'))::DATE AS month, count(*) AS orders
      FROM orders WHERE status <> 'cancelled'
     GROUP BY 1
  )
  SELECT m.month, m.revenue, coalesce(o.orders, 0), m.units,
         round(100 * (m.revenue - lag(m.revenue) OVER w) / NULLIF(lag(m.revenue) OVER w, 0), 1),
         round(avg(m.revenue) OVER (w ROWS BETWEEN 2 PRECEDING AND CURRENT ROW), 2),
         sum(m.revenue) OVER (w ROWS UNBOUNDED PRECEDING)
    FROM m LEFT JOIN o USING (month)
  WINDOW w AS (ORDER BY m.month)
   ORDER BY m.month;
END $$;

-- Revenue by top-level category and sub-category with subtotals and grand total (ROLLUP)
CREATE FUNCTION admin_category_rollup(p_since DATE DEFAULT NULL)
RETURNS TABLE (top_category TEXT, sub_category TEXT, revenue NUMERIC, units BIGINT,
               level TEXT, share_pct NUMERIC)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
#variable_conflict use_column
BEGIN
  PERFORM assert_admin();
  RETURN QUERY
  SELECT coalesce(top.name, c.name)                         AS top_category,
         CASE WHEN top.category_id IS NULL THEN NULL ELSE c.name END AS sub_category,
         sum(d.revenue), sum(d.units)::BIGINT,
         CASE GROUPING(coalesce(top.name, c.name), CASE WHEN top.category_id IS NULL THEN NULL ELSE c.name END)
              WHEN 0 THEN 'subcategory' WHEN 1 THEN 'category subtotal' ELSE 'grand total' END,
         round(100 * sum(d.revenue) / (SELECT sum(x.revenue) FROM mv_daily_sales x
                                         WHERE p_since IS NULL OR x.sale_date >= p_since), 2)
    FROM mv_daily_sales d
    JOIN categories c        ON c.category_id = d.category_id
    LEFT JOIN categories top ON top.category_id = c.parent_id
   WHERE p_since IS NULL OR d.sale_date >= p_since
   GROUP BY ROLLUP (coalesce(top.name, c.name), CASE WHEN top.category_id IS NULL THEN NULL ELSE c.name END)
   ORDER BY 1 NULLS LAST, 3 DESC;
END $$;

-- Seller leaderboard: overall rank, rank within their main category, share of platform revenue
CREATE FUNCTION admin_top_sellers(p_months INT DEFAULT 6)
RETURNS TABLE (seller_id BIGINT, store_name TEXT, main_category TEXT, revenue NUMERIC, units BIGINT,
               overall_rank BIGINT, category_rank BIGINT, revenue_share_pct NUMERIC)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
#variable_conflict use_column
BEGIN
  PERFORM assert_admin();
  RETURN QUERY
  WITH per_seller AS (
    SELECT d.seller_id, sum(d.revenue) AS revenue, sum(d.units)::BIGINT AS units
      FROM mv_daily_sales d
     WHERE d.sale_date >= (current_date - make_interval(months => p_months))
     GROUP BY d.seller_id
  ), main_cat AS (
    -- the top-level category where each seller earns the most (DISTINCT ON picks the max)
    SELECT DISTINCT ON (d.seller_id) d.seller_id, coalesce(top.name, c.name) AS cat
      FROM mv_daily_sales d
      JOIN categories c ON c.category_id = d.category_id
      LEFT JOIN categories top ON top.category_id = c.parent_id
     GROUP BY d.seller_id, coalesce(top.name, c.name)
     ORDER BY d.seller_id, sum(d.revenue) DESC
  )
  SELECT ps.seller_id, s.store_name, mc.cat, ps.revenue, ps.units,
         rank() OVER (ORDER BY ps.revenue DESC),
         rank() OVER (PARTITION BY mc.cat ORDER BY ps.revenue DESC),
         round(100 * ps.revenue / sum(ps.revenue) OVER (), 2)
    FROM per_seller ps
    JOIN sellers s   ON s.seller_id = ps.seller_id
    JOIN main_cat mc ON mc.seller_id = ps.seller_id
   ORDER BY ps.revenue DESC;
END $$;
