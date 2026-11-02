import { readPages, cleanPdf } from "./fileReader";
import { getChunks } from "./chunker";

const FILES = [
    {name: "eloquent-js-4e.pdf", tocStartPage:25}
];
export async function main() {
    for(const f of FILES){
        const pdf = await readPages(f.name);
        const cleaned = cleanPdf(pdf, f.tocStartPage);
        getChunks(cleaned);
    }
};

main().then(()=>console.log('completed'));