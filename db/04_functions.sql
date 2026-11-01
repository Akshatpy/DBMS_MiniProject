-- =====================================================================
-- 04  Stored functions & procedures
-- =====================================================================
-- Custom SQLSTATEs raised by business rules (class 'SS' = ShopSense):
--   SS001 insufficient stock      SS002 empty cart
--   SS003 product unavailable     SS004 illegal order state change
--   SS005 weak password

-- ---------------------------------------------------------------------
-- Request context. The API sets app.user_id per transaction with set_config(..., true).
-- The ROLE is never trusted from the client: it is looked up from the users table.
-- ---------------------------------------------------------------------
CREATE FUNCTION app_user_id() RETURNS BIGINT
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.user_id', true), '')::BIGINT
$$;

CREATE FUNCTION app_role() RETURNS user_role
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT role FROM users WHERE user_id = app_user_id() AND is_active
$$;

CREATE FUNCTION is_admin() RETURNS BOOLEAN
LANGUAGE sql STABLE AS $$
  SELECT coalesce(app_role() = 'admin', FALSE)
$$;

CREATE FUNCTION assert_admin() RETURNS VOID
LANGUAGE plpgsql STABLE AS $$
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Admin privileges required' USING ERRCODE = '42501';
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- Category hierarchy (recursive CTEs)
-- ---------------------------------------------------------------------
CREATE FUNCTION category_descendants(p_category_id INT) RETURNS SETOF INT
LANGUAGE sql STABLE AS $$
  WITH RECURSIVE tree AS (
    SELECT category_id FROM categories WHERE category_id = p_category_id
    UNION ALL
    SELECT c.category_id FROM categories c JOIN tree t ON c.parent_id = t.category_id
  )
  SELECT category_id FROM tree
$$;

CREATE FUNCTION category_path(p_category_id INT) RETURNS TEXT
LANGUAGE sql STABLE AS $$
  WITH RECURSIVE up AS (
    SELECT category_id, parent_id, name, 0 AS depth FROM categories WHERE category_id = p_category_id
    UNION ALL
    SELECT c.category_id, c.parent_id, c.name, up.depth + 1
    FROM categories c JOIN up ON c.category_id = up.parent_id
  )
  SELECT string_agg(name, ' > ' ORDER BY depth DESC) FROM up
$$;

-- ---------------------------------------------------------------------
-- Authentication (passwords are hashed and verified INSIDE the database)
-- ---------------------------------------------------------------------
CREATE FUNCTION assert_password_strength(p_password TEXT) RETURNS VOID
LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  IF p_password IS NULL OR length(p_password) < 8
     OR p_password !~ '[A-Za-z]' OR p_password !~ '[0-9]' THEN
    RAISE EXCEPTION 'Password must be at least 8 characters and contain a letter and a digit'
      USING ERRCODE = 'SS005';
  END IF;
END $$;

CREATE FUNCTION register_customer(p_email TEXT, p_password TEXT, p_full_name TEXT, p_phone TEXT DEFAULT NULL)
RETURNS BIGINT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user_id BIGINT;
BEGIN
  PERFORM assert_password_strength(p_password);
  INSERT INTO users (email, password_hash, full_name, phone, role)
  VALUES (lower(btrim(p_email)), crypt(p_password, gen_salt('bf', 10)), btrim(p_full_name), NULLIF(p_phone, ''), 'customer')
  RETURNING user_id INTO v_user_id;

  INSERT INTO customer_profiles (user_id) VALUES (v_user_id);
  INSERT INTO carts (user_id) VALUES (v_user_id);
  RETURN v_user_id;
END $$;

CREATE FUNCTION register_seller(p_email TEXT, p_password TEXT, p_full_name TEXT,
                                p_store_name TEXT, p_gstin TEXT DEFAULT NULL, p_phone TEXT DEFAULT NULL)
