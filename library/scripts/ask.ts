import { vectorSearch } from "@/src/retrieval";

export const main = async () => {
    const topN = Number(process.argv[2]);
    const query = process.argv[3];

    console.table((await vectorSearch(query,topN)).map((row) => ({...row, content:row.content.slice(0,100)})));
};

main().then(()=>{});