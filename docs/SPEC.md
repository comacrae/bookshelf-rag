# Bookshelf RAG: project specification

## Executive summary

Bookshelf RAG is a web app that answers questions about two programming books, Eloquent JavaScript and Pro Git, and cites the book and page for every claim. If the books can't answer, it searches the web and says so.

It is a portfolio project for full-stack jobs that ask for RAG or LLM-agent experience. It is scoped to be finished by one developer who has not built something this size before.

What gets built, in order:

1. An ingest script that turns the two PDFs into page-tagged chunks with embeddings in Postgres.
2. A hand-written retrieval layer: keyword search, vector search, and a fusion of the two.
3. A labeled eval set (30 answerable questions, 5 unanswerable) and a runner that reports recall@5, so every retrieval change gets a number.
4. A LangGraph agent that rewrites the question, retrieves, grades the results, retries up to three times, and then either answers, abstains, or falls back to web search.
5. A chat UI with streamed answers and clickable citations, deployed on Vercel with Supabase.
6. A README that shows the results table, what each change did to the numbers, the decisions made and the alternatives rejected, and the known limitations.

The ship line is after step 5. The link goes into job applications before the README is polished and before any stretch work.

Deliberate choices made for speed: one build rather than a hand-rolled pipeline followed by a framework rebuild; LangGraph for the loop and hand-written code for everything the loop calls; Postgres for everything (no Redis, no S3); PDFs as the source even though extraction is rough; one chunk size and three retrieval methods, with chunk-size and reranking experiments as stretch items.

Success is defined in section 11: the project runs from a clean clone, the results table has at least six rows with cost and latency, the live app streams validated citations, the agent passes its routing tests, and every number in the README traces to a file in the repo.

## 1. Purpose

The job postings this project targets mention RAG and LLM agents. Most portfolio RAG projects stop at "chat with a PDF" and never measure whether the retriever finds the right text. This project is built so a reviewer can verify four things:

1. The retrieval pipeline is hand-written: chunking, embedding storage, hybrid search, and citation checking are all in the repo and explained in the README.
2. There is a versioned eval set with known answers, and a results table showing recall before and after each change, including whether the agent's retry loop earns its cost.
3. The LangGraph agent has a gradable step, a hard retry cap, conversation memory, and a labeled web-search fallback.
4. Cost and latency per question are measured, not guessed.

The results table is what makes this a project rather than a demo.

### Terms used in this document

RAG (retrieval-augmented generation) means retrieving relevant text first and then having the model answer from that text only, so the answer can cite its source and can't invent facts.

A chunk is a few hundred tokens of a book stored as one database row, with the book and page it came from.

An embedding is a list of numbers a model produces from a piece of text. Texts with similar meaning get nearby vectors.

Recall@5 is the fraction of eval questions for which at least one of the top five retrieved chunks comes from a page known to contain the answer.

Hybrid retrieval merges keyword search and vector search into one ranking.

An agent is a loop in which the model's own judgment picks the next step (retry, rewrite, answer, fall back) instead of running a fixed pipeline.

The grader is the model call that decides whether the retrieved chunks can answer the question.

## 2. Decisions made for speed

Each row is a deliberate choice. Any of them can be revisited after the ship line in section 6.

