-- =====================================================================
-- 07  Authorization: least-privilege application role + Row-Level Security
-- =====================================================================
-- Two database roles:
--   shopsense_owner : owns every object; used only by migration/seed/worker scripts
--   shopsense_app   : what the Next.js API connects as. Gets only the privileges listed
--                     here, and every row it touches is filtered by the RLS policies below.
-- The API identifies the end user per transaction:  SELECT set_config('app.user_id', '42', true)
-- and the policies derive that user's role from the users table (never from the client).
-- (db-setup.mjs creates shopsense_app with the password from APP_DB_PASSWORD.)

REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO shopsense_app;

-- ---------------------------------------------------------------------
-- Object & column privileges
-- ---------------------------------------------------------------------
GRANT SELECT ON categories, sellers, products, reviews, product_embeddings, review_embeddings,
                carts, cart_items, orders, order_items, payments, order_status_history,
                stock_alerts, addresses, customer_profiles, search_logs, eval_runs, embedding_jobs
  TO shopsense_app;

-- Column-level privilege: the app can never read password hashes
GRANT SELECT (user_id, email, full_name, phone, role, is_active, created_at, last_login_at)
  ON users TO shopsense_app;
GRANT UPDATE (is_active) ON users TO shopsense_app;

GRANT SELECT ON v_product_cards, v_public_reviews, v_sales_lines, v_low_stock, v_category_tree,
                mv_product_pairs
  TO shopsense_app;

GRANT INSERT, UPDATE, DELETE ON cart_items, addresses TO shopsense_app;
GRANT INSERT, DELETE ON reviews TO shopsense_app;
GRANT UPDATE (rating, title, body) ON reviews TO shopsense_app;
GRANT INSERT ON search_logs, eval_runs TO shopsense_app;
GRANT INSERT ON products TO shopsense_app;
GRANT UPDATE (title, brand, description, features, price, mrp, stock_qty, reorder_threshold,
              image_url, is_active, category_id)
  ON products TO shopsense_app;
GRANT UPDATE (status) ON orders TO shopsense_app;
GRANT UPDATE (date_of_birth, preferred_category_id) ON customer_profiles TO shopsense_app;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO shopsense_app;

-- Functions are executable by PUBLIC by default; lock down the privileged ones
REVOKE EXECUTE ON FUNCTION refresh_all_taste_profiles(), recompute_product_ratings(BIGINT[])
  FROM PUBLIC;

