# Data Dictionary

_Generated from the live PostgreSQL catalog on 2026-10-27 by `npm run docs`._

## addresses

| Column | Type | Null | Default / generated | Keys |
|---|---|---|---|---|
| address_id | bigint | no |  | PK |
| user_id | bigint | no |  | FK → users |
| label | text | no | 'Home'::text |  |
| line1 | text | no |  |  |
| line2 | text | yes |  |  |
| city | text | no |  |  |
| state | text | no |  |  |
| pincode | indian_pincode | no |  |  |
| is_default | boolean | no | false |  |

**CHECK constraints**

- `addresses_label_check`: `CHECK ((length(label) <= 30))`
- `addresses_line1_check`: `CHECK ((length(btrim(line1)) >= 3))`

**Foreign keys**

- `addresses_user_id_fkey`: `FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE`

**Indexes**

- `CREATE UNIQUE INDEX addresses_pkey ON public.addresses USING btree (address_id)`
- `CREATE INDEX idx_addresses_user ON public.addresses USING btree (user_id)`
- `CREATE UNIQUE INDEX uq_addresses_one_default ON public.addresses USING btree (user_id) WHERE is_default`

**Row-Level Security policies**

- `addresses_owner` (ALL) USING `((user_id = ( SELECT app_user_id() AS app_user_id)) OR ( SELECT is_admin() AS is_admin))` WITH CHECK `(user_id = ( SELECT app_user_id() AS app_user_id))`

## cart_items

| Column | Type | Null | Default / generated | Keys |
|---|---|---|---|---|
| cart_id | bigint | no |  | PK, FK → carts |
| product_id | bigint | no |  | FK → products, PK |
| quantity | integer | no |  |  |
| added_at | timestamp with time zone | no | now() |  |

**CHECK constraints**

- `cart_items_quantity_check`: `CHECK (((quantity >= 1) AND (quantity <= 10)))`

**Foreign keys**

- `cart_items_cart_id_fkey`: `FOREIGN KEY (cart_id) REFERENCES carts(cart_id) ON DELETE CASCADE`
- `cart_items_product_id_fkey`: `FOREIGN KEY (product_id) REFERENCES products(product_id) ON DELETE CASCADE`

**Indexes**

- `CREATE UNIQUE INDEX cart_items_pkey ON public.cart_items USING btree (cart_id, product_id)`
- `CREATE INDEX idx_cart_items_product ON public.cart_items USING btree (product_id)`

**Triggers**

- `CREATE TRIGGER trg_cart_items_validate BEFORE INSERT OR UPDATE OF quantity ON public.cart_items FOR EACH ROW EXECUTE FUNCTION trg_fn_cart_item_validate()`

**Row-Level Security policies**

- `cart_items_owner` (ALL) USING `(cart_id = ( SELECT my_cart_id() AS my_cart_id))` WITH CHECK `(cart_id = ( SELECT my_cart_id() AS my_cart_id))`

## carts

| Column | Type | Null | Default / generated | Keys |
|---|---|---|---|---|
| cart_id | bigint | no |  | PK |
| user_id | bigint | no |  | UNIQUE, FK → users |
| updated_at | timestamp with time zone | no | now() |  |

**Foreign keys**

- `carts_user_id_fkey`: `FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE`

**Indexes**

- `CREATE UNIQUE INDEX carts_pkey ON public.carts USING btree (cart_id)`
- `CREATE UNIQUE INDEX carts_user_id_key ON public.carts USING btree (user_id)`

**Row-Level Security policies**

- `carts_owner` (ALL) USING `(user_id = ( SELECT app_user_id() AS app_user_id))`

## categories

| Column | Type | Null | Default / generated | Keys |
|---|---|---|---|---|
| category_id | integer | no |  | PK |
| name | text | no |  | UNIQUE |
| slug | text | no |  | UNIQUE |
| parent_id | integer | yes |  | UNIQUE, FK → categories |

**CHECK constraints**

