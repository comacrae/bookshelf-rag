"use client";
import { useParams } from "next/navigation"

export const Chat = () => {
    const p = useParams<{id:string}>();
    return <div>{p.id}</div>
}