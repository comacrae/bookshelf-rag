import {embeddingModel as model} from "./model";
import pgvector from "pgvector/pg";
import { pool } from "./db";
import { rrf } from "./rrf";

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

export const keywordSearch = async ( keywords:string, n:number) : Promise<Hit[]> => {
    
    // tsquery higher secore is better so we sort desc
    const result = await pool.query<{id:string,book_id:string,page:number,page_end:number,content:string,score:number}>(`
        select id, book_id, page,page_end, content, ts_rank(tsv, replace(websearch_to_tsquery('english', $1)::text, ' & ', ' | ')::tsquery) as score   
        from chunks
        where tsv @@ replace(websearch_to_tsquery('english', $1)::text, ' & ', ' | ')::tsquery
        order by score desc
        limit $2
        `,[keywords, n])

    // coerce to Hit and return
    return result.rows.map((hit) => ({id:hit.id, bookId:hit.book_id, page:hit.page, pageEnd:hit.page_end, content:hit.content, score:hit.score}));

}

export const hybridSearch = async (query:string, n:number) :Promise<Hit[]> => {
    const results =  await Promise.all([
        vectorSearch(query, n),
        keywordSearch(query,n)]
    );
    return rrf(results).slice(0,n);
}


