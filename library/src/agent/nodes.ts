import z from "zod";
import {chatModel} from "../model";
import { SystemMessage, HumanMessage, AIMessage } from "@langchain/core/messages";
import { tool } from "@langchain/core/tools";
import type { S, Source, Ctx, WebResult} from "./state";
import { hybridSearch } from "../retrieval"
import type { Hit } from "../retrieval";
import type { BaseMessage } from "@langchain/core/messages";
import type { Runtime } from "@langchain/langgraph";
import { config } from "../config";
import {tavily, TavilyResponse} from "../tavily";

// chat model returns structured output {rewritten:"...")} and will retry once if model output != schema
const extractor = chatModel.withStructuredOutput(z.object({rewritten: z.string()})).withRetry({stopAfterAttempt:2});
const grader = chatModel.withStructuredOutput(z.object({relevant:z.boolean(), gradeReason:z.string()})).withRetry({stopAfterAttempt:2});

const getFormattedChunks = (state:S):string =>  state.chunks.map((chunk:Hit, idx) => `[${idx + 1}] (${chunk.bookId} pp.${chunk.page}-${chunk.pageEnd}) ${chunk.content}`).join("\n\n");
const getFormattedWebResults = (state:S):string => state.webResults.map((result, idx) => `[w${idx + 1}] Title: ${result.title} ${result.content} URL:${result.url}`).join("\n\n");

export const rewrite = async (state:S) : Promise<{rewritten:string}> => {
    /*Takes a question and rewords it using conversation history */
    let instructions = "Rewrite the user's question so it makes sense on its own.";

    // if this is the same turn, add the failure reason to the instruction context
    if(state.gradeReason && state.attempts > 0)
        instructions += ` Your previous rewrite was ${state.rewritten}. Here is why the previous attempt failed: ${state.gradeReason}. Use different wording.`;
        
    const earlierMessages = state.messages;
    const newQuestion = state.question;

    const result = await extractor.invoke([new SystemMessage(instructions), ...earlierMessages, new HumanMessage(newQuestion)]);
    return result;
}

const searchChunks = tool(async ({query, topK}: {query:string, topK:number}) => hybridSearch(query,topK), {name:"search_books",description:"Search book chunks via hybrid search",schema: z.object({query:z.string(), topK:z.number()})});

export const retrieve = async (state:S, runtime:Runtime<Ctx>): Promise<{chunks:Hit[]}> => {
    /*Fetch related chunks using the rewritten question */
    return {chunks:await searchChunks.invoke({query:state.rewritten, topK:runtime.context?.topK ?? config.RETRIEVAL_TOP_K})};
};

export const grade = async(state:S): Promise<{relevant:boolean, gradeReason:string, attempts:number}> => {
    /**Takes the current chunks fetched, passes them to the LLM and asks for a determiniation as 
     * to whether the chunks are relevant with a reason behind the score, and passes the incremented number of attempts.
     */
    const instructions = "Given a selection of text excerpts in the format [<citation_number>] (<book_slug>, <page_range>) <text>, determine if the chunks can answer the given question. Give your reason in one sentence.";
    const formattedChunks = getFormattedChunks(state);
    const results = await grader.invoke(
        [new SystemMessage(instructions), 
        new HumanMessage(`Question: ${state.rewritten}\n\nExcerpts:\n${formattedChunks}`)]
    );
    return {relevant:results.relevant, gradeReason:results.gradeReason, attempts:state.attempts + 1};
};

export const answer = async(state:S): Promise<{source:Source, messages:BaseMessage[]}> => {
/**
 * Numbers the sources, tells the model to cite every claim, and answer only from the numbered sources. 
 * When source = 'none', the answer is a short 'the books don't cover this' with no citations. 
 */
    let source = 'none' as Source;

    if(state.relevant){ // grade node said chunks are relevant so pass them to the model
        source = 'books';

        const formattedChunks = getFormattedChunks(state);

        const instructions = `Respond to the following query. You are given a selection of text excerpts in the format [<citation_number>] (<book_slug>, <page_range>) <text>. Only use the text excerpt to answer the question and cite after each sentence in the format <claim> [<excerpt_number>]. Don't use any other citation format.\n\nExcerpts:\n${formattedChunks}`;

        const response = await chatModel.invoke([new SystemMessage(instructions), new HumanMessage(`Query: ${state.rewritten}`)]);

        return {source:source, messages: [new HumanMessage(state.question), response]}
    }else if (state.webResults.length > 0){
        //use web results if fallback occurred
        source = 'web';

        const webResults = getFormattedWebResults(state);

        const instructions = `Respond to the following query. You are given a selection of web search results in the format [<citation_number>] Title: <title> <content> URL:<url>. Only use the search results to answer the question and cite after each sentence in the format <claim> [w<citation_number>]. For example, [w1],[w2], etc. State in the first sentence that the books did not cover the given query and that you used web search as a fallback. Don't use any other citation format.\n\nExcerpts:\n${webResults}`;

        const response = await chatModel.invoke([new SystemMessage(instructions), new HumanMessage(`Query: ${state.rewritten}`)]);

        return {source:source, messages: [new HumanMessage(state.question), response]}
    }

    return {source:source, messages: [new HumanMessage(state.question),new AIMessage("The books don't cover this.")]};
    
}

export const webSearch = async (state:S): Promise<{webResults:WebResult[]}> => {
    const response = await tavily.invoke({query:state.rewritten});
    const parsed = TavilyResponse.safeParse(response);
    let results: WebResult[] = [];

    if(parsed.error){
        return {webResults:results};
    }

    return {webResults: parsed.data.results}
}
