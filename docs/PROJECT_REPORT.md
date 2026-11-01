{{COVER}}

# 1. Title

**ShopSense: A Hybrid Semantic Product Discovery Engine with Association-Rule Recommendations**

DBMS Experiential Learning, Level 3 Project · Database option 2 (SQL + Vector database) · Web interface in Next.js.

Source code (public): <https://github.com/Akshatpy/DBMS_MiniProject>

<h1 class="nb">2. Students (SRN and Name)</h1>

{{TEAM_TABLE}}

<h1 class="nb">3. Abstract</h1>

Most online shops still search by exact keywords. That works when a shopper already knows the product name, and it
fails when they describe a need: a search for *"something to keep my dog's teeth clean"* returns nothing useful
because the catalogue says "dental chews". Searching by meaning alone has the opposite weakness and gets exact model
names wrong. ShopSense is a multi-role marketplace (customer, seller, admin) whose database layer handles both.

The system keeps its structured data (users, sellers, catalogue, carts, orders, payments) in **PostgreSQL 17**, and
its unstructured text (product descriptions and customer reviews) as 384-dimensional embeddings in the same database
using **pgvector**, with HNSW indexes and cosine distance. A single SQL function runs a **hybrid search**: it fuses
full-text ranking, product-vector similarity and review-vector similarity with Reciprocal Rank Fusion, and applies
ordinary filters (category, price, rating, stock) in the same query. A trigger-fed queue and a background worker keep
embeddings in step with edits.

Beyond search, the project demonstrates the database concepts of the course: a 3NF schema with domains and constraints,
atomic and concurrency-safe checkout using row locks, 15 triggers, views and materialized views, window functions and
`ROLLUP` for analytics, association rules (support, confidence, lift) for "frequently bought together", and role-based
access enforced inside the database with Row-Level Security. Search quality was measured on 58 labelled queries,
including a held-out set. Vector search raised nDCG@10 from about 0.4–0.5 to 0.66–0.74 over keyword search, and the
final hybrid design matches or slightly exceeds semantic-only search while keeping exact-match behaviour. The first
hybrid design was actually worse than semantic-only search; the report notes how that was found and fixed.

# 4. Tech Stack

| Layer | Technology | Used for |
|---|---|---|
| Relational database | PostgreSQL 17.11 | schema, constraints, triggers, transactions, views, Row-Level Security |
| Vector database | pgvector 0.8.7 (inside PostgreSQL) | `vector(384)` columns, HNSW indexes, cosine distance search |
| Other PostgreSQL features | `pgcrypto`, `pg_trgm`, full-text search (`tsvector`, GIN) | bcrypt passwords, typo-tolerant suggestions, keyword search |
| Embedding model | all-MiniLM-L6-v2 via transformers.js (ONNX, CPU) | text to 384-d vectors, run locally with no external API |
| Web framework | Next.js 15 (App Router), React 19, TypeScript | pages, server components, route handlers |
| Styling and charts | Tailwind CSS 4, Recharts | interface and dashboards |
| Auth | `jose` (signed JWT in an HTTP-only cookie), bcrypt inside the database | sessions and password hashing |
| Validation | Zod (request shape) plus database constraints (values) | input validation |
| DB driver | `pg` | connection pool, transactions |
| Background worker | Node.js, `LISTEN/NOTIFY`, `FOR UPDATE SKIP LOCKED` | embedding queue |
| Container | Docker (`pgvector/pgvector:pg17`) | reproducible database |
| Testing | Node test runner (22 database integration tests) | constraints, triggers, RLS, concurrency |
| Version control | Git and GitHub | source history |
| Data | Amazon Reviews 2023 (McAuley Lab, UCSD): 3,001 products, 14,116 reviews; synthetic users and orders | catalogue and review text |

Database scale after seeding: 800 customers, 25 sellers, 15,417 orders (29,492 order lines), 17,117 stored vectors.

# 5. SQL Database Commands

Every excerpt below is taken directly from the repository; file names and line numbers are shown above each block.
The schema is applied in order by `npm run db:setup` (files `db/01` to `db/07`).

## 5.1 DDL: extensions, types and validation domains

{{CODE:db/01_extensions_types.sql|^CREATE EXTENSION IF NOT EXISTS vector|34}}

Domains make a validation rule reusable: any column declared `indian_pincode` or `email_address` rejects bad values
without repeating the rule.

