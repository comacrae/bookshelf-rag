# Retrieval, Agents, and Evidence: building Bookshelf RAG from the ground up

A textbook that teaches the ideas behind retrieval-augmented generation and LLM agents by building one working system. Each chapter introduces a concept, works a small example by hand, gives you a toy problem, checks your understanding, and then applies the idea to the project. By the end you have the system described in `SPEC.md`, and you can explain every part of it.

`BUILD-GUIDE.md` is the companion: it has the exact commands and full code sketches for each step. This book tells you what you're doing and why; that guide tells you what to type. Chapter sections named "Build" point at the matching guide section.

## How to read this book

Read a chapter before you build its part. Do the toy problem on paper or in a scratch file; the answers are in Appendix A, but write yours down first. The comprehension questions have no answer key on purpose; if you can't answer one in a sentence, reread the section, because the next chapter assumes you can.

The project is a sequence of milestones, M0 through M6, defined in `SPEC.md` section 6. The chapters map to them like this:

| Part | Chapters | Milestones |
|---|---|---|
| I. Retrieval | 1 to 6 | M0, M1, M2, M3 |
| II. Models and agents | 7 to 11 | M4 (the graph) |
| III. Shipping and proving it | 12 to 15 | M4 (the UI and deploy), M5, M6 |

Nothing in Part II makes sense without Part I, and nothing in Part III is worth doing until Part II works. Don't skip ahead.

---

# Part I: Retrieval

## Chapter 1. The problem retrieval solves

### 1.1 What a language model actually knows

A large language model is a function from a sequence of tokens to a probability distribution over the next token. It was trained on a large body of text, and what it "knows" is whatever patterns that text contained, compressed into the model's weights. Three consequences matter for us.

First, the knowledge has a date. Anything written after training is invisible to it.

Second, the knowledge is lossy. The model has seen Pro Git, probably, but it has not memorized it, and it cannot tell you which page a sentence is on, because page numbers are not something the training objective rewards remembering.

Third, the model has no way to say "I don't have this." When you ask it something outside its knowledge, the next-token distribution still produces fluent text. That text is often wrong. People call this hallucination; mechanically it is just the model doing its job on an input it was never going to handle well.

### 1.2 Putting the answer in the prompt

The fix is older than the term RAG. If the model is good at reading and summarizing text it is given, give it the text. Put the relevant paragraphs from the book in the prompt, ask the question, and tell the model to answer only from what's there. Now the knowledge has today's date, is lossless (it is the actual text), and the model has a reason to cite, because the citation is right in front of it.

The catch is the word "relevant." A book is 300 pages. A prompt can hold a few of them. Something has to pick which few. That something is retrieval, and most of this book is about doing it well and proving that it works.

So RAG is three steps: split the source into pieces small enough to put in a prompt (Chapter 2), find the pieces most likely to contain the answer (Chapters 3 and 5), and generate an answer from those pieces with citations back to them (Chapter 8). Everything else is measuring (Chapters 4, 6, 13) and controlling (Chapters 9 to 11).

### 1.3 Worked example

Suppose someone asks: "What does `git rebase --onto` do?"

Without retrieval, the model answers from memory. It will probably be right, because this is a common question, but it cannot point you to the page, and if you ask about a rarer flag it may invent one.

With retrieval, the system first searches the stored pieces of Pro Git for ones mentioning rebase, finds the paragraph on page 94 (say) that explains `--onto`, and hands the model that paragraph plus four others. The model's answer now says "`--onto` lets you take a branch's commits and replay them on a different base [2]", and `[2]` is page 94. If the search had found nothing about `--onto`, a well-built system says so instead of guessing.

### 1.4 Toy problem

Write down a question you could ask about one of your books where you are confident a plain chat model would get the page wrong or invent a detail. Then write down what text from the book would have to be in the prompt for the model to answer correctly. Count roughly how many words that text is. That count is your first intuition for chunk size (Chapter 2).

Excerpt from pro git p 437: 

The packfile is a single file containing the

contents of all the objects that were removed from your filesystem. The index is a file that contains

offsets into that packfile so you can quickly seek to a specific object. What is cool is that although

the objects on disk before you ran the gc command were collectively about 15K in size, the new

packfile is only 7K. You’ve cut your disk usage by half by packing your objects.

How does Git do this? When Git packs objects, it looks for files that are named and sized similarly,

and stores just the deltas from one version of the file to the next. You can look into the packfile and

see what Git did to save space.   
  
So a chunk is maybe 100 words?

### 1.5 Check your understanding

- Why does giving the model the text in the prompt reduce invented details, but not eliminate them?
  - We need to find the correct text to give the model
- Retrieval finds text; the model generates an answer. Which one is responsible when the final answer is wrong because the right page was never found?
  - retrieval
- What would you need to record, at the moment you split the book into pieces, so that a citation can later say which page a piece came from?
  - the page each peice was found in

### 1.6 Build: project setup and the spike (M0)

Follow `BUILD-GUIDE.md` Chapter 0 to create the repo, install dependencies, start Postgres, and run the first migration. Then do the four spike scripts in Chapter 1 of the guide. The spike exists because this chapter's third question has a practical answer you can only learn by looking: PDF extraction may or may not hand you page numbers you can trust.

Checkpoint: one line per book in `docs/notes.md` about how PDF page numbers map to what the extractor returns, and what a code block looks like after extraction.

---

## Chapter 2. From a book to rows: chunking

### 2.1 Tokens

Models don't read characters or words; they read tokens, pieces of text produced by a tokenizer. In English a token is about three-quarters of a word; code tokenizes less efficiently. Every limit you will meet (how much fits in a prompt, what an embedding model accepts, what you pay) is in tokens. The project uses the `cl100k_base` tokenizer through `js-tiktoken` to count them; the exact tokenizer matters less than counting consistently.

### 2.2 Why chunk at all

Two limits force you to split a book. An embedding model (Chapter 3) accepts a bounded input, typically a few thousand tokens, and produces one vector for the whole input. One vector for a whole chapter is a blurry vector: it points at the average of everything in the chapter, which matches nothing in particular. And a prompt has a budget; five chunks of 400 tokens is 2,000 tokens of context, which is plenty for most questions and cheap.

So you split. The question is where to cut.

### 2.3 The size trade-off

Small chunks (100 to 200 tokens) are precise: each one is about one thing, so a question about that thing matches it strongly. But an answer that needs two sentences from either side of a cut is now split across two chunks, and neither alone may match.

Large chunks (800 to 1,500 tokens) keep context together, but each one's embedding is blurrier, and you pay to put more irrelevant text in the prompt.

Industry defaults cluster around 400 to 600 tokens for prose. That is where the project starts, not because it is right, but because you need a baseline to measure against. Chapter 4 is where you find out.

### 2.4 Overlap