RETURNS BIGINT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user_id BIGINT;
BEGIN
  PERFORM assert_password_strength(p_password);
  INSERT INTO users (email, password_hash, full_name, phone, role)
  VALUES (lower(btrim(p_email)), crypt(p_password, gen_salt('bf', 10)), btrim(p_full_name), NULLIF(p_phone, ''), 'seller')
  RETURNING user_id INTO v_user_id;

  INSERT INTO sellers (seller_id, store_name, gstin, support_email)
  VALUES (v_user_id, btrim(p_store_name), NULLIF(upper(btrim(p_gstin)), ''), lower(btrim(p_email)));
  RETURN v_user_id;
END $$;

-- Returns the user on success, no rows on failure (wrong email, wrong password or inactive)
CREATE FUNCTION authenticate(p_email TEXT, p_password TEXT)
RETURNS TABLE (user_id BIGINT, full_name TEXT, role user_role)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE users u
     SET last_login_at = now()
   WHERE lower(u.email) = lower(btrim(p_email))
     AND u.is_active
     AND u.password_hash = crypt(p_password, u.password_hash)
  RETURNING u.user_id, u.full_name, u.role
$$;

-- ---------------------------------------------------------------------
-- Personalisation: taste vector = mean embedding of everything the customer bought
-- ---------------------------------------------------------------------
CREATE FUNCTION refresh_taste_profile(p_user_id BIGINT) RETURNS VOID
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE customer_profiles cp
     SET taste_embedding = t.v, taste_updated_at = now()
    FROM (SELECT avg(pe.embedding) AS v
            FROM orders o
            JOIN order_items oi USING (order_id)
            JOIN product_embeddings pe USING (product_id)
           WHERE o.user_id = p_user_id AND o.status <> 'cancelled') t
   WHERE cp.user_id = p_user_id
$$;

CREATE FUNCTION refresh_all_taste_profiles() RETURNS INT
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  WITH t AS (
    SELECT o.user_id, avg(pe.embedding) AS v
      FROM orders o
      JOIN order_items oi USING (order_id)
      JOIN product_embeddings pe USING (product_id)
     WHERE o.status <> 'cancelled'
     GROUP BY o.user_id
  ), upd AS (
    UPDATE customer_profiles cp SET taste_embedding = t.v, taste_updated_at = now()
      FROM t WHERE cp.user_id = t.user_id
    RETURNING 1
  )
  SELECT count(*)::INT FROM upd
$$;

