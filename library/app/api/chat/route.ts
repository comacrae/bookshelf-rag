import z from "zod";
import { config } from "@/src/config";
import { getGraph } from "@/src/agent/graph";
import type { WebResult, Source} from "@/src/agent/state";
import type { Hit } from "@/src/retrieval";
import { validateCitations } from "@/src/citations";
import { createTrace } from "@/src/trace";
import type { Node, Step } from "@/src/trace";
import { saveRequest } from "@/src/requestLog";
import { loadHistory } from "@/src/history";

const chatRequest = z.object({
    conversationId:z.string().min(1), 
    question:z.string().trim().min(1),
    webFallback:z.boolean().optional(),
    topK:z.number().int().min(1).max(10).optional()
});
type ChatInput = {conversationId: string, question:string, webFallback:boolean, topK:number};
export type MetaChunk = { n: number; book: string; page: number; pageEnd: number; content: string };
export type MetaWeb   = { n: string; url: string; title: string };          // n is "w1", "w2"...
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
    let tavilyCounter: number = 0; // track number of tavily runs
    const trace = createTrace(startTime); // per-node steps and token totals
    const graph = await getGraph();


    const hooks = [{
        handleLLMEnd(out:any){
            trace.addTokens(
                out.llmOutput?.tokenUsage?.promptTokens ?? 0,
                out.llmOutput?.tokenUsage?.completionTokens ?? 0
            );
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
                const [nodeName, update] = Object.entries(payload)[0] as [Node,any];

                // keep what the meta frame and the requests row need
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

                trace.onUpdate(nodeName, update);
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
        emit({done:true, invalid, steps: trace.getSteps()});

        const elapsed = Date.now() - startTime;
        await saveRequest({
            conversationId, question, ...trace.getTotals(), attempts,
            latencyMs: elapsed, ttftMs: ttft ?? elapsed, webCalls: tavilyCounter,
            invalidCitations: invalid.length, source, chatModel: process.env.CHAT_MODEL,
            status: "ok", errorMessage: null
        }, trace.getSteps());
    }catch(err){
        const elapsed = Date.now() - startTime;
        await saveRequest({
            conversationId, question, ...trace.getTotals(), attempts,
            latencyMs: elapsed, ttftMs: ttft ?? elapsed, webCalls: tavilyCounter,
            invalidCitations: 0, source, chatModel: process.env.CHAT_MODEL,
            status: "error", errorMessage: err instanceof Error ? err.message : String(err)
        }, trace.getSteps());
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

export async function GET(req:Request){
    const conversationId = new URL(req.url).searchParams.get("conversationId");

    if(!conversationId)
        return Response.json({error: "Conversation id missing from request"},{status:400});

    const history = await loadHistory(conversationId);
    return Response.json({turns:history});

}

