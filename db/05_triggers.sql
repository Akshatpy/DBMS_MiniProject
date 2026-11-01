-- =====================================================================
-- 05  Triggers
-- =====================================================================
-- Trigger functions that write to tables the app role cannot touch directly
-- (stock_alerts, embedding_jobs, order_status_history, products.avg_rating) are SECURITY DEFINER:
-- the side effect is guaranteed by the database, whatever role caused the triggering statement.

-- ---------------------------------------------------------------------
-- T1. Normalise emails before they are stored (BEFORE row trigger)
-- ---------------------------------------------------------------------
CREATE FUNCTION trg_fn_users_normalise() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  NEW.email := lower(btrim(NEW.email));
  NEW.full_name := btrim(NEW.full_name);
  RETURN NEW;
END $$;

CREATE TRIGGER trg_users_normalise
  BEFORE INSERT OR UPDATE OF email, full_name ON users
  FOR EACH ROW EXECUTE FUNCTION trg_fn_users_normalise();

-- ---------------------------------------------------------------------
-- T2. Maintain updated_at columns
-- ---------------------------------------------------------------------
CREATE FUNCTION trg_fn_touch_updated_at() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

CREATE TRIGGER trg_products_touch BEFORE UPDATE ON products
  FOR EACH ROW EXECUTE FUNCTION trg_fn_touch_updated_at();
CREATE TRIGGER trg_orders_touch BEFORE UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION trg_fn_touch_updated_at();

-- ---------------------------------------------------------------------
-- T3. LOW-STOCK ALERTS
-- Opens an alert when stock crosses below the seller's threshold, resolves it on restock.
-- The partial unique index uq_stock_alerts_open guarantees one open alert per product.
-- ---------------------------------------------------------------------
CREATE FUNCTION trg_fn_stock_alert() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.stock_qty < NEW.reorder_threshold THEN
    INSERT INTO stock_alerts (product_id, stock_qty, threshold)
    VALUES (NEW.product_id, NEW.stock_qty, NEW.reorder_threshold)
    ON CONFLICT (product_id) WHERE resolved_at IS NULL
    DO UPDATE SET stock_qty = EXCLUDED.stock_qty, threshold = EXCLUDED.threshold;
    PERFORM pg_notify('stock_alerts', json_build_object(
      'product_id', NEW.product_id, 'seller_id', NEW.seller_id, 'stock_qty', NEW.stock_qty)::TEXT);
  ELSE
    UPDATE stock_alerts SET resolved_at = now()
     WHERE product_id = NEW.product_id AND resolved_at IS NULL;
  END IF;
  RETURN NULL;   -- AFTER trigger: return value ignored
END $$;

CREATE TRIGGER trg_products_stock_alert
  AFTER INSERT OR UPDATE OF stock_qty, reorder_threshold ON products
  FOR EACH ROW EXECUTE FUNCTION trg_fn_stock_alert();

-- ---------------------------------------------------------------------
-- T4. EMBEDDING CONSISTENCY
-- Whenever text that feeds an embedding changes, queue a re-embedding job and NOTIFY the worker.
-- ON CONFLICT against the partial unique index de-duplicates bursts of edits.
-- ---------------------------------------------------------------------
CREATE FUNCTION trg_fn_enqueue_embedding() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_type TEXT := TG_ARGV[0];
  -- generic over both tables: read "<type>_id" from the row as JSON
  v_id   BIGINT := (to_jsonb(NEW) ->> (TG_ARGV[0] || '_id'))::BIGINT;
BEGIN
  INSERT INTO embedding_jobs (entity_type, entity_id)
  VALUES (v_type, v_id)
  ON CONFLICT (entity_type, entity_id) WHERE processed_at IS NULL DO NOTHING;
  PERFORM pg_notify('embedding_jobs', v_type || ':' || v_id);
  RETURN NULL;
END $$;

CREATE TRIGGER trg_products_enqueue_embedding_ins
  AFTER INSERT ON products
  FOR EACH ROW EXECUTE FUNCTION trg_fn_enqueue_embedding('product');

CREATE TRIGGER trg_products_enqueue_embedding_upd
  AFTER UPDATE OF title, brand, description, features, category_id ON products
  FOR EACH ROW
  WHEN (OLD.title       IS DISTINCT FROM NEW.title
     OR OLD.brand       IS DISTINCT FROM NEW.brand
     OR OLD.description IS DISTINCT FROM NEW.description
     OR OLD.features    IS DISTINCT FROM NEW.features
     OR OLD.category_id IS DISTINCT FROM NEW.category_id)
  EXECUTE FUNCTION trg_fn_enqueue_embedding('product');

CREATE TRIGGER trg_reviews_enqueue_embedding_ins
  AFTER INSERT ON reviews
  FOR EACH ROW EXECUTE FUNCTION trg_fn_enqueue_embedding('review');

CREATE TRIGGER trg_reviews_enqueue_embedding_upd
  AFTER UPDATE OF title, body ON reviews
  FOR EACH ROW
  WHEN (OLD.title IS DISTINCT FROM NEW.title OR OLD.body IS DISTINCT FROM NEW.body)
  EXECUTE FUNCTION trg_fn_enqueue_embedding('review');