-- ---------------------------------------------------------------------
-- CHECKOUT — the core transaction.
-- Runs atomically (a function is one statement): either the order, items, stock decrements,
-- payment and cart clearing ALL happen, or none do.
-- Product rows are locked with SELECT ... FOR UPDATE in product_id order (deadlock-free),
-- so two customers can never both buy the last unit.
-- ---------------------------------------------------------------------
CREATE FUNCTION checkout(p_address_id BIGINT, p_method payment_method)
RETURNS BIGINT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid       BIGINT := app_user_id();
  v_cart_id   BIGINT;
  v_order_id  BIGINT;
  v_subtotal  NUMERIC(12, 2) := 0;
  v_fee       NUMERIC(12, 2);
  v_hold      NUMERIC := coalesce(NULLIF(current_setting('app.demo_hold_seconds', true), '')::NUMERIC, 0);
  r           RECORD;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM addresses WHERE address_id = p_address_id AND user_id = v_uid) THEN
    RAISE EXCEPTION 'Address % does not belong to the current user', p_address_id USING ERRCODE = '42501';
  END IF;

  SELECT cart_id INTO v_cart_id FROM carts WHERE user_id = v_uid;
  IF v_cart_id IS NULL OR NOT EXISTS (SELECT 1 FROM cart_items WHERE cart_id = v_cart_id) THEN
    RAISE EXCEPTION 'Cart is empty' USING ERRCODE = 'SS002';
  END IF;

  FOR r IN
    SELECT p.product_id, p.title, p.price, p.stock_qty, p.is_active, ci.quantity
      FROM cart_items ci
      JOIN products p ON p.product_id = ci.product_id
     WHERE ci.cart_id = v_cart_id
     ORDER BY p.product_id
       FOR UPDATE OF p
  LOOP
    IF NOT r.is_active THEN
      RAISE EXCEPTION '"%" is no longer available', r.title USING ERRCODE = 'SS003';
    END IF;
    IF r.stock_qty < r.quantity THEN
      RAISE EXCEPTION 'Insufficient stock for "%": requested %, available %', r.title, r.quantity, r.stock_qty
        USING ERRCODE = 'SS001';
    END IF;
    v_subtotal := v_subtotal + r.price * r.quantity;
  END LOOP;

  -- Concurrency-lab hook: hold the row locks for a moment so a competing checkout visibly waits
  IF v_hold > 0 THEN
    PERFORM pg_sleep(least(v_hold, 5));
  END IF;

  v_fee := CASE WHEN v_subtotal >= 499 THEN 0 ELSE 40 END;

  INSERT INTO orders (user_id, address_id, status, subtotal, shipping_fee, total_amount)
  VALUES (v_uid, p_address_id,
          CASE WHEN p_method = 'cod' THEN 'pending' ELSE 'paid' END::order_status,
          v_subtotal, v_fee, v_subtotal + v_fee)
  RETURNING order_id INTO v_order_id;

  INSERT INTO order_items (order_id, product_id, quantity, unit_price)
  SELECT v_order_id, p.product_id, ci.quantity, p.price
    FROM cart_items ci JOIN products p USING (product_id)
   WHERE ci.cart_id = v_cart_id;

  UPDATE products p
     SET stock_qty = p.stock_qty - ci.quantity          -- low-stock trigger fires here
    FROM cart_items ci
   WHERE ci.cart_id = v_cart_id AND ci.product_id = p.product_id;

  INSERT INTO payments (order_id, method, amount, status, transaction_ref)
  VALUES (v_order_id, p_method, v_subtotal + v_fee,
          CASE WHEN p_method = 'cod' THEN 'pending' ELSE 'success' END::payment_status,
          CASE WHEN p_method = 'cod' THEN NULL
               ELSE 'TXN' || upper(substr(md5(random()::TEXT || v_order_id), 1, 12)) END);

  DELETE FROM cart_items WHERE cart_id = v_cart_id;
  UPDATE carts SET updated_at = now() WHERE cart_id = v_cart_id;

  PERFORM refresh_taste_profile(v_uid);
  RETURN v_order_id;
END $$;

CREATE FUNCTION cancel_order(p_order_id BIGINT) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_order orders%ROWTYPE;
BEGIN
  SELECT * INTO v_order FROM orders WHERE order_id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order % not found', p_order_id USING ERRCODE = 'P0002';
  END IF;
  IF v_order.user_id IS DISTINCT FROM app_user_id() AND NOT is_admin() THEN
    RAISE EXCEPTION 'You cannot cancel this order' USING ERRCODE = '42501';
  END IF;
  IF v_order.status NOT IN ('pending', 'paid') THEN
    RAISE EXCEPTION 'Order % is % and can no longer be cancelled', p_order_id, v_order.status
      USING ERRCODE = 'SS004';
  END IF;

  -- return the units to inventory (resolves any open low-stock alert via trigger)
  UPDATE products p
     SET stock_qty = p.stock_qty + oi.quantity
    FROM order_items oi
   WHERE oi.order_id = p_order_id AND oi.product_id = p.product_id;

  UPDATE orders SET status = 'cancelled' WHERE order_id = p_order_id;
  UPDATE payments
     SET status = CASE WHEN status = 'success' THEN 'refunded' ELSE 'failed' END::payment_status
   WHERE order_id = p_order_id;

  PERFORM refresh_taste_profile(v_order.user_id);
END $$;

