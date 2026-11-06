import { getGraph } from "../src/agent/graph";
import {pool} from "../src/db";
async function main(){
    const tests = [
        {question: "How do I use rerere?", webFallback:false},
        {question: "How do I turn it on?", webFallback:false},
    ];
    const g = await getGraph()
    const threadId = `test-${Date.now()}`;

    for(const t of tests){
        console.log(`Question: ${t.question} Webfallback: ${t.webFallback}`);
        let state = await g.getState({configurable: {thread_id: threadId}});
        console.log({ messages: state.values.messages?.length ?? 0, attempts: state.values.attempts, rewritten: state.values.rewritten });
        for await(const u of await g.stream({question:t.question, attempts:0, webResults:[]},{streamMode: "updates", recursionLimit:25,context:{webFallback:t.webFallback, topK:5}, configurable:{thread_id:threadId}})){
            console.log(JSON.stringify(u).slice(0,300));
        }
    }
}

main().then(()=> {pool.end()});