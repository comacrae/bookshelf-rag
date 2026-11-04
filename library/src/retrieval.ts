import {embeddingModel as model} from "./model";
import pgvector from "pgvector/pg";
import { pool } from "./db";

export type Hit = {
    id:string,
    bookId:string,
    page:number,
    pageEnd:number,
    content:string,
    score:number
}

export const vectorSearch = async ( query:string, n:number) : Promise<Hit[]> => {

    // get embedding of query
    const emb = await model.embedQuery(query);

        // score is 1 - dist because the higher the distance, the less related the emebeddings
        // so highly related embeddings will have smaller distance, meaining 1 - dist will be a larger value
        const result = await pool.query<{id:string,book_id:string,page:number,page_end:number,content:string,score:number}>(`
            select id, book_id, page, page_end, content, 1 - (embedding <=> $1) as score  
            from chunks
            order by embedding <=> $1 asc
            limit $2;
            `,[pgvector.toSql(emb), n])

        // coerce to Hit and return
        return result.rows.map((hit) => ({id:hit.id, bookId:hit.book_id, page:hit.page, pageEnd:hit.page_end, content:hit.content, score:hit.score}));

}

