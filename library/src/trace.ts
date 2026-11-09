import type { rewrite, grade, answer, webSearch, retrieve } from "./agent/nodes";

export type RewriteResult = Awaited<ReturnType<typeof rewrite>>;
export type GradeResult = Awaited<ReturnType<typeof grade>>;
export type AnswerResult = Awaited<ReturnType<typeof answer>>;
export type WebSearchResult = Awaited<ReturnType<typeof webSearch>>
export type RetrieveResult = Awaited<ReturnType<typeof retrieve>>

export type Step = {seq:number, node:Node, attempt:number, inputTokens:number,outputTokens:number, ms:number, detail:Record<string,unknown>}
export type Node = "rewrite" | "answer" | "webSearch" | "grade" | "retrieve";
export type Trace = {
    addTokens: (input:number,output:number) => void,
    onUpdate: (node:Node, update:unknown) => void,
    getTotals: () => {inputTokens:number,outputTokens:number},
    getSteps: () => Step[]
};

export const createTrace = (startTime:number):  Trace => {
    //factory to create an object that eases mid-turn telemetrics for chat graph
    let lastStepAt= startTime;
    let inputTokens = 0;
    let outputTokens = 0;
    let lastInputTotal = 0;
    let lastOutputTotal = 0;
    let attempts = 0;
    const steps:Step[] = [];

    const addTokens = (input:number,output:number):void => {
        inputTokens += input;
        outputTokens += output;
    };

    const onUpdate = (node:Node, update:unknown): void => {
        // records a single step based on the update info
        let detail: Record<string,unknown>;
        if(node==="rewrite"){
            const u = update as RewriteResult;
            attempts = attempts + 1;
            detail = {rewritten: u.rewritten}
        }else if (node === "grade"){
            const u = update as GradeResult;
            detail = {relevant: u.relevant, reason:u.gradeReason}
            attempts = u.attempts;
        }else if (node === "answer"){
            const u = update as AnswerResult
            detail = {source: u.source}
        }else if (node === "webSearch"){
            const u = update as WebSearchResult;
           detail = {urls: u.webResults.map(r => r.url)};
        }else if (node === "retrieve"){
            const u = update as RetrieveResult;
            detail = {chunkIds:u.chunks.map(ch => ch.id)};
        }else{
            throw new Error(`Invalid node type ${node}`);
        }

        const newStep:Step = {
            seq: steps.length + 1, 
            node, 
            attempt:attempts, 
            inputTokens: inputTokens - lastInputTotal, 
            outputTokens: outputTokens - lastOutputTotal,
            ms: Date.now() - lastStepAt,
            detail
        };

        steps.push(newStep);

        lastStepAt = Date.now();
        lastInputTotal = inputTokens;
        lastOutputTotal = outputTokens;

    }
    
    const getTotals = () : {inputTokens:number, outputTokens:number} => {
        return {inputTokens,outputTokens};
    }
    
    const getSteps = (): Step[] => {
        return steps;
    }

    return {
        getTotals,
        getSteps,
        onUpdate,
        addTokens
    }
}