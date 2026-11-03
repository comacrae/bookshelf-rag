import {expect, it, describe} from "vitest";
import { getChunks} from "../src/ingest/chunker";
import { getEncoding } from "js-tiktoken";

const encoder = getEncoding("cl100k_base");
// each word wX_Y is 4 tokens
const targetTokens = 400;
const tokenOverlap = 0;
// helper function to make deterministic word strings we can predict length + outcome
const getWords = (prefix:string, count:number) => Array.from({length:count}, (_,i) => `${prefix}_${i}`).join(" ");
const getPages= (wordCounts:number[]) => wordCounts.map((count, idx) => ({pageNumber:idx+ 1, text:getWords(`w${idx + 1}`,count)}));

describe("getChunks", () => {
    it("gives a chunk that crosses a page boundry both page numbers", () => {
        const pages= getPages([30,30]); // two pages of 30 words each, and each word is 4 tokens, so 120 tokens, 120 tokens

        const chunks = getChunks(pages,{targetTokens, overlapTokens:tokenOverlap});

        expect(chunks.length).toBe(1);
        expect(chunks[0].page).toBe(1);
        expect(chunks[0].pageEnd).toBe(2);
        expect(chunks[0].content).toBe(pages[0].text + "\n" + pages[1].text + "\n");
    });

    it("gives a chunk that doesn't cross a boundry the same start and end page number", () => {
        const pages = getPages([101]); // single page with 404 tokens
        const chunks = getChunks(pages,{targetTokens, overlapTokens:tokenOverlap});

        expect(chunks.length).toBe(2);
        expect(chunks[0].page).toBe(1);
        expect(chunks[0].pageEnd).toBe(1);
    });

    it("never creates a chunk bigger than targetTokens", () => {
        const pages = getPages([2000]); 
        const chunks = getChunks(pages,{targetTokens, overlapTokens:tokenOverlap});

        expect(chunks.length).toBeGreaterThan(1);
        for(const chunk of chunks){
            expect(encoder.encode(chunk.content).length).toBeLessThanOrEqual(targetTokens);
        }
    });

    it("consecutive chunks share overlap", () => {
        const pages = getPages([900]); 
        const chunks = getChunks(pages,{targetTokens, overlapTokens:60});

        const tokens = encoder.encode(pages[0].text + "\n");
        const shared = encoder.decode(tokens.slice(340,400));

        expect(chunks[0].content.endsWith(shared)).toBe(true);
        expect(chunks[1].content.startsWith(shared)).toBe(true);
    });
    it("tags a chunk with the page where its overlap starts", () => {
        // Page 1 is 360 tokens, so the second window starts at token 340, still on page 1.
        const pages = [{ pageNumber: 1, text: words(1, 90) }, { pageNumber: 2, text: words(2, 30) }];
        const out = getChunks(pages, { targetTokens: 400, overlapTokens: 60 });
        expect(out[1].content).toContain("w2_0");
        expect(out[1].page).toBe(1);
        expect(out[1].pageEnd).toBe(2);
      });
    
      it("doesn't add a chunk of only overlap when the text ends inside the first window", () => {
        // 340 tokens plus the page's newline: the first window holds it all.
        const out = getChunks([{ pageNumber: 1, text: words(1, 85) }], { targetTokens: 400, overlapTokens: 60 });
        expect(out.length).toBe(1);
      });


})