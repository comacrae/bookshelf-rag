## Langchain versions

Pinned because langchain packages all depend on langchain core

    "@langchain/core": "1.3.0",
    "@langchain/langgraph": "1.5.3",
    "@langchain/langgraph-checkpoint-postgres": "1.1.2",
    "@langchain/openai": "1.7.1",
    "@langchain/tavily": "1.2.0",

## Spike 1.2
- no reasonable distance threshold
- topic dominates the embedding (right chapter, wrong section misses likely)
- insert and queries for embeddings need pgvector.toSql()
- set embedding model explicitly
- check out pool clients AFTER API calls or an api error will leave pool.end() hanging forever