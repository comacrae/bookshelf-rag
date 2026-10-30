import {OpenAIEmbeddings} from "@langchain/openai";
import pgvector from "pgvector/pg";
import {pool} from "../src/db";
/*
* This spike file is to determine if the embeddings flow works as expected. 
* We save a query ("How does git save history") and compare the cosine dist of the query embedding against 
* a list of experiments and potential traps to see if the semnatically similar embeddings have a smaller
* cosine value as expected.
* 
* 1. Generate embeddings using the OpenAIEmbeddings API.
* 2. Save embeddings in a throwaway table as a pgvector
* 3. calculate cosine dist of query and sentences
*/

const query = "How does git save history";

const sentences = [
    // TARGETS: answer "how does git save history?" without sharing many of its words
    "Git stores snapshots of the whole project, not a list of file differences.",
    "Each commit records a pointer to a tree describing every file at that moment.",
  
    // TRAP 1: contains "history" but the meaning is unrelated
    "The history of operating systems begins with simple batch processing machines.",
  
    // TRAP 2: about git, but not about saving history
    "Creating a new branch in Git is cheap because it is only a movable pointer.",
    "A remote is a version of your repository hosted somewhere on the network.",
  
    // TRAP 3: about saving or recording things, but not git
    "A journaling file system writes changes to a log before applying them to disk.",
    "The browser's localStorage lets a page save key-value pairs between visits.",
  
    // NEAR-MISS: git, closely related, but secondary
    "Git compresses objects into packfiles and stores some of them as deltas.",
  
    // DISTRACTORS: one per book topic, clearly unrelated
    "A closure is a function that remembers the variables of its enclosing scope.",
    "Promises represent a value that may not be available yet.",
    "Arrow functions do not have their own binding of this.",
    "The scheduler decides which process runs next on the CPU.",
    "Virtual memory gives each process the illusion of its own address space.",
    "A mutex ensures only one thread enters a critical section at a time.",
    "Dynamic programming solves problems by storing answers to overlapping subproblems.",
    "Dijkstra's algorithm finds shortest paths in graphs with nonnegative edge weights.",
    "Merge sort divides the array in half, sorts each half, and merges them.",
    "Recursion reduces a problem to smaller instances of the same problem.",
    "A hash table maps keys to values using an array of buckets.",
    "Big-O notation describes how running time grows with input size.",
  ];

  async function testEmbeddings():Promise<void> {
    // init the open ai model and the pg client
    const embeddingDim: number | undefined = process.env.EMBEDDING_DIM ? Number(process.env.EMBEDDING_DIM): undefined;
    if(embeddingDim === undefined || Number.isNaN(embeddingDim))
        throw new Error('Embedding dim undefined in .env');

    const model = new OpenAIEmbeddings({apiKey:process.env.OPENAI_API_KEY, model: process.env.EMBEDDING_MODEL});
    const client = await pool.connect();

    //try to do the following: 

    // convert the sentences all at once
      const sentenceEmbeddings = await model.embedDocuments(sentences);
    // convert the query
      const queryEmbedding = await model.embedQuery(query);

    
    try{
      // create the temporary table
      await client.query(`
        create table if not exists tmp_vecs
        (
          id bigint generated always as identity primary key,
          txt text,
          embedding vector(${embeddingDim}) 
        )
        `);

      // store the sentence embeddings
      for(const [i, embedding] of sentenceEmbeddings.entries()){
        await client.query(`
            insert into tmp_vecs (txt, embedding)
            values ($1,$2)
          `,[sentences[i],pgvector.toSql(embedding)]);
      }
    // query from the table while calculate the cosine diff
      const output = await client.query(`
          select txt, embedding <=> $1 as dist from tmp_vecs
          order by dist
          limit 5 
        `,[pgvector.toSql(queryEmbedding)]);
    //print the output 
    console.table(output.rows);
      
    }finally{
      // finally tear down the table and release the pool;
      await client.query(`drop table tmp_vecs;`);
      client.release();
    }
    

  }

testEmbeddings().finally(()=> {
    pool.end();
});
