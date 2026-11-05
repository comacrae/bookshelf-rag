import type { Hit } from "./retrieval";

export const rrf = (lists:Hit[][],k=60): Hit[] =>  {
    /**
     * Perform reciprocal rank fusion to get hits ranked by different scoring metrics
     */
    //make an empty points table
    const points = new Map<string, number>(); //<chunkId, score>
    const hitsMap = new Map<string, Hit>();
    // for each list
    for(const list of lists){
        // for each chunk
        for(const [idx, chunk] of list.entries()){
            //add score for that chunk = 1 / (k + chunk's position in list)
            hitsMap.set(chunk.id,chunk);
            const existingScore = points.get(chunk.id) ?? 0;
            const score = 1 / (k + idx + 1);
            points.set(chunk.id, (existingScore + score ));
        }
    }

    return [...points.entries()]
    .sort((a,b)=> b[1] - a[1]) // sort by score desc
    .map(([chunkIdx, score]) => ({...hitsMap.get(chunkIdx)!, score}));
}