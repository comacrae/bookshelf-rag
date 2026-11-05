## Baseline misses (v1, vector)
Recall: k=1 21/32, k=3 29/32, k=5 30/32. Ranking is the weak spot.

| id | bucket | note |
|---|---|---|
| q02 | wording | "closure" question; answer on p.70 didn't reach top 5. Bucket is a guess, not yet checked |
| q30 | wording | Floyd-Warshall; top 5 were nearby (pp.335-343) but missed p.337. Bucket is a guess, not yet checked |


Full questions return few keyword results because every word must match.

## M3: keyword and hybrid (v1)
Strict keyword matching (every word must appear) returned no rows for 22 of 32 questions and scored recall@5 9/32, so keywordSearch now ORs the terms: 25/32 (78.1%).

Keyword misses: q01, q02, q10, q21, q22, q29, q30. q01 asks about `??`, which Postgres strips as punctuation.

recall@1: vector 21/32, hybrid 21/32. recall@5: vector 30/32, hybrid 29/32. Hybrid shows no gain on v1. Kept for exact-term queries (identifiers, pasted errors), which v1 underrepresents; v2 should add some.

### Vector to hybrid flips
q22: hit to miss. Keyword missed it, and its chunks pushed vector's correct chunk out of the top 5.

### Label fixes for v2
q12: the answer (rerere.enabled) is also on PDF pp.167-168, not only p.295. Hybrid's top-1 chunk was 167-168 and scored as a miss.