A common trick is to make each chunk start with the last N tokens of the previous one, so a sentence that straddles a cut is intact in at least one chunk. It costs storage and some duplicated retrieval results. Whether it helps is an empirical question, and recent benchmarks suggest that often it does not. The project uses 60 tokens of overlap as a starting point and lists "overlap 0 vs 60" as an experiment, because the right answer is whatever your eval says.

### 2.5 Where to cut

Cut at paragraph boundaries when you can. A paragraph is the author's own unit of "one idea," and an embedding of one idea is sharper than an embedding of one-and-a-half. The algorithm: accumulate whole paragraphs until adding the next would exceed the target; emit; start the next chunk. A single paragraph larger than the target gets split by sentence. A page with no blank lines (common after PDF extraction) is treated as one paragraph.

### 2.6 Page tags

Every chunk must record which page it came from, or there are no citations. The rule the project uses: a chunk's page is the page of its first character. That is a choice. A chunk that starts at the bottom of page 51 and runs onto page 52 is tagged 51. The alternative (tag it with the page where most of its text lives) is defensible too; what matters is that you pick one, write it down, and make a test enforce it, because the eval set's page labels have to use the same rule.

With overlap there's a subtlety: the overlap text at the start of a chunk came from the end of the previous chunk, and its page may differ from the first fresh paragraph. "Page of the first character" means the overlap's page. Decide and test it.

### 2.7 Worked example

Target 12 tokens, overlap 0, two pages:

```
page 1: "Git stores snapshots. Each commit points to a tree. A tree lists files."
page 2: "Branches are pointers to commits. Moving a branch is cheap."
```

Paragraphs (one per sentence here, since there are no blank lines, treat each page as one paragraph; but to show the boundary case, treat each sentence as a paragraph): "Git stores snapshots." (4 tokens), "Each commit points to a tree." (7), "A tree lists files." (5), "Branches are pointers to commits." (6), "Moving a branch is cheap." (6).

Chunk 0: sentences 1 and 2 (11 tokens; adding sentence 3 would make 16). Page 1.
Chunk 1: sentences 3 and 4 (11 tokens). Page 1, because it starts with "A tree lists files" which is on page 1, even though "Branches are pointers" is on page 2.
Chunk 2: sentence 5. Page 2.

Notice chunk 1: a question about branches will retrieve it, the citation will say page 1, and the reader will find the sentence at the top of page 2. That is the cost of the "first character" rule and it is why the eval labels list both pages when an answer sits near a boundary.

### 2.8 Toy problem

Using target 10 and overlap 3, chunk this (treat each sentence as a paragraph, count tokens as words for simplicity):

```
page 7: "Rebasing rewrites history. Never rebase shared commits. It confuses collaborators."
page 8: "Merging preserves history. It creates a merge commit."
```

Write the chunks, their page tags, and show where the overlap text came from and which page it carries.

### 2.9 Check your understanding

- Why does a very large chunk hurt retrieval even though it contains more information?
- Your eval set lists "answer on page 52." A chunk tagged page 51 contains the answer sentence. Is that a hit or a miss under the project's rules? What should the label have been?
- What happens to chunk boundaries if the PDF extractor returns each visual line as its own paragraph?

### 2.10 Build: the chunker and ingest (M1)

`BUILD-GUIDE.md` 2.1 to 2.3. Write `chunk()` yourself; the algorithm is in 2.5 above and the three tests in the guide pin the boundary, the oversized paragraph, and the overlap. The ingest script also embeds, which is Chapter 3's topic, so it is fine to run it now and understand the embedding step next.

Checkpoint: both books in `chunks`; three random chunks checked against the PDF are on the page they claim; `npm test` passes the chunker tests.

---

## Chapter 3. Embeddings and nearest-neighbor search

### 3.1 Text as a point in space

An embedding model maps a piece of text to a vector: a list of numbers, typically 768 to 3,072 of them. The model is trained so that texts with similar meaning map to nearby vectors. "A closure captures its enclosing scope" and "functions remember the variables around them" land close together even though they share no words. "Git stores snapshots" lands far from both.

That is the whole trick. Once every chunk is a point, "find chunks relevant to this question" becomes "embed the question, find the nearest points." Nearness is computed, not judged, so it's fast and it works on meaning rather than exact words.

### 3.2 Measuring nearness

Three distances appear in practice. Euclidean distance is the straight-line distance between the points. Dot product is the sum of elementwise products, large when vectors point the same way and are long. Cosine similarity is the dot product divided by both lengths, so it measures only direction, from -1 (opposite) through 0 (unrelated) to 1 (identical direction).

Most embedding models are trained with cosine in mind, and many return unit-length vectors, in which case dot product and cosine are the same thing. The project uses cosine. In pgvector, `<=>` is cosine *distance*, which is `1 - cosine_similarity`, so smaller is closer and `ORDER BY embedding <=> $1` puts the best match first.

### 3.3 Worked example

Two-dimensional vectors, to make the arithmetic visible:

```
question  q = (0.8, 0.6)
chunk A   a = (0.9, 0.4)
chunk B   b = (0.1, 0.9)
```

Dot products: q·a = 0.72 + 0.24 = 0.96; q·b = 0.08 + 0.54 = 0.62.
Lengths: |q| = 1.0, |a| ≈ 0.985, |b| ≈ 0.906.
Cosine: A ≈ 0.96 / 0.985 ≈ 0.975; B ≈ 0.62 / 0.906 ≈ 0.684.
Cosine distance (`<=>`): A ≈ 0.025, B ≈ 0.316. A is the nearer chunk.

Real vectors have 1,536 dimensions, not 2, but the arithmetic is identical, just longer.

### 3.4 Storing vectors in Postgres

pgvector adds a `vector(N)` column type and the distance operators. The column's dimension `N` must match the embedding model's output size exactly; a model change means a new column or a re-ingest. The project reads `EMBEDDING_DIM` from the environment and bakes it into the first migration.

Without an index, `ORDER BY embedding <=> $1 LIMIT 5` computes the distance to every row and sorts. For a few thousand chunks that takes milliseconds and is fine. Chapter 6 covers what to do when it isn't.

### 3.5 The embedding model is a decision

Models differ in dimension (storage and speed), quality, price, and license. The README will have to say why you picked yours. A hosted small model is the sensible default for this project: cheap, good, and you don't run anything. An open model you host yourself is the alternative worth naming.

### 3.6 Toy problem

Given `q = (1, 0)`, rank these chunks by cosine similarity and say which pgvector would return first with `ORDER BY embedding <=> q`:

```
a = (2, 0)     b = (0, 3)     c = (1, 1)     d = (-1, 0)
```

Then: `a` and `(2, 0)` have the same direction but different lengths. Does cosine care? Does Euclidean distance?

### 3.7 Check your understanding

- Why does embedding a 5,000-token chapter produce a less useful vector than embedding a 400-token section?
- A question and a chunk share no words but cosine similarity is 0.85. What did the embedding model do that keyword search could not?
- Your `vector(1536)` column was created for one model. You switch to a model that outputs 3,072 dimensions. What has to happen?

