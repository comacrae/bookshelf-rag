import { redirect } from "next/navigation"
import { randomUUID } from "crypto";
import { connection } from "next/server";
import { Button, Loader } from "@mantine/core";
import { Suspense } from "react";

export const NewConversation = async () => {
  await connection(); // ensures that we don't bake the convo uuid into build time by waiting for a real request
  const uuid = randomUUID();
  redirect(`/chat/${uuid}`);
}
export default function Home() {
  /* we return wrapped in suspense because Next caches components,
  causing next to build every page ahead of time. We dont want this because we dont want to 
  bake a UUID in so we have Next suspend the new convo redirect to wait for a real request
  */
  return  <Suspense fallback={<Loader/>}><NewConversation/></Suspense>
}