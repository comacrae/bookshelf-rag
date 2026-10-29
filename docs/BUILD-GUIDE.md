# Bookshelf RAG: build guide

A step-by-step companion to `SPEC.md`. The spec says what to build and what "done" means. This guide says what to type, in what order, and how to know each step worked before moving on.

## How to use this guide

Every step ends with a checkpoint. A checkpoint is something you can run or look at that proves the step worked. Do not move to the next step until the checkpoint passes. If it doesn't pass, fix it now; the next step assumes it did.

Commit after every checkpoint. The commit message is the checkpoint name. A reviewer reading your history should see the project assemble itself in the same order as this guide.

Two rules for working with AI while you build. First, anything you'd be asked about in an interview (the chunker, the retrieval SQL, rank fusion, the citation check, the graph wiring) you type yourself, then have AI review it. Second, anything that is plumbing (config, boilerplate, a Vitest setup, a Next page skeleton) you can generate, but read every line before committing. The README's "how AI was used" section is written from what actually happened, so keep a running note in `docs/notes.md` as you go.

Code in this guide is a sketch. It shows the shape of each piece and the library calls that matter. Package APIs drift, so if an import or method name fails, the package's current docs win over this guide. Pin major versions in `package.json` the day you install them.

The spec names two books. If your corpus is larger, every "per book" instruction applies to each one; nothing else changes.

## Chapter 0: setup

### 0.1 Create the repo

```
mkdir bookshelf-rag && cd bookshelf-rag
git init
npx create-next-app@latest . --typescript --app --no-tailwind --eslint --src-dir=false
```

Answer the prompts so you get the App Router, TypeScript, and no `src/` directory for the Next app (the project's `src/` is for the library code, not the UI).

Rename the repo before you push it. Name it after the problem, not the stack.

Checkpoint: `npm run dev` serves the default Next page on `localhost:3000`.

### 0.2 Add the project folders

```
mkdir -p corpus migrations scripts src/agent evals/raw docs tests spike
touch corpus/LICENSES.md evals/results.md evals/notes.md docs/notes.md
```

Add to `.gitignore`:

```
.env
spike/
evals/raw/
```

Checkpoint: `git status` shows the new folders and no `.env`.

### 0.3 Install dependencies

```
npm install pg pgvector unpdf js-tiktoken zod
npm install @langchain/core @langchain/langgraph @langchain/langgraph-checkpoint-postgres
npm install @langchain/openai        # or @langchain/anthropic; pick one chat provider and one embeddings provider
npm install @langchain/tavily        # or whichever search provider you chose
npm install -D vitest tsx @types/pg
```

Then pin: open `package.json` and change every `^` on the LangChain and LangGraph packages to an exact version. Write the versions you pinned in `docs/notes.md`.

Checkpoint: `npx tsx -e "console.log('ok')"` prints `ok`.

### 0.4 Local Postgres with pgvector

Create `docker-compose.yml`:

```yaml
services:
  db:
    image: pgvector/pgvector:pg16
    environment:
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: bookshelf
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data
volumes:
  pgdata:
```

Create `.env.example` and copy it to `.env`:

```
DATABASE_URL=postgres://postgres:postgres@localhost:5432/bookshelf
OPENAI_API_KEY=
TAVILY_API_KEY=
WEB_FALLBACK=off
EMBEDDING_MODEL=text-embedding-3-small
EMBEDDING_DIM=1536
CHAT_MODEL=gpt-4o-mini
```

Use whatever model names match your provider. Write the embedding model and its dimension down; `EMBEDDING_DIM` goes into the schema in the next step.

Checkpoint: `docker compose up -d` then `psql $DATABASE_URL -c "select 1"` returns a row. (Install `psql` if you don't have it; it's the fastest way to look at your data all project long.)

### 0.5 Migrations

Create `src/db.ts`:

```ts
import { Pool } from "pg";
export const pool = new Pool({ connectionString: process.env.DATABASE_URL });
```

Create `migrations/001_schema.sql` with the `books`, `chunks` and `requests` tables from `SPEC.md` section 5. Replace `DIM` with your `EMBEDDING_DIM` value. Do not add the HNSW index yet; that is migration 002, later.

Create `scripts/migrate.ts`:

```ts
import { readdirSync, readFileSync } from "fs";
import { pool } from "../src/db";

async function main() {
  await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz DEFAULT now())`);
  const files = readdirSync("migrations").filter(f => f.endsWith(".sql")).sort();
  for (const f of files) {
    const done = await pool.query("SELECT 1 FROM schema_migrations WHERE name = $1", [f]);
    if (done.rowCount) continue;
    const sql = readFileSync(`migrations/${f}`, "utf8");
    await pool.query("BEGIN");
    await pool.query(sql);
    await pool.query("INSERT INTO schema_migrations (name) VALUES ($1)", [f]);
    await pool.query("COMMIT");
    console.log("applied", f);
  }
  await pool.end();
}
main();
```

Add to `package.json` scripts:

```json
"migrate": "tsx --env-file=.env scripts/migrate.ts",
"ingest": "tsx --env-file=.env scripts/ingest.ts",
"eval": "tsx --env-file=.env evals/run.ts",
"test": "vitest run"
```

Checkpoint: `npm run migrate` prints `applied 001_schema.sql`. Running it again prints nothing. `psql $DATABASE_URL -c "\d chunks"` shows the `embedding` column with your dimension.

### 0.6 Corpus and licenses

Put each PDF in `corpus/`. For each one, add a line to `corpus/LICENSES.md`: title, edition, where you downloaded it, the license, and a link to the license page. If you can't find a license that allows redistribution, the book does not go in the public deployment. Stop and reconsider before continuing.

Insert the books:

```sql
INSERT INTO books (id, title, file) VALUES
  ('eloquent-js-4e', 'Eloquent JavaScript, 4th ed.', 'corpus/eloquent-js-4e.pdf'),
  ('pro-git-2e', 'Pro Git, 2nd ed.', 'corpus/pro-git-2e.pdf');
```

Put that in `migrations/002_books.sql` so a clean clone gets it. (Renumber the HNSW migration to 003 later.)

Checkpoint: `LICENSES.md` has one verified line per book; `SELECT * FROM books` lists them all.

## Chapter 1: the spike (M0)

Everything in `spike/` is throwaway. Don't test it, don't tidy it, don't keep it. The point is to find out what is harder than it looks before it matters.

### 1.1 PDF text by page

```ts
// spike/pdf.ts
import { extractText, getDocumentProxy } from "unpdf";
import { readFileSync } from "fs";