| Decision | Instead of | Why |
|---|---|---|
| One build, agent from the start | A fixed pipeline first, then a rebuild as an agent | A rebuild doubles the work and produces a comparison document nobody asked for. |
| LangGraph for the loop; everything else by hand | A hand-written loop | The loop is the same four nodes either way. LangGraph adds the keyword postings filter on, built-in checkpointing, step streaming, and a graph you can draw. The retrieval, chunker, citation check and eval stay hand-written, which is where understanding gets judged. |
| LangChain model wrappers throughout | LangGraph plus a second SDK for model calls | One model stack. Structured output, streaming and reranking come from the same package. |
| PDFs as the source, accepting rough extraction | Ingesting from the books' source repos | Postings describe PDF handling. Code blocks and hyphenation will come out messy; that is recorded as a known limitation rather than fixed. |
| Postgres only | Postgres + Redis | LangGraph's Postgres checkpointer holds conversation state. The answer cache and eval results fit in the same database. |
| PDFs in the repo, ingested from a laptop | Object storage + cloud ingest | Two free, redistributable books. Nothing needs private storage. |
| One chunk size, three retrieval methods, loop on/off | A matrix of experiments | Five rows prove the method. Chunk size, overlap and reranking are stretch rows. |
| Web-search fallback behind a flag | Corpus-only abstention | The fallback is on in the demo and off during the retrieval eval, so recall measures the books and the fallback is scored on its own (section 6, M2). |
| Supabase (Postgres + pgvector) and Vercel | Self-managed hosting | Free tiers, pgvector built in, deploy on push. |

## 3. Corpus

Two books, both free as PDF and licensed for redistribution:

- Eloquent JavaScript, 4th edition (Creative Commons)
- Pro Git, 2nd edition (Creative Commons)

Confirm each license before ingesting and record it in `corpus/LICENSES.md`. The README states the corpus and licenses in one sentence. The project uses nothing purchased or DRM-protected.

Known limitation: PDF text extraction mangles code blocks, hyphenated line breaks and running headers. Some eval questions about code will miss because of extraction, not retrieval. The error analysis in M2 labels those misses so they are not mistaken for retrieval bugs.

## 4. Architecture

### Stack

TypeScript. Next.js App Router. Postgres 16 with pgvector on Supabase. LangGraph JS and LangChain JS, one chat-model provider, one embeddings provider, and one web-search provider (Tavily, Brave or Exa, whichever has a free tier). Vitest for tests. Hosted on Vercel. Pin the LangGraph and LangChain major versions; both change often.

### Components

| Component | Responsibility |
|---|---|
| `scripts/ingest.ts` | Read PDFs from `corpus/`, extract text per page, chunk, embed, insert. Safe to re-run. |
| `src/chunker.ts` | Pure function: pages in, chunks with page numbers and overlap out. Unit-tested. |
| `src/retrieval.ts` | `vectorSearch`, `keywordSearch`, `hybridSearch` (reciprocal rank fusion). Hand-written SQL. |
| `src/agent/graph.ts` | The LangGraph `StateGraph`: nodes, edges, checkpointer. |
| `src/agent/nodes.ts` | `rewrite`, `retrieve`, `grade`, `webSearch`, `answer`. Each is a plain async function over state. |
| `src/citations.ts` | Parses `[n]` and `[wN]` citations and rejects any not in the retrieved set. |
| `app/api/chat/route.ts` | Invokes the graph with a `thread_id`, streams the answer node's tokens, records cost and latency, and records one step row per node run. |
| `app/c/[id]/page.tsx` | Question box, streamed answer, citation links that open the cited chunk or URL. |
| `evals/` | Versioned question set, runner, results table, error-analysis notes. |

### The graph

```
START → rewrite → retrieve → grade
                               ├─ relevant                         → answer → END
                               ├─ not relevant, attempts < MAX     → rewrite
                               └─ not relevant, attempts = MAX
                                     ├─ WEB_FALLBACK=on            → webSearch → answer → END
                                     └─ WEB_FALLBACK=off           → answer (abstain) → END
```

The state is defined with `Annotation.Root`. Each field has exactly one node that writes it:

| Field | Type | Written by |
|---|---|---|
| `messages` | message[] (reducer: append) | input, `answer` |
| `question` | string | input |
| `rewritten` | string | `rewrite` |
| `chunks` | chunk[] | `retrieve` (overwrite each attempt) |
| `webResults` | result[] | `webSearch` |
| `relevant` | boolean | `grade` |
| `gradeReason` | string | `grade` |
| `attempts` | number | `grade` |
| `source` | 'books' \| 'web' \| 'none' | `answer` |

`MAX_ATTEMPTS = 3`. It lives in state and the conditional edge checks it. `recursionLimit` is also set on every invoke as a second guard. Both are hard caps. The model is never asked whether to stop.