- `categories_name_check`: `CHECK ((length(btrim(name)) >= 2))`
- `categories_slug_check`: `CHECK ((slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'::text))`
- `chk_category_not_own_parent`: `CHECK ((parent_id IS DISTINCT FROM category_id))`

**Foreign keys**

- `categories_parent_id_fkey`: `FOREIGN KEY (parent_id) REFERENCES categories(category_id) ON DELETE RESTRICT`

**Indexes**

- `CREATE UNIQUE INDEX categories_pkey ON public.categories USING btree (category_id)`
- `CREATE UNIQUE INDEX categories_slug_key ON public.categories USING btree (slug)`
- `CREATE INDEX idx_categories_parent ON public.categories USING btree (parent_id)`
- `CREATE UNIQUE INDEX uq_category_name_per_parent ON public.categories USING btree (parent_id, name)`

## customer_profiles

| Column | Type | Null | Default / generated | Keys |
|---|---|---|---|---|
| user_id | bigint | no |  | PK, FK → users |
| date_of_birth | date | yes |  |  |
| preferred_category_id | integer | yes |  | FK → categories |
| taste_embedding | vector(384) | yes |  |  |
| taste_updated_at | timestamp with time zone | yes |  |  |

**CHECK constraints**

- `customer_profiles_date_of_birth_check`: `CHECK ((date_of_birth >= '1900-01-01'::date))`

**Foreign keys**

- `customer_profiles_preferred_category_id_fkey`: `FOREIGN KEY (preferred_category_id) REFERENCES categories(category_id) ON DELETE SET NULL`
- `customer_profiles_user_id_fkey`: `FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE`

**Indexes**

- `CREATE UNIQUE INDEX customer_profiles_pkey ON public.customer_profiles USING btree (user_id)`

**Row-Level Security policies**

- `profiles_owner` (ALL) USING `((user_id = ( SELECT app_user_id() AS app_user_id)) OR ( SELECT is_admin() AS is_admin))` WITH CHECK `(user_id = ( SELECT app_user_id() AS app_user_id))`

## embedding_jobs

| Column | Type | Null | Default / generated | Keys |
|---|---|---|---|---|
| job_id | bigint | no |  | PK |
| entity_type | text | no |  |  |
| entity_id | bigint | no |  |  |
| enqueued_at | timestamp with time zone | no | now() |  |
| started_at | timestamp with time zone | yes |  |  |
| processed_at | timestamp with time zone | yes |  |  |
| attempts | integer | no | 0 |  |
| last_error | text | yes |  |  |

**CHECK constraints**

- `chk_jobs_processed_after_enqueue`: `CHECK (((processed_at IS NULL) OR (processed_at >= enqueued_at)))`
- `embedding_jobs_attempts_check`: `CHECK ((attempts >= 0))`
- `embedding_jobs_entity_type_check`: `CHECK ((entity_type = ANY (ARRAY['product'::text, 'review'::text])))`

**Indexes**

- `CREATE UNIQUE INDEX embedding_jobs_pkey ON public.embedding_jobs USING btree (job_id)`
- `CREATE INDEX idx_embedding_jobs_queue ON public.embedding_jobs USING btree (enqueued_at) WHERE (processed_at IS NULL)`
- `CREATE UNIQUE INDEX uq_embedding_jobs_pending ON public.embedding_jobs USING btree (entity_type, entity_id) WHERE (processed_at IS NULL)`

## eval_runs

| Column | Type | Null | Default / generated | Keys |
|---|---|---|---|---|
| run_id | bigint | no |  | PK |
| mode | search_mode | no |  |  |
| model | text | no |  |  |
| k | integer | no |  |  |
| query_count | integer | no |  |  |
| precision_at_k | numeric(5,4) | yes |  |  |
| recall_at_k | numeric(5,4) | yes |  |  |
| mrr | numeric(5,4) | yes |  |  |
| ndcg_at_k | numeric(5,4) | yes |  |  |
| avg_latency_ms | numeric(10,2) | yes |  |  |
| details | jsonb | no | '{}'::jsonb |  |
| run_at | timestamp with time zone | no | now() |  |

**CHECK constraints**

