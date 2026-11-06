import {StateGraph,START, END, LangGraphRunnableConfig } from "@langchain/langgraph";
import { ConversationState, GraphContext, MAX_ATTEMPTS } from "./state";
import type {S,Ctx} from "./state";
import { rewrite,retrieve,webSearch,grade, answer } from "./nodes";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import {config as envConfig} from "../config";

const afterGrade = (state:S, graphConfig:LangGraphRunnableConfig<Ctx>): "rewrite" | "answer" | "webSearch" => {
    /*Takes whether the current turn returned  relevant chunk(s) and depending on web fall back setting 
    * or how many attempts have occured so far
    */
    if(!state.relevant){
        if(state.attempts >= MAX_ATTEMPTS)
            return (graphConfig.context?.webFallback ?? envConfig.WEB_FALLBACK )? "webSearch" : "answer";
        else
            return "rewrite"
    }
    return "answer";
}

export const buildGraph = (checkpointer?:PostgresSaver) => {
    return new StateGraph(ConversationState,GraphContext)
    .addNode("rewrite", rewrite)
    .addNode("retrieve",retrieve)
    .addNode("grade",grade)
    .addNode("answer",answer)
    .addNode("webSearch",webSearch)
    .addEdge(START, "rewrite")
    .addEdge("rewrite","retrieve")
    .addEdge("retrieve","grade")
    .addEdge("webSearch","answer")
    .addEdge("answer", END)
    .addConditionalEdges("grade", afterGrade, {rewrite:"rewrite",answer:"answer",webSearch:"webSearch"})
    .compile({checkpointer});
}