The checkpointer restores the whole state between turns, including `attempts` from the previous turn. Every invoke therefore passes `attempts: 0` in its input, which the overwrite reducer applies before the first node runs. No node resets it; `grade` remains the only writer during a run. Without this, the second turn of a conversation would start with fewer retries than intended, or none.

### Request flow

```
POST /api/chat  { conversationId, question }
  → graph.stream({ question, attempts: 0 }, { configurable: { thread_id: conversationId }, recursionLimit: 25 })
  → checkpointer loads prior messages for the thread (Postgres); attempts is reset by the input, messages are kept
  → rewrite   : one model call; restate using history ("what about the next chapter?" → concrete question)
  → retrieve  : hybridSearch(rewritten, 5)
  → grade     : one structured-output call → { relevant, reason }; attempts++
  → loop or exit per the edge table above
  → webSearch : top 3 results from the search provider; only reached after MAX_ATTEMPTS
  → answer    : streamed. Chunks numbered [1]–[5]; web results [w1]–[w3]. The prompt says which source
                it is answering from and, for web, that the answer is not from the books.
  → on stream end: validateCitations; strip invalid; log
  → route records: attempts, source, input/output tokens per node, wall time, time to first token, chat model
  → route records: one request_steps row per node update, in order (node, attempt, detail, tokens, ms),
                   written with the requests row since each step needs its request id
  → client renders answer; [n] opens the chunk panel; [wN] opens the URL; a badge shows "from the books" / "from the web" / "no answer found"
```

## 5. Data model

```sql
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE books (
  id         text PRIMARY KEY,     -- 'eloquent-js-4e', 'pro-git-2e'
  title      text NOT NULL,
  file       text NOT NULL,        -- path under corpus/
  page_count int
);

CREATE TABLE chunks (
  id          bigserial PRIMARY KEY,
  book_id     text NOT NULL REFERENCES books(id),
  page        int  NOT NULL,       -- page of the chunk's first character
  chunk_index int  NOT NULL,
  content     text NOT NULL,
  embedding   vector(DIM) NOT NULL,  -- DIM = embeddings model dimension; record the model in README
  tsv         tsvector GENERATED ALWAYS AS (to_tsvector('english', content)) STORED,
  UNIQUE (book_id, chunk_index)
);
CREATE INDEX chunks_tsv_idx ON chunks USING gin (tsv);
-- Separate migration, after the baseline eval, so the before/after plan exists:
-- CREATE INDEX chunks_embedding_idx ON chunks USING hnsw (embedding vector_cosine_ops);

-- Conversation state is owned by LangGraph's PostgresSaver checkpointer (its own tables, created by its setup()).

CREATE TABLE requests (                -- one row per answered question, for cost/latency reporting
  id              bigserial PRIMARY KEY,
  conversation_id text NOT NULL,
  question        text NOT NULL,
  source          text NOT NULL CHECK (source IN ('books','web','none')),
  attempts        int  NOT NULL,
  input_tokens    int  NOT NULL,
  output_tokens   int  NOT NULL,
  web_calls       int  NOT NULL DEFAULT 0,
  latency_ms      int  NOT NULL,
  ttft_ms         int  NOT NULL,       -- time to first streamed token; what a user actually feels
  chat_model      text NOT NULL,       -- keeps rows comparable across model changes
  invalid_citations int NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now()
);
```

Migrations are numbered SQL files in `migrations/`, applied in order by `scripts/migrate.ts`. An applied migration is never edited; changes go in a new file.

The tables above are `001_schema.sql`. One more table arrives later, as `004_request_steps.sql` in M4 (002 is the book rows, 003 the HNSW index). It is not in 001 on purpose: its columns are designed after looking at real `streamMode: "updates"` events, and since 001 will already be applied by then, it has to be a new file.

The rule for what goes where: a fact that happens once per question is a column on `requests`; a fact that happens several times per question (once per node run, once per attempt) is a row in a child table with a `request_id` foreign key. Each node execution is one row:

```sql
-- migrations/004_request_steps.sql. A starting point: finalize the columns after inspecting the update events.
CREATE TABLE request_steps (           -- one row per node execution, so the UI can show how an answer was reached
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  request_id    bigint NOT NULL REFERENCES requests(id),
  seq           int  NOT NULL,         -- order within the request, from 1
  node          text NOT NULL CHECK (node IN ('rewrite','retrieve','grade','webSearch','answer')),
  attempt       int  NOT NULL,         -- the retry cycle this step belongs to
  detail        jsonb NOT NULL DEFAULT '{}',  -- rewritten query, retrieved chunk ids, grade {relevant, reason}, web URLs
  input_tokens  int  NOT NULL DEFAULT 0,
  output_tokens int  NOT NULL DEFAULT 0,
  latency_ms    int  NOT NULL,
  UNIQUE (request_id, seq)             -- also serves "all steps for a request, in order"
);
```

This is an internal table rather than a hosted tracing service such as LangSmith, by choice: writing the trace yourself is part of what the project teaches.

## 6. Build order

Each milestone ends with an acceptance line. Finish the current milestone before starting the next. M0 through M4 are the ship line: deploy after M4 and start using the link.

### M0: spike (throwaway, two evenings at most)

Four small scripts in `spike/`, deleted afterwards. The point is to meet the unknowns before anything depends on them.

- Extract text from one PDF page by page and print page 50. Confirm that the page number is known at extraction time. Look at how a code block came out and write one sentence about it in `docs/notes.md`.
- Insert 20 embedded sentences into pgvector and run `ORDER BY embedding <=> $1 LIMIT 5`.
- Build a two-node LangGraph (`Annotation.Root` state, one conditional edge, no model call) compiled with `PostgresSaver`. Invoke it twice with the same `thread_id` and confirm the second invoke sees the first's state.
- Write a Next route handler that streams the tokens of one LangChain chat-model call to the browser.

Accept when all four run. Surprises go in `docs/notes.md`.

### M1: ingest

`scripts/ingest.ts <book-id>` extracts per page, calls `chunk(pages, { targetTokens: 400, overlapTokens: 60 })`, embeds in batches of 50, and inserts in transactions. Re-running a book deletes its chunks first.

The chunker splits on paragraph boundaries toward the target size, carries the page of the chunk's first character, overlaps consecutive chunks, and never crosses a book boundary. It has three tests: a page boundary inside a chunk, a paragraph larger than the target, and overlap length.

Accept when both books are in `chunks`, `SELECT book_id, count(*) FROM chunks GROUP BY 1` looks right, three random chunks checked against the PDF are on the stated page, and the chunker tests pass.

### M2: eval set, baseline, error analysis

`evals/questions.v1.json` holds 30 answerable questions (at least 12 per book) and 5 unanswerable ones (plausible programming questions whose answers are in neither book). Write them yourself from the books. Mix exact-term lookups with conceptual questions phrased in words the text doesn't use. Mark five answerable questions `hard`.

```json
{ "id": "q01", "book": "eloquent-js-4e", "question": "...", "answerPages": [52, 53], "expected": "one line", "hard": false }
{ "id": "u01", "book": null, "question": "...", "answerPages": [], "expected": "not in corpus", "hard": false }
```

Verify every `answerPages` entry against the PDF. Once committed, the file is frozen: any edit becomes `questions.v2.json`, and every results row records the version. The set never appears in any prompt.

`evals/run.ts --method vector|keyword|hybrid --loop on|off --web off` reports:

- Retrieval score. Over the 30 answerable questions, a hit is any of the top five chunks whose `(book, page)` is in the question's `(book, answerPages)`. The runner prints recall@5 and lists the misses.
- Agent score, when `--loop on`. Runs the full graph with `WEB_FALLBACK=off` and records, per question, the final `source`, `attempts`, tokens and latency. Over the 5 unanswerable questions, the abstention rate is the fraction with `source = 'none'`. Over the 30 answerable questions, the false-abstain rate is the fraction with `source = 'none'`.
- Grader accuracy, when `--loop on`. A 2×2 table of (retrieval hit?) against (grader said relevant?) over the 30 answerable questions.