- `eval_runs_k_check`: `CHECK ((k > 0))`
- `eval_runs_mrr_check`: `CHECK (((mrr >= (0)::numeric) AND (mrr <= (1)::numeric)))`
- `eval_runs_ndcg_at_k_check`: `CHECK (((ndcg_at_k >= (0)::numeric) AND (ndcg_at_k <= (1)::numeric)))`
- `eval_runs_precision_at_k_check`: `CHECK (((precision_at_k >= (0)::numeric) AND (precision_at_k <= (1)::numeric)))`
- `eval_runs_query_count_check`: `CHECK ((query_count > 0))`
- `eval_runs_recall_at_k_check`: `CHECK (((recall_at_k >= (0)::numeric) AND (recall_at_k <= (1)::numeric)))`

**Indexes**

- `CREATE UNIQUE INDEX eval_runs_pkey ON public.eval_runs USING btree (run_id)`

## order_items

| Column | Type | Null | Default / generated | Keys |
|---|---|---|---|---|
| order_id | bigint | no |  | PK, FK → orders |
| product_id | bigint | no |  | PK, FK → products |
| quantity | integer | no |  |  |
| unit_price | money_inr | no |  |  |
| line_total | numeric(12,2) | yes | _generated_ |  |

**CHECK constraints**

- `order_items_quantity_check`: `CHECK ((quantity > 0))`
- `order_items_unit_price_check`: `CHECK (((unit_price)::numeric > (0)::numeric))`

**Foreign keys**

- `order_items_order_id_fkey`: `FOREIGN KEY (order_id) REFERENCES orders(order_id) ON DELETE CASCADE`
- `order_items_product_id_fkey`: `FOREIGN KEY (product_id) REFERENCES products(product_id) ON DELETE RESTRICT`

**Indexes**

- `CREATE INDEX idx_order_items_product ON public.order_items USING btree (product_id)`
- `CREATE UNIQUE INDEX order_items_pkey ON public.order_items USING btree (order_id, product_id)`

**Row-Level Security policies**

- `order_items_select` (SELECT) USING `((order_id IN ( SELECT my_order_ids() AS my_order_ids)) OR ( SELECT is_admin() AS is_admin) OR (product_id IN ( SELECT products.product_id    FROM products   WHERE (products.seller_id = ( SELECT app_user_id() AS app_user_id)))))`

## order_status_history

| Column | Type | Null | Default / generated | Keys |
|---|---|---|---|---|
| history_id | bigint | no |  | PK |
| order_id | bigint | no |  | FK → orders |
| old_status | order_status | yes |  |  |
| new_status | order_status | no |  |  |
| changed_by | bigint | yes |  | FK → users |
| changed_at | timestamp with time zone | no | now() |  |

**Foreign keys**

- `order_status_history_changed_by_fkey`: `FOREIGN KEY (changed_by) REFERENCES users(user_id) ON DELETE SET NULL`
- `order_status_history_order_id_fkey`: `FOREIGN KEY (order_id) REFERENCES orders(order_id) ON DELETE CASCADE`

**Indexes**

- `CREATE INDEX idx_status_hist_order ON public.order_status_history USING btree (order_id, changed_at)`
- `CREATE UNIQUE INDEX order_status_history_pkey ON public.order_status_history USING btree (history_id)`

**Row-Level Security policies**

- `status_history_select` (SELECT) USING `((order_id IN ( SELECT my_order_ids() AS my_order_ids)) OR ( SELECT is_admin() AS is_admin) OR ((( SELECT app_role() AS app_role) = 'seller'::user_role) AND (order_id IN ( SELECT my_seller_order_ids() AS my_seller_order_ids))))`

## orders

| Column | Type | Null | Default / generated | Keys |
|---|---|---|---|---|
| order_id | bigint | no |  | PK |
| user_id | bigint | no |  | FK → users |
| address_id | bigint | no |  | FK → addresses |
| status | order_status | no | 'pending'::order_status |  |
| subtotal | money_inr | no |  |  |
| shipping_fee | money_inr | no | 0 |  |
| total_amount | money_inr | no |  |  |
| placed_at | timestamp with time zone | no | now() |  |
| updated_at | timestamp with time zone | no | now() |  |

