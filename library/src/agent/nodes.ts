import z from "zod";
import {chatModel} from "../model";
import { SystemMessage, HumanMessage } from "@langchain/core/messages";
import { tool } from "@langchain/core/tools";
import type { S } from "./state";
import { hybridSearch } from "../retrieval"
import type { Hit } from "../retrieval";
;
// chat model returns structured output {rewritten:"...")} and will retry once if model output != schema
const extractor = chatModel.withStructuredOutput(z.object({rewritten: z.string()})).withRetry({stopAfterAttempt:2});

export const rewrite = async (state:S) : Promise<{rewritten:string}> => {
    /*Takes a question and rewords it using conversation history */
    const instructions = "Rewrite the user's question so it makes sense on its own";
    const earlierMessages = state.messages;
    const newQuestion = state.question;

    const result = await extractor.invoke([new SystemMessage(instructions), ...earlierMessages, new HumanMessage(newQuestion)]);
    return result;
}

const searchChunks = tool(async ({query}) => hybridSearch(query,5), {name:"search_books",description:"Search book chunks via hybrid search",schema: z.object({query:z.string()})})

export const retrieve = async (state:S): Promise<{chunks:Hit[]}> => {
    /*Fetch related chunks using the rewritten question */
    return {chunks:await searchChunks.invoke({query:state.rewritten})}
}
async function main() {
console.log(await retrieve({ rewritten: "how do I turn it on?", messages: [] } as S));
}
main().then(()=>{});