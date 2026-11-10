"use client";
import { useParams } from "next/navigation"
import type { Frame, MetaChunk, MetaWeb } from "@/app/api/chat/route";
import type { Source } from "@/src/agent/state";
import type { Step } from "@/src/trace";
import { useState } from "react";


import {Container, Stack, Paper, Text, Loader, Group, Textarea, Button, Badge, Anchor, Accordion, Timeline, Drawer, List} from "@mantine/core";

type Turn = {
    question:string,
    answer:string,
    source: Source | null,
    chunks:MetaChunk[],
    web: MetaWeb[],
    invalid:string[],
    steps:Step[],
    error:string|null,
    pending:boolean
}

const COLORS: Record<Source, {color:string, label:string}> = {
    books: {color:"teal",label:"book"},
    web: {color:"orange",label:"web"},
    none: {color:"gray",label:"no source"}
}

const SourceBadge = ({source}:{source:Source}) => {
    
    const src = COLORS[source];
    return (
        <Badge color={src.color}>{src.label}</Badge>
    )
}

const summarize = (step:Step):string => {
    switch(step.node){
        case "retrieve":
            return `${(step.detail.chunkIds as string[]).length} chunks retrieved`;
        case 'rewrite':
            return `rewrote to "${step.detail.rewritten}"`;
        case 'grade':
            return step.detail.relevant ? `relevant` : `not relevant: ${step.detail.reason}`;
        case 'answer':
            return step.detail.source === "none" ? `no answer found` : `answered from the ${step.detail.source}`;
        case 'webSearch':
            return `${(step.detail.urls as string[]).length} web results`;
        default:
            return '';
    }
};


