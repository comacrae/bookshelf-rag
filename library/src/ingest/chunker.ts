import {getEncoding } from "js-tiktoken";
export type Page = {
    pageNumber: number,
    text: string
};
export type Chunk = {
    page: number,
    pageEnd: number,
    content:string,
    chunkIndex:number,
};

export type ChunkOpts = {
    targetTokens:number,
    overlapTokens:number
};

const encoder = getEncoding("cl100k_base");



export function getChunks(pages:Page[], opts:ChunkOpts):Chunk[]{

    //init arrays
    const tokens:number[] =  [];
    const tokenPages:number[] = [];
    const chunks: Chunk[] = [];
    
    //for each page, add the tokens and map their respective page
    for(const page of pages){
        const encoded = encoder.encode(page.text + "\n");
        tokens.push(...encoded);
        tokenPages.push(...new Array(encoded.length).fill(page.pageNumber));
    }

    //create a sliding window and build chunks from it
    const step = opts.targetTokens - opts.overlapTokens; // we want X tokens overlap per chunk

    for(let start = 0; start < tokens.length; start+= step){ // increment by step smaller than token window

        const end = Math.min(start + opts.targetTokens, tokens.length); // to prevent OOB on tokenPages

        chunks.push({
            page:tokenPages[start],
            pageEnd:tokenPages[end - 1],
            chunkIndex: chunks.length, // 0-indexed
            content: encoder.decode(tokens.slice(start,end))
        })

        // if the end is already at the end of the tokens, we break to avoid a chunk that is just an overlap
        if(end === tokens.length) 
            break;
    }                              

    return chunks;
}
