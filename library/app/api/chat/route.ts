import z from "zod";
import { config } from "@/src/config";
import { getGraph } from "@/src/agent/graph";
import type { WebResult, Source} from "@/src/agent/state";
import type { Hit } from "@/src/retrieval";
import { validateCitations } from "@/src/citations";
import { pool } from "@/src/db";

const chatRequest = z.object({
    conversationId:z.string().min(1), 
    question:z.string().trim().min(1),
    webFallback:z.boolean().optional(),
    topK:z.number().int().min(1).max(10).optional()
});
type ChatInput = {conversationId: string, question:string, webFallback:boolean, topK:number};
type MetaChunk = { n: number; book: string; page: number; pageEnd: number; content: string };
type MetaWeb   = { n: string; url: string; title: string };          // n is "w1", "w2"...
type Node = "rewrite" | "answer" | "webSearch" | "grade" | "retrieve";
type Step = {seq:number, node:Node, attempt:number, inTok:number,outTok:number, ms:number, detail:Record<string,unknown>}
export type Frame =
  | { meta: { source: Source; chunks: MetaChunk[]; web: MetaWeb[] } }    // sent once, first
  | { token: string }                                                    // sent many times
  | { done: true; invalid: string[], steps:Step[] }                                    // sent once, last
  | { error: string };                                                   // only if something breaks