## 5.2 DDL: tables with primary keys, foreign keys and constraints

{{CODE:db/02_schema.sql|^CREATE TABLE users|14}}

{{CODE:db/02_schema.sql|^CREATE TABLE sellers|16}}

The composite foreign key means a row in `sellers` can only exist for a user whose role is `seller`.

{{CODE:db/02_schema.sql|^CREATE TABLE orders|28}}

## 5.3 DDL: indexes

{{CODE:db/03_indexes.sql|^-- Partial indexes|18}}

## 5.4 DDL: ALTER and DROP

`db/demo/ddl_demo.sql` walks through schema evolution on a scratch table and is safe to re-run.

{{CODE:db/demo/ddl_demo.sql|2\. ALTER TABLE|11}}

{{CODE:db/demo/ddl_demo.sql|6\. ALTER TABLE|6}}

`npm run db:setup -- --reset` runs `DROP SCHEMA public CASCADE` and rebuilds everything. Other `ALTER` statements in
the setup files: `ALTER TABLE … ENABLE ROW LEVEL SECURITY` (13 tables) and `ALTER ROLE shopsense_app PASSWORD …`.

## 5.5 DML: INSERT, UPDATE, DELETE, SELECT

INSERT with an upsert (add to cart; quantity is added if the product is already there):

