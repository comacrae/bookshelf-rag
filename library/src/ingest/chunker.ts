import {getEncoding} from "js-tiktoken";


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


export async function getChunks(pages:Page[]):Promise<void>{
    const regex = /(?<=[.!?])\s+/; // matches any punctuation at end of a sentence followed by white space and keeps white space
    // convert all pages to a list of sentences split by punctuation with their page numbers
    const contents = pages.flatMap(
        (page) => page.text.split(regex).map(
            ((sentence) => ({pageNumber:page.pageNumber, sentence}))
        )
    );
    const encoder = getEncoding("cl100k_base");
    for(let i = 0; i < 10; i++){
        console.log(`${contents[i].sentence} Page: ${contents[i].pageNumber} Length:${encoder.encode(contents[i].sentence).length}`)
    }
    return;
}
