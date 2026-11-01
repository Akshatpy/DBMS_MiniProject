# Important Queries and Operations

All queries below are the ones the application actually runs (file references point to the source).
Every one can be pasted into `psql` against the seeded database.

## Q1. Hybrid semantic search: FTS + vector + review vectors, fused with RRF
*Source: `search_products()` in `db/04_functions.sql`; called from `src/lib/data/search.ts`.*
*Concepts: CTEs, full-text search (GIN), vector similarity (HNSW), FULL JOIN, window functions, filters.*

```sql
SELECT s.score, s.lexical_rank, s.semantic_rank, s.review_rank, p.title, p.price
  FROM search_products('keep coffee hot for hours', :query_vector, 'hybrid', 10,
                       NULL, NULL, 2000, 4, TRUE) s       -- max price 2000, min rating 4, in stock
  JOIN v_product_cards p USING (product_id)
 ORDER BY s.score DESC;
```

## Q2. Frequently bought together: association rules (support, confidence, lift)
*Source: `mv_product_pairs` in `db/06_views.sql`. Concepts: self-join, GROUP BY / HAVING, materialized view, CROSS JOIN.*

```sql
WITH baskets AS (SELECT oi.order_id, oi.product_id FROM order_items oi
                  JOIN orders o USING (order_id) WHERE o.status <> 'cancelled'),
     n     AS (SELECT count(DISTINCT order_id)::numeric AS total FROM baskets),
     item  AS (SELECT product_id, count(*)::numeric AS cnt FROM baskets GROUP BY product_id),
     pairs AS (SELECT a.product_id a_id, b.product_id b_id, count(*)::numeric cnt
                 FROM baskets a JOIN baskets b ON a.order_id = b.order_id AND a.product_id <> b.product_id
                GROUP BY 1, 2 HAVING count(*) >= 3)
SELECT a_id, b_id, cnt AS together,
       cnt / n.total                          AS support,
       cnt / ia.cnt                           AS confidence,     -- P(B | A)
       (cnt / ia.cnt) / (ib.cnt / n.total)    AS lift            -- > 1: bought together more than chance
  FROM pairs JOIN item ia ON ia.product_id = a_id JOIN item ib ON ib.product_id = b_id CROSS JOIN n;
```

## Q3. Seller revenue trend: month-over-month growth and moving average
*Source: `getSellerDashboard()` in `src/lib/data/seller.ts`. Concepts: window functions (`LAG`, `AVG OVER … ROWS`), view under RLS.*

```sql
WITH m AS (SELECT date_trunc('month', sale_date)::date AS month, sum(line_total) AS revenue
             FROM v_sales_lines WHERE status <> 'cancelled' GROUP BY 1)   -- no seller filter: RLS does it
SELECT month, revenue,
       round(100 * (revenue - lag(revenue) OVER w) / NULLIF(lag(revenue) OVER w, 0), 1) AS mom_growth_pct,
       round(avg(revenue) OVER (w ROWS BETWEEN 2 PRECEDING AND CURRENT ROW), 0)          AS moving_avg_3m
  FROM m WINDOW w AS (ORDER BY month) ORDER BY month;
```

## Q4. Daily revenue with gaps filled and a 7-day moving average
*Concepts: `generate_series`, LEFT JOIN, windowed average.*

```sql
WITH days AS (SELECT generate_series(current_date - 59, current_date, interval '1 day')::date AS day),
     d    AS (SELECT sale_date, sum(line_total) AS revenue FROM v_sales_lines
               WHERE status <> 'cancelled' GROUP BY sale_date)
SELECT days.day, coalesce(d.revenue, 0) AS revenue,
       round(avg(coalesce(d.revenue, 0)) OVER (ORDER BY days.day ROWS BETWEEN 6 PRECEDING AND CURRENT ROW)) AS ma7
  FROM days LEFT JOIN d ON d.sale_date = days.day ORDER BY days.day;
```

## Q5. Category revenue with subtotals and grand total (ROLLUP)
*Source: `admin_category_rollup()`. Concepts: `GROUP BY ROLLUP`, `GROUPING()`.*

```sql
SELECT coalesce(top.name, c.name) AS top_category,
       CASE WHEN top.category_id IS NULL THEN NULL ELSE c.name END AS sub_category,
       sum(d.revenue) AS revenue, sum(d.units) AS units
  FROM mv_daily_sales d
  JOIN categories c ON c.category_id = d.category_id
  LEFT JOIN categories top ON top.category_id = c.parent_id
 GROUP BY ROLLUP (coalesce(top.name, c.name), CASE WHEN top.category_id IS NULL THEN NULL ELSE c.name END);
```

## Q6. Seller leaderboard: overall rank and rank within main category
*Source: `admin_top_sellers()`. Concepts: `RANK() OVER (PARTITION BY …)`, `DISTINCT ON`, share via `SUM() OVER ()`.*

