-- =====================================================================
-- 02  Relational schema (3NF) — tables, keys and constraints
-- =====================================================================

-- ---------------------------------------------------------------------
-- Users & identity
-- ---------------------------------------------------------------------
CREATE TABLE users (
  user_id        BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email          email_address NOT NULL,
  password_hash  TEXT          NOT NULL,              -- bcrypt hash (pgcrypto), never plaintext
  full_name      TEXT          NOT NULL CHECK (length(btrim(full_name)) BETWEEN 2 AND 100),
  phone          indian_phone,
  role           user_role     NOT NULL DEFAULT 'customer',
  is_active      BOOLEAN       NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMPTZ   NOT NULL DEFAULT now(),
  last_login_at  TIMESTAMPTZ,
  CONSTRAINT uq_users_email UNIQUE (email),
  -- target for the composite FK that guarantees every seller row belongs to a 'seller' user
  CONSTRAINT uq_users_id_role UNIQUE (user_id, role),
  CONSTRAINT chk_users_hash_is_bcrypt CHECK (password_hash LIKE '$2%')
);

CREATE TABLE categories (
  category_id  INT  GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name         TEXT NOT NULL CHECK (length(btrim(name)) >= 2),
  slug         TEXT NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  parent_id    INT  REFERENCES categories (category_id) ON DELETE RESTRICT,
  CONSTRAINT uq_category_name_per_parent UNIQUE (parent_id, name),
  CONSTRAINT chk_category_not_own_parent CHECK (parent_id IS DISTINCT FROM category_id)
);

CREATE TABLE customer_profiles (
  user_id                BIGINT PRIMARY KEY REFERENCES users (user_id) ON DELETE CASCADE,
  date_of_birth          DATE CHECK (date_of_birth >= DATE '1900-01-01'),
  preferred_category_id  INT  REFERENCES categories (category_id) ON DELETE SET NULL,
  -- personalisation: mean embedding of products this customer bought (see refresh_taste_profile)
  taste_embedding        vector(384),
  taste_updated_at       TIMESTAMPTZ
);

