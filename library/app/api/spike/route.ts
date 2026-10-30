import {ChatOpenAI} from "@langchain/openai"
/**
 * Proves that the pipe works e2e for fetching a response from openai model and streaming the bytes from the 
 * http response and showing them on the browser
 */

/**
 * 
 * @param req The problem

A model answer takes about 5–15 seconds to finish generating, but the first word is ready after about half a second. If your route waits for the whole answer before replying, the user stares at a blank box for ten seconds and assumes it's broken. Streaming sends each piece of text to the browser the moment the model produces it.

That's why your requests table has a ttft_ms column, for "time to first token". Total latency is how long the answer takes. TTFT is how long the user waits before anything happens, and that's the number they actually feel.

Streaming has to survive four handoffs, and each one speaks a different format. If any single handoff buffers, meaning it collects everything and sends it at once, the whole chain stops streaming and you get no error message. The spike proves the pipe works end to end before you put a LangGraph graph behind it in M4.

 OpenAI            your route (server)                        browser
┌───────┐  chunks  ┌───────────────┐  bytes   ┌──────┐  bytes  ┌──────────────┐  text  ┌──────────┐
│ model │ ───────▶ │ model.stream()│ ───────▶ │ HTTP │ ──────▶ │ res.body     │ ─────▶ │ setText  │
│       │          │ async iterator│ Readable │ resp │         │ .getReader() │ Text   │ (React)  │
└───────┘          └───────────────┘ Stream + └──────┘         └──────────────┘ Decoder└──────────┘
                     AIMessageChunk  TextEncoder                                        screen
                     objects  ────────▶ "1, " ─────▶ 0x31 0x2c ─────▶ "1, " ──────────▶ "1, "

Where we're trying to end up

You click a button on a throwaway page and watch this:

streamed (what you want)             buffered (the silent failure)
t=0.0s  click                         t=0.0s  click
t=0.5s  1                             t=0.5s  (nothing)
t=0.6s  1, 2                          ...
t=0.7s  1, 2, 3                       t=4.0s  (nothing)
...                                   t=4.1s  1, 2, 3, ... 20   ← all at once
t=4.1s  1, 2, 3, ... 20

Both columns end with the same text. The spike passes only if you see the left column. Text that is correct at the end isn't enough.

The steps to get there

1. Create the route file. In Next's App Router, a route handler is a file named route.ts inside app/, and its folder path becomes the URL. So app/api/spike/route.ts is served at /api/spike. You export a function named after the HTTP method, here POST. I checked your installed Next 16 docs: this API hasn't changed, and POST handlers are never cached, so nothing can replay an old answer. Next also loads .env on its own, so CHAT_MODEL and OPENAI_API_KEY are already available with no --env-file. The question to settle: why POST rather than GET, when you're only "getting" an answer? Think about where the prompt travels and how long it can be.
2. Read the prompt from the request. The browser sends JSON like { "prompt": "Count to 20 slowly." }. req.json() parses it, and it's async because the body arrives over the network.
3. Call the model in streaming mode. model.invoke(prompt) waits and returns one finished message. model.stream(prompt) returns an async iterator, an object you loop over with for await, where each loop gives you the next piece as it arrives. Each piece is an AIMessageChunk, and its text is in .content. As in vec.ts, pass the model name explicitly from CHAT_MODEL.
4. Wrap the iterator in a ReadableStream. An HTTP response body has to be a web ReadableStream of bytes, not LangChain objects and not strings. You create one with a start(controller) function. Inside it you loop over the model's chunks, turn each one's text into bytes with a TextEncoder, push them out with controller.enqueue(...), and call controller.close() when the loop ends. What happens in the browser if you forget close()? Think about what the reader's done would be waiting for.
5. Return a Response. new Response(body, { headers }), with Content-Type: text/plain; charset=utf-8 so the browser decodes it as text.
6. Test the server alone, before you build any UI. Use curl, so you know which half is broken if something fails:
curl -N -X POST localhost:3000/api/spike -d '{"prompt":"Count to 20 slowly."}'
   -N turns off curl's own buffering. Without it, curl itself would cause the buffered failure and you'd blame your route. If numbers trickle into the terminal, the server half works.
7. Build the client page. Put it at app/spike/page.tsx. It needs "use client" as the first line. Components in app/ run on the server by default, and a server component can't hold state or respond to clicks. The button handler does the reverse of step 4: fetch the route, get a reader from res.body, loop on reader.read() until done, decode each chunk of bytes with a TextDecoder, and append the text to state. The question here: why does the guide write setText(t => t + piece) instead of setText(text + piece)? Hint: the loop runs inside one click handler that started when text was "". What value of text does that handler see on the 15th chunk?
8. Clean up. Unlike spike/, these files live in app/, so they aren't gitignored. Delete them after the checkpoint passes, and commit only the notes.md line.

What I need from you

Write app/api/spike/route.ts (steps 1–5), run npm run dev, and pass the curl test in step 6 before you start the page. Then write app/spike/page.tsx (step 7) and confirm you see the left column.

Here are the syntax shapes on a parallel toy example: a route that streams the words of a fixed sentence with a short pause between them.

// route shape
export async function POST(req: Request) {
  const { sentence } = await req.json();
  return new Response(body, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}

// ReadableStream shape: source is any async iterable
const encoder = new TextEncoder();
const body = new ReadableStream({
  async start(controller) {
    for await (const word of source) controller.enqueue(encoder.encode(word));
    controller.close();
  },
});

// client reader shape (inside an async click handler)
const reader = res.body!.getReader();
const decoder = new TextDecoder();
while (true) {
  const { value, done } = await reader.read();
  if (done) break;
  // decoder.decode(value) → a string piece
}

Your version replaces source with the model's stream. Remember that a chunk is an object and you want its .content. Leave comments wherever you're unsure, and answer the two step questions (1 and 7) in comments too.
 */

export async function POST(req:Request) {
    // take in the query sentence from the req body

    const {prompt} = await req.json(); // read body stream as bytes -> decode bytes to string -> JSON.parse the string

    // call the model in streaming mode
    const llm = new ChatOpenAI({model:process.env.CHAT_MODEL, apiKey: process.env.OPENAI_API_KEY});

    const modelStream = await llm.stream(prompt);

    // init encoder to stream the parsed response to the caller
    const encoder = new TextEncoder();

    // init the readable stream that will encode the model response's chunks
    const responseBody = new ReadableStream({
        async start(controller){
            for await(const chunk of modelStream){ // as the model's chunks come in
                // fetch the text and encode it to bytes
                const chunkContent: string = chunk.text;
                // encode to bytes
                const encodedChunk = encoder.encode(chunkContent);
                // append to outgoing stream
                controller.enqueue(encodedChunk);
            }
            controller.close();
        }
    });

    return new Response(responseBody, {headers: {"Content-Type": "text/plain; charset=utf-8"}});
}