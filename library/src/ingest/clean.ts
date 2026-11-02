
import { Page } from "../chunker";
export function removeHyphens(input:string): string{
    return input.replace(/\-\n/g,"");
}

export function removeTableOfContents(pages:{pageNumber:number, text:string}[], bodyStartPage:number): Page[] {
    return pages.slice(bodyStartPage - 1);
}