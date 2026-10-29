
export function removeHyphens(input:string): string{
    return input.replace(/\-\n/g,"");
}

export function removeTableOfContents(pages:string[], tocStartIdx:number): string[] {
    return pages.slice(tocStartIdx);
}