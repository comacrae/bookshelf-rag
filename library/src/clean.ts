
export function removeHyphens(input:string): string{
    return input.replace(/\-\n/g,"");
}

export function removeTableOfContents(pages:{pageNumber:number, text:string}[], bodyStartIdx:number): {pageNumber:number,text:string}[] {
    return pages.slice(bodyStartIdx);
}