import z from "zod";
import { config } from "@/src/config";
import { getGraph } from "@/src/agent/graph";
import type { WebResult, Source} from "@/src/agent/state";
import type { Hit } from "@/src/retrieval";

const chatRequest = z.object({
    conversationId:z.string().min(1), 
    question:z.string().trim().min(1),
    webFallback:z.boolean().optional(),
    topK:z.number().int().min(1).max(10).optional()
});

type MetaChunk = { n: number; book: string; page: number; pageEnd: number; content: string };
type MetaWeb   = { n: string; url: string; title: string };          // n is "w1", "w2"...

export type Frame =
  | { meta: { source: Source; chunks: MetaChunk[]; web: MetaWeb[] } }    // sent once, first
  | { token: string }                                                    // sent many times
  | { done: true; invalid: string[] }                                    // sent once, last
  | { error: string };                                                   // only if something breaks


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
    const startTime = Date.now();
    const graph = await getGraph();
    const encoder = new TextEncoder();

    // set up response stream
    const resBody = new ReadableStream({
        async start(controller){
            // helper to convert each frame returned from model stream to an ndjson line
            const emit = (e:Frame) => controller.enqueue(encoder.encode(JSON.stringify(e) + "\n"));
            let chunks:Hit[] = []; // raw results from retrieval node
            let webResults:WebResult[] = []; // raw results from websearch node
            let relevant:boolean = false;
            let attempts:number = 0;
            let source: Source = "none";
            let text: string = "";
            let ttft: number | null = null; // time to first token
            let metaSent: boolean = false; // has the meta frame gone out yet
            let inputTokens: number = 0;
            let outputTokens: number = 0; 

        }
    })
};