**CHECK constraints**

- `chk_orders_total`: `CHECK (((total_amount)::numeric = ((subtotal)::numeric + (shipping_fee)::numeric)))`

**Foreign keys**

- `orders_address_id_fkey`: `FOREIGN KEY (address_id) REFERENCES addresses(address_id) ON DELETE RESTRICT`
- `orders_user_id_fkey`: `FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE RESTRICT`

**Indexes**

- `CREATE INDEX idx_orders_placed ON public.orders USING btree (placed_at)`
- `CREATE INDEX idx_orders_user_placed ON public.orders USING btree (user_id, placed_at DESC)`
- `CREATE UNIQUE INDEX orders_pkey ON public.orders USING btree (order_id)`

**Triggers**

- `CREATE TRIGGER trg_orders_status_guard BEFORE UPDATE OF status ON public.orders FOR EACH ROW EXECUTE FUNCTION trg_fn_order_status_guard()`
- `CREATE TRIGGER trg_orders_status_history AFTER INSERT OR UPDATE OF status ON public.orders FOR EACH ROW EXECUTE FUNCTION trg_fn_order_status_history()`
- `CREATE TRIGGER trg_orders_touch BEFORE UPDATE ON public.orders FOR EACH ROW EXECUTE FUNCTION trg_fn_touch_updated_at()`

**Row-Level Security policies**

- `orders_select` (SELECT) USING `((user_id = ( SELECT app_user_id() AS app_user_id)) OR ( SELECT is_admin() AS is_admin) OR ((( SELECT app_role() AS app_role) = 'seller'::user_role) AND (order_id IN ( SELECT my_seller_order_ids() AS my_seller_order_ids))))`
- `orders_update` (UPDATE) USING `(( SELECT is_admin() AS is_admin) OR ((( SELECT app_role() AS app_role) = 'seller'::user_role) AND (order_id IN ( SELECT my_seller_order_ids() AS my_seller_order_ids))))`

## payments

| Column | Type | Null | Default / generated | Keys |
|---|---|---|---|---|
| payment_id | bigint | no |  | PK |
| order_id | bigint | no |  | UNIQUE, FK → orders |
| method | payment_method | no |  |  |
| amount | money_inr | no |  |  |
| status | payment_status | no | 'pending'::payment_status |  |
| transaction_ref | text | yes |  | UNIQUE |
| created_at | timestamp with time zone | no | now() |  |

**Foreign keys**

- `payments_order_id_fkey`: `FOREIGN KEY (order_id) REFERENCES orders(order_id) ON DELETE CASCADE`

**Indexes**

- `CREATE UNIQUE INDEX payments_order_id_key ON public.payments USING btree (order_id)`
- `CREATE UNIQUE INDEX payments_pkey ON public.payments USING btree (payment_id)`
- `CREATE UNIQUE INDEX payments_transaction_ref_key ON public.payments USING btree (transaction_ref)`

**Row-Level Security policies**

- `payments_select` (SELECT) USING `((order_id IN ( SELECT my_order_ids() AS my_order_ids)) OR ( SELECT is_admin() AS is_admin))`

## product_embeddings

| Column | Type | Null | Default / generated | Keys |
|---|---|---|---|---|
| product_id | bigint | no |  | PK, FK → products |
| embedding | vector(384) | no |  |  |
| model | text | no |  |  |
| source_hash | text | no |  |  |
| embedded_at | timestamp with time zone | no | now() |  |

**Foreign keys**

- `product_embeddings_product_id_fkey`: `FOREIGN KEY (product_id) REFERENCES products(product_id) ON DELETE CASCADE`

**Indexes**

- `CREATE INDEX idx_product_embeddings_hnsw ON public.product_embeddings USING hnsw (embedding vector_cosine_ops) WITH (m='16', ef_construction='64')`
- `CREATE UNIQUE INDEX product_embeddings_pkey ON public.product_embeddings USING btree (product_id)`

