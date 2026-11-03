import {OpenAIEmbeddings} from "@langchain/openai";
import pgvector from "pgvector/pg";
import {pool} from "../db";
import type { Chunk } from "./chunker";


export const vectorize = async (bookSlug:string,chunks:Chunk[]):Promise<void> => {

    //init embedding model    
    const embeddingDim: number | undefined = process.env.EMBEDDING_DIM ? Number(process.env.EMBEDDING_DIM): undefined;
    if(embeddingDim === undefined || Number.isNaN(embeddingDim))
        throw new Error('Embedding dim undefined in .env');

    const model = new OpenAIEmbeddings({apiKey:process.env.OPENAI_API_KEY, model: process.env.EMBEDDING_MODEL});

    const batchSize = 50;

    const embeddings:number[][] = [];

    for(let chunkStart = 0; chunkStart < chunks.length; chunkStart+=batchSize){
        const chunkEnd = Math.min(chunkStart + batchSize, chunks.length);
        const batch = chunks.slice(chunkStart, chunkEnd).map((chunk) => chunk.content);
        const converted = await model.embedDocuments(batch);
        embeddings.push(...converted);
    }
    console.log(embeddings.length, chunks.length, embeddings[0].length);
    // init db client
    /*const client = await pool.connect();

    try{
        client.query('begin transaction;');
        // clear table for given book

        // for each embedding batch
            
            //get embeddings

            // populate table

    }catch(err){
        client.query('rollback');
    }finally{
        await client.end();
    }*/
    
}