export type Config = {
    WEB_FALLBACK:boolean,
    RETRIEVAL_TOP_K:number
}
const loadConfig = (): Config => {
    const webFallback : string = process.env.WEB_FALLBACK ?? "true";

    if(!["true","false"].includes(webFallback))
        throw new Error(`Invalid value for WEB_FALLBACK envvar ${webFallback}`)

    const WEB_FALLBACK:boolean = webFallback === "false";

    const topK = Number(process.env.RETRIEVAL_TOP_K) ?? "5";
    if(!Number.isInteger(topK) || topK < 1 )
        throw new Error(`Invalid value for RETRIEVAL_TOP_K envvar ${process.env.RETRIEVAL_TOP_K}`)

    const RETRIEVAL_TOP_K:number = topK;
    return {
        WEB_FALLBACK,
        RETRIEVAL_TOP_K
    }
}

export const config = loadConfig();