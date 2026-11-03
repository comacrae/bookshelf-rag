
import { Page } from "./chunker";
export function removeHyphens(input:string): string{
    return input.replace(/\-\n/g,"");
}

export function removeNulls(input:string):string{
    return input.replaceAll( "\u0000", "");
}

export function extractBody(pages:{pageNumber:number, text:string}[], bodyStartPage:number,bodyEndPage:number): Page[] {
    return pages.slice(bodyStartPage - 1, bodyEndPage);
}