Each run appends a row to `evals/results.md` with: date, eval version, change, method, index on/off, loop on/off, recall@5, abstention, false-abstain, median latency, and $/question.

At this milestone `src/retrieval.ts` has `vectorSearch` only and the loop is not built, so the baseline row is `--method vector --loop off`.

After the baseline, do the error analysis: read every miss and put it in a bucket in `evals/notes.md`: wording mismatch, chunk boundary, wrong book, PDF extraction, or bad label. The bucket counts decide what M3 tries first, and the paragraph goes in the README.

Accept when the first row of `results.md` is the vector-only baseline, committed together with the runner and the error-analysis buckets.

### M3: hybrid retrieval and the index

`keywordSearch` runs `websearch_to_tsquery('english', $1)` over `tsv`, ranks by `ts_rank`, and returns the top 20. Postgres `ts_rank` is not BM25; the Decisions section says so and why it is fine for two books.

`hybridSearch` takes the top 20 from each method, fuses them with reciprocal rank fusion (`score = Σ 1/(60 + rank)`), and returns the top 5. One unit test checks that an item present in only one list is scored and ordered correctly.

Add eval rows for keyword-only and hybrid. For each question that flipped between miss and hit, write one sentence in `evals/notes.md`.

Add the HNSW index in a new migration. Capture `EXPLAIN ANALYZE` of the vector query before and after in `docs/index.md`. Re-run the hybrid eval and record the row, since HNSW is approximate and recall can move.

Accept when `results.md` has vector, keyword, hybrid and hybrid+index rows, `docs/index.md` shows both plans, and the app uses hybrid.

### M4: agent, chat UI, deploy

Build `src/agent/graph.ts` as described in section 4. Add nodes one at a time. After each, run `graph.stream(..., { streamMode: "updates" })` and confirm the node writes only its assigned fields.

- `retrieve` wraps `hybridSearch` as a LangChain `tool` with a schema. There is no second retrieval implementation.
- `rewrite` and `grade` use `withStructuredOutput` with one retry on malformed output.
- `answer` numbers the sources, tells the model to cite every claim, to answer only from the numbered sources, and to state which kind of source it used. When `source = 'none'`, the answer is a short "the books don't cover this" with no citations.
- `webSearch` makes one provider call, keeps the top 3, and stores them in `webResults`. It is reached only after `MAX_ATTEMPTS` and only when `WEB_FALLBACK=on`.
- `src/citations.ts` exports `validateCitations(text, chunkIds, webIds)`, which returns the invalid tokens. One unit test: an id outside either set is flagged. The route strips invalid citations and counts them in `requests`.
- The checkpointer is `PostgresSaver` from `@langchain/langgraph-checkpoint-postgres`, with `thread_id` set to the conversation id. Inspect what it writes per step and note it in `docs/graph.md`.
- The route handler invokes the graph with the `thread_id` and `{ question, attempts: 0 }` as input, streams the `answer` node's tokens, sends source metadata (chunk ids, URLs, `source`) as the first frame, and writes a `requests` row when the stream ends, including `ttft_ms` (request start to first answer token) and `chat_model`. The eval runner passes the same input shape.
- The UI has a question box, a streamed answer, a badge for books / web / none, `[n]` links that open a panel with book, page and chunk text, and `[wN]` links that open the URL. The conversation id lives in the URL so a refresh keeps history.
- Add eval rows for `--method hybrid --loop on --web off` (the full graph) and `--loop off` with the same method. The difference between those two recall@5 numbers is the measured value of the retry loop. Record grader accuracy, abstention and false-abstain.
- Deploy: a Supabase project with pgvector, ingest run once from the laptop, Vercel on push. `WEB_FALLBACK=on` in production and `off` in eval. `.env.example` documents every variable.

