# Index performance study

Run: 2026-10-27T14:56:28.043Z · PostgreSQL 17.11 (Debian 17.11-1.pgdg12+2) · pgvector 0.8.7
Medians over 20 queries; every figure is the Execution Time reported by EXPLAIN (ANALYZE).

## 1. Vector similarity (top-10 by cosine distance)

| Table | Vectors | Exact scan | HNSW (ef_search 40) | HNSW (ef_search 200) |
|---|---|---|---|---|
| product_embeddings (real) | 3,001 | 3.05 ms | 1.05 ms (recall 1.000) | 3.52 ms (recall 1.000) |
| review_embeddings (real) | 14,116 | 16.00 ms | 17.11 ms (recall 0.995) | 3.91 ms (recall 1.000) |
| scaled-up (real + noisy copies) | 85,585 | 88.54 ms | 6.16 ms (recall 0.950) | 9.95 ms (recall 1.000) |

HNSW build on the scaled-up set: 120.5 s · index 167 MB vs heap 134 MB.

## 2. Full-text search (GIN on weighted tsvector)

| Query term(s) | Matches | Seq scan | GIN index | Speed-up |
|---|---|---|---|---|
| headphones | 28 | 17.35 ms | 0.17 ms | 105.2× |
| dog toy | 29 | 16.57 ms | 0.20 ms | 82.0× |
| stainless steel | 113 | 17.81 ms | 0.32 ms | 56.2× |
| waterproof | 199 | 18.10 ms | 0.49 ms | 36.9× |
| yoga | 67 | 19.07 ms | 0.23 ms | 82.9× |

## 3. B-tree composite index `orders (user_id, placed_at DESC)`

| Query | Seq scan + sort | B-tree index | Speed-up |
|---|---|---|---|
| latest 20 orders of one customer (15,417 orders) | 2.23 ms | 0.13 ms | 17.0× |

## 4. Materialized view vs live aggregation

| Monthly revenue report | Live join + aggregate | Materialized view | Speed-up |
|---|---|---|---|
| platform-wide | 63.10 ms | 19.75 ms | 3.2× |
