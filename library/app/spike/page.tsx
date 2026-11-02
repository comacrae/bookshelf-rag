"use client";
import { useState } from "react";
export default function Page(){
    const [response, setResponse] = useState("");
    const [prompt, setPrompt] = useState("");
    async function load(e:React.SubmitEvent<HTMLFormElement>) {
        e.preventDefault();
        setResponse("");
        const res = await fetch("/api/spike",{method:'POST', body: JSON.stringify({prompt}),  headers: {'Content-Type':'application/json'}});
        const reader = res.body!.getReader();
        const decoder = new TextDecoder();
        let {value, done} = await reader.read();
        while(!done){
            const decoded = decoder.decode(value, {stream:true});
            setResponse((prev => prev + decoded));
            ({value,done} = await reader.read());
        }
    }
    return (
    <main>
        <form onSubmit={load}>
            <input value={prompt} onChange={(e)=> {setPrompt(e.target.value)}}/>
            <button type="submit">Search</button>
            <p>{response}</p>
        </form>
        </main>
        );


}