### 3.8 Build: vector search (M2, first half)

`BUILD-GUIDE.md` 3.2. `vectorSearch` is one SQL statement. Run it from a scratch script with an eval question and look at the five chunks it returns before you build anything that depends on it.

---

## Chapter 4. Knowing whether retrieval works

### 4.1 Why "it answered my question" is not evidence

If you ask your system three questions and like the answers, you have learned that it handles three questions you happened to think of. You have not learned whether the retriever found the right page or whether the model answered from its own memory and the citation is decorative. Those two failures look identical from the outside.

The only way to know is to decide, in advance, what the right answer is for a set of questions, and then check. That set is called a golden set or eval set, and building one is the single thing that most portfolio RAG projects skip.

### 4.2 Recall@k

Retrieval is a ranking problem: for a question, the system returns chunks in order. Recall@k asks: among the top k results, is at least one from a page we know holds the answer? Count the questions where the answer is yes, divide by the number of questions. The project uses k = 5 because five chunks is what the prompt gets.

Recall is about misses. A system with 60% recall@5 fails to surface the answer for four questions in ten; no amount of prompt engineering fixes those four, because the model never sees the text.

Precision@k, the fraction of the top k that are relevant, matters less here: five chunks with one good one is a prompt the model can handle, as long as the good one is there.

### 4.3 What a good eval set looks like

Written by a person who read the source, not generated from the chunks (a model generating questions from chunks produces questions those exact chunks answer, which inflates recall).

Mixed in kind: some use the text's own words (easy for keyword search), some paraphrase (easy for vectors), some are ambiguous or spread across pages (hard for both). The hard ones are where the interesting failures live; a set of easy lookups passes everything and teaches nothing.

Labeled with the page or pages holding the answer, under the same page rule the chunker uses.

Includes questions with no answer in the corpus. A system that is never asked an unanswerable question is never tested on the one failure RAG systems have most: confident answers from irrelevant text.

Frozen. Once you have numbers against version 1, any edit is version 2, and every results row says which version it ran against. Otherwise a label fix silently moves your numbers and you can't compare rows.

### 4.4 Error analysis

A recall number tells you how often retrieval fails, not why. After the first run, read every miss and put it in a bucket. The buckets the project uses:

- Wording: the question's words and the text's words don't match and the embedding didn't bridge them.
- Chunk boundary: the answer is split across two chunks and neither matches alone.
- Wrong book: a strong match in the other book outranked the right one.
- PDF extraction: the answer text is there but came out mangled.
- Bad label: the answer isn't on the page you wrote down.

Counting the buckets tells you what to try next. If "wording" dominates, keyword search (Chapter 5) will help. If "chunk boundary" dominates, chunk size or overlap is the lever. If "bad label" has any entries, fix the labels first, because everything downstream is measured against them.

### 4.5 Worked example

Five questions, top-3 retrieved pages, and labels:

| q | label pages | retrieved (book:page) | hit? |
|---|---|---|---|
| q1 | git:94 | git:94, git:95, git:12 | yes |
| q2 | git:120 | js:40, git:118, git:121 | no |
| q3 | js:52, js:53 | js:53, js:10, js:200 | yes |
| q4 | git:30 | git:31, git:29, git:28 | no |
| q5 | js:140 | js:140, js:141, js:139 | yes |

Recall@3 = 3/5 = 60%. Now bucket the misses. q2 retrieved pages 118 and 121, bracketing the label: likely a chunk-boundary problem, or the label is off by a page. q4 retrieved 29, 31, 28, all around 30: same pattern. Both deserve a look at the PDF before any code changes.

### 4.6 Toy problem

Eight questions, k = 2. Compute recall@2, then recall@1, and explain in one sentence why recall@1 can never exceed recall@2.

| q | label | retrieved |
|---|---|---|
| 1 | p10 | p10, p11 |
| 2 | p25 | p40, p25 |
| 3 | p33 | p33, p34 |
| 4 | p50, p51 | p52, p51 |
| 5 | p70 | p71, p72 |
| 6 | p88 | p88, p3 |
| 7 | p99 | p101, p99 |
| 8 | p120 | p119, p118 |

### 4.7 Check your understanding

- Why does generating eval questions from your chunks with a model produce a misleadingly high recall?
- A change raises recall@5 from 70% to 73% on 30 questions. How many questions is that? Is it evidence?
- You find a mislabeled question after three results rows exist. What do you do, and what do you not do?

### 4.8 Build: the eval set, the runner, the baseline (M2)

`BUILD-GUIDE.md` 3.1, 3.3, 3.4. Write the questions first; it is boring and it is the project. Then the runner, the baseline row, and the bucketed error analysis in `evals/notes.md`.

Checkpoint: `results.md` has one row (vector-only), every miss has a bucket, and the bucket counts are at the top of the notes.

---

## Chapter 5. Keyword search and rank fusion

### 5.1 What embeddings miss

Embeddings capture meaning and blur the specifics. Ask "what does `git rebase --onto` do" and the vector for that question is near vectors about rebasing in general; the chunk that actually mentions `--onto` may rank fourth behind three chunks that discuss rebasing without the flag. Exact identifiers, flags, function names, error messages, and rare terms are where vectors are weakest, and they are exactly what programming questions are full of.

Keyword search has the opposite profile: it finds the chunk with `--onto` in it instantly, and it has no idea that "undo a commit" and "revert" are related.

### 5.2 Postgres full-text search

Postgres has keyword search built in. `to_tsvector('english', text)` turns text into a sorted list of stemmed lexemes ("rebasing" and "rebased" both become "rebas"), stop words removed. The project stores that as a generated column `tsv` with a GIN index on it. `websearch_to_tsquery('english', question)` turns a question into a query; by default it ANDs every word, which means a long natural-language question often matches nothing. `ts_rank` scores matches by term frequency and position.

`ts_rank` is not BM25, the scoring function most search engines use; it lacks document-length normalization and saturation. For two books of similar structure the difference is small, and the README should say exactly that, with the alternative named (an extension like ParadeDB or pg_textsearch brings BM25 to Postgres).

### 5.3 Combining two rankings

You now have two ranked lists for the same question, scored on scales that have nothing to do with each other (cosine distance in [0, 2], `ts_rank` in some positive range). Adding the scores is meaningless without normalizing both, and normalizing introduces a weight you'd have to tune.

Reciprocal rank fusion sidesteps the scales entirely by using only positions. Each item's fused score is the sum, over every list it appears in, of `1 / (k + rank)`, with rank starting at 1 and k a constant, conventionally 60. An item at the top of both lists scores about `2/61`; an item at the top of one and absent from the other scores `1/61`; an item at rank 10 in both scores `2/70`. The constant k dampens the gap between rank 1 and rank 2 so that one list can't dominate on a single strong placement.

RRF has one parameter and it barely matters, which is why it's the default fusion method in most hybrid search systems.

### 5.4 Worked example

Vector list: [A, B, C]. Keyword list: [C, D, A]. k = 60.

