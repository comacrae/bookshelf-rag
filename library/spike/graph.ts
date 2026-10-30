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
*/