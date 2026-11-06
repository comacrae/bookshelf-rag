import {TavilySearch} from "@langchain/tavily"
import z from "zod";

export const tavily = new TavilySearch({maxResults:3, tavilyApiKey:process.env.TAVILY_API_KEY});

export const TavilyResponse = z.object({
    response_time:z.number(),
    results: z.array(
        z.object({
            url:z.string(),
            title:z.string(),
            content:z.string()
        })
    )
});