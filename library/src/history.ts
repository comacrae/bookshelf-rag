
import type { MetaChunk, MetaWeb } from "@/app/api/chat/route";
import type { Source } from "@/src/agent/state";
import type { Step } from "@/src/trace";
import { pool } from "./db";

export type Turn = HistoryTurn & {
    error:string|null,
    pending:boolean
};
export type HistoryTurn = {
    question:string,
    answer:string,
    source: Source | null,
    chunks:MetaChunk[],
    web: MetaWeb[],
    invalid:string[],
    steps:Step[]
};

export const loadHistory = async (conversationId:string) : Promise<HistoryTurn[]> => {

    // query requests for conversations that are ok and order by time 
    const requests = await pool.query<{
        id:string,
        question:string,
        source:Source
    }>(`
        select id,question, source
        from requests
        where conversation_id = $1 and status = 'ok'
        order by
        created_at asc
        `,[conversationId]);
    const requestIds = requests.rows.map(r => r.id);
    // if no matching history ,return
    if(requestIds.length === 0)
        return [];

    //get each step for the requests
    const steps = await pool.query<{
        request_id:string,
        seq:number,
        node:Node,
        attempt:number,
        detail:Record<string,unknown>,
        input_tokens:number,
        output_tokens:number,
        latency_ms:number
    }>(`
        select request_id, seq, node, attempt, detail, input_tokens, output_tokens, latency_ms
        from request_steps
        where request_id = any($1)
        order by request_id, seq
        `,[requestIds]);

    return steps.rows as any;
};