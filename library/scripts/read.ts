import { readPages, cleanPdf } from "../src/ingest/fileReader";
import { getChunks } from "../src/ingest/chunker";
import type { Chunk, ChunkOpts} from "../src/ingest/chunker";
import {getEncoding} from "js-tiktoken";

const FILES = [
    {name: "eloquent-js-4e.pdf", tocStartPage:25}
];


const CHUNK_TOKENS = 400;
const CHUNK_OVERLAP = 60;


export async function main() {

    const chunkerOptions:ChunkOpts = {
        encoder:getEncoding("cl100k_base"),
        targetTokens: CHUNK_TOKENS,
        overlapTokens: CHUNK_OVERLAP
    }
    
    for(const f of FILES){

        console.log(`Extracting ${f.name}...`);
        const pdf = await readPages(f.name);

        console.log(`Cleaning ${f.name}...`);
        const cleaned = cleanPdf(pdf, f.tocStartPage);

        console.log(`Chunking ${f.name}...`);
        const chunks: Chunk[] = getChunks(cleaned, chunkerOptions);
    }
};

main().then(()=>console.log('completed'));