CREATE TABLE addresses (
  address_id  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id     BIGINT NOT NULL REFERENCES users (user_id) ON DELETE CASCADE,
  label       TEXT   NOT NULL DEFAULT 'Home' CHECK (length(label) <= 30),
  line1       TEXT   NOT NULL CHECK (length(btrim(line1)) >= 3),
  line2       TEXT,
  city        TEXT   NOT NULL,
  state       TEXT   NOT NULL,
  pincode     indian_pincode NOT NULL,
  is_default  BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE sellers (
  seller_id      BIGINT     PRIMARY KEY,
  role           user_role  NOT NULL DEFAULT 'seller' CHECK (role = 'seller'),
  store_name     TEXT       NOT NULL UNIQUE CHECK (length(btrim(store_name)) >= 2),
  gstin          gstin_code UNIQUE,
  support_email  email_address,
  is_verified    BOOLEAN    NOT NULL DEFAULT FALSE,
  joined_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Composite FK: a seller row can only exist for a user whose role is 'seller',
  -- and that user's role cannot be changed while the seller row exists.
  CONSTRAINT fk_sellers_user_is_seller FOREIGN KEY (seller_id, role)
    REFERENCES users (user_id, role) ON DELETE CASCADE ON UPDATE RESTRICT
);

-- ---------------------------------------------------------------------
-- Catalog
-- ---------------------------------------------------------------------
CREATE TABLE products (
  product_id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  seller_id          BIGINT    NOT NULL REFERENCES sellers (seller_id) ON DELETE RESTRICT,
  category_id        INT       NOT NULL REFERENCES categories (category_id) ON DELETE RESTRICT,
  asin               TEXT      UNIQUE,                          -- source identifier (dataset)
  title              TEXT      NOT NULL CHECK (length(btrim(title)) BETWEEN 3 AND 300),
  brand              TEXT,
  description        TEXT      NOT NULL DEFAULT '',
  features           TEXT      NOT NULL DEFAULT '',             -- bullet points, newline separated
  price              money_inr NOT NULL CHECK (price > 0),
  mrp                money_inr NOT NULL,
  stock_qty          INT       NOT NULL DEFAULT 0  CHECK (stock_qty >= 0),
  reorder_threshold  INT       NOT NULL DEFAULT 10 CHECK (reorder_threshold BETWEEN 0 AND 10000),
  image_url          TEXT      CHECK (image_url ~ '^https?://'),
  -- Derived attributes, maintained by trigger (trg_reviews_stats_*) for read performance
  avg_rating         NUMERIC(2, 1) NOT NULL DEFAULT 0 CHECK (avg_rating BETWEEN 0 AND 5),
  review_count       INT       NOT NULL DEFAULT 0 CHECK (review_count >= 0),
  is_active          BOOLEAN   NOT NULL DEFAULT TRUE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Full-text search document, weighted: title (A) > brand (B) > features (C) > description (D)
  search_tsv         tsvector GENERATED ALWAYS AS (
                       setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
                       setweight(to_tsvector('english', coalesce(brand, '')), 'B') ||
                       setweight(to_tsvector('english', coalesce(features, '')), 'C') ||
                       setweight(to_tsvector('english', coalesce(description, '')), 'D')
                     ) STORED,
  CONSTRAINT chk_products_mrp_ge_price CHECK (mrp >= price)
);

CREATE TABLE reviews (
  review_id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  product_id         BIGINT   NOT NULL REFERENCES products (product_id) ON DELETE CASCADE,
  user_id            BIGINT   REFERENCES users (user_id) ON DELETE SET NULL,   -- review survives account deletion
  rating             SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  title              TEXT     CHECK (length(title) <= 200),
  body               TEXT     NOT NULL CHECK (length(btrim(body)) BETWEEN 10 AND 5000),
  verified_purchase  BOOLEAN  NOT NULL DEFAULT FALSE,              -- set by trigger, not by client
  helpful_votes      INT      NOT NULL DEFAULT 0 CHECK (helpful_votes >= 0),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_one_review_per_user_product UNIQUE (product_id, user_id)
);

-- ---------------------------------------------------------------------
-- Vector store (pgvector) — kept in separate tables from the relational rows
-- so the embedding model/version can change independently of the catalog.
-- ---------------------------------------------------------------------
CREATE TABLE product_embeddings (
  product_id   BIGINT PRIMARY KEY REFERENCES products (product_id) ON DELETE CASCADE,
  embedding    vector(384) NOT NULL,
  model        TEXT        NOT NULL,
  source_hash  TEXT        NOT NULL,      -- md5 of the embedded text; lets the worker skip no-op updates
  embedded_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE review_embeddings (
  review_id    BIGINT PRIMARY KEY REFERENCES reviews (review_id) ON DELETE CASCADE,
  embedding    vector(384) NOT NULL,
  model        TEXT        NOT NULL,
  source_hash  TEXT        NOT NULL,
  embedded_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Work queue: filled by triggers whenever embedded text changes, drained by the embedding worker
CREATE TABLE embedding_jobs (
  job_id        BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  entity_type   TEXT   NOT NULL CHECK (entity_type IN ('product', 'review')),
  entity_id     BIGINT NOT NULL,
  enqueued_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at    TIMESTAMPTZ,
  processed_at  TIMESTAMPTZ,
  attempts      INT    NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error    TEXT,
  CONSTRAINT chk_jobs_processed_after_enqueue CHECK (processed_at IS NULL OR processed_at >= enqueued_at)
);

-- ---------------------------------------------------------------------
-- Shopping & orders
-- ---------------------------------------------------------------------
CREATE TABLE carts (
  cart_id     BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id     BIGINT NOT NULL UNIQUE REFERENCES users (user_id) ON DELETE CASCADE,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE cart_items (
  cart_id     BIGINT NOT NULL REFERENCES carts (cart_id) ON DELETE CASCADE,
  product_id  BIGINT NOT NULL REFERENCES products (product_id) ON DELETE CASCADE,
  quantity    INT    NOT NULL CHECK (quantity BETWEEN 1 AND 10),
  added_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (cart_id, product_id)
);

CREATE TABLE orders (
  order_id      BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id       BIGINT       NOT NULL REFERENCES users (user_id) ON DELETE RESTRICT,
  address_id    BIGINT       NOT NULL REFERENCES addresses (address_id) ON DELETE RESTRICT,
  status        order_status NOT NULL DEFAULT 'pending',
  subtotal      money_inr    NOT NULL,
  shipping_fee  money_inr    NOT NULL DEFAULT 0,
  total_amount  money_inr    NOT NULL,
  placed_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT chk_orders_total CHECK (total_amount = subtotal + shipping_fee)
);

CREATE TABLE order_items (
  order_id    BIGINT    NOT NULL REFERENCES orders (order_id) ON DELETE CASCADE,
  product_id  BIGINT    NOT NULL REFERENCES products (product_id) ON DELETE RESTRICT,
  quantity    INT       NOT NULL CHECK (quantity > 0),
  unit_price  money_inr NOT NULL CHECK (unit_price > 0),       -- price snapshot at purchase time
  line_total  NUMERIC(12, 2) GENERATED ALWAYS AS (quantity * unit_price) STORED,
  PRIMARY KEY (order_id, product_id)
);

CREATE TABLE payments (
  payment_id       BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id         BIGINT         NOT NULL UNIQUE REFERENCES orders (order_id) ON DELETE CASCADE,
  method           payment_method NOT NULL,
  amount           money_inr      NOT NULL,
  status           payment_status NOT NULL DEFAULT 'pending',
  transaction_ref  TEXT UNIQUE,
  created_at       TIMESTAMPTZ    NOT NULL DEFAULT now()
);

CREATE TABLE order_status_history (
  history_id  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id    BIGINT       NOT NULL REFERENCES orders (order_id) ON DELETE CASCADE,
  old_status  order_status,
  new_status  order_status NOT NULL,
  changed_by  BIGINT       REFERENCES users (user_id) ON DELETE SET NULL,
  changed_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- Operations & analytics
-- ---------------------------------------------------------------------
CREATE TABLE stock_alerts (
  alert_id     BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  product_id   BIGINT NOT NULL REFERENCES products (product_id) ON DELETE CASCADE,
  stock_qty    INT    NOT NULL CHECK (stock_qty >= 0),
  threshold    INT    NOT NULL CHECK (threshold >= 0),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at  TIMESTAMPTZ,
  CONSTRAINT chk_alert_resolved_after_created CHECK (resolved_at IS NULL OR resolved_at >= created_at)
);

CREATE TABLE search_logs (
  log_id        BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id       BIGINT REFERENCES users (user_id) ON DELETE SET NULL,
  query         TEXT        NOT NULL CHECK (length(query) BETWEEN 1 AND 500),
  mode          search_mode NOT NULL,
  filters       JSONB       NOT NULL DEFAULT '{}'::jsonb,
  result_count  INT         NOT NULL CHECK (result_count >= 0),
  latency_ms    NUMERIC(10, 2) CHECK (latency_ms >= 0),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE eval_runs (
  run_id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  mode            search_mode NOT NULL,
  model           TEXT        NOT NULL,
  k               INT         NOT NULL CHECK (k > 0),
  query_count     INT         NOT NULL CHECK (query_count > 0),
  precision_at_k  NUMERIC(5, 4) CHECK (precision_at_k BETWEEN 0 AND 1),
  recall_at_k     NUMERIC(5, 4) CHECK (recall_at_k BETWEEN 0 AND 1),
  mrr             NUMERIC(5, 4) CHECK (mrr BETWEEN 0 AND 1),
  ndcg_at_k       NUMERIC(5, 4) CHECK (ndcg_at_k BETWEEN 0 AND 1),
  avg_latency_ms  NUMERIC(10, 2),
  details         JSONB       NOT NULL DEFAULT '{}'::jsonb,
  run_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