const buf = new Uint8Array(readFileSync("corpus/eloquent-js-4e.pdf"));
const pdf = await getDocumentProxy(buf);
const { text, totalPages } = await extractText(pdf, { mergePages: false });
console.log("pages:", totalPages);
console.log("--- page 50 ---");
console.log(text[49]);
```

Run it with `npx tsx spike/pdf.ts`. Do this for every book in the corpus.

Look at three things on the printed page: did the page number line up with the PDF viewer's page 50 (it often doesn't; front matter uses roman numerals), did paragraphs survive as paragraphs or come out as one line per visual line, and what happened to a code block.

Checkpoint: one line per book in `docs/notes.md` saying how page numbering maps to the PDF viewer and what code blocks look like. If a book's page 50 came out empty or garbled, write that down too; it means that book needs a different extraction path and you want to know now.

### 1.2 pgvector round trip

```ts
// spike/vec.ts
import { OpenAIEmbeddings } from "@langchain/openai";
import pgvector from "pgvector/pg";
import { pool } from "../src/db";

const emb = new OpenAIEmbeddings({ model: process.env.EMBEDDING_MODEL });
const sentences = ["Git stores snapshots, not diffs.", "A closure captures its enclosing scope.", /* ... 20 total */];
const vectors = await emb.embedDocuments(sentences);

await pool.query(`CREATE TABLE IF NOT EXISTS spike_vec (id serial, txt text, embedding vector(${process.env.EMBEDDING_DIM}))`);
for (let i = 0; i < sentences.length; i++)
  await pool.query("INSERT INTO spike_vec (txt, embedding) VALUES ($1, $2)", [sentences[i], pgvector.toSql(vectors[i])]);

const q = await emb.embedQuery("how does git save history?");
const { rows } = await pool.query("SELECT txt, embedding <=> $1 AS dist FROM spike_vec ORDER BY dist LIMIT 5", [pgvector.toSql(q)]);
console.table(rows);
```

Checkpoint: the top result is the sentence about Git snapshots, with a distance under about 0.5. Drop the table afterwards.

### 1.3 Two-node LangGraph with a Postgres checkpointer

```ts
// spike/graph.ts
import { Annotation, StateGraph, START, END } from "@langchain/langgraph";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";

const State = Annotation.Root({
  count: Annotation<number>({ reducer: (_, b) => b, default: () => 0 }),
  log: Annotation<string[]>({ reducer: (a, b) => a.concat(b), default: () => [] }),
});

const bump = async (s: typeof State.State) => ({ count: s.count + 1, log: [`bump to ${s.count + 1}`] });
const route = (s: typeof State.State) => (s.count < 3 ? "bump" : END);

const checkpointer = PostgresSaver.fromConnString(process.env.DATABASE_URL!);
await checkpointer.setup();

const graph = new StateGraph(State)
  .addNode("bump", bump)
  .addEdge(START, "bump")
  .addConditionalEdges("bump", route, { bump: "bump", [END]: END })
  .compile({ checkpointer });

const cfg = { configurable: { thread_id: "spike-1" } };
console.log(await graph.invoke({}, cfg));
console.log(await graph.invoke({}, cfg));   // second run starts from saved state
```

Run it twice. Look at what the checkpointer wrote: `psql $DATABASE_URL -c "\dt"` and poke at the `checkpoints` table.

Checkpoint: the first invoke ends with `count: 3` and three log lines. The second invoke's output shows the log has six lines (the reducer appended) and `count` restarted from the saved value. You can explain in one sentence why `count` and `log` behaved differently. Write that sentence in `docs/notes.md`; it goes in `docs/graph.md` later.

### 1.4 Streaming a model call through a Next route

Create `app/api/spike/route.ts`:

```ts
import { ChatOpenAI } from "@langchain/openai";

