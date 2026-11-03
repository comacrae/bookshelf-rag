import {expect, it, describe} from "vitest";
import { getChunks, Page } from "../src/ingest/chunker";
import { getEncoding } from "js-tiktoken";

const encoder = getEncoding("cl100k_base");
// each word wX_Y is 4 tokens
const targetTokens = 400;
const tokenOverlap = 0;
// helper function to make deterministic word strings we can predict length + outcome
const getWords = (prefix:string, count:number) => Array.from({length:count}, (_,i) => `${prefix}_${i}`).join();
const getPages= (wordCounts:number[]) => wordCounts.map((count, idx) => ({pageNumber:idx+ 1, text:getWords(`w${idx}_`,count)}));

describe("getChunks", () => {
    it("gives a chunk that crosses a page boundry both page numbers", () => {
        const pages= getPages([30,30]); // two pages of 30 words each, and each word is 4 tokens, so 120 tokens, 120 tokens

        const chunks = getChunks(pages,{targetTokens, overlapTokens:tokenOverlap});

        expect(chunks.length).toBe(1);
        expect(chunks[0].page).toBe(1);
        expect(chunks[0].pageEnd).toBe(2);
        expect(chunks[0].content).toBe(pages[0].text + "\n" + pages[1].text + "\n");
    })
})