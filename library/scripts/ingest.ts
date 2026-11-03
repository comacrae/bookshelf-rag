import { readPages, cleanPdf } from "../src/ingest/fileReader";
import { getChunks } from "../src/ingest/chunker";
import type { Chunk, ChunkOpts} from "../src/ingest/chunker";
import { vectorize } from "@/src/ingest/vectorize";
import {pool} from "../src/db";

const FILES = [
    {name: "eloquent-js-4e.pdf", start:25, end:431},
    {name: "algorithms-erickson.pdf", start:19, end:446},
    {name: "ostep.pdf", start:22, end:675},
    {name: "pro-git-2e.pdf", start:16, end:498}
];


const CHUNK_TOKENS = 400;
const CHUNK_OVERLAP = 60;


export async function main() {

    const chunkerOptions:ChunkOpts = {
        targetTokens: CHUNK_TOKENS,
        overlapTokens: CHUNK_OVERLAP
    }

    for(const f of FILES){

        console.log(`Extracting ${f.name}...`);
        const pdf = await readPages(f.name);

        console.log(`Cleaning ${f.name}...`);
        const cleaned = cleanPdf(pdf, f.start, f.end);

        console.log(`Chunking ${f.name}...`);
        const chunks: Chunk[] = getChunks(cleaned, chunkerOptions);

        console.log(`Creating embeddings for ${chunks.length} chunks...`)
        const slug = f.name.replace(".pdf","");
        await vectorize(slug,chunks);
    }
};

main().then(()=>{
    pool.end();
    console.log('COMPLETED')
});