export const Chat = () => {
    const {id} = useParams<{id:string}>();
    const [turns, setTurns] = useState<Turn[]>([]);
    const [input, setInput] = useState<string>("");
    const [selected, setSelected] = useState<MetaChunk |null>(null);
    
    // if busy, return early
        // turns.at(-1) is undefined if turns is empty, so it would return false
    const busy = turns.at(-1)?.pending ?? false;

    // helper to update the last turn using the given function
    const updateLastTurn = (fn:(t:Turn) => Turn) => setTurns(prev => prev.map((t,i) => i === prev.length - 1? fn(t) : t));
    const applyFrame  = (f:Frame) => {
        // helper function to update the turn according to the frame that's coming in
        if("meta" in f){
            updateLastTurn(t => ({...t, chunks:f.meta.chunks, web:f.meta.web, source:f.meta.source}));
        }else if("token" in f){
            updateLastTurn(t => ({...t, answer: t.answer + f.token}));
        }else if ("done" in f){
            updateLastTurn(t=> ({...t, steps:f.steps, invalid:f.invalid, pending: false}));
        }else if("error" in f){
            updateLastTurn(t => ({...t, error: f.error, pending: false}))
        }
    }

    const renderAnswer = (t:Turn) => {
        /*
        * Renders text or hyperlinked text anchored to citation
        */

        // split answer with citation regex capturing citations
        const matchCitation = /(\[w?\d+\])/g; // match [w1] or [1]

        const peices = t.answer.split(matchCitation);

        //for each piece split on citations
        return peices.map((p,i)=>{
            if((!/^\[\w+\]$/.test(p))) // if not a citation like [w1] or [1]
                return p; // it's regular text; just return as is

            const citation = p.slice(1,-1); // remove start and end square brackets

            if(t.invalid.includes(citation))
                return null; // skip invalid citations 

            if(citation.includes('w')){ // if a web id
                const site = t.web.find(w => w.n === citation)
                if(site){
                    return <Anchor key={i} href={site.url} target="_blank" rel="noreferrer">{`[${citation}]`}</Anchor>
                }
            }

            const parsedChunkId = Number.parseInt(citation);
            const chunk = t.chunks.find(ch => ch.n === parsedChunkId);
            if(chunk){
                return <Anchor key={i} component="button" onClick={()=>setSelected(chunk)}>{`[${citation}]`}</Anchor>
            }

            return p; // fallback for nothing matching; just return the text as is
        })
    }

    const send = async (e:React.SubmitEvent<HTMLFormElement>) => {
        e.preventDefault(); // dont let form wipe out state by reloading page
        const question = input.trim();

        

        if(busy || question.length === 0) 
            return;

        // init turn
        setTurns(prev => [...prev, {
            question,
            answer:"",
            source:null,
            chunks:[],
            web:[],
            invalid:[],
            steps:[],
            error:null,
            pending:true
        }])

        setInput(""); // clear question input box

        

        const payload = {
            conversationId: id,
            question,
        }
        // fetch response
        try{
            const res = await fetch("/api/chat",
                {
                    method:'post',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(payload)
                });

            // if 400 error, return
            if(!res.ok){
                const result = await res.json();
                updateLastTurn((t) => ({...t, error:result.error}));
                return
            }

            const reader = res.body!.getReader(); // stream reader
            const decoder = new TextDecoder(); // convert bytes to utf-8
            let buffer = "";
            let {value, done} = await reader.read();
            // read stream as it comes in
            while(!done){
                // fill in token buffer
                buffer += decoder.decode(value, {stream:true});
                // split by new line
                const lines = buffer.split("\n"); // jsonnd input format
                buffer = lines.pop() ?? ""; // if theres an unfinshed line, assign to buffer
                for(const line of lines)
                    applyFrame(JSON.parse(line) as Frame);
                ({value,done} = await reader.read());
            }
        }catch(err){
            const e = err as Error;
            updateLastTurn((t) => ({...t, error:e.message}));

        }finally{
            updateLastTurn((t) => ({...t, pending:false})); // always end the loop
        }
    }
    
    return (
        <Container size="md" py="xl">
            <Stack gap="md">
                <Text size="xl" fw={800}>
                    Ask a question
                </Text>
                <Text size="lg">
                   Ask a question about git, javascript, data structs/algorithms, or operating systems. The chatbot will
                   attempt to answer you by pulling the top N most relevant chunks from a selection of pre-scraped books.
                   If it can't find the answer and web search is active, it will find you an answer from the web. 
                </Text>
                <Text fw={600}>Books</Text>
<List size="sm">
    <List.Item>Algorithms by Jeff Erickson</List.Item>
    <List.Item>Operating Systems: Three Easy Pieces by Remzi H. Arpaci-Dusseau and Andrea C. Arpaci-Dusseau</List.Item>
    <List.Item>Eloquent JavaScript, 4th edition by Marijn Haverbeke</List.Item>
    <List.Item>Pro Git, 2nd edition by Scott Chacon and Ben Straub</List.Item>
</List>
                {turns.map((t,i)=>(
                    <Paper key={i} withBorder p="md">
                        <Text fw={600}>{t.question}</Text>
                        {t.source && <SourceBadge source={t.source}/>} 
                        {t.pending && t.answer === "" ? <Loader/> : <Text style={{whiteSpace:"pre-wrap"}}>{renderAnswer(t)}</Text>}
                        {t.error && <Text c="red">{t.error}</Text>}
                        {t.steps.length > 0 && (
                            <Accordion>
                            <Accordion.Item value="log">
                                <Accordion.Control>How this answer was reached</Accordion.Control>
                                <Accordion.Panel>
                                    <Timeline bulletSize={14} lineWidth={2}>
                                        {t.steps.map((s)=>
                                            <Timeline.Item 
                                            key={s.seq} 
                                            title={`Attempt #${s.attempt}: ${s.node} node`} >
                                                <Text size="sm">{summarize(s)}</Text>
                                                <Text size="xs" c="dimmed">{s.ms} ms</Text>
                                            </Timeline.Item>
                                        )}
                                    </Timeline>
                                </Accordion.Panel>
                            </Accordion.Item>
                            </Accordion>
                        )}
                    </Paper>
                ))}
            </Stack>
            <Drawer opened={selected !== null} onClose={()=>setSelected(null)} position="right" size="lg" title={`Citation [${selected?.n}]`}>
                {selected && 
                    <>
                       <Text fw={600}>{selected.page === selected.pageEnd ?`${selected.book} p. ${selected.page}` :`${selected.book}  p. ${selected.page}-${selected.pageEnd}`}</Text>
                        <Text style={{whiteSpace:"pre-wrap"}}>{selected.content}</Text>
                    </>}
            </Drawer>
            <form onSubmit={send} >
                <Group align="flex-end" mt="md">
                    <Textarea style={{flex:1}} autosize minRows={2} disabled={busy} value={input} onChange={(e) => setInput(e.currentTarget.value)}>

                    </Textarea>
                    <Button type="submit" loading={busy}>Ask</Button>
                </Group>
            </form>
        </Container>
    )
}