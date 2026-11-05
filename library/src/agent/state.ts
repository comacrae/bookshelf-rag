import { Annotation } from "@langchain/langgraph";
import type { BaseMessage } from "@langchain/core/messages";
import type { Hit } from "../retrieval";

export type WebResult = {
    url:string;
    title:string;
    content:string;
}

export type Source = 'books'|'web'|'none';

export const MAX_ATTEMPTS = 3;

export const ConversationState = Annotation.Root({
    messages: Annotation<BaseMessage[]>({reducer: (old, update) => old.concat(update), default: () => []}),
    question: Annotation<string>,
    rewritten: Annotation<string>,
    chunks: Annotation<Hit[]>({reducer:(_,update) => update, default: () => []}),
    webResults: Annotation<WebResult[]>({reducer:(_,update) => update, default: () => []}),
    relevant: Annotation<boolean>,
    gradeReason:Annotation<string>,
    attempts: Annotation<number>({reducer: (_curr,update) => update, default: () => 0 }),
    source: Annotation<Source>
});

export type S = typeof ConversationState.State;