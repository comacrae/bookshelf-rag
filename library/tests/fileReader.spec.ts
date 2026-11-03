import {describe, it,expect} from "vitest";
import { cleanPdf } from "../src/ingest/fileReader";
import { Page } from "../src/ingest/chunker";

describe("cleanPdf", () => {
    it("maintains pageNumbers and cleans pages as expected", () => {
        const mockPdf: Page[] = [{pageNumber:1,text:"Contents"},{pageNumber:2, text:"to-\ngether"}, {pageNumber:3, text:"Index"}];
        expect(cleanPdf(mockPdf,2,2)).toStrictEqual([{pageNumber:2,text:"together"}]);
    });
});