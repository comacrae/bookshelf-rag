import z from "zod";
import {chatModel} from "../model";
import { SystemMessage, HumanMessage } from "@langchain/core/messages";
import type { S } from "./state";
// chat model returns structured output {rewritten:"...")} and will retry once if model output != schema
const extractor = chatModel.withStructuredOutput(z.object({rewritten: z.string()})).withRetry({stopAfterAttempt:2});

export const rewrite = async (state:S) : Promise<{rewritten:string}> => {
    const instructions = "Rewrite the user's question so it makes sense on its own";
    const earlierMessages = state.messages;
    const newQuestion = state.question;

    const result = await extractor.invoke([new SystemMessage(instructions), ...earlierMessages, new HumanMessage(newQuestion)]);
    return result;
}
async function main() {
console.log(await rewrite({ question: "how do I turn it on?", messages: [] } as S));
}
main().then(()=>{});