A: 1/61 (rank 1 in vector) + 1/63 (rank 3 in keyword) = 0.01639 + 0.01587 = 0.03226
B: 1/62 = 0.01613
C: 1/63 + 1/61 = 0.01587 + 0.01639 = 0.03226
D: 1/62 = 0.01613

Fused order: A and C tie at the top (each is high in one list and present in the other), then B and D tie. Ties are broken however your sort does it; in practice with 20-item lists ties are rare.

### 5.5 Toy problem

Vector list: [P, Q, R, S]. Keyword list: [S, T]. k = 60. Compute the fused score for each of P, Q, R, S, T and give the final order. Then answer: S was last in the vector list; why does it end up first?

### 5.6 Check your understanding

- Give one question from your eval set that keyword search should win, and one that vector search should win. Say why in each case.
- `websearch_to_tsquery` returns no rows for most of your questions. Is hybrid retrieval still useful? What does RRF do with an empty list?
- Why does RRF not need the two scores to be on the same scale?

### 5.7 Build: keyword, RRF, hybrid (M3, first half)

`BUILD-GUIDE.md` 4.1 and 4.2. Type `rrf()` yourself and test it without a database. Then two more eval rows, and one sentence per flipped question.

Checkpoint: three rows (vector, keyword, hybrid); flipped questions explained in `evals/notes.md`.

---

## Chapter 6. Indexes, and reading a query plan

### 6.1 What an index is for

A query that must look at every row is a sequential scan. It's fine at a thousand rows and painful at a million. An index is a separate structure that lets the database jump to the rows it needs. A B-tree index on a sorted key answers "where is id 4012" in a handful of steps. Vector search has no sorted key, so it needs a different structure.

### 6.2 HNSW in one paragraph

Hierarchical Navigable Small World graphs connect each vector to a few of its nearest neighbors, in layers: a sparse top layer for coarse navigation and denser lower layers for precision. A query starts at the top, greedily walks toward the nearest node, drops a layer, and repeats. It visits a small fraction of the vectors and returns neighbors that are very likely, but not guaranteed, to be the true nearest. That "very likely" is why it's called approximate nearest-neighbor search, and why your recall number can move a little after you add the index.

Two build parameters matter: `m`, how many neighbors each node links to, and `ef_construction`, how hard the builder searches for good neighbors. One query parameter matters: `ef_search`, how many candidates the query keeps as it walks. Higher `ef_search` is slower and more accurate. pgvector's defaults are reasonable for this project; the point is to know the knob exists and what it trades.

### 6.3 Reading EXPLAIN ANALYZE

`EXPLAIN` shows the plan Postgres chose; `ANALYZE` runs it and reports real timings. For the vector query you'll see one of two shapes. Before the index: a `Sort` node above a `Seq Scan on chunks`, with the sort key being the distance expression. After: an `Index Scan using chunks_embedding_idx`, no sort, and an execution time that is lower (at this scale, modestly; at a million rows, enormously).

The two numbers to read are `actual time` on the top node and `rows` on the scan. Everything else is detail you can learn later.

### 6.4 Toy problem

Here is a plan. Which node did the work, how many rows did it touch, and is the index being used?

```
Limit  (cost=0.28..1.84 rows=5 width=8) (actual time=0.412..0.498 rows=5 loops=1)
  ->  Index Scan using chunks_embedding_idx on chunks  (cost=0.28..612.00 rows=1960 width=8) (actual time=0.410..0.494 rows=5 loops=1)
        Order By: (embedding <=> '[...]'::vector)
Planning Time: 0.120 ms
Execution Time: 0.530 ms
```

Now the same query without the index:

```
Limit  (cost=211.40..211.41 rows=5 width=8) (actual time=9.8..9.81 rows=5 loops=1)
  ->  Sort  (cost=211.40..216.30 rows=1960 width=8) (actual time=9.79..9.80 rows=5 loops=1)
        Sort Key: ((embedding <=> '[...]'::vector))
        Sort Method: top-N heapsort  Memory: 25kB
        ->  Seq Scan on chunks  (cost=0.00..178.80 rows=1960 width=8) (actual time=0.02..8.9 rows=1960 loops=1)
Execution Time: 9.85 ms
```

What is the speedup, and why is "rows=1960" on the Seq Scan but "rows=5" on the Index Scan?

### 6.5 Check your understanding

- Why can adding an index change your recall number?
- If recall drops after indexing, what single setting would you try first, and what does raising it cost?
- Your corpus grows to fifty books. Which part of this chapter becomes urgent?

### 6.6 Build: the HNSW migration and the plan document (M3, second half)

`BUILD-GUIDE.md` 4.3. Capture the plan before, add the index in its own migration, capture the plan after, re-run the eval.

Checkpoint: `docs/index.md` has both plans with timings; a fourth results row.

---

# Part II: Models and agents

## Chapter 7. Talking to a model

### 7.1 The call

A chat model call sends a list of messages (a system instruction, prior turns, the new user message) and gets back a message. Two settings matter for us. Temperature controls randomness; 0 makes the output as deterministic as the provider allows, which is what you want for grading and rewriting. Max tokens caps the response length.

Every call costs money proportional to tokens in plus tokens out, and output tokens cost more. The project logs both per call, because the agent loop can make five or six calls per question and the README has to report what a question costs.

### 7.2 Prompts are code

A prompt is a function from inputs to a string, and it should live in a file where it can be read and reviewed as a unit. The project keeps every prompt in `src/prompts.ts` as an exported function. When something goes wrong, print the exact string the model received. The most common bug in this whole project is a prompt that contains `[object Object]` where the chunks should be.

Write prompts the way you'd brief a careful contractor: what the task is, what inputs follow, what output format you need, and what to do when the inputs don't suffice. Don't pile on adjectives ("be extremely careful and thorough"); they don't change the model's behavior and they make the prompt harder to read.

### 7.3 Structured output

When the model's output feeds code rather than a person, you want a typed value, not prose. Structured output asks the model to return JSON matching a schema you provide (the project uses Zod schemas through LangChain's `withStructuredOutput`). The grader returns `{ relevant: boolean, reason: string }`; the rewriter returns `{ rewritten: string }`. The provider enforces the shape, mostly. Occasionally you get malformed output; the project retries once and then fails loudly rather than guessing.

A field's description in the schema is part of the prompt. "relevant: whether the chunks contain enough information to answer the question" produces better grades than "relevant: boolean."

### 7.4 Worked example: the grade prompt

```
You are checking whether a set of passages can answer a question.

Question: {rewritten}

Passages:
[1] (Pro Git, p. 94) ...text...
[2] (Pro Git, p. 95) ...text...
...

Answer with relevant=true only if the passages contain the information needed
to answer the question directly. Partial or tangential mentions are not enough.
Give a one-sentence reason either way.
```

Notice what's absent: no instructions about tone, no "think step by step," no examples. The schema's field descriptions carry the rest. If grades are too strict or too loose, the second sentence of the instruction is the knob, and Chapter 13 is how you'd know.

