import { buildGraph } from "../src/agent/graph";
import {pool} from "../src/db";
async function main(){
    const tests = [
        {question: "How do I use rerere?", webFallback:false},
        {question: "Is bun better than npm?", webFallback:true},
        {question: "Is bun better than npm?", webFallback:false}
    ];
    const g = buildGraph()


    for(const t of tests){
        console.log(`Question: ${t.question} Webfallback: ${t.webFallback}`);

        for await(const u of await g.stream({question:t.question, attempts:0, webResults:[]},{streamMode: "updates", recursionLimit:25,context:{webFallback:t.webFallback, topK:5}})){
            console.log(JSON.stringify(u).slice(0,300));
        }
    }
}

main().then(()=> {pool.end()});