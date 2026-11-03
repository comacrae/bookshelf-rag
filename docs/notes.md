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

## Spike 1.3
- checkpointer saves full state to postgres per thread_id, which lets state survive process exiting
- resuming a thread starts a NEW run at START on top of saved state; DOES NOT RESUME LOOP 
- reducers decide what happens with the output of a node; an overwrite replaces, an append accumulates
- a default for a state field is what the field inits as
- there's one checkpoint row per checkpoint step including START in the checkpoint table created by postgresql saver
- postgres has its own pool; setup() first then end() to disconnect pool

## Spike 1.4

- stream loop has to live inside ReadableStream start(); otherwise if you loop before returning, you're just buffering
- Response returns immediately with the headers and the body chunks follow. Make sure you close() or the reader will wait forever
- chunk.content can be a string or a ContentBlock[]
- can use curl -N to test a server
- client works by decoding a chunk into a const then using setX( prev => prev + new); 
- setX doesn't change the variable you're holding; it tells React what to store and re-renders.
  Inside one running handler the variable keeps its old value.
  → if a handler sets the same state more than once (loops, streams), use setX(prev => prev + new)

```
click → handler runs with count = 0 → setCount(count + 1) → React stores 1 → re-render
click → handler runs with count = 1 → setCount(count + 1) → React stores 2 → re-render   ✓

Each click starts a new handler, and each new handler gets the newest copy of count. No problem.

It only breaks when one handler calls setX more than once. This is the simplest possible example, with no streams and no async:

function handleClick() {
  setCount(count + 1);   // count is 0 in this handler → "store 1"
  setCount(count + 1);   // count is STILL 0 here      → "store 1"
}
```

- Next loads .env iteslf