### 7.5 Toy problem

Write the rewrite prompt. Inputs: the conversation so far (may be empty), the new question, and optionally the reason a previous attempt failed. Output: one standalone question that could be answered from a book without any of the conversation. Then list three inputs where your prompt might produce a bad rewrite, and say what you'd add to handle each.

### 7.6 Check your understanding

- Why temperature 0 for grading but not necessarily for the final answer?
- A structured-output call returns `{ relevant: "yes" }`. What went wrong, and where does the fix go?
- Six model calls at 800 input tokens and 100 output tokens each. At $0.15 per million input and $0.60 per million output, what does one question cost? (Use your own provider's numbers in the real project.)

### 7.7 Build: prompts and the two structured calls (M4, part 1)

`BUILD-GUIDE.md` 5.2, the `rewrite` and `grade` functions only, and `src/prompts.ts`. Call each one from a scratch script with a real eval question and real retrieved chunks and look at what comes back. Don't wire them into a graph yet.

Checkpoint: `rewrite` turns "what about the next chapter?" plus a prior turn about rebasing into a concrete standalone question; `grade` returns `true` with a sensible reason for a question whose answer is in the chunks, and `false` for "purple elevator tax."

---

## Chapter 8. Grounded answers and citations

### 8.1 The contract

A grounded answer is one where every claim traces to a passage the system actually retrieved. The model is told: here are numbered passages, answer only from them, cite each claim as `[n]`, and if they don't contain the answer, say so. That is the entire contract, and the rest of this chapter is about enforcing it, because the model will not always keep it.

### 8.2 Why numbers, not titles

Have the model cite `[2]`, not "Pro Git, page 94." A number is trivial to parse and trivial to check against the list you sent. A free-text citation might be right, might be subtly wrong (page 93), might be a page the model remembers from training that was never retrieved. The display layer turns `[2]` back into "Pro Git, p. 94" from the metadata you already have.

### 8.3 Validation

After the answer is complete, scan it for `[n]` tokens and compare each against the set you sent. Anything outside the set is invalid: the model cited a passage it was never shown. The project strips invalid citations from the display, counts them in the `requests` table, and the acceptance test says there must be zero across the eval set. A system that passes that test has a citation you can trust by construction, not by hoping the model behaved.

The web fallback (Chapter 11) adds a second id space, `[w1]`..`[w3]`, validated the same way against a separate list.

### 8.4 Abstaining

When the grader says the passages can't answer the question and retries are exhausted, the system must say "the books don't cover this" and cite nothing. This sounds trivial. It is the behavior most RAG demos lack, and it is the behavior the unanswerable eval questions exist to test. A model given five irrelevant passages and asked a question will, by default, answer anyway from its own knowledge and decorate the answer with the passage numbers. The abstain path is a separate prompt that never includes the passages.

### 8.5 Worked example

Passages sent: [1]..[5]. Model output:

> Rebasing replays your commits on a new base [2]. It rewrites commit hashes [2][3], so it should not be used on branches others have pulled [7]. See also the discussion of merge commits [4].

Validation: `[2]`, `[3]`, `[4]` are in range. `[7]` is not; the model either hallucinated a passage or miscounted. The sentence about shared branches may still be true, but it is unsupported by what was retrieved, so the citation is stripped and the event counted. If this happens often, the answer prompt needs to restate the range more plainly, or the retrieval is returning passages so weak the model is reaching past them.

### 8.6 Toy problem

Write `validateCitations` in your head: input is the answer text, the list of valid chunk numbers, and the list of valid web ids; output is the list of invalid tokens. Then list three answer strings that would trip a naive regex and say how you'd handle each: a citation inside a code span like ``arr[0]``, a range like `[2-4]`, and `[w1]` when no web results were sent.

### 8.7 Check your understanding

- Why is "cite by number" safer than "cite by page" even though the user sees pages?
- An answer has all-valid citations but is wrong. Which of the system's parts failed, and which chapter's tools diagnose it?
- Why must the abstain prompt not include the retrieved passages?

### 8.8 Build: citation validation and the answer prompts (M4, part 2)

`BUILD-GUIDE.md` 5.5 for `src/citations.ts` and its test; 5.2 for the `answer` node's three prompts (books, web, abstain). Test the validator against the three tricky strings from the toy problem.

Checkpoint: `npm test` passes the citations test; calling `answer` by hand with five real chunks yields an answer whose citations all validate.

---

## Chapter 9. State machines and graphs

### 9.1 From a pipeline to a graph

A pipeline runs steps in a fixed order. A graph runs steps and then decides which step comes next based on what happened. The difference is one conditional edge, and that edge is what lets the system try again when retrieval failed, rather than answering from bad passages.

LangGraph models this as a state machine. There is one state object. Each node is a function that receives the state and returns the fields it wants to change. Edges say which node follows which; a conditional edge is a function of the state that returns the next node's name. The graph runs until it reaches `END`.

### 9.2 State and reducers

The state is declared once with every field and its type. For each field you also say how an update combines with the current value. The default is overwrite: the node's returned value replaces the old one. For lists you usually want append: the node returns new items and they're concatenated. That combining function is the reducer.

Getting reducers wrong is the first bug everyone hits. If `messages` has no reducer, every turn overwrites the history and the conversation forgets itself. If `chunks` has an append reducer, each retry adds five more chunks to the five from before and the grader sees ten. The spec's state table says which fields overwrite and which append; it's worth re-reading before writing a node.

### 9.3 Who writes what

A rule that prevents most graph bugs: each field is written by exactly one node. `rewrite` writes `rewritten`, `grade` writes `relevant`, `gradeReason`, and `attempts`, and nothing else touches them. When a node returns a field it doesn't own, the graph accepts it silently and you spend an evening wondering why `attempts` reset. Running the graph with `streamMode: "updates"` prints exactly what each node returned, which is how you check.

### 9.4 Termination

A graph with a cycle can loop forever. Two guards, both hard: a counter in the state (`attempts`) checked by the conditional edge against `MAX_ATTEMPTS`, and LangGraph's `recursionLimit` on the invoke, which throws if the total number of steps exceeds it. The model is never asked "should we stop?" because a model asked that will sometimes say no.

### 9.5 Worked example: a vending machine

State: `{ credit: number, selection: string | null, dispensed: boolean }`.
Nodes: `insertCoin` (credit += 25), `select` (sets selection), `dispense` (dispensed = true, credit -= price).
Edges: START → insertCoin → route. Route: if credit < price, back to insertCoin; else to select → dispense → END.

Draw it. Then ask: which field has an append reducer? None; every field overwrites. What's the termination guard? Credit grows by 25 each loop, so the condition eventually flips. What if `insertCoin` had a bug and returned `credit: 0`? Infinite loop, caught only by `recursionLimit`. That is the `attempts` bug in miniature.

### 9.6 Toy problem

Draw the project's graph from `SPEC.md` section 4 on paper from memory, with every edge labeled with its condition. Then trace "purple elevator tax" through it with `WEB_FALLBACK=off` and `MAX_ATTEMPTS=3`: list every node visited in order and the value of `attempts` after each `grade`. Then trace a question the grader approves on the second attempt.

### 9.7 Check your understanding

- A node returns `{ attempts: s.attempts + 1, rewritten: "..." }`. Which rule did it break, and what might go wrong?
- Why is `chunks` an overwrite field but `messages` an append field?
- What's the difference between the `attempts` cap and `recursionLimit`, and why have both?

### 9.8 Build: state, nodes, graph, routing tests (M4, part 3)

`BUILD-GUIDE.md` 5.1, 5.3, 5.4. Build the graph without a checkpointer first (`buildGraph()` with no argument). Run it with `streamMode: "updates"` and check each node's output against the ownership table. Then the three mocked routing tests.

Checkpoint: the graph runs end to end; every update contains only its owner's fields; `npm test` passes the agent tests.

---

## Chapter 10. Memory and checkpoints

### 10.1 Why a chat needs persistence

"What about the next chapter?" is only answerable if the system remembers the previous question. A web request has no memory; each one starts fresh. So the conversation state has to live somewhere between requests.

LangGraph's answer is a checkpointer: after every node, it saves the full state under a `thread_id`. The next invoke with the same `thread_id` starts from the saved state. The project uses the Postgres checkpointer, so the same database that holds the chunks holds the conversations.

### 10.2 What gets saved

Everything in the state, after every step. That's more than you need (you don't need `gradeReason` from three turns ago) and it's what makes the graph resumable mid-run, which you also don't need yet but is why the design is shaped this way. Look at the checkpointer's tables once in `psql` so you know what's there; `docs/graph.md` should say in a sentence what a checkpoint row contains.

