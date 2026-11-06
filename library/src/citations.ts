export const validateCitations = (text:string, chunkIds:string[], webIds:string[]) => {
    /*
    input:

    text:      "Set rerere.enabled [1]. It reuses resolutions [2][7]. See also [w1]."
    chunkIds:  [1, 2, 3, 4, 5]        ← the display numbers that were shown, not database IDs
    webIds:    []                     ← no web results this turn

    returns:   { isValid: false, invalid: ["7", "w1"] }
    */
    const invalid:string[] = [];

    // matches a literal [ , optional w , one or more digits followed by ], and captures digits
    const matchCitation = /\[(w?\d+)\]/g 
    const validCitations = chunkIds.concat(webIds);
    for(const m of text.matchAll(matchCitation)){
        const [_, match] = m;
        if(!validCitations.includes(match))
            invalid.push(match)
    }
    return {isValid: invalid.length === 0, invalid};
}