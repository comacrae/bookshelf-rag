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


// state is an object that marks the state of the fields acted upon by nodes in the graph
const SpikeState = Annotation.Root({
    count: Annotation<number>({reducer: (_curr, update) => update, default: () => 0}),
    log: Annotation<string[]>({reducer: (curr, update) => curr.concat(update), default: ()=>[]})
});

// a node is an async function that ingests and modifies state and returns the change to be ingested by the reducer
const bump = async (state: typeof SpikeState.State) => {
    return {count: state.count+1, log: [`bump to ${state.count+1}`]};
};

// router reads state and guides path by returning name of next node to visit or END to stop

const nextStep = (state: typeof SpikeState.State) => {
    if(state.count >= 3)
        return END;
    else
        return "bump";
};

// checkpointer
const dbUrl = process.env.DATABASE_URL;
if(dbUrl === undefined)
    throw new Error('db url env var undefined');
const checkpointer = PostgresSaver.fromConnString(dbUrl);

// build graph 

const graph = new StateGraph(SpikeState)
    .addNode("bump", bump)
    .addEdge(START, "bump")
    // maps whatever the router returned to which node runs next
    // so this says after bump runs, call next step, and depedning on what it returns, loop again or stop
    .addConditionalEdges("bump", nextStep, {"bump": "bump", [END]: END}) 
    .compile({checkpointer});


const invoke = async (threadId:string) => {
    const config = {configurable: {thread_id: threadId}};
    await checkpointer.setup(); //create tables if dne
    const result = await graph.invoke({}, config); // {} means no new input so use saved state
    console.log(`Invoked threadId: ${threadId} \n Result: ${result}`);
}


async function main(){
    await invoke('thread-1');
    // expect to see ({count: 3, ['bump to 1', 'bump to 2', 'bump to 3']})
    await invoke('thread-1');
    // expect to see ({count: 4, ['bump to 1', 'bump to 2', 'bump to 3','bump to 4']})
    await invoke('thread-2');
    // expect to see ({count: 3, ['bump to 1', 'bump to 2', 'bump to 3']})
}

main().finally(() => checkpointer.end() ); // closes its own pool so process will exit
