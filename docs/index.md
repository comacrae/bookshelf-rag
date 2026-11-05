# Vector query plan, before and after HNSW

Query:

```
SELECT embedding::text AS qvec FROM chunks WHERE id = 3719 \gset
EXPLAIN ANALYZE SELECT id FROM chunks ORDER BY embedding <=> :'qvec'::vector LIMIT 5;
```

## Before (no vector index)
Limit -> Sort (top-N heapsort) -> Seq Scan on chunks (rows=2834)
Execution Time: 16.734 ms

## After (chunks_embedding_idx, hnsw, vector_cosine_ops)
Default planner: still Seq Scan + Sort, 7.469 ms. The planner estimates the
index (cost 1854) as dearer than a scan of 2,834 rows (cost 890).
With SET enable_seqscan = off:
Limit -> Index Scan using chunks_embedding_idx
Execution Time: 0.331 ms

Index built with pgvector defaults (m = 16, ef_construction = 64). At query
time hnsw.ef_search (default 40) sets how many candidates the search keeps:
higher is slower but more accurate.
