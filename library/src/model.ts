import {OpenAIEmbeddings} from "@langchain/openai";

const embeddingDim: number | undefined = process.env.EMBEDDING_DIM ? Number(process.env.EMBEDDING_DIM): undefined;
    if(embeddingDim === undefined || Number.isNaN(embeddingDim))
        throw new Error('Embedding dim undefined in .env');

export const embeddingModel = new OpenAIEmbeddings({apiKey:process.env.OPENAI_API_KEY, model: process.env.EMBEDDING_MODEL, dimensions: embeddingDim});