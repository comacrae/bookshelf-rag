import { getTopN } from "@/src/retrieval";

export const main = async () => {
    const topN = Number(process.argv[2]);
    const query = process.argv[3];

    console.table((await getTopN(topN,query)).map((row) => ({...row, content:row.content.slice(0,100)})));
};

main().then(()=>{});