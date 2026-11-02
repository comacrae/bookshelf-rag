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

type Piece = {
    page:number, text:string, tokens:number
}

const encoder = getEncoding("cl100k_base");



export function getChunks(pages:Page[], opts:ChunkOpts):Chunk[]{


    // matches any punctuation at end of a sentence followed by white space and keeps punctuation but removes whitespace
    const regex = /(?<=[.!?])\s+/; 
    let chunks: Chunk[] = [];
    let buffer: Piece[] = [];
    let bufferTokens = 0;

    const emit = () => {
        chunks.push({
            page:buffer[0].page,
            pageEnd:buffer[buffer.length-1].page,
            chunkIndex: chunks.length,
            content : buffer.map((piece) => piece.text).join(" ")
        })
        buffer = [];
        bufferTokens = 0;
    }

    for(const page of pages){
        // split page into sentences
        const sentences = page.text.split(regex);
        // for each sentence, encode and split into sections of size X tokens
        for(const sentence of sentences){

            // encode the sentence
            const encoded = encoder.encode(sentence);

            // for section sizes of X tokens
            for(let i = 0; i < encoded.length; i += opts.targetTokens){
                // slice the encoding into X tokens
                const slice = encoded.slice(i, i+opts.targetTokens);

                //decode it back into text
                const decoded = encoder.decode(slice);

                // build the piece, keeping track of page number and slice size
                const piece: Piece = {page:page.pageNumber, text: decoded, tokens:slice.length};

                // if adding this piece to the buffer would exceed size, then add a chunk
                if(bufferTokens + piece.tokens > opts.targetTokens)
                    emit();

                buffer.push(piece);
                bufferTokens += slice.length;
            }
            
        }

    }
    if(buffer.length > 0)
        emit();

    return chunks;
}
