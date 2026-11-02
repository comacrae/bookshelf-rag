import type { Tiktoken } from "js-tiktoken";
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
    encoder:Tiktoken,
    targetTokens:number,
    overlapTokens:number
};

export async function getChunks(pages:Page[], opts:ChunkOpts):Chunks[]{
    // matches any punctuation at end of a sentence followed by white space and keeps punctuation but removes whitespace
    const regex = /(?<=[.!?])\s+/; 

    // convert all pages to a list of sentences split by punctuation with their page numbers
    const contents = pages.flatMap(
        (page) => page.text.split(regex).map(
            ((sentence) => ({pageNumber:page.pageNumber, sentence, tokens:0}))
        )
    );
    
    // encode each sentence and get the length
    const countTokens= (s:string) => opts.encoder.encode(s).length;
    for(let i = 0; i < contents.length; i++){
        contents[i].tokens = countTokens(contents[i].sentence);
    }

    return;
}
