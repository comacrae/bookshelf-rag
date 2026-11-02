
import { Page } from "../chunker";
export function removeHyphens(input:string): string{
    return input.replace(/\-\n/g,"");
}

export function removeTableOfContents(pages:{pageNumber:number, text:string}[], bodyStartIdx:number): Page[] {
    return pages.slice(bodyStartIdx);
}