### 10.3 Reducers, again

Because the checkpointer restores the whole state, the append reducer on `messages` is what makes history accumulate across invokes: each turn's `answer` node returns two new messages, and the reducer concatenates them onto the restored list. If `messages` overwrote instead, every turn would have a one-message history.

The rewrite node reads `messages` to resolve references. It does not need all of them; the last ten are plenty and keep the prompt small.

### 10.4 Worked example

Thread `t1`, state after turn 1: `messages: [H("what is rebase"), A("Rebase replays...")]`, `attempts: 1`, `chunks: [...5 chunks about rebase]`.

Turn 2 invokes with `{ question: "what about the next chapter?" }` on `t1`. The checkpointer restores the state above. `rewrite` sees the history and produces "What does the chapter after rebasing in Pro Git cover?" (or something closer, depending on the prompt). `retrieve` overwrites `chunks`. `grade` sets `attempts: 1`; notice it does not continue from the previous turn's count, because `grade` returns `s.attempts + 1` and... wait. It would return 2.

That is a real bug waiting in the design: `attempts` must be reset at the start of each turn. The spec's state table says `attempts` is written by `grade`, but the per-turn reset has to happen somewhere. The cleanest fix is for the route handler to pass `attempts: 0` in the input to each invoke, which overwrites the restored value. Put that in `docs/graph.md` as a decision, and in the routing tests.

### 10.5 Toy problem

Thread `t2` has had two turns. Write out what `messages` contains (as a list of roles) and what `attempts` would be at the start of turn 3 under three designs: (a) no reset, (b) the route passes `attempts: 0`, (c) `rewrite` returns `attempts: 0`. Which design breaks the "one writer per field" rule, and does it matter?

### 10.6 Check your understanding

- Why does the same `thread_id` across two requests produce a conversation, and two different ids produce two unrelated ones?
- What would you lose by replacing the checkpointer with your own `messages` table? What would you gain?
- The eval runner invokes the graph once per question with a fresh `thread_id` each time. Why fresh?

### 10.7 Build: the Postgres checkpointer and the follow-up check (M4, part 4)

`BUILD-GUIDE.md` 5.3 (`getGraph` with `PostgresSaver`) and the follow-up check in 5.6. Decide the `attempts` reset and document it.

Checkpoint: two invokes on one thread produce a resolved follow-up; the second invoke's `attempts` starts at 0.

---

## Chapter 11. Agents, tools, and fallbacks

### 11.1 What makes it an agent

Nothing mystical. A pipeline becomes an agent when a model's output is used to decide control flow. In this project the grader's `relevant` field decides whether to answer, retry, or fall back. That one decision, plus the loop it enables, is what the postings mean by "LLM agent." The project's graph is the pattern the literature calls corrective RAG: retrieve, grade, rewrite and retry on failure.

### 11.2 Tools

A tool is a function the model can ask to have called, with a schema for its arguments. The project wraps `hybridSearch` as a tool named `search_books` with a `{ query: string }` schema. In the current graph the `retrieve` node calls it directly rather than letting the model choose, so the tool wrapper is mostly a shape. It is there because the alternative design, a tool-calling loop where the model decides when and what to search, is one import away, and the README's decisions section should say why the fixed graph was chosen over it: a fixed graph has a gradable step and a cap you can unit-test; a free-form tool loop does not.

### 11.3 Fallback

When retries are exhausted, the graph can route to a web search and answer from that. This is a trade. It makes the system more useful on questions outside the books and it adds another tool to the agent story. It also breaks the guarantee that every citation points at text you can open: a web result is whatever the search provider returned, unverified.

The project keeps the trade honest three ways. The fallback runs only after the grader has rejected three retrieval attempts, never first. It's behind a flag, on in the demo and off in the retrieval eval, so recall numbers measure the books and nothing else. And it's scored on its own: for the five unanswerable questions, routing to web or abstaining is a pass and answering from the books is a fail; for the thirty answerable ones, routing to web is a fail.

The UI labels every answer with its source. A reader always knows whether they're looking at the books or the web.

### 11.4 Worked example: routing table

| Question | Grader attempt 1 | 2 | 3 | Flag | Outcome |
|---|---|---|---|---|---|
| "What does rebase do?" | yes | | | off | books, attempts 1 |
| "How do I undo the last commit?" | no | yes | | off | books, attempts 2 |
| "purple elevator tax" | no | no | no | off | none, attempts 3 |
| "purple elevator tax" | no | no | no | on | web, attempts 3 |
| "What's the Rust borrow checker?" | no | no | no | on | web (unanswerable, correct) |
| "What's the Rust borrow checker?" | no | no | yes | on | books (unanswerable, WRONG: grader approved irrelevant chunks) |

The last row is the failure the unanswerable eval questions exist to catch. It means the grade prompt is too loose.

### 11.5 Toy problem

Design the change for stretch item 6 in the spec: grade the web results too, and abstain if even the web is irrelevant. Which node gets added or changed, which state fields, what's the new edge from `webSearch`, and what's the new termination argument? Draw it.

### 11.6 Check your understanding

