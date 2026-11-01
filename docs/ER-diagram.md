# ER Diagram and Relational Schema

## Entity-Relationship diagram

```mermaid
erDiagram
    USERS ||--o| CUSTOMER_PROFILES : "is a (customer)"
    USERS ||--o| SELLERS : "is a (seller)"
    USERS ||--o{ ADDRESSES : has
    USERS ||--|| CARTS : owns
    USERS ||--o{ ORDERS : places
    USERS ||--o{ REVIEWS : writes
    USERS ||--o{ SEARCH_LOGS : issues
    CATEGORIES ||--o{ CATEGORIES : "parent of"
    CATEGORIES ||--o{ PRODUCTS : classifies
    SELLERS ||--o{ PRODUCTS : lists
    PRODUCTS ||--o| PRODUCT_EMBEDDINGS : "embedded as"
    PRODUCTS ||--o{ REVIEWS : receives
    REVIEWS ||--o| REVIEW_EMBEDDINGS : "embedded as"
    PRODUCTS ||--o{ STOCK_ALERTS : raises
    CARTS ||--o{ CART_ITEMS : contains
    PRODUCTS ||--o{ CART_ITEMS : "in"
    ORDERS ||--|{ ORDER_ITEMS : contains
    PRODUCTS ||--o{ ORDER_ITEMS : "sold as"
    ORDERS ||--|| PAYMENTS : "paid by"
    ORDERS ||--o{ ORDER_STATUS_HISTORY : audits
    ADDRESSES ||--o{ ORDERS : "ships to"
    EMBEDDING_JOBS }o..o{ PRODUCTS : "queues (logical)"
    EMBEDDING_JOBS }o..o{ REVIEWS : "queues (logical)"

    USERS {
        bigint user_id PK
        email_address email UK
        text password_hash "bcrypt via pgcrypto"
        text full_name
        indian_phone phone
        user_role role "customer | seller | admin"
        boolean is_active
        timestamptz created_at
        timestamptz last_login_at
    }
    CUSTOMER_PROFILES {
        bigint user_id PK, FK
        date date_of_birth
        int preferred_category_id FK
        vector_384 taste_embedding "mean of purchased product vectors"
    }
    SELLERS {
        bigint seller_id PK, FK
        user_role role "CHECK = seller (composite FK)"
        text store_name UK
        gstin_code gstin UK
        email_address support_email
        boolean is_verified
    }
    ADDRESSES {
        bigint address_id PK
        bigint user_id FK
        text line1
        text city
        text state
        indian_pincode pincode
        boolean is_default "one per user (partial unique index)"
    }
    CATEGORIES {
        int category_id PK
        text name
        text slug UK
        int parent_id FK "self reference: 2-level tree"
    }
    PRODUCTS {
        bigint product_id PK
        bigint seller_id FK
        int category_id FK
        text asin UK
        text title
        text brand
        text description
        text features
        money_inr price "CHECK > 0"
        money_inr mrp "CHECK >= price"
        int stock_qty "CHECK >= 0"
        int reorder_threshold
        numeric avg_rating "trigger-maintained"
        int review_count "trigger-maintained"
        tsvector search_tsv "generated, GIN indexed"
    }
    PRODUCT_EMBEDDINGS {
        bigint product_id PK, FK
        vector_384 embedding "HNSW cosine index"
        text model
        text source_hash
    }
    REVIEWS {
        bigint review_id PK
        bigint product_id FK
        bigint user_id FK
        smallint rating "1..5"
        text body
        boolean verified_purchase "trigger-computed"
    }
    REVIEW_EMBEDDINGS {
        bigint review_id PK, FK
        vector_384 embedding "HNSW cosine index"
    }
    CARTS {
        bigint cart_id PK
        bigint user_id FK, UK
    }
    CART_ITEMS {
        bigint cart_id PK, FK
        bigint product_id PK, FK
        int quantity "1..10"
    }
    ORDERS {
        bigint order_id PK
        bigint user_id FK
        bigint address_id FK
        order_status status "state machine trigger"
        money_inr subtotal
        money_inr shipping_fee
        money_inr total_amount "CHECK = subtotal + fee"
        timestamptz placed_at
    }
    ORDER_ITEMS {
        bigint order_id PK, FK
        bigint product_id PK, FK
        int quantity
        money_inr unit_price "price snapshot"
        numeric line_total "generated"
    }
    PAYMENTS {
        bigint payment_id PK
        bigint order_id FK, UK
        payment_method method
        payment_status status
        text transaction_ref UK
    }
    ORDER_STATUS_HISTORY {
        bigint history_id PK
        bigint order_id FK
        order_status old_status
        order_status new_status
        bigint changed_by FK
    }
    STOCK_ALERTS {
        bigint alert_id PK
        bigint product_id FK
        int stock_qty
        int threshold
        timestamptz resolved_at "one open alert per product"
    }
    EMBEDDING_JOBS {
        bigint job_id PK
        text entity_type "product | review"
        bigint entity_id
        timestamptz processed_at
    }
    SEARCH_LOGS {
        bigint log_id PK
        bigint user_id FK
        text query
        search_mode mode
        jsonb filters
        int result_count
        numeric latency_ms
    }
    EVAL_RUNS {
        bigint run_id PK
        search_mode mode
        numeric ndcg_at_k
        numeric precision_at_k
        numeric mrr
        jsonb details
    }
```

