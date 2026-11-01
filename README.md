# ShopSense: Hybrid Semantic Product Discovery Engine

A multi-role e-commerce marketplace on **PostgreSQL 17 + pgvector** and **Next.js**. Search fuses PostgreSQL
full-text ranking with vector similarity over product descriptions and customer reviews (Reciprocal Rank Fusion), so
plain-language queries such as *"gift for a dad who loves gardening"* find the right products, while exact queries such
as *"HDMI cable"* still work. Integrity, access control and concurrency are enforced **inside the database**
(constraints, triggers, transactions, Row-Level Security).

> DBMS Experiential Learning, Level 3 project. Database option 2: **SQL + Vector database**
> (PostgreSQL with pgvector).

## Highlights

| Area | What it demonstrates |
|---|---|
| **Hybrid search** | One SQL function fuses full-text (GIN), product-embedding (HNSW) and review-embedding (HNSW) rankings with RRF, plus relational filters (category subtree, price, rating, stock) |
| **Measured quality** | 40 labelled queries; lexical vs semantic vs hybrid compared on nDCG@10, Precision@10, Recall@10, MRR (`npm run eval`, `/admin/search-quality`) |
| **Association rules** | "Frequently bought together" via support / confidence / lift in a materialized view |
| **Analytics** | Window functions (`LAG`, moving averages, `RANK() OVER (PARTITION BY …)`), `GROUP BY ROLLUP`, materialized views |
| **Triggers** | Low-stock alerts, embedding queue, verified-purchase flag, rating aggregates (statement-level + transition tables), order state machine, audit trail, cart validation |
| **Transactions** | `checkout()` runs atomically with `SELECT … FOR UPDATE`; live race-condition lab (`/admin/lab`, `npm run race`) |
| **Security** | bcrypt in the database (`pgcrypto`), least-privilege app role, column-level GRANTs, **Row-Level Security** per role |
| **Performance** | `EXPLAIN ANALYZE` study of HNSW / GIN / B-tree / materialized views (`docs/benchmark-results.md`) |

## Architecture

```
Browser ──► Next.js (App Router: pages + Route Handlers)
                │  JWT cookie session (jose); role gates in middleware + handlers
                │  set_config('app.user_id', …) per transaction
                ▼
        PostgreSQL 17 + pgvector  (connects as least-privilege role `shopsense_app`)
          ├─ relational schema (3NF), domains, CHECKs, triggers, RLS, views, functions
          ├─ vector store: product_embeddings, review_embeddings (vector(384), HNSW cosine)
          └─ embedding_jobs queue ◄── triggers        ▲
                                                      │ LISTEN/NOTIFY + FOR UPDATE SKIP LOCKED
                                    Embedding worker (Node + transformers.js, all-MiniLM-L6-v2, local ONNX)
```

Full documentation is in [`docs/`](docs/): ER diagram and relational schema, data dictionary, schema reference,
vector-database design, important queries, benchmark results, test report and the project report.

## Prerequisites

* Node.js 20+ (developed on 22)
* Docker Desktop (for PostgreSQL + pgvector), **or** a local PostgreSQL 16/17 with the `pgvector` extension

## Setup

```bash
# 1. dependencies
npm install

# 2. configuration: copy the template and set your own secrets (never commit .env)
cp .env.example .env            # Windows PowerShell: Copy-Item .env.example .env
#    then edit .env: change the passwords and set SESSION_SECRET to a long random string

# 3. start the database (PostgreSQL 17 + pgvector, port 5433)
docker compose --env-file .env up -d

# 4. create the schema (tables, indexes, functions, triggers, views, RLS)
npm run db:setup                # add  -- --reset  to drop and recreate everything

# 5. get the product data (~3,000 real Amazon products + ~14,000 real reviews, streamed, ~10 MB)
npm run data:fetch

# 6. seed users, sellers, orders, carts, then build the embeddings (about 20-30 min on a laptop CPU)
npm run db:seed
npm run embed:all               # also refreshes materialized views and taste profiles

# 7. run the app
npm run dev                     # development      -> http://localhost:3000
# or: npm run build && npm start
npm run worker                  # optional: keeps embeddings in sync when sellers edit products
```

If you do not want to use Docker, create a database yourself, run `CREATE EXTENSION vector;` as a superuser, and point
`OWNER_DATABASE_URL` / `DATABASE_URL` in `.env` at it.

### Demo accounts (created by the seed script)

| Role | Email | Password |
|---|---|---|
| Customer | `customer@shopsense.dev` | `Customer@123` |
| Seller | `seller@shopsense.dev` | `Seller@123` |
| Admin | `admin@shopsense.dev` | `Admin@123` |

## Useful commands

| Command | Purpose |
|---|---|
| `npm test` | 22 database integration tests (constraints, triggers, transactions, RLS, concurrency, search) |
| `npm run eval` | Search-quality benchmark → `eval_runs` table and `/admin/search-quality` |
| `npm run bench` | Index performance study → `docs/benchmark-results.md` |
| `npm run race` | Command-line concurrency demo (lost update vs `FOR UPDATE`) |
| `npm run docs` | Regenerate the data dictionary and schema reference from the live database |
| `npm run report` | Build `docs/Project-Report.pdf` from `docs/REPORT.md` (needs Microsoft Edge and internet for Mermaid) |
| `npm run screenshots` | Capture the application screenshots (needs the app running and Microsoft Edge) |

## Project layout

```
db/            SQL, applied in order: 01 extensions/types · 02 schema · 03 indexes · 04 functions
               05 triggers · 06 views + analytics · 07 roles/RLS
scripts/       db-setup, fetch-dataset, seed, embed-worker, evaluate, benchmark, race-demo, gen-docs
eval/          labelled benchmark queries
src/app/       Next.js pages and API route handlers (customer, seller, admin)
src/lib/       DB access (RLS-aware transactions), auth/session, embeddings, data layer
tests/         integration tests
docs/          documentation
```

## Security notes

* No credentials are in source control: all configuration comes from environment variables (`.env` is git-ignored).
* The web app connects as `shopsense_app` (no superuser, no `BYPASSRLS`, no access to `password_hash`).
  Schema changes and the embedding worker use a separate owner connection.
* Every request runs in a transaction that sets `app.user_id`; the role is looked up from the `users` table, never
  trusted from the client. RLS policies then decide which rows exist for that request.
* The demo accounts above are for local use only.

## Data and attribution

Product and review text come from the public **Amazon Reviews 2023** dataset (McAuley Lab, UCSD; used for
educational purposes). Users, sellers, addresses, orders and carts are synthetic and generated with a fixed random
seed. Prices are converted from USD to INR at a flat rate, and products without a price get a plausible one.