- In one sentence, what is the difference between a pipeline and an agent?
- Why is the web fallback off during the retrieval eval?
- A reviewer asks "why not just let the model call search whenever it wants?" Give the two-sentence answer.

### 11.7 Build: the web node, the flag, and the full-pipeline checks (M4, part 5)

`BUILD-GUIDE.md` 5.2 (`webSearch`), the `afterGrade` routing in 5.3, and the acceptance checks in 5.7 for routing (the eval-side measurements are Chapter 13).

Checkpoint: "purple elevator tax" exits with `none` when the flag is off and `web` when it's on; the three routing tests pass.

---

# Part III: Shipping and proving it

## Chapter 12. Streaming

### 12.1 Why stream

A full answer takes several seconds of model time. Showing nothing until it's done feels broken; showing tokens as they arrive feels alive. Streaming is a user-experience requirement, and it's also the first thing a reviewer notices on the live link.

### 12.2 HTTP streams

An HTTP response body can be sent in pieces. In a Next route handler you return a `Response` whose body is a `ReadableStream`; you enqueue bytes as they're ready and close when done. On the client, `fetch` gives you a reader; you loop on `read()` and append. There's no special protocol; it's just a response that takes a while to finish.

Because the body is bytes, you need a framing convention so the client can tell a token from metadata. The project uses newline-delimited JSON: one JSON object per line, with three kinds: `{ meta }` once at the start (source, the chunk list, the web list), `{ token }` many times, `{ done, invalid }` once at the end.

### 12.3 Getting tokens out of a graph

The graph runs several model calls, and you only want to stream the last one. LangGraph's `streamEvents` emits an event for every model token with metadata naming the node it came from. Filter for `on_chat_model_stream` where `langgraph_node === "answer"` and forward those. Meanwhile, watch for the `answer` node's start event to capture the state it received, which is where the chunk list for the `meta` frame comes from. The event names are the part of the API most likely to shift between versions; log everything once, then filter.

### 12.4 Why metadata goes first

The client needs the chunk list to render `[2]` as a clickable "Pro Git, p. 94" while tokens are still arriving. If the metadata came last, citations would be dead until the answer finished. So the `meta` frame is sent the moment the `answer` node starts, before the first token.

### 12.5 Toy problem

Write out the exact NDJSON lines the client would receive for a two-chunk answer "Rebase replays commits [1]. It rewrites hashes [2]." with one invalid citation stripped. Then: the client's `read()` returns a byte chunk that ends in the middle of a JSON line. What does the client have to do?

### 12.6 Check your understanding

- Why can't the citation validation run before the stream ends?
- What breaks if the route is statically cached by the framework?
- What does the client do with a `token` frame that arrives before any `meta` frame?

### 12.7 Build: the route and the UI (M4, part 6)

`BUILD-GUIDE.md` 5.5 and 5.6.

Checkpoint: `curl -N` shows frames arriving one at a time; in the browser the answer streams, citations open the right chunk, the badge is right, a refresh keeps the conversation.

---

## Chapter 13. Measuring the agent

### 13.1 Three questions the retrieval eval can't answer

Chapter 4 measured whether the retriever finds the right page. The agent adds three new questions. Does the retry loop improve recall, or just cost money? Is the grader any good at its one job? What does a question cost and how long does it take?

### 13.2 Loop on versus off

Run the eval twice with hybrid retrieval: once calling retrieval directly (loop off) and once through the full graph with the web fallback disabled (loop on). Recall is computed the same way from the final chunks. The difference between the two numbers is what the retry loop bought. It's usually small and positive; sometimes it's zero; occasionally it's negative, when the rewrite step changes a good question into a worse one. Any of those is a finding. Write it down.

### 13.3 The grader's confusion matrix

For each answerable question you know two things: whether retrieval actually hit (from the labels) and what the grader said. Cross them:

| | grader: relevant | grader: not relevant |
|---|---|---|
| retrieval hit | correct approve | needless retry (cost) |
| retrieval miss | wrong approve (answer from bad passages) | correct reject |

The bottom-left cell is the dangerous one: the grader approved passages that don't contain the answer, and the model will now answer confidently from them. The top-right cell is the expensive one. Reading the two off-diagonal counts tells you whether to loosen or tighten the grade prompt.

### 13.4 Cost and latency

Every `requests` row has tokens and milliseconds. The runner reports median and 95th-percentile latency (p95 is what a user who got unlucky experienced) and dollars per question from your provider's price sheet. Put the prices in the runner as constants with the date you looked them up. These numbers go in the README with no adjectives attached.

### 13.5 Worked example

Thirty questions, loop on. Retrieval hit 24; missed 6. Grader said relevant for 21 of the 24 hits and for 2 of the 6 misses.

| | relevant | not relevant |
|---|---|---|
| hit (24) | 21 | 3 |
| miss (6) | 2 | 4 |

Three needless retries, two wrong approvals. The two wrong approvals are the ones to read: open those questions and see what the grader was looking at. If the passages are plausibly related but don't answer the question, the grade prompt's "partial mentions are not enough" line needs to be stronger.

### 13.6 Toy problem

Forty questions. Hits: 30. Grader approved 27 hits and 5 misses. Fill in the 2×2, name the two off-diagonal counts, and say which prompt change you'd try first and why.

### 13.7 Check your understanding

- Why does the loop-on eval disable the web fallback?
- Loop on raised recall from 76% to 80% and doubled cost per question. Is that worth it? What would you need to know to decide?
- Why is p95 latency reported alongside the median?

### 13.8 Build: the runner extension and the agent rows (M4, part 7)

`BUILD-GUIDE.md` 5.7.

Checkpoint: loop-on and loop-off rows; the 2×2 and a sentence about it in `evals/notes.md`; median latency and $/question filled in.

---

## Chapter 14. Deploying and keeping it alive

### 14.1 What changes in production

Locally you have one Postgres in Docker, environment variables in a file, and a dev server that restarts when you save. In production the database is Supabase (Postgres with pgvector, reached over a connection pooler), the app runs as serverless functions on Vercel that start cold, and every variable has to be set in the dashboard.