## products

| Column | Type | Null | Default / generated | Keys |
|---|---|---|---|---|
| product_id | bigint | no |  | PK |
| seller_id | bigint | no |  | FK → sellers |
| category_id | integer | no |  | FK → categories |
| asin | text | yes |  | UNIQUE |
| title | text | no |  |  |
| brand | text | yes |  |  |
| description | text | no | ''::text |  |
| features | text | no | ''::text |  |
| price | money_inr | no |  |  |
| mrp | money_inr | no |  |  |
| stock_qty | integer | no | 0 |  |
| reorder_threshold | integer | no | 10 |  |
| image_url | text | yes |  |  |
| avg_rating | numeric(2,1) | no | 0 |  |
| review_count | integer | no | 0 |  |
| is_active | boolean | no | true |  |
| created_at | timestamp with time zone | no | now() |  |
| updated_at | timestamp with time zone | no | now() |  |
| search_tsv | tsvector | yes | _generated_ |  |

**CHECK constraints**

- `chk_products_mrp_ge_price`: `CHECK (((mrp)::numeric >= (price)::numeric))`
- `products_avg_rating_check`: `CHECK (((avg_rating >= (0)::numeric) AND (avg_rating <= (5)::numeric)))`
- `products_image_url_check`: `CHECK ((image_url ~ '^https?://'::text))`
- `products_price_check`: `CHECK (((price)::numeric > (0)::numeric))`
- `products_reorder_threshold_check`: `CHECK (((reorder_threshold >= 0) AND (reorder_threshold <= 10000)))`
- `products_review_count_check`: `CHECK ((review_count >= 0))`
- `products_stock_qty_check`: `CHECK ((stock_qty >= 0))`
- `products_title_check`: `CHECK (((length(btrim(title)) >= 3) AND (length(btrim(title)) <= 300)))`

**Foreign keys**

- `products_category_id_fkey`: `FOREIGN KEY (category_id) REFERENCES categories(category_id) ON DELETE RESTRICT`
- `products_seller_id_fkey`: `FOREIGN KEY (seller_id) REFERENCES sellers(seller_id) ON DELETE RESTRICT`

**Indexes**

- `CREATE INDEX idx_products_active_price ON public.products USING btree (category_id, price) WHERE is_active`
- `CREATE INDEX idx_products_category ON public.products USING btree (category_id)`
- `CREATE INDEX idx_products_search_tsv ON public.products USING gin (search_tsv)`
- `CREATE INDEX idx_products_seller ON public.products USING btree (seller_id)`
- `CREATE INDEX idx_products_title_trgm ON public.products USING gin (title gin_trgm_ops)`
- `CREATE UNIQUE INDEX products_asin_key ON public.products USING btree (asin)`
- `CREATE UNIQUE INDEX products_pkey ON public.products USING btree (product_id)`

**Triggers**

- `CREATE TRIGGER trg_products_enqueue_embedding_ins AFTER INSERT ON public.products FOR EACH ROW EXECUTE FUNCTION trg_fn_enqueue_embedding('product')`
- `CREATE TRIGGER trg_products_enqueue_embedding_upd AFTER UPDATE OF title, brand, description, features, category_id ON public.products FOR EACH ROW WHEN (((old.title IS DISTINCT FROM new.title) OR (old.brand IS DISTINCT FROM new.brand) OR (old.description IS DISTINCT FROM new.description) OR (old.features IS DISTINCT FROM new.features) OR (old.category_id IS DISTINCT FROM new.category_id))) EXECUTE FUNCTION trg_fn_enqueue_embedding('product')`
- `CREATE TRIGGER trg_products_stock_alert AFTER INSERT OR UPDATE OF stock_qty, reorder_threshold ON public.products FOR EACH ROW EXECUTE FUNCTION trg_fn_stock_alert()`
- `CREATE TRIGGER trg_products_touch BEFORE UPDATE ON public.products FOR EACH ROW EXECUTE FUNCTION trg_fn_touch_updated_at()`

