# Project Proposal

## Title
**ShopSense — A Hybrid Semantic Product Discovery Engine with Association-Rule Recommendations**

**Stack:** PostgreSQL 17 + pgvector (SQL + Vector), Next.js (App Router + Route Handlers), Docker
**Team:** 2 members (see *Work split* below)

---

## Problem Statement
Most e-commerce search is *lexical*: it returns products whose text contains the words the shopper typed. That breaks as soon as a shopper describes a **need** instead of a **product name**. A query like *"gift for a dad who likes gardening"* or *"something to keep my dog's teeth clean"* returns little or nothing, even when the catalog has exactly the right items, because the product text uses different words ("pruning shears", "dental chew"). Pure *semantic* (vector) search has the opposite failure: it understands intent but is fuzzy on exact identifiers. *"Nintendo Switch Pro controller"* can return the wrong model.

Online shoppers lose time and abandon searches. Mid-scale retailers lose sales on products that are in stock but never found. They also lack simple, trustworthy analytics on what sells together, how revenue is trending, and what is about to run out.

## Objective
Build a multi-role marketplace backed by a **normalized (3NF) PostgreSQL schema** with a **pgvector** semantic layer, where:

1. Search is **hybrid**: PostgreSQL full-text ranking (`tsvector`/`ts_rank_cd`) and vector similarity over **product descriptions and customer reviews** are fused in a single SQL query using **Reciprocal Rank Fusion**, alongside ordinary relational filters (price, category, rating, in-stock).
2. Search quality is **measured, not claimed**: a labelled benchmark of natural-language and exact-match queries compares lexical, semantic and hybrid retrieval on Precision@10, MRR and nDCG@10.
3. Data integrity is enforced **inside the database** with constraints, triggers, transactions and Row-Level Security, not only in application code.

## Why SQL + Vector (justification)
| Data | Store | Why |
|---|---|---|
| Users, sellers, products, prices, stock, carts, orders, payments | **PostgreSQL (relational)** | Highly structured, related data that needs ACID transactions (checkout must never oversell), foreign keys, constraints and aggregate analytics. |
| Product descriptions and review text (as embeddings) | **pgvector (vector)** | Unstructured natural language. Meaning cannot be matched by keywords, so it is stored as 384-dimension embeddings and searched by cosine similarity with an HNSW index. |
| Product text (as `tsvector`) | **PostgreSQL full-text** | Exact terms, brands and model numbers are matched best lexically. |

Keeping vectors **in the same PostgreSQL instance** (pgvector) lets a single query join semantic similarity with stock, price and rating filters, and keeps embeddings transactionally consistent with the rows they describe.

## Users and Roles
- **Customer:** search, view products, cart, checkout, order history, cancel orders, write reviews, personalised recommendations.
- **Seller:** manage own catalog and stock, see own revenue trends, top products and low-stock alerts. Cannot see other sellers' data, which PostgreSQL **Row-Level Security** enforces.
- **Admin:** platform-wide analytics, user management, search analytics, embedding queue, search-quality evaluation results, concurrency demo.

## Entities
Users, Customer Profiles, Addresses, Sellers, Categories (hierarchical), Products, Product Embeddings, Reviews, Review Embeddings, Carts, Cart Items, Orders, Order Items, Payments, Order Status History, Stock Alerts, Embedding Jobs, Search Logs, Evaluation Runs.

## Key Queries / Features
1. **Hybrid semantic search.** Top-k products ranked by RRF over three ranked lists: full-text rank, product-embedding cosine similarity, and best-matching review similarity. Shows *why* a product matched, e.g. the review sentence that matched.
2. **Frequently bought together.** A self-join on order history computes **support, confidence and lift** (association rules) in a **materialized view**.
3. **Seller revenue analytics.** **Window functions** (`LAG` for month-over-month growth, moving averages, `RANK() OVER (PARTITION BY …)`) and `GROUP BY ROLLUP` power seller and admin dashboards.
4. **Inventory alerts.** A **trigger** raises a stock alert when quantity drops below a seller-defined threshold and resolves it on restock.
5. **Concurrency-safe checkout.** A **stored function in one transaction** locks product rows (`SELECT … FOR UPDATE`) so two customers can never buy the last unit. This is demonstrated live.
6. **Embedding consistency.** A trigger queues re-embedding whenever product text or a review changes. A worker drains the queue with `FOR UPDATE SKIP LOCKED` and `LISTEN/NOTIFY`.
7. **Personalised recommendations.** Each customer's taste vector is the average embedding of products they bought. Nearest-neighbour search runs over the catalog.

## Advanced Database Concepts Covered
Transactions and row locking · Stored functions and procedures · Triggers · Views and materialized views · B-tree, GIN and HNSW indexes · Full-text search · Vector similarity search · Window functions and `ROLLUP` · Recursive CTE (category tree) · Row-Level Security · `CHECK`/`UNIQUE`/FK constraints and password hashing in-DB (`pgcrypto`) · `EXPLAIN ANALYZE` performance study.

## Data
Real product metadata and customer reviews from the public **Amazon Reviews 2023** dataset (McAuley Lab, UCSD): about 3,000 products across 8 categories with their real reviews. Users, orders and carts are synthetically generated with planted co-purchase patterns and seasonality, so that the association-rule and trend analytics have signal to find.

## Embedding Approach
- **Model:** `all-MiniLM-L6-v2` (sentence-transformers, 384-d), run locally through transformers.js. No paid API is needed.
- **Embedded text:** product title + brand + category + features + description, and each review's title + body.
- **Metric:** cosine distance (`<=>`), with an HNSW index (`vector_cosine_ops`).

## Work Split
| Member A — Transactions, Integrity & Analytics | Member B — Search, Vectors & Recommendations |
|---|---|
| ER diagram, relational schema, DDL and constraints | Dataset ingestion and embedding pipeline/worker |
| Checkout/cancel transactions, concurrency demo | Hybrid search SQL (FTS + vector + RRF) and search UI |
| Triggers (stock alerts, review stats, status audit) | Search-quality evaluation (P@10, MRR, nDCG) |
| Row-Level Security, authentication and roles | Frequently-bought-together (lift) and personalised recommendations |
| Seller and admin analytics dashboards | Product pages, similar products, search analytics |

Each member builds the SQL, API routes and Next.js pages for their own features.