-- ---------------------------------------------------------------------
-- RLS helper functions (SECURITY DEFINER so policies don't recurse into each other)
-- ---------------------------------------------------------------------
CREATE FUNCTION my_order_ids() RETURNS SETOF BIGINT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT order_id FROM orders WHERE user_id = app_user_id()
$$;

CREATE FUNCTION my_seller_order_ids() RETURNS SETOF BIGINT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT DISTINCT oi.order_id
    FROM order_items oi JOIN products p USING (product_id)
   WHERE p.seller_id = app_user_id()
$$;

CREATE FUNCTION my_cart_id() RETURNS BIGINT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT cart_id FROM carts WHERE user_id = app_user_id()
$$;

-- ---------------------------------------------------------------------
-- Policies.  (SELECT f()) wraps a function as an InitPlan, so it runs once per query, not per row.
-- ---------------------------------------------------------------------
ALTER TABLE users                ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_profiles    ENABLE ROW LEVEL SECURITY;
ALTER TABLE addresses            ENABLE ROW LEVEL SECURITY;
ALTER TABLE products             ENABLE ROW LEVEL SECURITY;
ALTER TABLE reviews              ENABLE ROW LEVEL SECURITY;
ALTER TABLE carts                ENABLE ROW LEVEL SECURITY;
ALTER TABLE cart_items           ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders               ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_items          ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments             ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_status_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_alerts         ENABLE ROW LEVEL SECURITY;
ALTER TABLE search_logs          ENABLE ROW LEVEL SECURITY;

-- users: see yourself; admins see and (de)activate everyone
CREATE POLICY users_select ON users FOR SELECT
  USING (user_id = (SELECT app_user_id()) OR (SELECT is_admin()));
CREATE POLICY users_admin_update ON users FOR UPDATE
  USING ((SELECT is_admin())) WITH CHECK ((SELECT is_admin()));

CREATE POLICY profiles_owner ON customer_profiles FOR ALL
  USING (user_id = (SELECT app_user_id()) OR (SELECT is_admin()))
  WITH CHECK (user_id = (SELECT app_user_id()));

CREATE POLICY addresses_owner ON addresses FOR ALL
  USING (user_id = (SELECT app_user_id()) OR (SELECT is_admin()))
  WITH CHECK (user_id = (SELECT app_user_id()));

-- products: everyone browses active products; sellers manage only their own; no hard deletes
CREATE POLICY products_select ON products FOR SELECT
  USING (is_active OR seller_id = (SELECT app_user_id()) OR (SELECT is_admin()));
CREATE POLICY products_insert ON products FOR INSERT
  WITH CHECK ((seller_id = (SELECT app_user_id()) AND (SELECT app_role()) = 'seller') OR (SELECT is_admin()));
CREATE POLICY products_update ON products FOR UPDATE
  USING (seller_id = (SELECT app_user_id()) OR (SELECT is_admin()))
  WITH CHECK (seller_id = (SELECT app_user_id()) OR (SELECT is_admin()));

-- reviews: public to read; only customers write, and only as themselves
CREATE POLICY reviews_select ON reviews FOR SELECT USING (TRUE);
CREATE POLICY reviews_insert ON reviews FOR INSERT
  WITH CHECK (user_id = (SELECT app_user_id()) AND (SELECT app_role()) = 'customer');
CREATE POLICY reviews_update ON reviews FOR UPDATE
  USING (user_id = (SELECT app_user_id())) WITH CHECK (user_id = (SELECT app_user_id()));
CREATE POLICY reviews_delete ON reviews FOR DELETE
  USING (user_id = (SELECT app_user_id()) OR (SELECT is_admin()));

CREATE POLICY carts_owner ON carts FOR ALL
  USING (user_id = (SELECT app_user_id()));
CREATE POLICY cart_items_owner ON cart_items FOR ALL
  USING (cart_id = (SELECT my_cart_id())) WITH CHECK (cart_id = (SELECT my_cart_id()));

-- orders: customer sees own; seller sees orders that contain their products; admin sees all
CREATE POLICY orders_select ON orders FOR SELECT
  USING (user_id = (SELECT app_user_id())
         OR (SELECT is_admin())
         OR ((SELECT app_role()) = 'seller' AND order_id IN (SELECT my_seller_order_ids())));
-- status updates (ship / deliver) by admin or a seller involved in the order;
-- the state-machine trigger still decides which transitions are legal
CREATE POLICY orders_update ON orders FOR UPDATE
  USING ((SELECT is_admin()) OR ((SELECT app_role()) = 'seller' AND order_id IN (SELECT my_seller_order_ids())));

-- order lines: a seller sees ONLY the lines for their own products, even inside a shared order
CREATE POLICY order_items_select ON order_items FOR SELECT
  USING (order_id IN (SELECT my_order_ids())
         OR (SELECT is_admin())
         OR product_id IN (SELECT product_id FROM products WHERE seller_id = (SELECT app_user_id())));

CREATE POLICY payments_select ON payments FOR SELECT
  USING (order_id IN (SELECT my_order_ids()) OR (SELECT is_admin()));

CREATE POLICY status_history_select ON order_status_history FOR SELECT
  USING (order_id IN (SELECT my_order_ids())
         OR (SELECT is_admin())
         OR ((SELECT app_role()) = 'seller' AND order_id IN (SELECT my_seller_order_ids())));

CREATE POLICY stock_alerts_select ON stock_alerts FOR SELECT
  USING ((SELECT is_admin())
         OR product_id IN (SELECT product_id FROM products WHERE seller_id = (SELECT app_user_id())));

CREATE POLICY search_logs_insert ON search_logs FOR INSERT
  WITH CHECK (user_id IS NULL OR user_id = (SELECT app_user_id()));
CREATE POLICY search_logs_select ON search_logs FOR SELECT
  USING ((SELECT is_admin()));