async function runChat(input:ChatInput, emit:(f:Frame)=>void){
    const {question, conversationId, topK, webFallback} = input;
    const startTime = Date.now();

    // helper to convert each frame returned from model stream to an ndjson line
    let chunks:Hit[] = []; // raw results from retrieval node
    let webResults:WebResult[] = []; // raw results from websearch node
    let relevant:boolean = false;
    let attempts:number = 0;
    let source: Source = "none";
    let text: string = "";
    let ttft: number | null = null; // time to first token
    let metaSent: boolean = false; // has the meta frame gone out yet
    let inputTokens: number = 0; // running total counter
    let outputTokens: number = 0; // running total counter
    let tavilyCounter: number = 0; // track number of tavily runs
    let steps:Step[] = [];
    let lastStepTime = startTime;
    let lastInputTokenTotal = 0;
    let lastOutputTokenTotal = 0;
    const graph = await getGraph();


    const hooks = [{
        handleLLMEnd(out:any){
            inputTokens += out.llmOutput?.tokenUsage.promptTokens ?? 0;
            outputTokens += out.llmOutput?.tokenUsage.completionTokens ?? 0;
        }
    }];

    const mapChunks = (chunks:Hit[]):MetaChunk[] => chunks.map((ch,idx)=>({
        n:idx+1,
        book:ch.bookId,
        page:ch.page,
        pageEnd:ch.pageEnd,
        content:ch.content
    }));

    const mapWebResults = (webResults:WebResult[]):MetaWeb[] => webResults.map((w,idx)=>({
        n:`w${idx+1}`,
        url:w.url,
        title:w.title
    }));

    const buildMeta = () :Frame => {
        return {
            meta:{ 
                source: relevant? "books" : webResults.length > 0 ? "web" : "none", 
                chunks: relevant? mapChunks(chunks): [],
                web: !relevant? mapWebResults(webResults): []
            }
        }
    };

    const buildDetails = (node:Node, update:Record<string,any>): Record<string,any>  => {
        if(node==="rewrite"){
            return {rewritten: update.rewritten}
        }else if (node === "grade"){
            const u = update as {relevant:boolean, gradeReason:string, attempts:number};
            return {relevant: u.relevant, reason:u.gradeReason}
        }else if (node === "answer"){
            return {source: update.source}
        }else if (node === "webSearch"){
            const u = update as {webResults: WebResult[]};
            return {urls: u.webResults.map(r => r.url)};
        }else if (node === "retrieve"){
            return {chunks:update.chunks}
        }else{
            throw new Error(`Invalid node type ${node}`);
        }
    };

    try{
        const events = await graph.stream(
            {question, attempts:0, webResults:[]},
            {
                streamMode:["updates","messages"],
                configurable: {thread_id:conversationId},
                context: {webFallback, topK},
                callbacks: hooks,
                recursionLimit:25
            }
        );

        // one run of this loop per node execution
        for await (const [mode, payload] of events){
            if(mode === "updates"){
                const [nodeName, update] = Object.entries(payload)[0] as [string,any];

                // determine current attempt number for mid-turn updates
                const attemptNumber = nodeName === "answer" ? update.attempts : nodeName === "rewrite" ? attempts + 1 : attempts; 

                // extract the update information to populate the stream
                if(nodeName === "retrieve")
                    chunks = update.chunks;
                else if (nodeName === "webSearch"){
                    webResults = update.webResults;
                    tavilyCounter +=1;
                }else if (nodeName === "grade"){
                    relevant = update.relevant;
                    attempts = update.attempts;
                }else if (nodeName === "answer"){
                    source = update.source;
                }

                //push the step into the sequence array to get mid-turn updates
                const newStep = {seq: steps.length + 1, 
                    node:nodeName as Node, 
                    attempt: attemptNumber, 
                    inTok: inputTokens - lastInputTokenTotal, 
                    outTok: outputTokens - lastOutputTokenTotal,
                    ms: Date.now() - lastStepTime
                  };
                  // update step counters
                  lastInputTokenTotal
            }else if(mode === "messages"){
                const [msg, meta] = payload;
                if(meta.langgraph_node != "answer" || msg.type != "ai")
                    continue;
                const messageText = String(msg.content);
                if(!messageText)
                    continue;

                // if first peice sent in stream, send meta, record meta as sent
                if(!metaSent){
                    emit(buildMeta());
                    ttft = Date.now() - startTime; // record time to first token
                    metaSent = true;
                }

                // add this slice's text to the running log and send a text frame
                text += messageText;
                emit({token: messageText})
            }
        }

        //validate citations
        const chunkIds:string[] = chunks.map((_,i) =>`${i+1}`);
        const webIds:string[] = webResults.map((_,i) =>`w${i+1}`);

        const {invalid} = validateCitations(text,chunkIds,webIds);
        emit({done:true, invalid, steps});

        
        const elapsed = Date.now() - startTime;
        await pool.query(`
            insert into requests (conversation_id, question, input_tokens, output_tokens, attempts, latency_ms, ttft_ms, web_calls, invalid_citations, source, chat_model,status)
            values
            ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
            `,[conversationId,question,inputTokens,outputTokens,attempts,elapsed,ttft ?? elapsed, tavilyCounter,invalid.length,source,process.env.CHAT_MODEL, "ok"]);
    }catch(err){
        const elapsed = Date.now() - startTime;
        const reason = err instanceof Error ? err.message : String(err);
        await pool.query(`
            insert into requests (conversation_id, question, input_tokens, output_tokens, attempts, latency_ms, ttft_ms, web_calls, invalid_citations, source, chat_model,status, error_message)
            values
            ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,$13)
            `,[conversationId,question,inputTokens,outputTokens,attempts,elapsed,ttft ?? elapsed, tavilyCounter,0,source,process.env.CHAT_MODEL, "error", reason]);
            throw err;
    }
}

export async function POST(req:Request){
    let body:unknown;

    try{
        body = await req.json();
    }catch(err){
        return Response.json({error: "Body must be JSON"}, {status:400});
    }

    const parsed = chatRequest.safeParse(body);

    if(!parsed.success)
        return Response.json({error: "Invalid request", issues:parsed.error.issues}, {status:400});

    // pull out convo id, question, and get fallbacks
    const {conversationId, question} = parsed.data;
    const webFallback = parsed.data.webFallback ?? config.WEB_FALLBACK;
    const topK = parsed.data.topK ?? config.RETRIEVAL_TOP_K;

    //get graph, text encoder, and start time of query
    const encoder = new TextEncoder();

    // set up response stream
    const resBody = new ReadableStream({
        async start(controller){
            const emit = (e:Frame) => controller.enqueue(encoder.encode(JSON.stringify(e) + "\n"));
            try{
                await runChat({conversationId, question,webFallback,topK},emit);
            }catch(err){
                {console.log(err); emit({error: "Something went wrong"});}
            }finally{
                controller.close();
            }
        }
    });

    return new Response(resBody, {headers: {"Content-Type": "application/x-ndjson"}});
};