-- Stored PROCEDURE (invoked with CALL). Runs with the caller's rights, so Row-Level Security
-- guarantees a seller can only restock their own products.
CREATE PROCEDURE restock_product(p_product_id BIGINT, p_quantity INT)
LANGUAGE plpgsql AS $$
BEGIN
  IF p_quantity IS NULL OR p_quantity <= 0 OR p_quantity > 10000 THEN
    RAISE EXCEPTION 'Restock quantity must be between 1 and 10000' USING ERRCODE = '22023';
  END IF;
  UPDATE products SET stock_qty = stock_qty + p_quantity WHERE product_id = p_product_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Product % not found or not owned by you', p_product_id USING ERRCODE = '42501';
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- Text that gets embedded (single source of truth for the worker)
-- ---------------------------------------------------------------------
CREATE FUNCTION product_embedding_text(p_product_id BIGINT) RETURNS TEXT
LANGUAGE sql STABLE AS $$
  SELECT concat_ws('. ',
           p.title,
           'Brand: ' || p.brand,
           'Category: ' || category_path(p.category_id),
           left(replace(p.features, E'\n', '; '), 700),
           left(p.description, 700))
    FROM products p
   WHERE p.product_id = p_product_id
$$;

CREATE FUNCTION review_embedding_text(p_review_id BIGINT) RETURNS TEXT
LANGUAGE sql STABLE AS $$
  SELECT concat_ws('. ', NULLIF(r.title, ''), left(r.body, 1200))
    FROM reviews r
   WHERE r.review_id = p_review_id
$$;

