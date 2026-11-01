# Vector Database Design (pgvector)

## 1. Why a vector database, and why pgvector

| Question | Answer |
|---|---|
| What data needs semantic matching? | Free text: product titles/descriptions/feature bullets and customer review bodies. Shoppers describe *needs* ("keep coffee hot for hours"); catalog text uses *product vocabulary* ("double-wall vacuum-insulated tumbler"). Keyword matching cannot bridge that gap. |
| Why not only full-text search? | Lexical search is exact on tokens: it fails on synonyms and paraphrase, and a query's words may not appear in any product. We keep it anyway, because it is better than vectors for brand names, model numbers and exact phrases. The hybrid design uses both. |
| Why pgvector rather than Qdrant/Pinecone/Chroma? | Vectors must be filtered by relational predicates (category subtree, price, rating, stock) and stay transactionally consistent with the rows they describe. Inside PostgreSQL one query joins semantic similarity with those predicates, with no second system to synchronise and one backup/ACL story. At this scale (≈17k vectors) pgvector is comfortably fast (see `benchmark-results.md`). |

## 2. What is embedded

| Table | Source text (built by SQL functions, a single source of truth) | Rows |
|---|---|---|
| `product_embeddings` | `product_embedding_text(product_id)` = title · "Brand: …" · "Category: Top > Sub" · feature bullets (≤700 chars) · description (≤700 chars) | one per product |
| `review_embeddings` | `review_embedding_text(review_id)` = review title · review body (≤1200 chars) | one per review |

Reviews are embedded separately because they carry vocabulary that sellers never write ("comfortable on long flights",
"my dog loves it"). A search can therefore match a product through what customers say about it, and the UI shows the
matching review sentence as the reason for the match.

## 3. Embedding model

* **Model:** `sentence-transformers/all-MiniLM-L6-v2` (ONNX build `Xenova/all-MiniLM-L6-v2`), 22M parameters.
* **Output:** 384-dimensional vectors, mean-pooled, **L2-normalised** (so cosine similarity = dot product).
* **Runtime:** `@huggingface/transformers` (transformers.js) in Node, on CPU. No external API, no cost, no data leaves
  the machine. The same module embeds documents (worker) and queries (web app), so both sides of the comparison use the
  same model and settings.
* **Input length:** capped at 256 tokens (the model's training length). Longer text is truncated.
* **Why this model:** small enough to run on a laptop CPU, strong general-purpose retrieval quality for its size, and
  384 dimensions keep the HNSW index compact (≈1.5 KB per vector).

## 4. How vectors are stored

```sql
CREATE TABLE product_embeddings (
  product_id   BIGINT PRIMARY KEY REFERENCES products ON DELETE CASCADE,
  embedding    vector(384) NOT NULL,      -- pgvector type
  model        TEXT        NOT NULL,      -- which model produced it (allows re-embedding on model change)
  source_hash  TEXT        NOT NULL,      -- md5 of the embedded text; the worker skips unchanged text
  embedded_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- review_embeddings has the same shape, keyed by review_id.
```

Vectors live in tables **separate from the catalog** so the model or dimension can be changed by rebuilding one table
without touching `products`. `ON DELETE CASCADE` guarantees no orphaned vectors.

**Metadata** (what a retrieved vector can be filtered/joined on) is not duplicated into the vector tables. It is joined
from the relational tables at query time: category (recursive subtree), price, rating, stock, seller, `is_active`.
This avoids the classic vector-store problem of metadata going stale.

A third vector lives on `customer_profiles.taste_embedding`: the mean embedding of every product the customer bought
(cancelled orders excluded), maintained by `refresh_taste_profile()`.

## 5. Indexes and similarity metric

```sql
CREATE INDEX idx_product_embeddings_hnsw ON product_embeddings
  USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64);
CREATE INDEX idx_review_embeddings_hnsw ON review_embeddings
  USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64);
```

* **Metric: cosine distance** (`<=>`; similarity = `1 − distance`). Chosen because sentence-embedding direction carries
  meaning and magnitude does not.
* **Index: HNSW** (hierarchical navigable small world graph), approximate nearest neighbour. `m` = links per node,
  `ef_construction` = build-time candidate list. At query time `hnsw.ef_search = 200` trades a little speed for recall.
  HNSW was preferred over IVFFlat because it needs no training step, which suits a catalog that changes continuously.
* **Filtered search.** Approximate indexes can return too few rows when a restrictive filter is applied after the
  index scan. The search function sets `hnsw.iterative_scan = relaxed_order` (pgvector ≥ 0.8) so the index keeps
  scanning until enough rows pass the filter.
* Measured speed-up and recall: see [`benchmark-results.md`](benchmark-results.md).

## 6. Retrieval strategy: hybrid search with Reciprocal Rank Fusion

`search_products(query, query_embedding, mode, limit, category, min_price, max_price, min_rating, in_stock)`

```
eligible   = products passing the relational filters (is_active, category subtree, price, rating, stock)

lexical    = top 100 of eligible by ts_rank_cd(search_tsv, OR-query)        -- GIN index
semantic   = top 100 of eligible by cosine distance to the query vector     -- HNSW on product_embeddings
reviews    = best-matching review per product, top 100 products             -- HNSW on review_embeddings

score(p)   = 1/(60 + rank_lexical) + 1/(60 + rank_semantic) + 0.5/(60 + rank_review)
result     = top N by score
```

* **Why RRF.** BM25-style scores and cosine similarities are on different scales and cannot be added directly. RRF
  uses only ranks, so it needs no score calibration, and an item that appears in several lists is pushed up.
  `k = 60` is the value from the original RRF paper (Cormack et al., 2009).
* **Why reviews get half weight.** Reviews are noisier evidence than the seller's own description.
* **Weighted lexical document.** `search_tsv` = title (A) > brand (B) > features (C) > description (D).
* **Explainability.** The function returns each list's rank, the semantic similarity, and the matching review ID, so
  the UI can show *why* a product matched ("keyword #3 · meaning #1 · review #2" plus the review quote).
* **Modes.** `lexical`, `semantic` and `hybrid` share one function, which makes the evaluation a fair comparison.

Other vector queries: `similar_products(id)` (nearest neighbours of a product), `recommend_for_me()` (nearest
neighbours of the user's taste vector, excluding purchased and out-of-stock items).

## 7. Keeping embeddings consistent

```
UPDATE products SET description = …  ──► trigger trg_products_enqueue_embedding_upd
INSERT INTO reviews …                ──► trigger trg_reviews_enqueue_embedding_ins
                                           │  INSERT INTO embedding_jobs … ON CONFLICT DO NOTHING  (de-duplicated)
                                           │  pg_notify('embedding_jobs', …)
                                           ▼
                        embed-worker:  LISTEN embedding_jobs
                                       SELECT … FOR UPDATE SKIP LOCKED   (several workers can run safely)
                                       md5(text) == source_hash ? skip : embed + UPSERT
```

Only changes to text that feeds the embedding (title, brand, description, features, category) enqueue a job; price or
stock updates do not (verified by a test). Failed jobs keep `last_error` and are retried up to 5 times.

## 8. Evaluation

40 labelled queries (28 natural-language, 12 exact) are in `eval/queries.json`. Relevance labels are computed by SQL
from a category plus a concept regex over the catalog (graded: 2 = concept in the title, 1 = elsewhere in the text),
independent of any retrieval code. `npm run eval` reports Precision@10, Recall@10, MRR and nDCG@10 per mode, stored in
`eval_runs` and displayed at `/admin/search-quality`. Results and discussion are in the project report.