Two things bite first-timers. Cold starts: a serverless function that does setup work on its first request (like the checkpointer's `setup()`) can exceed the request timeout; do one-time setup from your laptop against the production database instead. Connection limits: serverless functions open connections freely; use the pooled connection string for the app and the direct one only for ingest.

### 14.2 Loading the data

The production database starts empty. Point your local `.env` at the direct Supabase connection string, run the migrations and the ingest once, and point it back. The chunks are now in production. This is simpler than running ingest in the cloud and it's fine for a corpus that changes rarely.

### 14.3 Health and operation

A `/health` route that runs one query and returns the chunk count is the cheapest possible monitor. Once a week for a month, ask five questions and note what came back. A month of dated notes showing you ran the thing and fixed what broke is a signal almost no junior portfolio has.

### 14.4 Check your understanding

- Why does ingest use the direct connection but the app uses the pooled one?
- What would you check first if the live app returns an answer with no citations when local returns one with citations?
- What does a reviewer learn from four dated entries in `docs/notes.md` that they can't learn from the code?

### 14.5 Build: deploy and operate (M4 deploy, M6)

`BUILD-GUIDE.md` 5.8 and Chapter 7.

Checkpoint: the live URL passes the four hand checks and the URL is at the top of the README. This is the ship line; put the link in applications now.

---

## Chapter 15. Writing it up

### 15.1 The README is a model card

A model card states what a system does, how it was measured, what its numbers are, and where it fails. That's the README's job, in that order. A reviewer gives it ninety seconds. The live link, the results table, and the decisions section are what they'll read; everything else is there to answer the follow-up questions.

### 15.2 Decisions, with the road not taken

Every decision paragraph names what you chose, what you considered instead, and the reason, with a number from your own table where one exists. "I used RRF" is a fact. "I used RRF with k=60 instead of a weighted sum because a weighted sum needs both scores normalized and a tuned weight, and RRF moved recall from 70% to 77% with no parameters" is engineering. The spec lists the seven decisions that need paragraphs.

### 15.3 Limitations, honestly

PDF extraction mangles code blocks, and some eval misses are that. Web answers are unverified. There's no reranking yet. One tenant. State these plainly. A limitations section is a stronger signal than a longer feature list, because it shows you know where the edges are.

### 15.4 How AI was used

Write this from the notes you kept. Specific beats general: which pieces were generated and reviewed, which were hand-written and then reviewed by AI. A reviewer in 2026 assumes AI was involved; what they're checking is whether you can account for it.

### 15.5 Build: the README (M5)

`BUILD-GUIDE.md` Chapter 6.

Checkpoint: someone who hasn't seen the project can clone it, run the commands, and reproduce the baseline recall within a point. Every number in the README exists in `results.md`.

---

# Appendix A. Answers to the toy problems

**2.8.** Sentences as paragraphs, tokens as words: "Rebasing rewrites history." (3), "Never rebase shared commits." (4), "It confuses collaborators." (3), "Merging preserves history." (3), "It creates a merge commit." (5).
Chunk 0: sentences 1 to 3 (10 words), page 7.
Chunk 1: overlap is the last 3 words of chunk 0, "It confuses collaborators." (page 7), plus sentence 4 (3 words, page 8), total 6; adding sentence 5 makes 11 > 10, so stop. Page 7, because the first character is the overlap text from page 7.
Chunk 2: overlap "Merging preserves history." (page 8) plus sentence 5 = 8 words. Page 8.
The lesson: chunk 1's citation says page 7 but its fresh content is on page 8.

**3.6.** Cosine with q=(1,0): a = 1.0, c ≈ 0.707, b = 0, d = -1. Order: a, c, b, d. pgvector returns a first. Cosine ignores length (a and (2,0) are identical to it); Euclidean distance does not (|q−a| = 1, |q−(2,0)|... same here since a=(2,0); take a'=(5,0): cosine still 1, Euclidean 4).

**4.6.** Recall@2: hits on q1, q2, q3, q4, q6, q7 = 6/8 = 75%. Recall@1: hits on q1, q3, q6 = 3/8 = 37.5%. Recall@1 can't exceed recall@2 because any answer in position 1 is also in the top 2.

**5.5.** k=60. P: 1/61 = 0.01639. Q: 1/62 = 0.01613. R: 1/63 = 0.01587. S: 1/64 + 1/61 = 0.01563 + 0.01639 = 0.03202. T: 1/62 = 0.01613. Order: S, P, Q and T (tie), R. S wins because it appears in both lists; a presence in a second list is worth more than a few ranks in one list.

**6.4.** With the index: the Index Scan did the work, touched 5 rows (it stopped once the Limit was satisfied), index used. Without: Seq Scan touched all 1,960 rows and the Sort ordered them; about 18× slower (9.85 vs 0.53 ms). The index scan returns rows already in distance order, so it can stop at 5; the sequential scan has to see every row before it knows which 5 are nearest.

**7.6, cost.** Input: 6 × 800 = 4,800 tokens × $0.15/M = $0.00072. Output: 6 × 100 = 600 × $0.60/M = $0.00036. Total about $0.0011 per question.

**9.6.** With flag off: rewrite, retrieve, grade (attempts 1), rewrite, retrieve, grade (2), rewrite, retrieve, grade (3), answer (source none), END. Approved on attempt 2: rewrite, retrieve, grade (1), rewrite, retrieve, grade (2), answer (books), END.

**10.5.** `messages` at start of turn 3: [H, A, H, A]. (a) no reset: attempts restored from turn 2's final value, so the loop has fewer tries than intended or none; (b) route passes `attempts: 0` in the input: overwrite reducer sets it to 0, grade then counts 1, 2, 3; (c) `rewrite` returns `attempts: 0`: works but `rewrite` now writes a field `grade` owns, and on retries it would reset the count every loop, which breaks termination. (b) is the one.

**12.5.**

```
{"meta":{"source":"books","chunks":[{"n":1,"book":"pro-git-2e","page":94},{"n":2,"book":"pro-git-2e","page":95}],"web":[]}}
{"token":"Rebase replays "}
{"token":"commits [1]. "}
{"token":"It rewrites hashes [2]."}
{"done":true,"invalid":["7"]}
```

(assuming the model also emitted a `[7]` somewhere that was stripped). The client must buffer partial lines: keep the trailing fragment after the last newline and prepend it to the next chunk before parsing.

**13.6.** Hits 30, misses 10. Approved hits 27 (correct approve), rejected hits 3 (needless retry). Approved misses 5 (wrong approve), rejected misses 5 (correct reject). Wrong approvals at 5 of 10 misses is the problem; tighten the grade prompt's "partial mentions are not enough" line first, since those five will produce confident wrong answers.

# Appendix B. Glossary

Abstain: answer "the sources don't cover this" with no citations.
Agent: a system where a model's output decides control flow.
Checkpointer: LangGraph component that saves state after each node under a thread id.
Chunk: a bounded piece of source text stored with its origin.
Conditional edge: a function of state that names the next node.
Corrective RAG: retrieve, grade, rewrite-and-retry on failure.
Cosine distance: 1 − cosine similarity; pgvector's `<=>`.
Embedding: a vector representing a text's meaning.
Eval set / golden set: questions with known answers, frozen and versioned.
HNSW: an approximate nearest-neighbor index structure.
Hybrid retrieval: keyword plus vector results fused into one ranking.
Precision@k: fraction of the top k that are relevant.
Recall@k: fraction of questions with a relevant result in the top k.
Reducer: the function that combines a node's returned field with the existing value.
RRF: reciprocal rank fusion, `Σ 1/(k + rank)`.
Structured output: a model response constrained to a schema.
Thread id: the key a checkpointer uses to find a conversation's state.
Token: the unit models read and bill in; roughly three-quarters of a word.
tsvector / tsquery: Postgres full-text search document and query types.
