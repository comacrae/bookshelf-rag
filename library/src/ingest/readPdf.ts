import { readFile } from "fs/promises";
import {extractText, getDocumentProxy} from "unpdf";
import { removeTableOfContents, removeHyphens } from "./clean";
import type { Page } from "../chunker";
/*
*   Read in a pdf, remove the table of contents, clean the hyphens, and return the results as a list of strings
*/

async function readPages(filepath: string): Promise<Page[]> {
    /**
     * Reads a pdf file buffer, converts it to a byte array, then reads by pages and returns as Page array
     */

    //get file buffer
    const buffer = await readFile(filepath);

    //convert buffer to byte array
    const byteArr = new Uint8Array(buffer);

    // feed byte array to pdf doc proxy
    const pdf = await getDocumentProxy(byteArr);

    // extract the pages from the pdf
    const extraction = await extractText(pdf, {mergePages:false}); 

    // return the pages mapped to our custom type
    return extraction.text.map((text, idx) =>( {pageNumber:idx + 1, text}));
}

function cleanPdf(pdf:Page[], bodyStartIdx:number):Page[]{
    let bodyPages = removeTableOfContents(pdf,bodyStartIdx);
    for(let i = 0; i < pdf.length; i++){
        bodyPages[i].text = removeHyphens(pdf[i].text);
    }
    return bodyPages;
}