**Row-Level Security policies**

- `products_insert` (INSERT) WITH CHECK `(((seller_id = ( SELECT app_user_id() AS app_user_id)) AND (( SELECT app_role() AS app_role) = 'seller'::user_role)) OR ( SELECT is_admin() AS is_admin))`
- `products_select` (SELECT) USING `(is_active OR (seller_id = ( SELECT app_user_id() AS app_user_id)) OR ( SELECT is_admin() AS is_admin))`
- `products_update` (UPDATE) USING `((seller_id = ( SELECT app_user_id() AS app_user_id)) OR ( SELECT is_admin() AS is_admin))` WITH CHECK `((seller_id = ( SELECT app_user_id() AS app_user_id)) OR ( SELECT is_admin() AS is_admin))`

## review_embeddings

| Column | Type | Null | Default / generated | Keys |
|---|---|---|---|---|
| review_id | bigint | no |  | PK, FK → reviews |
| embedding | vector(384) | no |  |  |
| model | text | no |  |  |
| source_hash | text | no |  |  |
| embedded_at | timestamp with time zone | no | now() |  |

**Foreign keys**

- `review_embeddings_review_id_fkey`: `FOREIGN KEY (review_id) REFERENCES reviews(review_id) ON DELETE CASCADE`

**Indexes**

- `CREATE INDEX idx_review_embeddings_hnsw ON public.review_embeddings USING hnsw (embedding vector_cosine_ops) WITH (m='16', ef_construction='64')`
- `CREATE UNIQUE INDEX review_embeddings_pkey ON public.review_embeddings USING btree (review_id)`

## reviews

| Column | Type | Null | Default / generated | Keys |
|---|---|---|---|---|
| review_id | bigint | no |  | PK |
| product_id | bigint | no |  | UNIQUE, FK → products |
| user_id | bigint | yes |  | FK → users, UNIQUE |
| rating | smallint | no |  |  |
| title | text | yes |  |  |
| body | text | no |  |  |
| verified_purchase | boolean | no | false |  |
| helpful_votes | integer | no | 0 |  |
| created_at | timestamp with time zone | no | now() |  |

**CHECK constraints**

- `reviews_body_check`: `CHECK (((length(btrim(body)) >= 10) AND (length(btrim(body)) <= 5000)))`
- `reviews_helpful_votes_check`: `CHECK ((helpful_votes >= 0))`
- `reviews_rating_check`: `CHECK (((rating >= 1) AND (rating <= 5)))`
- `reviews_title_check`: `CHECK ((length(title) <= 200))`

**Foreign keys**

- `reviews_product_id_fkey`: `FOREIGN KEY (product_id) REFERENCES products(product_id) ON DELETE CASCADE`
- `reviews_user_id_fkey`: `FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE SET NULL`

**Indexes**

- `CREATE INDEX idx_reviews_product ON public.reviews USING btree (product_id, created_at DESC)`
- `CREATE INDEX idx_reviews_user ON public.reviews USING btree (user_id)`
- `CREATE UNIQUE INDEX reviews_pkey ON public.reviews USING btree (review_id)`
- `CREATE UNIQUE INDEX uq_one_review_per_user_product ON public.reviews USING btree (product_id, user_id)`

**Triggers**

- `CREATE TRIGGER trg_reviews_enqueue_embedding_ins AFTER INSERT ON public.reviews FOR EACH ROW EXECUTE FUNCTION trg_fn_enqueue_embedding('review')`
- `CREATE TRIGGER trg_reviews_enqueue_embedding_upd AFTER UPDATE OF title, body ON public.reviews FOR EACH ROW WHEN (((old.title IS DISTINCT FROM new.title) OR (old.body IS DISTINCT FROM new.body))) EXECUTE FUNCTION trg_fn_enqueue_embedding('review')`
- `CREATE TRIGGER trg_reviews_stats_del AFTER DELETE ON public.reviews REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION trg_fn_review_stats_del()`
- `CREATE TRIGGER trg_reviews_stats_ins AFTER INSERT ON public.reviews REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION trg_fn_review_stats_ins()`
- `CREATE TRIGGER trg_reviews_stats_upd AFTER UPDATE ON public.reviews REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION trg_fn_review_stats_upd()`
- `CREATE TRIGGER trg_reviews_verify BEFORE INSERT ON public.reviews FOR EACH ROW EXECUTE FUNCTION trg_fn_review_verify()`