-- ---------------------------------------------------------------------
-- T5. VERIFIED PURCHASE — computed by the database, never trusted from the client
-- ---------------------------------------------------------------------
CREATE FUNCTION trg_fn_review_verify() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  NEW.verified_purchase := EXISTS (
    SELECT 1
      FROM orders o JOIN order_items oi USING (order_id)
     WHERE o.user_id = NEW.user_id
       AND oi.product_id = NEW.product_id
       AND o.status IN ('paid', 'shipped', 'delivered'));
  RETURN NEW;
END $$;

CREATE TRIGGER trg_reviews_verify
  BEFORE INSERT ON reviews
  FOR EACH ROW EXECUTE FUNCTION trg_fn_review_verify();

-- ---------------------------------------------------------------------
-- T6. RATING AGGREGATES — STATEMENT-level triggers with TRANSITION TABLES.
-- A bulk insert of 10,000 reviews recomputes each affected product once, not 10,000 times.
-- ---------------------------------------------------------------------
CREATE FUNCTION recompute_product_ratings(p_product_ids BIGINT[]) RETURNS VOID
LANGUAGE sql AS $$
  UPDATE products p
     SET avg_rating   = coalesce(s.avg_rating, 0),
         review_count = coalesce(s.cnt, 0)
    FROM (SELECT ids.product_id,
                 round(avg(r.rating), 1) AS avg_rating,
                 count(r.review_id)      AS cnt
            FROM unnest(p_product_ids) AS ids(product_id)
            LEFT JOIN reviews r ON r.product_id = ids.product_id
           GROUP BY ids.product_id) s
   WHERE p.product_id = s.product_id
$$;

CREATE FUNCTION trg_fn_review_stats_ins() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM recompute_product_ratings(ARRAY(SELECT DISTINCT product_id FROM new_rows));
  RETURN NULL;
END $$;

CREATE FUNCTION trg_fn_review_stats_upd() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM recompute_product_ratings(ARRAY(
    SELECT product_id FROM new_rows UNION SELECT product_id FROM old_rows));
  RETURN NULL;
END $$;

CREATE FUNCTION trg_fn_review_stats_del() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM recompute_product_ratings(ARRAY(SELECT DISTINCT product_id FROM old_rows));
  RETURN NULL;
END $$;

CREATE TRIGGER trg_reviews_stats_ins AFTER INSERT ON reviews
  REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION trg_fn_review_stats_ins();

CREATE TRIGGER trg_reviews_stats_upd AFTER UPDATE ON reviews
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION trg_fn_review_stats_upd();

CREATE TRIGGER trg_reviews_stats_del AFTER DELETE ON reviews
  REFERENCING OLD TABLE AS old_rows
  FOR EACH STATEMENT EXECUTE FUNCTION trg_fn_review_stats_del();

-- ---------------------------------------------------------------------
-- T7. ORDER STATE MACHINE — reject illegal status transitions
--     pending -> paid | cancelled
--     paid    -> shipped | cancelled
--     shipped -> delivered
--     delivered, cancelled are terminal
-- ---------------------------------------------------------------------
CREATE FUNCTION trg_fn_order_status_guard() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = OLD.status THEN
    RETURN NEW;
  END IF;
  IF NOT (
       (OLD.status = 'pending' AND NEW.status IN ('paid', 'cancelled'))
    OR (OLD.status = 'paid'    AND NEW.status IN ('shipped', 'cancelled'))
    OR (OLD.status = 'shipped' AND NEW.status = 'delivered')
  ) THEN
    RAISE EXCEPTION 'Illegal order status change % -> % (order %)', OLD.status, NEW.status, OLD.order_id
      USING ERRCODE = 'SS004';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_orders_status_guard
  BEFORE UPDATE OF status ON orders
  FOR EACH ROW EXECUTE FUNCTION trg_fn_order_status_guard();

-- T8. Audit trail of every status change
CREATE FUNCTION trg_fn_order_status_history() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO order_status_history (order_id, old_status, new_status, changed_by, changed_at)
    VALUES (NEW.order_id, NULL, NEW.status, app_user_id(), NEW.placed_at);
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO order_status_history (order_id, old_status, new_status, changed_by)
    VALUES (NEW.order_id, OLD.status, NEW.status, app_user_id());
  END IF;
  RETURN NULL;
END $$;

CREATE TRIGGER trg_orders_status_history
  AFTER INSERT OR UPDATE OF status ON orders
  FOR EACH ROW EXECUTE FUNCTION trg_fn_order_status_history();

-- ---------------------------------------------------------------------
-- T9. Cart validation: cannot add more units than are in stock, or inactive products
-- ---------------------------------------------------------------------
CREATE FUNCTION trg_fn_cart_item_validate() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_stock  INT;
  v_active BOOLEAN;
  v_title  TEXT;
BEGIN
  SELECT stock_qty, is_active, title INTO v_stock, v_active, v_title
    FROM products WHERE product_id = NEW.product_id;
  IF NOT v_active THEN
    RAISE EXCEPTION '"%" is not available', v_title USING ERRCODE = 'SS003';
  END IF;
  IF NEW.quantity > v_stock THEN
    RAISE EXCEPTION 'Only % unit(s) of "%" in stock', v_stock, v_title USING ERRCODE = 'SS001';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_cart_items_validate
  BEFORE INSERT OR UPDATE OF quantity ON cart_items
  FOR EACH ROW EXECUTE FUNCTION trg_fn_cart_item_validate();
