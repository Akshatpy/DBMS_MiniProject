-- =====================================================================
-- 03  Indexes
-- =====================================================================
-- Foreign-key / join indexes (PostgreSQL does not index FK columns automatically)
CREATE INDEX idx_products_seller      ON products (seller_id);
CREATE INDEX idx_products_category    ON products (category_id);
CREATE INDEX idx_categories_parent    ON categories (parent_id);
CREATE INDEX idx_addresses_user       ON addresses (user_id);
CREATE INDEX idx_reviews_product      ON reviews (product_id, created_at DESC);
CREATE INDEX idx_reviews_user         ON reviews (user_id);
CREATE INDEX idx_orders_user_placed   ON orders (user_id, placed_at DESC);
CREATE INDEX idx_orders_placed        ON orders (placed_at);
CREATE INDEX idx_order_items_product  ON order_items (product_id);
CREATE INDEX idx_cart_items_product   ON cart_items (product_id);
CREATE INDEX idx_status_hist_order    ON order_status_history (order_id, changed_at);
CREATE INDEX idx_search_logs_created  ON search_logs (created_at DESC);

-- Partial indexes
CREATE INDEX idx_products_active_price ON products (category_id, price) WHERE is_active;
-- at most one default address per user
CREATE UNIQUE INDEX uq_addresses_one_default ON addresses (user_id) WHERE is_default;
-- at most one OPEN stock alert per product
CREATE UNIQUE INDEX uq_stock_alerts_open ON stock_alerts (product_id) WHERE resolved_at IS NULL;
-- at most one PENDING embedding job per entity (lets triggers use ON CONFLICT DO NOTHING)
CREATE UNIQUE INDEX uq_embedding_jobs_pending ON embedding_jobs (entity_type, entity_id) WHERE processed_at IS NULL;
CREATE INDEX idx_embedding_jobs_queue ON embedding_jobs (enqueued_at) WHERE processed_at IS NULL;

-- Case-insensitive email lookups (login)
CREATE UNIQUE INDEX uq_users_email_lower ON users (lower(email));

-- Full-text search: GIN over the generated tsvector
CREATE INDEX idx_products_search_tsv ON products USING GIN (search_tsv);
-- Trigram index for typo-tolerant autocomplete on titles
CREATE INDEX idx_products_title_trgm ON products USING GIN (title gin_trgm_ops);

-- Vector similarity: HNSW graph indexes using cosine distance (<=>)
-- m = max connections per node, ef_construction = candidate list size at build time
CREATE INDEX idx_product_embeddings_hnsw ON product_embeddings
  USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64);
CREATE INDEX idx_review_embeddings_hnsw ON review_embeddings
  USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64);
