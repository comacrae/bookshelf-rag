import pgvector from "pgvector/pg";
import {pool} from "../db";
import {embeddingModel as model} from "../model";
import type { Chunk } from "./chunker";


export const vectorize = async (bookSlug:string,chunks:Chunk[]):Promise<void> => {

    //init embedding model    
    

    const batchSize = 50;

    const embeddings:number[][] = [];

    for(let chunkStart = 0; chunkStart < chunks.length; chunkStart+=batchSize){
        const chunkEnd = Math.min(chunkStart + batchSize, chunks.length);
        const batch = chunks.slice(chunkStart, chunkEnd).map((chunk) => chunk.content);
        const converted = await model.embedDocuments(batch);
        embeddings.push(...converted);
    }
    // init db client
    const client = await pool.connect();

    try{
        await client.query('begin transaction;');
        // clear table for given book
        await client.query('delete from chunks where book_id = $1',[bookSlug]);

        // for each chunk
        for(let i = 0; i < embeddings.length; i++){
            // get chunk
            const chunk = chunks[i];
            const emb = embeddings[i];
        // populate table
            await client.query('insert into chunks (book_id, page, page_end, chunk_index, content, embedding) values ($1,$2,$3,$4,$5,$6)', 
                [bookSlug,chunk.page, chunk.pageEnd, chunk.chunkIndex, chunk.content, pgvector.toSql(emb)]
            );
        }

        await client.query('commit');
    }catch(err){
        await client.query('rollback');
        throw err;
    }finally{
        client.release();
    }
}