**Row-Level Security policies**

- `reviews_delete` (DELETE) USING `((user_id = ( SELECT app_user_id() AS app_user_id)) OR ( SELECT is_admin() AS is_admin))`
- `reviews_insert` (INSERT) WITH CHECK `((user_id = ( SELECT app_user_id() AS app_user_id)) AND (( SELECT app_role() AS app_role) = 'customer'::user_role))`
- `reviews_select` (SELECT) USING `true`
- `reviews_update` (UPDATE) USING `(user_id = ( SELECT app_user_id() AS app_user_id))` WITH CHECK `(user_id = ( SELECT app_user_id() AS app_user_id))`

## search_logs

| Column | Type | Null | Default / generated | Keys |
|---|---|---|---|---|
| log_id | bigint | no |  | PK |
| user_id | bigint | yes |  | FK → users |
| query | text | no |  |  |
| mode | search_mode | no |  |  |
| filters | jsonb | no | '{}'::jsonb |  |
| result_count | integer | no |  |  |
| latency_ms | numeric(10,2) | yes |  |  |
| created_at | timestamp with time zone | no | now() |  |

**CHECK constraints**

- `search_logs_latency_ms_check`: `CHECK ((latency_ms >= (0)::numeric))`
- `search_logs_query_check`: `CHECK (((length(query) >= 1) AND (length(query) <= 500)))`
- `search_logs_result_count_check`: `CHECK ((result_count >= 0))`

**Foreign keys**

- `search_logs_user_id_fkey`: `FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE SET NULL`

**Indexes**

- `CREATE INDEX idx_search_logs_created ON public.search_logs USING btree (created_at DESC)`
- `CREATE UNIQUE INDEX search_logs_pkey ON public.search_logs USING btree (log_id)`

**Row-Level Security policies**

- `search_logs_insert` (INSERT) WITH CHECK `((user_id IS NULL) OR (user_id = ( SELECT app_user_id() AS app_user_id)))`
- `search_logs_select` (SELECT) USING `( SELECT is_admin() AS is_admin)`

## sellers

| Column | Type | Null | Default / generated | Keys |
|---|---|---|---|---|
| seller_id | bigint | no |  | PK, FK → users |
| role | user_role | no | 'seller'::user_role | FK → users |
| store_name | text | no |  | UNIQUE |
| gstin | gstin_code | yes |  | UNIQUE |
| support_email | email_address | yes |  |  |
| is_verified | boolean | no | false |  |
| joined_at | timestamp with time zone | no | now() |  |

**CHECK constraints**

- `sellers_role_check`: `CHECK ((role = 'seller'::user_role))`
- `sellers_store_name_check`: `CHECK ((length(btrim(store_name)) >= 2))`

**Foreign keys**

- `fk_sellers_user_is_seller`: `FOREIGN KEY (seller_id, role) REFERENCES users(user_id, role) ON UPDATE RESTRICT ON DELETE CASCADE`

**Indexes**

- `CREATE UNIQUE INDEX sellers_gstin_key ON public.sellers USING btree (gstin)`
- `CREATE UNIQUE INDEX sellers_pkey ON public.sellers USING btree (seller_id)`
- `CREATE UNIQUE INDEX sellers_store_name_key ON public.sellers USING btree (store_name)`

## stock_alerts

| Column | Type | Null | Default / generated | Keys |
|---|---|---|---|---|
| alert_id | bigint | no |  | PK |
| product_id | bigint | no |  | FK → products |
| stock_qty | integer | no |  |  |
| threshold | integer | no |  |  |
| created_at | timestamp with time zone | no | now() |  |
| resolved_at | timestamp with time zone | yes |  |  |