Accept when all of the following hold:

- "purple elevator tax" with `WEB_FALLBACK=off` exits after exactly 3 attempts with `source = 'none'`. With it on, the same question returns a web-sourced answer with `[w]` citations and the web badge.
- A question, then "what about the next chapter?", and the rewrite resolves it (visible in the updates stream). The second turn's first `grade` update shows `attempts: 1`, not a value carried over from turn one.
- Across the 30 answerable questions, zero displayed citations fall outside the retrieved set, and `source` is never `'web'`.
- Across the 5 unanswerable questions with `WEB_FALLBACK=off`, abstention is at least 4 of 5. With it on, `source` is `'web'` or `'none'` for all 5 and never `'books'`.
- `results.md` has loop-on and loop-off rows, the grader 2×2, and median latency and $/question.
- An eval question asked on the live URL streams visibly before it completes, and every citation link resolves.

This is the ship line. Put the link in the README and in applications.

### M4 follow-on: step timeline

Built right after the ship line and before any section 8 stretch item. It never delays M2 or M3; the eval numbers come first. The point is to make the retry loop and the grader visible under each answer, which few portfolio agents show, and to give error analysis a per-step record.

- Print a few real `streamMode: "updates"` events (normal question, retried question, web fallback) and finalize the `request_steps` columns from section 5 against them. Then add `migrations/004_request_steps.sql`.
- Capture: the route already iterates the graph's events. Each node update becomes one step row with `seq`, `node`, `attempt`, a small `detail` object, the tokens of that node's model calls, and its wall time. Steps are held in memory and inserted after the `requests` row, in the same transaction, using its returned id.
- UI: under each answer, a collapsed, read-only timeline with one line per step: node, attempt, a one-line summary from `detail` ("rewrote to …", "5 chunks", "not relevant: …", "3 web results"), and milliseconds. No graph rendering. A refresh shows the same timeline, read from `request_steps`.

Accept when "purple elevator tax" with `WEB_FALLBACK=off` shows a timeline of three rewrite → retrieve → grade cycles (attempts 1, 2, 3, each grade "not relevant") followed by an abstaining `answer`, and `SELECT node, attempt FROM request_steps WHERE request_id = $1 ORDER BY seq` returns the same ten rows.

### M5: README and write-up

The README is a single page with these sections, in this order:

1. One line: "Bookshelf RAG is a question-answering agent over two programming books that cites book and page, falls back to the web when the books can't answer, and measures its own retrieval quality."
2. Live link and one screenshot or short recording, including one web-fallback answer and one abstention.
3. Stack and architecture: the graph from section 4, drawn.
4. The results table from `evals/results.md`, in change order, with the eval version column.
5. What the numbers say: three sentences on the biggest surprise, and one on whether the retry loop earned its cost.
6. Error analysis: the miss buckets from M2 and what each one led to.
7. Decisions, one short paragraph each, with the alternative named: chunk size; RRF over weighted sum; `ts_rank` over BM25; HNSW over IVFFlat; embedding model (cost, dimension, license); LangGraph's fixed graph over a free-form tool-calling loop; web fallback after retries rather than as a first-class source.
8. Known limitations: PDF extraction quality (code blocks), web answers are unverified, single tenant, no reranking yet.
9. Hardest bug and how it was found.
10. How AI was used in the build: what it helped with, what was written and reviewed by hand.
11. Corpus and licenses.
12. Reproduce: the commands in section 7.

Name the repo after the problem it solves, not after the stack.

Accept when every number in the README traces to a row in `results.md`, and the reproduce commands work from a clean clone.

### M6: run it for real

Keep the deployment up and add a `/health` route. Once a week for a month, ask five questions and note any wrong, uncited or wrongly routed answer in `docs/notes.md`. Fix what breaks and write it up.

## 7. Setup and run

