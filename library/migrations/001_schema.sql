create extension if not exists vector;

create table if not exists books -- one row per book
(
    id varchar(64) primary key, -- slug
    title text not null,
    author text not null,
    filepath text not null, --relative to corpus dir (corpus/path/to/pdf)
    page_count int,
    created_at timestamptz not null default now()
);

create table if not exists chunks -- one row per chunk
(
    id bigint generated always as identity primary key,
    book_id varchar(64) references books(id) not null,
    page int not null, -- page in pdf where the chunk begins 
    chunk_index int not null, -- position in book where chunk begins
    content text not null,
    embedding vector(1536) not null, -- populated after pdf is chunked by feeding to openai api. size in .env as EMBEDDING_DIM
    tsv tsvector generated always as (to_tsvector('english', content)) stored, -- for keyword search
    created_at timestamptz not null default now(),
    unique(book_id,chunk_index)
);

create index if not exists chunks_tsv_idx on chunks using gin (tsv); -- generalized inverted index (like a keyword index in back of a book)

create table if not exists requests -- one row per question
(
    id bigint generated always as identity primary key,
    conversation_id text not null, -- which conversation was this related to?
    question text not null, -- what was the input query?
    input_tokens int not null, -- what was passed in to the model (including reference chunks)
    output_tokens int, -- what was returned by the model (null on error)
    attempts int not null, -- how many times did the agent rewrite the query and attempt to answer question
    latency_ms int not null, -- what was the total time to response
    ttft_ms int, -- time to first token, since we are streaming text (null on error)
    web_calls int not null default 0, -- how many times did we query the web
    invalid_citations int not null default 0, -- how many citations in the returned answer are NOT grounded 
    source text not null check (source in ('books','web','none')), -- books, web, or none, meaning no valid answer was returned,
    chat_model text not null,
    status text not null check (status in ('ok','error')), -- ok or the error that occured during the request
    error_message text,
    created_at timestamptz not null default now() -- when was the request initially created
);