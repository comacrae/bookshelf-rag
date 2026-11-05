| date | eval | change | method | index | loop | recall@5 | abstain | false-abstain | p50 ms | $/q |
|---|---|---|---|---|---|---|---|---|---|---|
| 2026-11-04 | v1 | baseline | vector | off | off | 93.8% | | | | |
| 2026-11-05 | v1 | keyword only (or) | keyword | off | off | 78.1% | | | | |
| 2026-11-05 | v1 | hybrid RRF k=60 | hybrid | off | off | 90.6% | | | | |
| 2026-11-05 | v1 | hybrid + hnsw (planner still seq scan) | hybrid | on | off | 90.6% | | | | |
