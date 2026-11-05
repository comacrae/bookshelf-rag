create index chunks_embedding_idx on chunks using hnsw (embedding vector_cosine_ops);
analyze chunks;