import {Chat} from "./Chat";
import { Suspense } from "react";
import { Loader } from "@mantine/core";
export default function Page(){
    return <Suspense fallback={<Loader/>}><Chat/></Suspense>
}