```
cp .env.example .env         # DATABASE_URL, model keys, search key, WEB_FALLBACK
npm install
npm run migrate              # includes PostgresSaver.setup()
npm run ingest               # both books; re-runnable
npm run dev                  # localhost:3000
npm run eval -- --method hybrid --loop on --web off
npm test
```

Running `npm run ingest` twice leaves one copy of everything.

## 8. Stretch items

Only after M5, in order of value:

1. Reranking. A cross-encoder reranker (LangChain's Cohere integration or similar) over the top 20 before taking 5. One eval row; the before/after lift is the deliverable.
2. Overlap 0 vs 60. One re-ingest, one row. Recent benchmarks suggest overlap often buys nothing.
3. Second chunk size. Add a `chunk_config` column, ingest at about 800 tokens, eval, keep the winner.
4. Answer cache. A Postgres table keyed on a hash of the normalized question. A repeated question makes no model calls.
5. Contextual chunks. Prepend a one-line summary to each chunk before embedding. One row.
6. Grade web results too. Run `grade` over `webResults` and abstain if even the web is irrelevant.

## 9. Repository layout

```
.
├── README.md
├── SPEC.md
├── .env.example
├── package.json
├── corpus/
│   ├── LICENSES.md
│   ├── eloquent-js-4e.pdf
│   └── pro-git-2e.pdf
├── migrations/              001_schema.sql, 002_books.sql, 003_hnsw.sql, 004_request_steps.sql
├── scripts/
│   ├── migrate.ts
│   └── ingest.ts
├── src/
│   ├── chunker.ts
│   ├── retrieval.ts
│   ├── citations.ts
│   ├── db.ts
│   ├── prompts.ts
│   └── agent/
│       ├── graph.ts         StateGraph, edges, checkpointer, MAX_ATTEMPTS
│       ├── nodes.ts         rewrite, retrieve, grade, webSearch, answer
│       └── state.ts         Annotation.Root definition
├── app/
│   ├── page.tsx
│   ├── c/[id]/page.tsx
│   └── api/chat/route.ts
├── evals/
│   ├── questions.v1.json
│   ├── run.ts
│   ├── results.md
│   ├── notes.md             error-analysis buckets, flipped questions
│   └── raw/
├── docs/
│   ├── index.md             EXPLAIN ANALYZE before/after
│   ├── graph.md             the graph, state fields, what the checkpointer stores
│   └── notes.md             spike findings, bugs, weekly checks
└── tests/
    ├── chunker.test.ts
    ├── rrf.test.ts
    ├── citations.test.ts
    └── agent.test.ts        retry cap and fallback routing, with mocked model and search calls
```

## 10. Tests that matter

| Test | Proves |
|---|---|
| chunker: page boundary inside a chunk | stored page is the first character's page |
| chunker: paragraph larger than target | split, not emitted oversized |
| chunker: overlap | consecutive chunks share `overlapTokens` |
| rrf: item in only one list | fused and ordered correctly |
| citations: id outside either set | flagged |
| agent: grader always says no, `WEB_FALLBACK=off` (mocked) | exits after exactly `MAX_ATTEMPTS` with `source = 'none'` |
| agent: grader always says no, `WEB_FALLBACK=on` (mocked) | routes to `webSearch` exactly once, `source = 'web'` |
| agent: grader says yes on attempt 2 (mocked) | `attempts = 2`, `webSearch` never called |
| agent: second invoke on the same thread (in-memory checkpointer, mocked) | `attempts` starts at 0 again; `messages` has four entries |
| eval: one row per change | retrieval quality was measured, not assumed |

## 11. Done

1. `npm run migrate && npm run ingest && npm run eval` works from a clean clone.
2. `results.md` has at least six rows (vector, keyword, hybrid, hybrid+index, loop off, loop on) with the eval version, latency and cost columns filled, plus the grader 2×2 and abstention numbers.
3. The live app streams answers with clickable, validated citations, keeps history across a refresh, and shows the source badge.
4. The retry cap, follow-up resolution, abstention and web-fallback routing each pass their M4 checks.
5. The README has all twelve sections and every number in it traces to a file in the repo.