## Q7. Top products per seller with category rank and revenue share
*Source: `getSellerDashboard()`. Concepts: aggregate, two `RANK()` windows with different partitions, share of total.*

## Q8. Checkout: one atomic transaction with row locking
*Source: `checkout()` in `db/04_functions.sql`. Concepts: transaction, `SELECT … FOR UPDATE`, stored function, custom SQLSTATEs.*

```sql
SELECT checkout(:address_id, 'upi');   -- inside BEGIN … COMMIT, with app.user_id set
-- 1. locks every cart product row in product_id order (deadlock-free)  ... FOR UPDATE OF p
-- 2. RAISE SS001 if any stock < quantity, SS003 if a product was delisted
-- 3. INSERT order, INSERT order_items (price snapshot), UPDATE products SET stock_qty = stock_qty - qty
--    (fires the low-stock trigger), INSERT payment, DELETE cart_items, refresh taste vector
-- any error rolls ALL of it back
```

## Q9. Low-stock alert (trigger-driven)

```sql
UPDATE products SET stock_qty = 2 WHERE product_id = 42;       -- threshold is 10
SELECT * FROM v_low_stock;                                      -- the alert row exists
CALL restock_product(42, 100);                                  -- stored procedure
SELECT * FROM stock_alerts WHERE product_id = 42;               -- resolved_at is now set
```

## Q10. Personalised recommendations: nearest neighbours of the taste vector
*Source: `recommend_for_me()`. Concepts: `CROSS JOIN LATERAL`, vector KNN, anti-join (`NOT EXISTS`).*

## Q11. Similar products
*Source: `similar_products()`. Concepts: vector KNN with LATERAL join.*

## Q12. Recursive category traversal
*Source: `category_descendants()`, `category_path()`, `v_category_tree`. Concept: `WITH RECURSIVE`.*

```sql
WITH RECURSIVE tree AS (
  SELECT category_id FROM categories WHERE category_id = :id
  UNION ALL
  SELECT c.category_id FROM categories c JOIN tree t ON c.parent_id = t.category_id)
SELECT * FROM tree;
```

## Q13. Typo-tolerant autocomplete (trigram similarity)

```sql
SELECT product_id, title, similarity(title, 'wirless mose') AS sim
  FROM products WHERE is_active AND title % 'wirless mose' ORDER BY sim DESC LIMIT 6;   -- GIN gin_trgm_ops
```

## Q14. Search analytics: zero-result queries (demand the catalog misses)

```sql
SELECT lower(query) AS query, mode, count(*) AS n FROM search_logs
 WHERE result_count = 0 GROUP BY lower(query), mode ORDER BY n DESC LIMIT 10;
```

## Q15. Row-Level Security in action
Same SQL, different user context, different rows:

```sql
BEGIN;
SELECT set_config('app.user_id', :seller_a_id, true);
SELECT count(*), sum(line_total) FROM v_sales_lines;     -- only seller A's lines
ROLLBACK;
BEGIN;
SELECT set_config('app.user_id', :customer_id, true);
SELECT count(*) FROM orders;                              -- only that customer's orders
SELECT password_hash FROM users;                          -- ERROR: permission denied (column-level GRANT)
ROLLBACK;
```

## DML coverage

| Statement | Where used |
|---|---|
| INSERT | register_*, checkout (orders/items/payments), reviews, cart, seller product creation, search logs, ON CONFLICT upserts (cart, embeddings, alerts, jobs) |
| UPDATE | stock decrement/restock, order status changes, product edits, user activation, taste vectors, embedding upserts |
| DELETE | cart item removal, cart clearing inside `checkout()`, cascading deletes (`ON DELETE CASCADE`), stale queue/embedding cleanup in the test suite |
| SELECT | everything above plus dashboards, JOINs (up to 6 tables), GROUP BY/HAVING, subqueries, correlated `EXISTS`, CTEs, window functions |

## DDL coverage (`db/*.sql`, `scripts/db-setup.mjs`)

`CREATE` (extensions, types, domains, tables, indexes incl. GIN/HNSW/partial/unique, views, materialized views,
functions, procedures, triggers, policies, roles), `ALTER` (`ALTER TABLE … ENABLE ROW LEVEL SECURITY`,
`ALTER ROLE … PASSWORD`), `DROP` (`npm run db:setup -- --reset` drops the schema `CASCADE`).

[`db/demo/ddl_demo.sql`](../db/demo/ddl_demo.sql) is a self-contained, re-runnable walkthrough of schema evolution on a
scratch table (`CREATE TABLE`, `ALTER TABLE ADD/ALTER/RENAME/DROP COLUMN`, `ADD/DROP CONSTRAINT`, `CREATE/DROP INDEX`,
`CREATE/DROP VIEW`, `DROP TABLE`), with the error each constraint produces. Run it with
`docker exec -i shopsense-db psql -U shopsense_owner -d shopsense < db/demo/ddl_demo.sql`.
