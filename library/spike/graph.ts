import { Annotation, StateGraph, START, END } from "@langchain/langgraph";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";

/*
* Problem statement: every HTTP request is a fresh run of the code, so we need a way 
* to remember the previous state of a conversation with a model. In other words, the memory
* needs to live outside the process. To accomplish this, we use LangGraph's checkpointer.
* 
* Checkpointer: component that saves a graph's whole state to Postgres after every node runs. 
*   It then loads it back when you invoke again with the same thread_id. (Thread_id is like a conversation id)
*
* This spike answers the following questions:
* 1. does saving and restoring state through supabase actually work?
* 2. when state is restored, how do new updates combine with saved values?
* 
* Output: a tiny graph with no LLM. a single node that loops on itself and increases state
*/

/*
The steps to get there

1. Define the state and its reducers. LangGraph's state is an object with named fields. Each field has a reducer, a function (current, update) => newValue that decides how a node's returned value merges into what's already stored. An overwrite reducer ignores current and an append reducer concatenates. Each field also gets a default for a brand-new thread. Decide which reducer goes on count and which on log.
2. Write the bump node. A node is an async function that receives the full state and returns only the fields it wants to change. LangGraph runs each returned field through that field's reducer. Should bump return the whole log array plus a new line, or just the new line? Look at what the append reducer does with what you return.
3. Write the router. A router is a plain function that looks at state and returns the name of the next node, or END to stop. Yours keeps looping while count < 3.
4. Wire the graph. START → bump is a normal edge. After bump comes a conditional edge, an edge whose destination the router picks at runtime. Then compile the graph with the checkpointer attached. The conditional edge is what will later become your grade → retry loop.
5. Create the checkpointer. PostgresSaver.fromConnString(...) opens its own connection pool, separate from your pool in src/db. setup() creates its tables, and it's safe to run every time. Because it has its own pool, the process will hang at the end just like your migrate script did until you close it. Find the method that ends it. Your pool.end() won't close it, because it's a different pool.
6. Invoke twice with the same thread_id, and predict first. Write down your predicted second output before you run anything. Hint: the second invoke starts at START again with count restored to 3. Trace what bump does and then what the router says.
7. Invoke once with a different thread_id. This proves that state belongs to a thread, not to the graph as a whole.
8. Look at the tables. Count the rows in checkpoints for your thread. You should get roughly one per step. That's what lets the real app resume a conversation.

What I need from you

Write spike/graph.ts covering steps 1–7, then write your prediction for the second invoke as a comment at the bottom before you run it. Run it with npx tsx --env-file=.env spike/graph.ts from library/.

Some syntax tips. A state field with a reducer has this shape:

const State = Annotation.Root({
  field: Annotation<Type>({ reducer: (current, update) => ..., default: () => ... }),
});

A conditional edge maps each router return value to a node:

.addConditionalEdges("fromNode", routerFn, { returnValue: "targetNode", [END]: END })

The config that selects a thread is { configurable: { thread_id: "some-id" } }, passed as the second argument to invoke.

The guide's sample uses top-level await, which fails under tsx just like it did in migrate.ts. Wrap the work in an async main() and close the checkpointer in a .finally.
*/

// state is an object that marks the state of the fields acted upon by nodes in the graph
const ConversationState = Annotation.Root({
    count: Annotation<number>({reducer: (_curr, update) => update, default: () => 0}),
    log: Annotation<string[]>({reducer: (curr, update) => curr.concat(update), default: ()=>[]})
});

// a node is an async function that ingests and modifies state and returns the change to be ingested by the reducer
const node = async (state: typeof ConversationState.State) => {
    return {count: state.count+1, log: [`bump to ${state.count+1}`]};
};