**CHECK constraints**

- `chk_alert_resolved_after_created`: `CHECK (((resolved_at IS NULL) OR (resolved_at >= created_at)))`
- `stock_alerts_stock_qty_check`: `CHECK ((stock_qty >= 0))`
- `stock_alerts_threshold_check`: `CHECK ((threshold >= 0))`

**Foreign keys**

- `stock_alerts_product_id_fkey`: `FOREIGN KEY (product_id) REFERENCES products(product_id) ON DELETE CASCADE`

**Indexes**

- `CREATE UNIQUE INDEX stock_alerts_pkey ON public.stock_alerts USING btree (alert_id)`
- `CREATE UNIQUE INDEX uq_stock_alerts_open ON public.stock_alerts USING btree (product_id) WHERE (resolved_at IS NULL)`

**Row-Level Security policies**

- `stock_alerts_select` (SELECT) USING `(( SELECT is_admin() AS is_admin) OR (product_id IN ( SELECT products.product_id    FROM products   WHERE (products.seller_id = ( SELECT app_user_id() AS app_user_id)))))`

## users

| Column | Type | Null | Default / generated | Keys |
|---|---|---|---|---|
| user_id | bigint | no |  | PK, UNIQUE |
| email | email_address | no |  | UNIQUE |
| password_hash | text | no |  |  |
| full_name | text | no |  |  |
| phone | indian_phone | yes |  |  |
| role | user_role | no | 'customer'::user_role | UNIQUE |
| is_active | boolean | no | true |  |
| created_at | timestamp with time zone | no | now() |  |
| last_login_at | timestamp with time zone | yes |  |  |

**CHECK constraints**

- `chk_users_hash_is_bcrypt`: `CHECK ((password_hash ~~ '$2%'::text))`
- `users_full_name_check`: `CHECK (((length(btrim(full_name)) >= 2) AND (length(btrim(full_name)) <= 100)))`

**Indexes**

- `CREATE UNIQUE INDEX uq_users_email ON public.users USING btree (email)`
- `CREATE UNIQUE INDEX uq_users_email_lower ON public.users USING btree (lower((email)::text))`
- `CREATE UNIQUE INDEX uq_users_id_role ON public.users USING btree (user_id, role)`
- `CREATE UNIQUE INDEX users_pkey ON public.users USING btree (user_id)`

**Triggers**

- `CREATE TRIGGER trg_users_normalise BEFORE INSERT OR UPDATE OF email, full_name ON public.users FOR EACH ROW EXECUTE FUNCTION trg_fn_users_normalise()`

**Row-Level Security policies**

- `users_admin_update` (UPDATE) USING `( SELECT is_admin() AS is_admin)` WITH CHECK `( SELECT is_admin() AS is_admin)`
- `users_select` (SELECT) USING `((user_id = ( SELECT app_user_id() AS app_user_id)) OR ( SELECT is_admin() AS is_admin))`

## Domains (reusable validation)

| Domain | Base type | Constraint |
|---|---|---|
| cardinal_number | integer | `CHECK ((VALUE >= 0))` |
| email_address | text | `CHECK ((VALUE ~* '^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$'::text))` |
| gstin_code | text | `CHECK ((VALUE ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$'::text))` |
| indian_phone | text | `CHECK ((VALUE ~ '^[6-9][0-9]{9}$'::text))` |
| indian_pincode | character(6) | `CHECK ((VALUE ~ '^[1-9][0-9]{5}$'::text))` |
| money_inr | numeric(12,2) | `CHECK ((VALUE >= (0)::numeric))` |
| yes_or_no | character varying(3) | `CHECK (((VALUE)::text = ANY ((ARRAY['YES'::character varying, 'NO'::character varying])::text[])))` |

## Enumerated types

| Type | Values |
|---|---|
| order_status | pending, paid, shipped, delivered, cancelled |
| payment_method | upi, card, netbanking, cod |
| payment_status | pending, success, failed, refunded |
| search_mode | lexical, semantic, hybrid |
| user_role | customer, seller, admin |
