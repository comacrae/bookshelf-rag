
import { getGraph } from "./agent/graph";
import { validateCitations } from "./citations";
import type { MetaChunk, MetaWeb } from "@/app/api/chat/route";
import type { Source } from "@/src/agent/state";
import type { Step, Node } from "@/src/trace";
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

type RequestRow = { id: string; question: string; source: Source };
type ChunkRow = { id: string; book_id: string; page: number; page_end: number; content: string };

const buildTurn = async (request: RequestRow, steps: Step[], answer: string): Promise<HistoryTurn> => {
    // last retreive holds the correct chunk ids
    const chunkIds = (steps.findLast(s => s.node === "retrieve")?.detail.chunkIds as string[] | undefined) ?? [];
    // webSearch runs at most once per turn so we dont need to filter for last
    const urls = (steps.find(s => s.node === "webSearch")?.detail.urls as string[] | undefined) ?? [];

    // look up only this turn's chunks; skip the query when there are none
    const { rows } = chunkIds.length
        ? await pool.query<ChunkRow>(
            `select id, book_id, page, page_end, content from chunks where id = any($1)`, [chunkIds])
        : { rows: [] as ChunkRow[] };

    // rows come back in any order, so walk chunkIds to keep [1] = first retrieved chunk, like the live meta frame
    const byId = new Map(rows.map(r => [r.id, r]));          // bigint id comes back as a string, same as chunkIds
    const chunks: MetaChunk[] = chunkIds.flatMap((id, i) => {
        const r = byId.get(id);
        return r ? [{ n: i + 1, book: r.book_id, page: r.page, pageEnd: r.page_end, content: r.content }] : [];
    });

    // titles were never stored; the renderer only needs url
    const web: MetaWeb[] = urls.map((url, i) => ({ n: `w${i + 1}`, url, title: url }));

    // invalid ids weren't saved, only their count, so recompute exactly like route.ts:131-134
    const { invalid } = validateCitations(answer, chunkIds.map((_, i) => `${i + 1}`), web.map(w => w.n));

    return {
        question: request.question,
        answer,
        source: request.source,
        chunks: request.source === "books" ? chunks : [],   // same rule as buildMeta: chunks only for book answers
        web: request.source !== "books" ? web : [],
        invalid,
        steps,
    };
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

    // group the rows by request
    const stepMap = new Map<string, Step[]>();
    for(const step of steps.rows){
        const stepList = stepMap.get(step.request_id) ??  [];
        const newStep:Step = {
            seq:step.seq,
            node:step.node,
            attempt:step.attempt,
            detail:step.detail,
            inputTokens:step.input_tokens,
            outputTokens:step.output_tokens,
            ms:step.latency_ms
        }
        stepMap.set(step.request_id, [...stepList, newStep]);

    }

     // answers live in the checkpoint as [Human, AI, Human, AI, ...]; keep just the AI ones
     const graph = await getGraph();
     const snapshot = await graph.getState({ configurable: { thread_id: conversationId } });
     const answers = ((snapshot.values.messages ?? []) as { type: string; content: unknown }[])
         .filter(m => m.type === "ai")
         .map(m => String(m.content));
 
     // line up from the END: the newest answer always pairs with the newest request,
     // even if the thread has older turns from before request logging existed
     const offset = answers.length - requests.rows.length;
 
     const turns: HistoryTurn[] = [];
     for (const [i, request] of requests.rows.entries()) {
         turns.push(await buildTurn(request, stepMap.get(request.id) ?? [], answers[i + offset] ?? ""));
     }
     return turns;
};