export async function POST(req: Request) {
  const { prompt } = await req.json();
  const model = new ChatOpenAI({ model: process.env.CHAT_MODEL });
  const stream = await model.stream(prompt);
  const encoder = new TextEncoder();
  const body = new ReadableStream({
    async start(controller) {
      for await (const chunk of stream) controller.enqueue(encoder.encode(String(chunk.content)));
      controller.close();
    },
  });
  return new Response(body, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
```

And a throwaway page with a button that does:

```ts
const res = await fetch("/api/spike", { method: "POST", body: JSON.stringify({ prompt: "Count to 20 slowly." }) });
const reader = res.body!.getReader();
const dec = new TextDecoder();
for (;;) { const { value, done } = await reader.read(); if (done) break; setText(t => t + dec.decode(value)); }
```

Checkpoint: numbers appear in the browser one at a time, not all at once. Delete the route and the page.

Commit: `M0 spike complete`. (The `spike/` folder is gitignored; what you commit is `docs/notes.md`.)

## Chapter 2: ingest (M1)

### 2.1 The chunker

This is the first piece you type by hand. Create `src/chunker.ts`:

```ts
import { getEncoding } from "js-tiktoken";
const enc = getEncoding("cl100k_base");

export type Page = { page: number; text: string };
export type Chunk = { page: number; chunkIndex: number; content: string };
export type ChunkOpts = { targetTokens: number; overlapTokens: number };

const countTokens = (s: string) => enc.encode(s).length;

export function chunk(pages: Page[], opts: ChunkOpts): Chunk[] {
  // 1. Turn pages into paragraphs, each tagged with the page it starts on.
  //    Split on blank lines; if a page has no blank lines, treat the page as one paragraph.
  // 2. Walk paragraphs, accumulating into a buffer until adding the next one would exceed targetTokens.
  //    When it would, emit the buffer as a chunk whose page is the page of the buffer's first paragraph.
  // 3. A single paragraph bigger than targetTokens is split by sentence until each piece fits.
  // 4. Overlap: when starting a new chunk, seed the buffer with the last overlapTokens worth of text
  //    from the previous chunk (same page tag as that text).
  // 5. Return chunks numbered 0..n-1.
}
```

Write it. The comments are the algorithm; the code is yours. Keep it under 80 lines. The hard case is step 4: the overlap text comes from the end of the previous chunk, and its page tag must be the page where that text actually lives, which may differ from the new chunk's first fresh paragraph. Decide which page the chunk reports (the spec says: the page of the chunk's first character, which is the overlap's page) and make the test enforce it.

### 2.2 Chunker tests

Create `tests/chunker.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { chunk } from "../src/chunker";

const para = (n: number, words = 60) => Array.from({ length: words }, (_, i) => `w${n}_${i}`).join(" ");

describe("chunker", () => {
  it("tags a chunk that straddles a page boundary with the page of its first character", () => {
    const pages = [{ page: 1, text: para(1) }, { page: 2, text: para(2) }];
    const out = chunk(pages, { targetTokens: 400, overlapTokens: 0 });
    expect(out[0].page).toBe(1);
    expect(out[0].content).toContain("w2_0"); // page 2 text landed in a page-1 chunk
  });

  it("splits a paragraph larger than the target instead of emitting it oversized", () => {
    const pages = [{ page: 1, text: para(1, 2000) }];
    const out = chunk(pages, { targetTokens: 400, overlapTokens: 0 });
    expect(out.length).toBeGreaterThan(1);
    // every chunk under target plus a small tolerance for the last sentence
  });

  it("overlaps consecutive chunks by roughly overlapTokens", () => {
    const pages = [{ page: 1, text: [para(1, 300), para(2, 300), para(3, 300)].join("\n\n") }];
    const out = chunk(pages, { targetTokens: 400, overlapTokens: 60 });
    const tail = out[0].content.split(" ").slice(-20).join(" ");
    expect(out[1].content.startsWith(tail.split(" ").slice(0, 5).join(" "))).toBe(true);
  });
});
```

Adjust the assertions to your implementation's exact behavior, but keep the three cases. Each test name says what edge it covers; that's what a reviewer reads.

Checkpoint: `npm test` passes all three. Commit: `M1 chunker with tests`.

### 2.3 The ingest script

Create `scripts/ingest.ts`:

```ts
import { readFileSync } from "fs";
import { extractText, getDocumentProxy } from "unpdf";
import { OpenAIEmbeddings } from "@langchain/openai";
import pgvector from "pgvector/pg";
import { pool } from "../src/db";
import { chunk } from "../src/chunker";

const bookId = process.argv[2];
const emb = new OpenAIEmbeddings({ model: process.env.EMBEDDING_MODEL });

async function main() {
  const { rows: [book] } = await pool.query("SELECT * FROM books WHERE id = $1", [bookId]);
  if (!book) throw new Error(`unknown book ${bookId}`);

  const pdf = await getDocumentProxy(new Uint8Array(readFileSync(book.file)));
  const { text, totalPages } = await extractText(pdf, { mergePages: false });
  const pages = text.map((t, i) => ({ page: i + 1, text: t }));   // adjust the +1 per your spike note on page numbering

  const chunks = chunk(pages, { targetTokens: 400, overlapTokens: 60 });
  console.log(`${bookId}: ${totalPages} pages → ${chunks.length} chunks`);

  await pool.query("DELETE FROM chunks WHERE book_id = $1", [bookId]);   // makes re-runs safe
  for (let i = 0; i < chunks.length; i += 50) {
    const batch = chunks.slice(i, i + 50);
    const vectors = await emb.embedDocuments(batch.map(c => c.content));
    await pool.query("BEGIN");
    for (let j = 0; j < batch.length; j++) {
      const c = batch[j];
      await pool.query(
        "INSERT INTO chunks (book_id, page, chunk_index, content, embedding) VALUES ($1,$2,$3,$4,$5)",
        [bookId, c.page, c.chunkIndex, c.content, pgvector.toSql(vectors[j])]
      );
    }
    await pool.query("COMMIT");
    process.stdout.write(`\r${Math.min(i + 50, chunks.length)}/${chunks.length}`);
  }
  await pool.query("UPDATE books SET page_count = $1 WHERE id = $2", [totalPages, bookId]);
  await pool.end();
}
main();
```

Make `npm run ingest` with no argument loop over every row in `books`.

Run it for one book first. While it runs, open the PDF.

Checkpoint, per book:

```sql
SELECT book_id, count(*), min(page), max(page) FROM chunks GROUP BY 1;
SELECT page, left(content, 120) FROM chunks WHERE book_id = 'pro-git-2e' ORDER BY random() LIMIT 3;
```

Open the PDF to each of the three random pages and find the text. If it's on the stated page, page tagging works. If it's consistently off by a constant, fix the offset in `ingest.ts`; if it's off by a varying amount, your extraction is dropping or merging pages and you need to look at the spike note again.

Run ingest a second time for the same book and confirm the count is unchanged. Commit: `M1 ingest, both books loaded` (or however many).

## Chapter 3: the eval set and the baseline (M2)

This chapter has no interesting code and is the one most people skip. It is also the chapter that separates this project from a tutorial. Budget real time for it.

### 3.1 Write the questions

Create `evals/questions.v1.json`. For each book, at least 12 questions (or your per-book floor if the corpus is larger). Open the PDF and read; don't generate questions from the chunks.

For each question record the pages where the answer lives. If the answer spans two pages, list both. Use the PDF's page numbering as your chunks store it, which you verified in 2.3.

Aim for this mix across the set:

- About a third are exact-term lookups: the question uses a word that appears in the text ("What does `git rebase --onto` do?").
- About a third are conceptual and phrased in words the text doesn't use ("Why does Git let you rewrite history on your own branch but warn you against it on shared ones?").
- The rest are somewhere in between.
- Mark five `hard`: ambiguous phrasing, answer spread across pages, or a term that appears in many places with the answer in only one.

Then five unanswerable questions: plausible programming questions whose answer is in none of your books. Pick a topic none of them covers (a different language, a tool none of them mentions). `book: null`, `answerPages: []`.

Verify every answerable question's pages one more time, a day after writing them if you can. A wrong label makes the whole table lie.

Checkpoint: the file parses, has 30+ answerable and 5 unanswerable entries, every answerable one has at least one page, and five are marked `hard`. Commit: `M2 eval set v1, frozen`. From here on, edits to the set create `questions.v2.json`.

### 3.2 Vector search

Create `src/retrieval.ts` with only `vectorSearch` for now:

```ts
import pgvector from "pgvector/pg";
import { OpenAIEmbeddings } from "@langchain/openai";
import { pool } from "./db";

const emb = new OpenAIEmbeddings({ model: process.env.EMBEDDING_MODEL });
export type Hit = { id: number; bookId: string; page: number; content: string; score: number };

export async function vectorSearch(q: string, k: number): Promise<Hit[]> {
  const v = pgvector.toSql(await emb.embedQuery(q));
  const { rows } = await pool.query(
    `SELECT id, book_id, page, content, 1 - (embedding <=> $1) AS score
       FROM chunks ORDER BY embedding <=> $1 LIMIT $2`, [v, k]);
  return rows.map(r => ({ id: r.id, bookId: r.book_id, page: r.page, content: r.content, score: Number(r.score) }));
}
```

### 3.3 The eval runner

Create `evals/run.ts`. It needs to do four things: load the question file named by `--eval` (default the latest version), retrieve for each answerable question with the chosen `--method`, score hits, and append a row to `results.md`. The `--loop` and `--web` flags exist from the start but only matter after Chapter 5; for now `--loop off` is the only option that works.

```ts
import { readFileSync, writeFileSync, appendFileSync } from "fs";
import { vectorSearch } from "../src/retrieval";

const arg = (name: string, dflt: string) => { const i = process.argv.indexOf(`--${name}`); return i > -1 ? process.argv[i + 1] : dflt; };
const method = arg("method", "vector");
const loop = arg("loop", "off");
const evalFile = arg("eval", "evals/questions.v1.json");
const change = arg("change", "");

type Q = { id: string; book: string | null; question: string; answerPages: number[]; hard: boolean };
const questions: Q[] = JSON.parse(readFileSync(evalFile, "utf8"));
const answerable = questions.filter(q => q.book);

const search = { vector: vectorSearch /* keyword, hybrid added in Chapter 4 */ }[method];

let hits = 0;
const raw: any[] = [];
for (const q of answerable) {
  const t0 = Date.now();
  const top = await search(q.question, 5);
  const hit = top.some(h => h.bookId === q.book && q.answerPages.includes(h.page));
  if (hit) hits++;
  else console.log(`MISS ${q.id} ${q.hard ? "(hard)" : ""} got pages ${top.map(h => `${h.bookId}:${h.page}`).join(", ")}`);
  raw.push({ id: q.id, hit, retrieved: top.map(h => ({ book: h.bookId, page: h.page, id: h.id })), ms: Date.now() - t0 });
}
const recall = hits / answerable.length;
console.log(`recall@5 = ${(recall * 100).toFixed(1)}%  (${hits}/${answerable.length})`);

const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
writeFileSync(`evals/raw/${stamp.replace(/[: ]/g, "-")}-${method}-${loop}.json`, JSON.stringify(raw, null, 2));
appendFileSync("evals/results.md",
  `| ${stamp} | ${evalFile.replace("evals/questions.", "").replace(".json", "")} | ${change} | ${method} | off | ${loop} | ${(recall * 100).toFixed(1)}% | | | | |\n`);
```

Put the table header in `results.md` by hand before the first run:

```
| date | eval | change | method | index | loop | recall@5 | abstain | false-abstain | p50 ms | $/q |
|---|---|---|---|---|---|---|---|---|---|---|
```

Checkpoint: `npm run eval -- --method vector --change "baseline"` prints a recall number and a list of misses, writes a raw file, and adds one row to `results.md`. Commit: `M2 baseline: vector-only recall@5 = NN%`. Put the real number in the commit message.

### 3.4 Error analysis

Open the raw file and the question file side by side. For every miss, decide which bucket it belongs in and write it in `evals/notes.md`:

```
## Baseline misses (v1, vector)

| id | bucket | note |
|---|---|---|
| q07 | wording | question says "undo", text says "revert"; no overlap in embedding space either |
| q13 | chunk boundary | answer sentence split across chunks 212/213; neither chunk alone matches |
| q19 | wrong book | retrieved Eloquent JS pages about "branches" (control flow) for a Git question |
| q22 | PDF extraction | code block on p.88 came out as one line per token; the answer is in the code |
| q25 | bad label | answer is actually on p.141, not p.140. Fix in v2. |
```

Then count the buckets. The biggest bucket is what Chapter 4 should help with, and you'll say so in the README. If "bad label" has entries, fix them in `questions.v2.json` now and re-run the baseline against v2 so the two rows are comparable.

Checkpoint: every miss has a bucket; the bucket counts are at the top of the section. Commit: `M2 error analysis`.

## Chapter 4: hybrid retrieval and the index (M3)

### 4.1 Keyword search

Add to `src/retrieval.ts`:

```ts
export async function keywordSearch(q: string, k: number): Promise<Hit[]> {
  const { rows } = await pool.query(
    `SELECT id, book_id, page, content, ts_rank(tsv, websearch_to_tsquery('english', $1)) AS score
       FROM chunks WHERE tsv @@ websearch_to_tsquery('english', $1)
      ORDER BY score DESC LIMIT $2`, [q, k]);
  return rows.map(/* same mapping */);
}
```

Test it in `psql` first with a question you know the exact wording of, so you see what `websearch_to_tsquery` does with your question (it ANDs the words, which is why a long natural-language question often returns nothing). Write one sentence about that in `docs/notes.md`; it belongs in the README's `ts_rank` vs BM25 decision.

### 4.2 Reciprocal rank fusion

Type this one by hand. Put the fusion in its own function so it can be unit-tested without a database:

```ts
export function rrf(lists: Hit[][], k = 60): Hit[] {
  const score = new Map<number, { hit: Hit; s: number }>();
  for (const list of lists)
    list.forEach((h, rank) => {
      const e = score.get(h.id) ?? { hit: h, s: 0 };
      e.s += 1 / (k + rank + 1);
      score.set(h.id, e);
    });
  return [...score.values()].sort((a, b) => b.s - a.s).map(e => ({ ...e.hit, score: e.s }));
}

export async function hybridSearch(q: string, k: number): Promise<Hit[]> {
  const [v, kw] = await Promise.all([vectorSearch(q, 20), keywordSearch(q, 20)]);
  return rrf([v, kw]).slice(0, k);
}
```

Create `tests/rrf.test.ts` with the one case the spec asks for: an item that appears in only one list gets a score and lands in the right position relative to items that appear in both. Add a second if you like: two lists with the same item at rank 1 in both puts it first.

Wire `keyword` and `hybrid` into the runner's `search` map.

Checkpoint: `npm test` passes. Run `npm run eval -- --method keyword --change "keyword only"` and `npm run eval -- --method hybrid --change "hybrid RRF k=60"`. Three rows in `results.md`. For every question whose hit/miss flipped between vector and hybrid, one sentence in `evals/notes.md`. Commit: `M3 hybrid: recall@5 vector NN% → hybrid NN%`.

If hybrid is not better than vector, that is a finding, not a failure. Look at the flipped questions; the usual cause is `websearch_to_tsquery` returning nothing for long questions, which drags nothing in but also costs nothing. Write down what you see.

### 4.3 The HNSW index, with before and after

Before adding the index, capture the plan:

```sql
EXPLAIN ANALYZE SELECT id FROM chunks ORDER BY embedding <=> '[...your query vector...]' LIMIT 5;
```

Get a real query vector by logging one from `vectorSearch`. Paste the plan into `docs/index.md` under "Before". You should see `Seq Scan` and a sort.

Create `migrations/003_hnsw.sql`:

```sql
CREATE INDEX chunks_embedding_idx ON chunks USING hnsw (embedding vector_cosine_ops);
ANALYZE chunks;
```

Run `npm run migrate`, then the same `EXPLAIN ANALYZE`. Paste it under "After". You should see `Index Scan using chunks_embedding_idx`. Note both execution times. Add two sentences on what `hnsw.ef_search` trades (higher is slower and more accurate) and which `m` and `ef_construction` you used (the defaults, unless you changed them).

Re-run the hybrid eval with `--change "hybrid + hnsw"`. The number can move a little because HNSW is approximate.

Checkpoint: `docs/index.md` has both plans with timings and the index is visibly used. Fourth row in `results.md`. Commit: `M3 HNSW index, plans captured`.

## Chapter 5: the agent, the UI, and the deploy (M4)

This is the longest chapter. Build it in the order given and run the graph after every node.

### 5.1 State

Create `src/agent/state.ts`:

```ts
import { Annotation } from "@langchain/langgraph";
import type { BaseMessage } from "@langchain/core/messages";
import type { Hit } from "../retrieval";

export type WebResult = { url: string; title: string; content: string };
export type Source = "books" | "web" | "none";

export const State = Annotation.Root({
  messages: Annotation<BaseMessage[]>({ reducer: (a, b) => a.concat(b), default: () => [] }),
  question: Annotation<string>,
  rewritten: Annotation<string>,
  chunks: Annotation<Hit[]>({ reducer: (_, b) => b, default: () => [] }),
  webResults: Annotation<WebResult[]>({ reducer: (_, b) => b, default: () => [] }),
  relevant: Annotation<boolean>,
  gradeReason: Annotation<string>,
  attempts: Annotation<number>({ reducer: (_, b) => b, default: () => 0 }),
  source: Annotation<Source>,
});
export type S = typeof State.State;
export const MAX_ATTEMPTS = 3;
```

The spec's table in section 4 says which node writes which field. Keep that table open while writing nodes; a node that writes a field it doesn't own is the most common graph bug.

### 5.2 Nodes, one at a time

Create `src/agent/nodes.ts` and `src/prompts.ts`. Keep prompts as exported template strings in `prompts.ts` so they're reviewable in one place.

Rewrite:

```ts
import { z } from "zod";
import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, AIMessage } from "@langchain/core/messages";
import { hybridSearch } from "../retrieval";
import { S, MAX_ATTEMPTS } from "./state";
import * as P from "../prompts";

const model = new ChatOpenAI({ model: process.env.CHAT_MODEL, temperature: 0 });

export async function rewrite(s: S) {
  const out = await model.withStructuredOutput(z.object({ rewritten: z.string() }))
    .invoke(P.rewrite(s.question, s.messages, s.gradeReason));
  return { rewritten: out.rewritten };
}
```

The prompt tells the model: here is the conversation so far, here is the new question, restate it as a standalone question that could be answered from a book with no other context; if a previous attempt failed, here is why, so phrase it differently.

Retrieve:

```ts
export async function retrieve(s: S) {
  return { chunks: await hybridSearch(s.rewritten, 5) };
}
```

The spec asks for the retrieval to be exposed as a LangChain `tool`. Define it as one (`tool(async ({ query }) => hybridSearch(query, 5), { name: "search_books", schema: z.object({ query: z.string() }) })`) and have the node call `.invoke`. It is the same function; the tool wrapper is there so the graph could hand it to a model later.

Grade:

```ts
export async function grade(s: S) {
  const out = await model.withStructuredOutput(z.object({ relevant: z.boolean(), reason: z.string() }))
    .invoke(P.grade(s.rewritten, s.chunks));
  return { relevant: out.relevant, gradeReason: out.reason, attempts: s.attempts + 1 };
}
```

The grade prompt shows the question and the five chunks and asks one thing: can the question be answered from these chunks, yes or no, and why in one sentence. Resist adding more to it.

Web search:

```ts
import { TavilySearch } from "@langchain/tavily";
const tavily = new TavilySearch({ maxResults: 3 });

export async function webSearch(s: S) {
  const r = await tavily.invoke({ query: s.rewritten });
  const results = (r.results ?? r).slice(0, 3).map((x: any) => ({ url: x.url, title: x.title, content: x.content }));
  return { webResults: results };
}
```

Check the actual shape of your provider's result and adjust.

Answer:

```ts
export async function answer(s: S) {
  const source: Source = s.relevant ? "books" : s.webResults.length ? "web" : "none";
  const prompt = source === "none" ? P.abstain(s.question)
               : source === "books" ? P.answerFromBooks(s.rewritten, s.chunks)
               : P.answerFromWeb(s.rewritten, s.webResults);
  const res = await model.invoke(prompt);   // streaming is handled at the graph level in 5.5
  return { source, messages: [new HumanMessage(s.question), new AIMessage(String(res.content))] };
}
```

`answerFromBooks` numbers the chunks `[1]`..`[5]` with book title and page, and says: answer only from these, cite every claim with `[n]`, don't use any other citation format, and begin with nothing else. `answerFromWeb` numbers results `[w1]`..`[w3]` with the URL and says the same, plus: state in the first sentence that the books did not cover this and the answer comes from the web.

### 5.3 The graph

Create `src/agent/graph.ts`:

```ts
import { StateGraph, START, END } from "@langchain/langgraph";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import { State, S, MAX_ATTEMPTS } from "./state";
import * as N from "./nodes";

function afterGrade(s: S) {
  if (s.relevant) return "answer";
  if (s.attempts < MAX_ATTEMPTS) return "rewrite";
  return process.env.WEB_FALLBACK === "on" ? "webSearch" : "answer";
}

export function buildGraph(checkpointer?: PostgresSaver) {
  return new StateGraph(State)
    .addNode("rewrite", N.rewrite)
    .addNode("retrieve", N.retrieve)
    .addNode("grade", N.grade)
    .addNode("webSearch", N.webSearch)
    .addNode("answer", N.answer)
    .addEdge(START, "rewrite")
    .addEdge("rewrite", "retrieve")
    .addEdge("retrieve", "grade")
    .addConditionalEdges("grade", afterGrade, { answer: "answer", rewrite: "rewrite", webSearch: "webSearch" })
    .addEdge("webSearch", "answer")
    .addEdge("answer", END)
    .compile({ checkpointer });
}

let saver: PostgresSaver | undefined;
export async function getGraph() {
  if (!saver) { saver = PostgresSaver.fromConnString(process.env.DATABASE_URL!); await saver.setup(); }
  return buildGraph(saver);
}
```

`buildGraph` takes an optional checkpointer so tests can build it without Postgres.

Now the step-by-step check the spec asks for. Write `spike/run-graph.ts`:

```ts
import { getGraph } from "../src/agent/graph";
const g = await getGraph();
for await (const step of await g.stream({ question: "What does git rebase do?", attempts: 0 },
    { configurable: { thread_id: "dev-1" }, recursionLimit: 25, streamMode: "updates" }))
  console.log(JSON.stringify(step, null, 1).slice(0, 600));
```

Each printed step is `{ nodeName: { fieldsItWrote } }`. Confirm against the spec's table: `rewrite` writes only `rewritten`, `grade` writes only `relevant`, `gradeReason`, `attempts`, and so on.

Checkpoint: a normal question runs `rewrite → retrieve → grade → answer` and every node's update contains only its own fields. Commit: `M4 graph runs end to end`.

### 5.4 The two routing checks and the agent tests

Run `spike/run-graph.ts` with the question "purple elevator tax" and `WEB_FALLBACK=off`. You should see three `grade` updates with `attempts` 1, 2, 3 and `relevant: false`, then `answer` with `source: "none"`. Switch `WEB_FALLBACK=on`, run again, and you should see `webSearch` once, then `answer` with `source: "web"`.

Then make that permanent in `tests/agent.test.ts`. Use `vi.mock` to replace the model calls and the search provider so the test runs without network or database:

```ts
import { describe, it, expect, vi } from "vitest";

vi.mock("../src/agent/nodes", async (orig) => {
  const real = await orig<typeof import("../src/agent/nodes")>();
  return {
    ...real,
    rewrite: async (s: any) => ({ rewritten: s.question }),
    retrieve: async () => ({ chunks: [] }),
    webSearch: vi.fn(async () => ({ webResults: [{ url: "u", title: "t", content: "c" }] })),
    answer: async (s: any) => ({ source: s.relevant ? "books" : s.webResults.length ? "web" : "none", messages: [] }),
  };
});

// four tests: grader always no with fallback off → attempts 3, source none, webSearch not called
//             grader always no with fallback on  → webSearch called once, source web
//             grader yes on attempt 2            → attempts 2, source books, webSearch not called
//             two invokes on one thread          → second run's attempts starts at 0; messages has 4 entries
```

The grader mock is set per test (always false; false then true). Build the graph with `buildGraph()` and no checkpointer for the first three. For the fourth, pass `new MemorySaver()` from `@langchain/langgraph` so the thread persists in memory, invoke twice with the same `thread_id`, and make the mocked `answer` return two messages so the count is checkable. Set `process.env.WEB_FALLBACK` inside each test. Every invoke's input is `{ question, attempts: 0 }`; the reset is the thing the fourth test exists to pin.

Checkpoint: `npm test` passes the three agent tests plus the earlier ones. Commit: `M4 routing tests`.

### 5.5 Citation validation and the streaming route

Create `src/citations.ts`:

```ts
export function validateCitations(text: string, chunkIds: number[], webIds: string[]) {
  const invalid: string[] = [];
  for (const m of text.matchAll(/\[(w?\d+)\]/g)) {
    const t = m[1];
    const ok = t.startsWith("w") ? webIds.includes(t) : chunkIds.includes(Number(t));
    if (!ok) invalid.push(t);
  }
  return { valid: invalid.length === 0, invalid };
}
```

Here `chunkIds` are the display numbers 1..5 (not database ids) and `webIds` are `w1`..`w3`. Add `tests/citations.test.ts` with one case: `[7]` when only 1..5 were shown is invalid.

Now the route. Replace `answer`'s single `model.invoke` with a streaming-friendly version: the simplest approach is to leave `answer` as is for the eval runner, and in the route use `graph.streamEvents` to forward the answer node's tokens as they arrive:

```ts
// app/api/chat/route.ts
import { getGraph } from "../../../src/agent/graph";
import { validateCitations } from "../../../src/citations";
import { pool } from "../../../src/db";

export async function POST(req: Request) {
  const { conversationId, question } = await req.json();
  const graph = await getGraph();
  const cfg = { configurable: { thread_id: conversationId }, recursionLimit: 25, version: "v2" as const };
  const enc = new TextEncoder();
  const t0 = Date.now();

  const body = new ReadableStream({
    async start(controller) {
      let meta: any = null, text = "", attempts = 0, inTok = 0, outTok = 0, ttft = 0;
      for await (const ev of graph.streamEvents({ question, attempts: 0 }, cfg)) {   // attempts reset per turn; see SPEC §4
        if (ev.event === "on_chain_end" && ev.name === "grade") attempts = ev.data.output.attempts;
        if (ev.event === "on_chain_start" && ev.name === "answer") {
          const s = ev.data.input;
          meta = { source: s.relevant ? "books" : s.webResults?.length ? "web" : "none",
                   chunks: s.chunks.map((c: any, i: number) => ({ n: i + 1, book: c.bookId, page: c.page, content: c.content })),
                   web: (s.webResults ?? []).map((w: any, i: number) => ({ n: `w${i + 1}`, url: w.url, title: w.title })) };
          controller.enqueue(enc.encode(JSON.stringify({ meta }) + "\n"));   // first frame
        }
        if (ev.event === "on_chat_model_stream" && ev.metadata?.langgraph_node === "answer") {
          const piece = String(ev.data.chunk.content ?? "");
          if (!ttft) ttft = Date.now() - t0;
          text += piece;
          controller.enqueue(enc.encode(JSON.stringify({ token: piece }) + "\n"));
        }
        if (ev.event === "on_chat_model_end") { inTok += ev.data.output?.usage_metadata?.input_tokens ?? 0; outTok += ev.data.output?.usage_metadata?.output_tokens ?? 0; }
      }
      const { invalid } = validateCitations(text, meta.chunks.map((c: any) => c.n), meta.web.map((w: any) => w.n));
      controller.enqueue(enc.encode(JSON.stringify({ done: true, invalid }) + "\n"));
      controller.close();
      await pool.query(
        `INSERT INTO requests (conversation_id, question, source, attempts, input_tokens, output_tokens, web_calls, latency_ms, ttft_ms, chat_model, invalid_citations)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [conversationId, question, meta.source, attempts, inTok, outTok, meta.source === "web" ? 1 : 0, Date.now() - t0, ttft, process.env.CHAT_MODEL, invalid.length]);
    },
  });
  return new Response(body, { headers: { "Content-Type": "application/x-ndjson" } });
}
```

The exact event names and the `usage_metadata` shape are the parts most likely to differ by version. Log every event once to see what you get, then filter.

Checkpoint: `curl -N -X POST localhost:3000/api/chat -d '{"conversationId":"c1","question":"What is a closure?"}'` prints a meta line, then token lines one at a time, then a done line. A `requests` row appears with non-zero tokens and latency, a `ttft_ms` well below `latency_ms`, and your `chat_model`. Commit: `M4 streaming route with citation validation`.

### 5.6 The UI

`app/page.tsx` creates a conversation id (`crypto.randomUUID()`) and redirects to `/c/[id]`. `app/c/[id]/page.tsx` is the chat: a text box, a list of turns, and for the in-progress answer a reader loop over the NDJSON stream that handles three frame kinds (`meta`, `token`, `done`).

Rendering the answer: split on the citation regex and turn each `[n]` or `[wN]` into a button. Clicking a chunk citation opens a side panel with book, page and the chunk text from `meta`; clicking a web one opens the URL in a new tab. Strip any token the `done` frame listed as invalid. Show a badge from `meta.source`.

History on refresh: on page load, read prior turns for the thread. The simplest route is a `GET /api/chat?conversationId=` that calls `graph.getState(cfg)` and returns `state.values.messages`.

Keep it plain. No component library is needed; this is a demo, and a reviewer cares that citations open the right chunk, not that the buttons are pretty.

Checkpoint: in the browser, ask an eval question; the answer streams visibly, each `[n]` opens a panel showing the right book and page, the badge says "from the books". Ask "what about the next chapter?"; the answer makes sense (and the `rewritten` field in your server log shows a concrete question). Refresh; the conversation is still there. Commit: `M4 chat UI`.

### 5.7 Full-pipeline checks

Three things to verify before deploying, all against the 30 answerable questions with `WEB_FALLBACK=off`. Add a `--loop on` path to `evals/run.ts` that invokes the graph (without a checkpointer, fresh `thread_id` per question, input `{ question, attempts: 0 }`) instead of calling retrieval directly, and records `source`, `attempts`, latency, and tokens per question. Recall is computed the same way, from `chunks` in the final state.

Then:

1. `npm run eval -- --method hybrid --loop off --change "hybrid, no loop"` (you have this row already; re-run so it's on the same date).
2. `npm run eval -- --method hybrid --loop on --change "full graph, loop on"`. The runner now also prints: abstention rate over the 5 unanswerable questions, false-abstain rate over the 30, the grader 2×2, median latency, and $/question (tokens × your provider's prices; put the prices in `evals/run.ts` as constants with a comment on the date).
3. Compare the two recall numbers. That difference is what the retry loop bought.

While it runs, watch for any answerable question whose final `source` is `web`. There should be none with the flag off, by construction; if you see one, the flag isn't being read where you think.

Checkpoint: `results.md` has loop-on and loop-off rows with the new columns filled; `evals/notes.md` has the grader 2×2 and a sentence on what it shows (the usual finding is that the grader is stricter than the retrieval hit, which means some hits get needlessly retried; say so if that's what you see). Zero invalid citations across the 30. Commit: `M4 loop on vs off: NN% → NN%`.

### 5.8 Deploy

1. Create a Supabase project. In the SQL editor run `CREATE EXTENSION IF NOT EXISTS vector;`. Copy the connection string (the pooled one for Vercel, the direct one for ingest).
2. Point `DATABASE_URL` in your local `.env` at the direct Supabase string, run `npm run migrate` and `npm run ingest`. This loads the production database from your laptop once. Switch `.env` back to local afterwards.
3. Push to GitHub. In Vercel, import the repo, set every variable from `.env.example` (`DATABASE_URL` = pooled string, `WEB_FALLBACK=on`, the API keys). Deploy.
4. Open the live URL and run the M4 acceptance list from the spec by hand: an eval question streams and cites; "purple elevator tax" comes back from the web with the web badge; a follow-up resolves; a refresh keeps history.

If the first request on Vercel times out, the cause is almost always the checkpointer's `setup()` running on a cold start plus a three-attempt loop. Run `setup()` once from your laptop against the production database and remove it from the request path.

Checkpoint: the live URL passes all four hand checks, and a `requests` row lands in Supabase for each. Commit: `M4 deployed`, and put the URL at the top of `README.md` right now, before anything else is written. This is the ship line.

### 5.9 Step rows: migration 004 and capture

Do this after the ship line, not before. It is the follow-on in the spec's M4 section, and it comes before any stretch item.

First, look at what you're about to store. Run `spike/run-graph.ts` three times: a normal question, "purple elevator tax" with `WEB_FALLBACK=off`, and the same with it on. Each printed update is one future row. Decide what goes in `detail` for each node; keep it to ids and short strings (the rewritten query, chunk ids, the grade's `relevant` and `reason`, web URLs), never chunk text, which is already in `chunks`.

Create `migrations/004_request_steps.sql` with the `request_steps` table from `SPEC.md` section 5, adjusted for what you saw. Don't touch 001; it's applied.

Checkpoint: `npm run migrate` prints `applied 004_request_steps.sql`. `psql $DATABASE_URL -c "\d request_steps"` shows the foreign key to `requests`.

Now capture. The route's `streamEvents` loop already sees every node finish: the `on_chain_end` event for a node carries the same update that `streamMode: "updates"` prints. Add to the loop in `app/api/chat/route.ts`:

```ts
const NODES = new Set(["rewrite", "retrieve", "grade", "webSearch", "answer"]);
const steps: any[] = [], started = new Map<string, number>();
let grades = 0, stepIn = 0, stepOut = 0;

// inside the for-await loop:
if (ev.event === "on_chain_start" && NODES.has(ev.name)) started.set(ev.run_id, Date.now());
if (ev.event === "on_chat_model_end") {
  stepIn += ev.data.output?.usage_metadata?.input_tokens ?? 0;
  stepOut += ev.data.output?.usage_metadata?.output_tokens ?? 0;
}
if (ev.event === "on_chain_end" && NODES.has(ev.name)) {
  const out = ev.data.output;
  if (ev.name === "grade") grades = out.attempts;
  steps.push({
    seq: steps.length + 1, node: ev.name,
    attempt: ev.name === "rewrite" || ev.name === "retrieve" ? grades + 1 : grades,   // the cycle this step belongs to
    detail: detailOf(ev.name, out), inTok: stepIn, outTok: stepOut,
    ms: Date.now() - started.get(ev.run_id)!,
  });
  stepIn = stepOut = 0;
}
```

`detailOf` is a small switch: `{ rewritten }` for rewrite, `{ chunkIds }` for retrieve, `{ relevant, reason }` for grade, `{ urls }` for webSearch, `{ source }` for answer. If you see a node's end event twice, also require `ev.metadata?.langgraph_node === ev.name`.

Then write the steps with the request. A step needs the request's id, so change the `requests` insert to end in `RETURNING id`, and do both inserts on one client in one transaction:

```ts
const client = await pool.connect();
try {
  await client.query("BEGIN");
  const { rows } = await client.query(`INSERT INTO requests (...) VALUES (...) RETURNING id`, [/* as before */]);
  for (const st of steps)
    await client.query(
      `INSERT INTO request_steps (request_id, seq, node, attempt, detail, input_tokens, output_tokens, latency_ms)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [rows[0].id, st.seq, st.node, st.attempt, st.detail, st.inTok, st.outTok, st.ms]);
  await client.query("COMMIT");
} catch (e) { await client.query("ROLLBACK"); throw e; } finally { client.release(); }
```

Also add `steps` to the `done` frame so the client has them without a second request.

Checkpoint: ask "purple elevator tax" with `WEB_FALLBACK=off` through `curl`, then:

```sql
SELECT seq, node, attempt, detail->>'relevant' AS relevant, latency_ms
FROM request_steps WHERE request_id = (SELECT max(id) FROM requests) ORDER BY seq;
```

Ten rows: rewrite, retrieve, grade with attempt 1, the same with 2 and 3, each grade `false`, then `answer` with `{"source":"none"}`. The per-step tokens add up to the request's tokens. Commit: `M4 request steps captured`.

### 5.10 The step timeline

Under each answer in `app/c/[id]/page.tsx`, add a collapsed "How this answer was reached" toggle. Open, it is a plain list with one line per step: node, attempt, a one-line summary built from `detail`, and milliseconds.

```
1  rewrite    #1  "Is there a tax on purple elevators?"     410 ms
2  retrieve   #1  5 chunks                                    90 ms
3  grade      #1  not relevant: passages are about git tags  620 ms
...
10 answer     #3  no answer found                            380 ms
```

Read-only, no graph drawing, no library. Live, the steps come from the `done` frame. On refresh, extend the history `GET` to also return each turn's steps: select the conversation's `requests` rows by `created_at` with their `request_steps` by `seq`, and pair the nth request with the nth answer.

Checkpoint: in the browser, "purple elevator tax" with `WEB_FALLBACK=off` shows three rewrite → retrieve → grade cycles and then an abstaining answer; a normal question shows four lines; a refresh shows the same timelines. Commit: `M4 step timeline`.

## Chapter 6: the README (M5)

Write the README in the order the spec lists its twelve sections. Three of them need preparation:

Section 3, the graph drawn: a Mermaid block renders on GitHub.

```mermaid
flowchart LR
  S((start)) --> R[rewrite] --> T[retrieve] --> G{grade}
  G -- relevant --> A[answer] --> E((end))
  G -- "not relevant, attempts < 3" --> R
  G -- "attempts = 3, fallback on" --> W[webSearch] --> A
  G -- "attempts = 3, fallback off" --> A
```

Section 4, the results table: copy `evals/results.md` as is. Don't retype numbers.

Section 7, decisions: for each, two or three sentences: what you chose, the alternative you considered, and the reason, with a number from your own table where one exists ("RRF with k=60 over a weighted sum: a weighted sum needs the two score scales normalized, and I didn't want a tuning knob I couldn't justify; RRF moved recall from NN% to NN% with no parameters").

Section 10, how AI was used: write it from `docs/notes.md`. Be specific. "Claude Code generated the Next page skeleton and the migrate script; I wrote the chunker, retrieval SQL, RRF, citation validator and graph by hand and had Claude review each" is the kind of sentence that survives an interview.

Checkpoint: a friend who hasn't seen the project can clone it, run the commands in section 12, and get the same baseline recall number within a point. Every number in the README appears in `results.md`. Commit: `M5 README`.

## Chapter 7: keep it alive (M6)

Add `app/api/health/route.ts` that runs `SELECT 1` and returns `{ ok: true, chunks: <count> }`.

Put a weekly reminder in your calendar for four weeks. Each time: open the live app, ask five questions (two from the eval set, two new ones, one unanswerable), and record in `docs/notes.md` what came back and whether anything was wrong, uncited, or routed to the web when it shouldn't have been. If something is broken, fix it and add it to the README's hardest-bug section if it earns the spot.

Checkpoint: four dated entries in `docs/notes.md`. That's the whole milestone.

## Appendix A: when something goes wrong

Page numbers are off by a constant. Front matter. Adjust the `+1` in `ingest.ts` to whatever offset your spike note found, re-ingest, re-check three random chunks.

`websearch_to_tsquery` returns nothing for most questions. Expected; it ANDs every word. Either accept it (hybrid still works because vector fills in) or pass only the question's nouns. If you change it, that's an eval row.

Recall went down after the HNSW index. HNSW is approximate. Raise `hnsw.ef_search` for the session (`SET hnsw.ef_search = 100`) and re-run; note the trade-off in `docs/index.md`.

The grader says "not relevant" to everything. Print the prompt it's receiving. The usual cause is chunks arriving as `[object Object]` because the prompt template got the array instead of the formatted text.

The graph loops forever. `afterGrade` is returning `"rewrite"` when `attempts` never increments, which means `grade` isn't returning `attempts` or the reducer is wrong. The `recursionLimit` will stop it; read the error message, it names the last node.

Streaming works locally and not on Vercel. Check that the route is not being statically optimized (export `const dynamic = "force-dynamic"`) and that the response is returned before the stream finishes.

`withStructuredOutput` throws on malformed JSON. Wrap it in one retry. If it keeps failing on the same input, the schema description is unclear to the model; make the field descriptions explicit.

## Appendix B: the commit log you should end with

```
M0 spike complete
M1 chunker with tests
M1 ingest, N books loaded
M2 eval set v1, frozen
M2 baseline: vector-only recall@5 = NN%
M2 error analysis
M3 hybrid: recall@5 vector NN% → hybrid NN%
M3 HNSW index, plans captured
M4 graph runs end to end
M4 routing tests
M4 streaming route with citation validation
M4 chat UI
M4 loop on vs off: NN% → NN%
M4 deployed
M4 request steps captured
M4 step timeline
M5 README
M6 week 1 ... week 4
```

If your log looks like this, the history itself tells the story, and the README only has to point at it.
