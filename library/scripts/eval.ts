import {readFile} from "fs/promises";
import { hybridSearch } from "@/src/retrieval";
import { pool} from "@/src/db";

type Question = {
    id:string,
    book:string|null,
    question:string,
    answerPages:number[],
    expected:string,
    hard:boolean
};

type ChunkComparison = {
    bookReturned:string,
    pageRangeReturned:number[],
    correctBook:boolean, // is the chunk from the expected book
    correctRange:boolean, // is the chunk in the expected page range
    hit: boolean
}

type Result = Question & {
    hits:ChunkComparison[],
    misses:ChunkComparison[],
    hasHit:boolean
}

const getArgOrDefault = (flag:string,defaultVal:string) => {
    const i = process.argv.indexOf(flag);
    return i > -1  ? process.argv[i + 1]: defaultVal;
};

const main = async () => {
    const questionsFilepath= getArgOrDefault("--eval", "evals/questions.v1.json");
    const topN = 5;
    const file = await readFile(questionsFilepath, "utf-8");
    const questions:Question[] = JSON.parse(file).filter((q:Question) => q.book !== null); // only questions that can be actually answered
    const results: Result[] = [];
    let hitCount = 0;

    for(const q of questions){
        // get topN results 
        const chunksReturned = await hybridSearch(q.question, topN);
        let hasHit = false;
        // are there any chunks that are from the expected book and page range? If yes, it's a hit
        const comparisons:ChunkComparison[] = chunksReturned.map((chunk) =>{
                const correctBook = chunk.bookId === q.book;
                // match if at least one answer page falls inside returned chunk range
                const correctRange = q.answerPages.some(page => page >= chunk.page && page <= chunk.pageEnd);
                const hit = correctBook && correctRange;
                if(hit){
                    hasHit= true;
                }
                return {
                    bookReturned: chunk.bookId,
                    pageRangeReturned: [chunk.page, chunk.pageEnd],
                    correctBook,
                    correctRange,
                    hit
                }
            }
        )

        if(hasHit) // one hit per question
            hitCount +=1;

        const hits = comparisons.filter((c)=>c.hit);
        const misses = comparisons.filter(c => !c.hit);

        results.push({...q, hits,misses, hasHit});
    };

    const recallAtTopN = hitCount / questions.length;

    console.log(`Recall at k=${topN} for ${questionsFilepath}: ${recallAtTopN}`);
    for(const result of results){
        console.log(`Book: ${result.book}, Has hit:${result.hasHit}, precision: ${result.hits.length / topN}\nQuestion:${result.question}`);
        console.log("Misses:")
        console.table(result.misses);
    }
}

main().then(()=>pool.end());