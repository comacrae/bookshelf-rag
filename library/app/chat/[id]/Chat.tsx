"use client";
import { useParams } from "next/navigation"
import type { Frame, MetaChunk, MetaWeb, ChatInput } from "@/app/api/chat/route";
import type { Source } from "@/src/agent/state";
import type { Step } from "@/src/trace";
import { useState } from "react";

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
    // helper to update the last turn using the given function
    const updateLastTurn = (fn:(t:Turn) => Turn) => setTurns(prev => prev.map((t,i) => i === prev.length - 1? fn(t) : t));
    return <div>{id}</div>
}