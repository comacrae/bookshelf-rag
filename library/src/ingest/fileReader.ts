import { readFile } from "fs/promises";
import {extractText, getDocumentProxy} from "unpdf";
import { extractBody, removeHyphens } from "./clean";
import type { Page } from "./chunker";
import { join } from "path";
/*
*   Read in a pdf, remove the table of contents, clean the hyphens, and return the results as a list of strings
*/

const CLEANING_FUNCTIONS = [removeHyphens];

export async function readPages(filepath: string): Promise<Page[]> {
    /**
     * Reads a pdf file buffer, converts it to a byte array, then reads by pages and returns as Page array
     */
    if(!process.env.CORPUS_DIR)
        throw new Error("Corpus dirpath not defined in env vars");

    //get file buffer
    const buffer = await readFile(join(process.env.CORPUS_DIR,filepath));

    //convert buffer to byte array
    const byteArr = new Uint8Array(buffer);

    // feed byte array to pdf doc proxy
    const pdf = await getDocumentProxy(byteArr);

    // extract the pages from the pdf
    const extraction = await extractText(pdf, {mergePages:false}); 

    // return the pages mapped to our custom type
    return extraction.text.map((text, idx) =>( {pageNumber:idx + 1, text}));
}

export function cleanPdf(pdf:Page[], bodyStartPage:number,bodyEndPage:number):Page[]{
    let bodyPages = extractBody(pdf,bodyStartPage, bodyEndPage);
    for(const fn of CLEANING_FUNCTIONS)
        bodyPages = bodyPages.map((page)=> ({...page, text:fn(page.text)}));
    return bodyPages;
}