-- ---------------------------------------------------------------------
-- HYBRID SEARCH — Reciprocal Rank Fusion of three ranked lists:
--   1. lexical  : full-text rank (ts_rank_cd over weighted tsvector). CONJUNCTIVE first: if any eligible
--                 product contains ALL query terms, only those are ranked and the list gets full weight.
--                 Otherwise it falls back to DISJUNCTIVE (any term) at weight 0.25: a partial keyword
--                 match on a natural-language query ("make my backyard glow at night") is weak evidence
--                 and must not out-vote the semantic lists.
--   2. semantic : cosine similarity between query and PRODUCT embeddings
--   3. reviews  : best cosine similarity between query and any REVIEW of the product
-- RRF score = sum over lists of  w_i / (60 + rank_i)      (w: lexical 1.0 or 0.25, semantic 1.0, reviews 0.5)
-- Relational filters (category subtree, price, rating, stock) apply to every list.
-- ---------------------------------------------------------------------
CREATE FUNCTION search_products(
  p_query        TEXT,
  p_embedding    vector(384),
  p_mode         search_mode DEFAULT 'hybrid',
  p_limit        INT         DEFAULT 24,
  p_category_id  INT         DEFAULT NULL,
  p_min_price    NUMERIC     DEFAULT NULL,
  p_max_price    NUMERIC     DEFAULT NULL,
  p_min_rating   NUMERIC     DEFAULT NULL,
  p_in_stock     BOOLEAN     DEFAULT FALSE
)
RETURNS TABLE (
  product_id                 BIGINT,
  score                      DOUBLE PRECISION,
  lexical_rank               INT,
  semantic_rank              INT,
  review_rank                INT,
  semantic_similarity        DOUBLE PRECISION,
  matched_review_id          BIGINT,
  matched_review_similarity  DOUBLE PRECISION
)
LANGUAGE sql STABLE
SET hnsw.ef_search = 200
SET hnsw.iterative_scan = 'relaxed_order'
AS $$
  WITH
  eligible AS MATERIALIZED (
    SELECT p.product_id
      FROM products p
     WHERE p.is_active
       AND (p_category_id IS NULL OR p.category_id IN (SELECT category_descendants(p_category_id)))
       AND (p_min_price  IS NULL OR p.price      >= p_min_price)
       AND (p_max_price  IS NULL OR p.price      <= p_max_price)
       AND (p_min_rating IS NULL OR p.avg_rating >= p_min_rating)
       AND (NOT p_in_stock OR p.stock_qty > 0)
  ),
  q AS (
    SELECT plainto_tsquery('english', p_query) AS tsq_and,
           NULLIF(replace(plainto_tsquery('english', p_query)::TEXT, '&', '|'), '')::tsquery AS tsq_or
  ),
  -- The @@ match is materialised FIRST so the planner uses the GIN index, then intersected with the
  -- relational filters (joining against `eligible` first forces a slow row-by-row detoast of tsvectors).
  and_match AS MATERIALIZED (
    SELECT p.product_id
      FROM products p, q
     WHERE p_mode IN ('lexical', 'hybrid')
       AND q.tsq_and::TEXT <> ''
       AND p.search_tsv @@ q.tsq_and
  ),
  and_hits AS (
    -- does any eligible product contain every query term?
    SELECT count(*) AS n FROM and_match WHERE product_id IN (SELECT product_id FROM eligible)
  ),
  lex_q AS (
    SELECT CASE WHEN a.n > 0 THEN q.tsq_and ELSE q.tsq_or END AS tsq,
           CASE WHEN a.n > 0 THEN 1.0 ELSE 0.25 END           AS weight
      FROM q, and_hits a
  ),
  lex_match AS MATERIALIZED (
    SELECT p.product_id, ts_rank_cd(p.search_tsv, lq.tsq, 1) AS rank
      FROM products p, lex_q lq
     WHERE p_mode IN ('lexical', 'hybrid')
       AND lq.tsq IS NOT NULL
       AND p.search_tsv @@ lq.tsq
  ),
  lexical AS (
    SELECT x.product_id, row_number() OVER (ORDER BY x.rank DESC, x.product_id)::INT AS rnk
      FROM (SELECT m.product_id, m.rank
              FROM lex_match m
             WHERE m.product_id IN (SELECT product_id FROM eligible)
             ORDER BY m.rank DESC
             LIMIT 100) x
  ),
  semantic AS (
    SELECT x.product_id, x.dist, row_number() OVER (ORDER BY x.dist, x.product_id)::INT AS rnk
      FROM (SELECT pe.product_id, pe.embedding <=> p_embedding AS dist
              FROM product_embeddings pe
             WHERE p_mode IN ('semantic', 'hybrid')
               AND pe.product_id IN (SELECT product_id FROM eligible)
             ORDER BY pe.embedding <=> p_embedding
             LIMIT 100) x
  ),
  review_hits AS (
    SELECT r.product_id, re.review_id, re.embedding <=> p_embedding AS dist
      FROM review_embeddings re
      JOIN reviews r USING (review_id)
     WHERE p_mode IN ('semantic', 'hybrid')
       AND r.product_id IN (SELECT product_id FROM eligible)
     ORDER BY re.embedding <=> p_embedding
     LIMIT 300
  ),
  review_best AS (
    SELECT DISTINCT ON (h.product_id) h.product_id, h.review_id, h.dist
      FROM review_hits h
     ORDER BY h.product_id, h.dist
  ),
  review_ranked AS (
    SELECT b.*, row_number() OVER (ORDER BY b.dist, b.product_id)::INT AS rnk
      FROM review_best b
     ORDER BY b.dist
     LIMIT 100
  ),
  fused AS (
    SELECT coalesce(l.product_id, s.product_id, rv.product_id) AS product_id,
           coalesce((SELECT weight FROM lex_q) / (60 + l.rnk), 0)
         + coalesce(1.0 / (60 + s.rnk), 0)
         + coalesce(0.5 / (60 + rv.rnk), 0)                     AS score,   -- reviews are noisier: half weight
           l.rnk  AS lexical_rank,
           s.rnk  AS semantic_rank,
           rv.rnk AS review_rank,
           1 - s.dist  AS semantic_similarity,
           rv.review_id AS matched_review_id,
           1 - rv.dist AS matched_review_similarity
      FROM lexical l
      FULL JOIN semantic s       ON s.product_id = l.product_id
      FULL JOIN review_ranked rv ON rv.product_id = coalesce(l.product_id, s.product_id)
  )
  SELECT product_id, score::DOUBLE PRECISION, lexical_rank, semantic_rank, review_rank,
         semantic_similarity, matched_review_id, matched_review_similarity
    FROM fused
   ORDER BY score DESC, product_id
   LIMIT p_limit