{{CODE:src/app/api/cart/route.ts|^// Add to cart|12}}

UPDATE (seller edits a product; Row-Level Security hides other sellers' rows from this statement):

{{CODE:src/app/api/seller/products/[id]/route.ts|const sets|7}}

DELETE:

{{CODE:src/app/api/cart/route.ts|^export const DELETE|7}}

SELECT with JOINs, `GROUP BY`, aggregation and a correlated subquery:

{{CODE:src/lib/data/shop.ts|export async function getOrders|28}}

## 5.6 Analytical queries: window functions, HAVING, ROLLUP

Month-over-month growth and moving average (window functions `LAG` and `AVG OVER`):

{{CODE:src/lib/data/seller.ts|// Monthly trend with month-over-month|14}}

Association rules for "frequently bought together": self-join, `GROUP BY … HAVING`, support, confidence and lift,
stored in a materialized view:

{{CODE:db/06_views.sql|^CREATE MATERIALIZED VIEW mv_product_pairs|30}}

Revenue by category with subtotals and a grand total (`GROUP BY ROLLUP`):

{{CODE:db/06_views.sql|^CREATE FUNCTION admin_category_rollup|26}}

## 5.7 Views

{{CODE:db/06_views.sql|^CREATE VIEW v_sales_lines|18}}

`security_invoker = true` makes the view run with the caller's rights, so Row-Level Security applies through it.

## 5.8 Stored functions and procedures

Authentication runs inside the database (bcrypt verification with `pgcrypto`):

{{CODE:db/04_functions.sql|^CREATE FUNCTION authenticate|9}}

A stored procedure, called with `CALL`:

{{CODE:db/04_functions.sql|^CREATE PROCEDURE restock_product|12}}

The `checkout()` function (atomic order placement with row locking) is shown in the code screenshots in Section 8.

## 5.9 Triggers

Illegal order-status changes are rejected by a `BEFORE UPDATE` trigger:

{{CODE:db/05_triggers.sql|^CREATE FUNCTION trg_fn_order_status_guard|24}}

Rating averages are recomputed by a statement-level trigger using a transition table, so a bulk insert of reviews
recomputes each product once rather than once per row:

{{CODE:db/05_triggers.sql|^CREATE TRIGGER trg_reviews_stats_ins|10}}

The low-stock alert trigger is shown in the code screenshots in Section 8.

## 5.10 Transactions and concurrency

Checkout runs as one transaction. Product rows are locked with `SELECT … FOR UPDATE` in primary-key order, so two
buyers cannot both take the last unit and two checkouts cannot deadlock. The concurrency lab in the application runs
a naive read-then-write (two units sold from a stock of one) against `checkout()` (second buyer rejected with
`SS001`); the automated test `concurrency: two buyers racing for the last unit` asserts the correct outcome.

## 5.11 Security: roles, grants and Row-Level Security

{{CODE:db/07_security.sql|^-- Column-level privilege|3}}

{{CODE:db/07_security.sql|^-- users: see yourself|10}}

The web application connects as `shopsense_app`, which is not a superuser, cannot bypass Row-Level Security and
cannot read `password_hash`. Each request runs in a transaction that first sets `app.user_id`; the role is looked up
from the `users` table, never trusted from the client.

# 6. NoSQL / Vector Database Commands

The project uses **Option 2: SQL + Vector database**, with pgvector inside PostgreSQL. No separate NoSQL store was
added, because no part of the data is schema-less or graph-shaped enough to justify a second system to keep
consistent. The few semi-structured fields (search filters, evaluation details) use PostgreSQL `jsonb`.

| Rubric question | Answer |
|---|---|
| What data becomes embeddings? | Product text (title, brand, category path, feature bullets, description) and review text (title and body) |
| Which model? | all-MiniLM-L6-v2, 384 dimensions, mean-pooled and L2-normalised, run locally with transformers.js; input capped at the model's 256-token training length |
| How are vectors stored? | `vector(384)` columns in `product_embeddings` and `review_embeddings`; a per-customer taste vector in `customer_profiles` |
| Similarity metric? | Cosine distance (`<=>`), similarity = 1 − distance |
| How is relevance retrieved? | Hybrid Reciprocal Rank Fusion of keyword, product-vector and review-vector rankings, with relational filters |

## 6.1 Vector storage

{{CODE:db/02_schema.sql|^CREATE TABLE product_embeddings|15}}

## 6.2 Vector indexes

{{CODE:db/03_indexes.sql|^-- Vector similarity|7}}

HNSW is an approximate nearest-neighbour graph index. `m` is the number of links per node and `ef_construction` the
candidate list size while building. At query time `hnsw.ef_search = 200` is set to favour recall.

## 6.3 What text is embedded

{{CODE:db/04_functions.sql|^CREATE FUNCTION product_embedding_text|13}}

## 6.4 Keeping vectors up to date: queue trigger and worker

{{CODE:db/05_triggers.sql|^CREATE FUNCTION trg_fn_enqueue_embedding|14}}

The worker claims jobs with `FOR UPDATE SKIP LOCKED`, embeds in batches, skips text whose hash is unchanged, and
upserts the vector:

{{CODE:scripts/embed-worker.mjs|const table = d.type|9}}

## 6.5 Hybrid search by vector similarity

Query embedding in the application, then the SQL function call:

{{CODE:src/lib/data/search.ts|// lexical mode never needs|10}}

The fusion step of `search_products()` (Reciprocal Rank Fusion; the full function is in the code screenshots):

{{CODE:db/04_functions.sql|^  fused AS \(|18}}

## 6.6 Similar products and personalised recommendations

Nearest neighbours of a product (`LATERAL` join over the HNSW index):

{{CODE:db/04_functions.sql|^CREATE FUNCTION similar_products|16}}

Nearest neighbours of the customer's taste vector (the mean embedding of what they bought), excluding items already
bought and out-of-stock items:

{{CODE:db/04_functions.sql|^CREATE FUNCTION recommend_for_me|20}}

## 6.7 Measured search quality

Labelled queries are in `eval/queries.json` (40) and `eval/holdout.json` (18, written before the fusion algorithm
was revised and never used to tune it). Metrics are at k = 10; relevance is graded (2 = concept in the title, 1 = in
the description or features).

| Main set, 40 queries | nDCG@10 | Precision@10 | MRR | nDCG, natural-language | nDCG, exact |
|---|---|---|---|---|---|
| Keyword (full-text) | 0.492 | 0.472 | 0.813 | 0.338 | 0.852 |
| Semantic (vectors) | 0.660 | 0.677 | 0.855 | 0.575 | 0.857 |
| **Hybrid (RRF)** | **0.687** | **0.710** | **0.880** | **0.600** | **0.890** |

| Held-out set, 18 queries | nDCG@10 | Precision@10 | MRR |
|---|---|---|---|
| Keyword | 0.402 | 0.372 | 0.715 |
| Semantic | 0.733 | 0.733 | 0.889 |
| **Hybrid** | **0.738** | **0.744** | 0.861 |

The first hybrid design gave keyword and semantic rankings equal weight and scored *worse than semantic alone*
(0.649 and 0.589). Weak keyword matches on natural-language queries out-voted good semantic ones. The fix uses a
conjunctive keyword match when one exists and gives the OR-fallback a quarter of the weight. It improved the held-out
set as well, so it is not just tuned to the queries we had inspected. Hybrid's lead over semantic on the held-out
set is within noise, so we claim "at least as good as semantic, far better than keyword".

Index performance (`EXPLAIN ANALYZE`): with 85,585 vectors an exact scan takes about 80–90 ms and HNSW 4–10 ms at
recall 0.95–1.00. At a few thousand vectors the difference is within noise. A GIN index speeds full-text search by
30–110 times, and the composite B-tree on orders by 24 times.

# 7. Next.js Project Tree Structure

Top level of the repository:

{{TREE:.|2}}

Application source (`src/`):

{{TREE:src|5}}

The Next.js App Router maps folders to URLs: `src/app/search/page.tsx` is `/search`, and
`src/app/api/checkout/route.ts` is the `POST /api/checkout` endpoint. Pages in `src/app` are server components that
call the data layer in `src/lib/data`; every database access goes through `withUser()` in `src/lib/db.ts`, which
opens a transaction and sets the current user for Row-Level Security.

# 8. Sample Screenshots: Application Demo and Code

## 8.1 Application demo

![crop:Home page: natural-language search box, example queries, categories and trending products.](screenshots/01-home.png)

![crop:Hybrid search for "gift for a dad who loves gardening", with keyword, meaning and review ranks and the matching review quote.](screenshots/02-search-hybrid.png)

![crop:"Compare all 3": keyword, semantic and hybrid results side by side for the same query.](screenshots/03-search-compare.png)

![crop:Filtered search: price, rating and stock filters are applied inside the same SQL function.](screenshots/04-search-filters.png)

![crop:Product page: ratings, reviews with verified-purchase badges, similar products and frequently bought together.](screenshots/07-product.png)

![crop:Customer cart and checkout (one atomic stored function).](screenshots/09-cart.png)

![crop:Order history with the status timeline written by the audit trigger.](screenshots/10-orders.png)

![crop:Seller dashboard: revenue trend, month-over-month growth, top products, low-stock alerts and fulfilment. All numbers are limited to the seller by Row-Level Security.](screenshots/11-seller-dashboard.png)

![crop:Admin analytics: category roll-up, seller leaderboard, search analytics and the embedding queue.](screenshots/13-admin-analytics.png)

![crop:Search quality benchmark page with per-query results.](screenshots/14-admin-search-quality.png)

![Database lab: the unsafe read-then-write sells the last unit twice; checkout() with a row lock rejects the second buyer. Below, an EXPLAIN ANALYZE of the HNSW index.](screenshots/16-admin-lab.png)

![crop:Login page with one-click demo accounts for each role.](screenshots/05-login.png)

## 8.2 Application code

![Table definition with constraints and generated columns (db/02_schema.sql).](screenshots/code-01-schema-products.png)

![Full-text (GIN) and vector (HNSW) indexes (db/03_indexes.sql).](screenshots/code-02-hnsw-gin-indexes.png)

![The checkout() stored function: row locks, stock checks, order creation (db/04_functions.sql).](screenshots/code-03-checkout-function.png)

![Hybrid search: keyword match with fallback, then Reciprocal Rank Fusion (db/04_functions.sql).](screenshots/code-04-hybrid-search.png)

![Low-stock alert trigger (db/05_triggers.sql).](screenshots/code-05-low-stock-trigger.png)

![Row-Level Security policies for orders (db/07_security.sql).](screenshots/code-06-row-level-security.png)

![Transaction helper that sets the current user for Row-Level Security (src/lib/db.ts).](screenshots/code-07-rls-aware-transaction.png)

![The checkout API route handler (src/app/api/checkout/route.ts).](screenshots/code-08-checkout-api-route.png)

## 8.3 Testing

`npm test` runs 22 integration tests against the live database. They connect as the least-privilege application
role, create their own fixtures and remove them afterwards. **Result: 22 passed, 0 failed.**

| Area | What the tests check |
|---|---|
| Authentication | correct and wrong passwords, unknown user, case-insensitive email, bcrypt storage, password hash unreadable by the app role |
| Validation | weak password, duplicate email, bad email, phone, PIN code and GSTIN, price and stock limits, rating range, short review, non-seller cannot become a seller |
| Checkout | order, price snapshot, free shipping threshold, stock decrement, cart cleared, payment and audit rows; empty cart; over-stock; someone else's address |
| Concurrency | two parallel checkouts of the last unit: exactly one succeeds |
| Orders | cancellation restores stock and refunds; only the owner can cancel; illegal status changes are rejected; status history recorded |
| Triggers | low-stock alert opens, updates and resolves; verified-purchase is computed by the database; rating aggregates; embedding queue enqueues text edits but not price edits |
| Row-Level Security | seller cannot change another seller's product; customer, sellers and anonymous users each see only their rows; users table is private; admin-only functions reject others |
| Search | keyword search with filters, hybrid search ordering, category recursion, association rules |

Bugs the tests and benchmarks caught, all fixed: trigger functions lacked rights to write their side-effect tables
(now `SECURITY DEFINER`); a generic trigger read a column missing on one table; the first hybrid fusion design
(above); and a slow keyword query plan that ignored the GIN index.

# 9. Evaluation Rubrics: Completion Status

| # | Requirement (from the project document) | Status | Where it is |
|---|---|---|---|
| 1 | Unique project title; real-world problem; not simple CRUD | **Done** | Section 1, 3. Title to be confirmed as unique in the section |
| 2 | Team of 2 with defined responsibilities across database and application | **Done** | Responsibilities split by feature (below) |
| 3 | SQL (PostgreSQL) plus Vector database (pgvector) | **Done** | Sections 4, 6 |
| 4 | ER diagram, relational schema, keys, constraints; vector data model documented | **Done** | `docs/ER-diagram.md`, `docs/data-dictionary.md`, `docs/vector-database-design.md` |
| 5 | DDL: CREATE, ALTER, DROP, keys, constraints, indexes, views | **Done** | Section 5.1 to 5.4, 5.7 |
| 6 | DML: INSERT, UPDATE, DELETE, SELECT with JOIN, GROUP BY, HAVING, ORDER BY, aggregates, subqueries | **Done** | Section 5.5, 5.6 |
| 7 | At least four advanced SQL concepts and one vector concept | **Done** | Transactions, views and materialized views, stored functions and procedures, triggers, indexing, full-text search, window functions, Row-Level Security; vector similarity search |
| 8 | Vector explanation: what is embedded, model, storage, metric, retrieval | **Done** | Section 6 |
| 9 | Functional Next.js interface with forms, tables, search, filters, dashboards | **Done** | Section 8.1 |
| 10 | Next.js talks to the database through an API layer; no hard-coded credentials; environment variables | **Done** | Route handlers in `src/app/api`; `.env.example`, `.env` is git-ignored |
| 11 | Backend authentication and at least two roles | **Done** | Customer, seller, admin; JWT sessions; bcrypt in the database |
| 12 | Input validation at the database level; consistency and integrity demonstrated | **Done** | Domains, CHECK constraints, triggers, transactions; tests in Section 8.3 |
| 13 | Documentation: objectives, requirements, ER, schema, DB justification, data dictionary, implementation, queries, architecture, screenshots, testing, conclusion | **Done** | This report and `docs/` |
| 14 | Git and GitHub; commits show individual contributions; README with setup | **Partly done** | Public repository and README are done. Commits so far come from one account; the teammate's own work should be committed under their name |
| 15 | Demonstration: design, schema, implementation, queries, interface, integration, advanced features, test cases, individual contribution | **Ready** | Demo script in the README; `npm test`; `/admin/lab` |
| 16 | Originality | **Done** | Original design and implementation; uses a public dataset (credited) for product and review text |
| 17 | Level 3 expectation: beyond CRUD, database choice justified by the data | **Done** | Section 4, 6 |
| – | Deliverable: project report | **Done** | This document |
| – | Deliverable: public GitHub repository link | **Done** | <https://github.com/Akshatpy/DBMS_MiniProject> |
| – | Individual contribution, modifications and viva | **To prepare** | Viva guide in `docs/` |

**Division of work.** Member A: schema and constraints, checkout and concurrency, triggers, authentication and Row-Level
Security, seller and admin dashboards. Member B: data ingestion and embedding pipeline, hybrid search, search
benchmark, association rules and recommendations, product pages and the index benchmark.

**Known limitations.** Payments and shipping are simulated. Orders and users are synthetic; only product and review text
are real. Relevance labels are pattern-based rather than human-annotated, and the benchmark is small, so absolute
numbers should not be compared with published benchmarks.