### Cardinality notes

| Relationship | Cardinality | Implementation |
|---|---|---|
| User → Customer profile / Seller | 1 : 0..1 each (role specialisation, disjoint) | `customer_profiles.user_id` PK+FK; `sellers (seller_id, role)` composite FK to `users (user_id, role)` with `CHECK (role = 'seller')`, so a seller row can only exist for a user whose role is `seller` |
| Category → Category | 1 : N (self-referencing tree) | `categories.parent_id`; traversed with recursive CTEs |
| Seller → Product | 1 : N | `products.seller_id` (ON DELETE RESTRICT) |
| Product → Embedding | 1 : 0..1 | separate table, so the model/version can change without touching the catalog |
| Cart ↔ Product | M : N | associative entity `cart_items` with composite PK |
| Order ↔ Product | M : N | associative entity `order_items` with composite PK (carries `quantity`, `unit_price`) |
| Order → Payment | 1 : 1 | `payments.order_id` UNIQUE |

## Relational schema (3NF)

Underlined = primary key, *italic* = foreign key.

```
users(user_id, email, password_hash, full_name, phone, role, is_active, created_at, last_login_at)
    UNIQUE(email), UNIQUE(user_id, role)

customer_profiles(user_id→users, date_of_birth, preferred_category_id→categories, taste_embedding, taste_updated_at)

sellers(seller_id, role, store_name, gstin, support_email, is_verified, joined_at)
    FK (seller_id, role) → users(user_id, role),  CHECK (role = 'seller')

addresses(address_id, user_id→users, label, line1, line2, city, state, pincode, is_default)

categories(category_id, name, slug, parent_id→categories)

products(product_id, seller_id→sellers, category_id→categories, asin, title, brand, description, features,
         price, mrp, stock_qty, reorder_threshold, image_url, avg_rating, review_count, is_active,
         created_at, updated_at, search_tsv)

product_embeddings(product_id→products, embedding, model, source_hash, embedded_at)

reviews(review_id, product_id→products, user_id→users, rating, title, body, verified_purchase,
        helpful_votes, created_at)
    UNIQUE(product_id, user_id)

review_embeddings(review_id→reviews, embedding, model, source_hash, embedded_at)

embedding_jobs(job_id, entity_type, entity_id, enqueued_at, started_at, processed_at, attempts, last_error)

carts(cart_id, user_id→users)                       UNIQUE(user_id)
cart_items(cart_id→carts, product_id→products, quantity, added_at)           PK(cart_id, product_id)

orders(order_id, user_id→users, address_id→addresses, status, subtotal, shipping_fee, total_amount,
       placed_at, updated_at)
order_items(order_id→orders, product_id→products, quantity, unit_price, line_total)   PK(order_id, product_id)
payments(payment_id, order_id→orders, method, amount, status, transaction_ref, created_at)   UNIQUE(order_id)
order_status_history(history_id, order_id→orders, old_status, new_status, changed_by→users, changed_at)

stock_alerts(alert_id, product_id→products, stock_qty, threshold, created_at, resolved_at)
search_logs(log_id, user_id→users, query, mode, filters, result_count, latency_ms, created_at)
eval_runs(run_id, mode, model, k, query_count, precision_at_k, recall_at_k, mrr, ndcg_at_k,
          avg_latency_ms, details, run_at)
```

### Normalisation argument

* **1NF**: every column is atomic. The only multi-valued attribute, product feature bullets, is stored as
  newline-separated text because it is only ever read and embedded as a unit, never queried per bullet.
* **2NF**: in the two tables with composite keys (`cart_items`, `order_items`), every non-key attribute depends on
  the whole key. `unit_price` depends on (order, product): it is a historical snapshot, deliberately *not* a copy of
  `products.price`.
* **3NF**: no transitive dependencies. Seller details live in `sellers`, category names in `categories`, delivery
  address in `addresses` (orders reference it, they do not copy it).
* **Deliberate, controlled denormalisation** (documented trade-offs, each kept consistent by the database itself):
  * `products.avg_rating`, `products.review_count`: recomputed by statement-level triggers with transition tables;
  * `order_items.line_total`, `products.search_tsv`: `GENERATED ALWAYS … STORED` columns;
  * `orders.subtotal / total_amount`: guarded by `CHECK (total_amount = subtotal + shipping_fee)`;
  * `customer_profiles.taste_embedding`: derived cache of purchase history, refreshed by `refresh_taste_profile()`.
