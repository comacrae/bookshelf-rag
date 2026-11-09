"use client";
import { useParams } from "next/navigation"
import type { Frame, MetaChunk, MetaWeb } from "@/app/api/chat/route";
import type { Source } from "@/src/agent/state";
import type { Step } from "@/src/trace";
import { useState } from "react";

import {Container, Stack, Paper, Text, Loader, Group, Textarea, Button} from "@mantine/core";

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

export const Chat = () => {
    const {id} = useParams<{id:string}>();
    const [turns, setTurns] = useState<Turn[]>([]);
    const [input, setInput] = useState("");
    
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
                {turns.map((t,i)=>(
                    <Paper key={i} withBorder p="md">
                        <Text fw={600}>{t.question}</Text>
                        {t.pending && t.answer === "" ? <Loader/> : <Text style={{whiteSpace:"pre-wrap"}}>{t.answer}</Text>}
                        {t.error && <Text c="red">{t.error}</Text>}
                    </Paper>
                ))}
            </Stack>
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