$$;

-- Nearest neighbours of a product in embedding space ("similar products")
CREATE FUNCTION similar_products(p_product_id BIGINT, p_limit INT DEFAULT 8)
RETURNS TABLE (product_id BIGINT, similarity DOUBLE PRECISION)
LANGUAGE sql STABLE AS $$
  SELECT n.product_id, 1 - n.dist
    FROM product_embeddings src
   CROSS JOIN LATERAL (
     SELECT pe.product_id, pe.embedding <=> src.embedding AS dist
       FROM product_embeddings pe
       JOIN products p ON p.product_id = pe.product_id AND p.is_active
      WHERE pe.product_id <> src.product_id
      ORDER BY pe.embedding <=> src.embedding
      LIMIT p_limit
   ) n
   WHERE src.product_id = p_product_id
   ORDER BY n.dist
$$;

-- Personalised recommendations for the CURRENT user (taste vector nearest neighbours,
-- excluding anything already bought and anything out of stock)
CREATE FUNCTION recommend_for_me(p_limit INT DEFAULT 12)
RETURNS TABLE (product_id BIGINT, similarity DOUBLE PRECISION)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT n.product_id, 1 - n.dist
    FROM customer_profiles cp
   CROSS JOIN LATERAL (
     SELECT pe.product_id, pe.embedding <=> cp.taste_embedding AS dist
       FROM product_embeddings pe
       JOIN products p ON p.product_id = pe.product_id
      WHERE p.is_active AND p.stock_qty > 0
        AND NOT EXISTS (SELECT 1
                          FROM orders o JOIN order_items oi USING (order_id)
                         WHERE o.user_id = cp.user_id AND oi.product_id = pe.product_id)
      ORDER BY pe.embedding <=> cp.taste_embedding
      LIMIT p_limit
   ) n
   WHERE cp.user_id = app_user_id() AND cp.taste_embedding IS NOT NULL
   ORDER BY n.dist
$$;

-- ---------------------------------------------------------------------
-- Concurrency-lab helpers (admin only)
-- ---------------------------------------------------------------------
-- Resets the lab product to exactly one unit in stock and returns its id
CREATE FUNCTION demo_reset_lab_product() RETURNS BIGINT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_id BIGINT;
BEGIN
  PERFORM assert_admin();
  UPDATE products SET stock_qty = 1 WHERE asin = 'LAB-LAST-UNIT' RETURNING product_id INTO v_id;
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'Lab product missing — run the seed script';
  END IF;
  DELETE FROM cart_items WHERE product_id = v_id;
  RETURN v_id;
END $$;

-- The WRONG way: read stock without a lock, "think", then write back a value computed
-- in application code. Two concurrent calls both read 1, both write 0 => lost update, oversold.
CREATE FUNCTION demo_unsafe_purchase(p_product_id BIGINT, p_hold_seconds NUMERIC DEFAULT 1)
RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_stock INT;
BEGIN
  PERFORM assert_admin();
  SELECT stock_qty INTO v_stock FROM products WHERE product_id = p_product_id;   -- no FOR UPDATE
  PERFORM pg_sleep(least(p_hold_seconds, 5));
  IF v_stock < 1 THEN
    RETURN format('rejected (read stock=%s)', v_stock);
  END IF;
  UPDATE products SET stock_qty = v_stock - 1 WHERE product_id = p_product_id;    -- blind write
  RETURN format('SOLD (read stock=%s, wrote %s)', v_stock, v_stock - 1);
END $$;
