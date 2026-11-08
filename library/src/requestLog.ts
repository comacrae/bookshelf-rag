import { pool } from "./db";
import type { Step } from "./trace";
import type { Source } from "./agent/state";

export type RequestRow = {
    conversationId: string,
    question: string,
    inputTokens: number,
    outputTokens: number,
    attempts: number,
    latencyMs: number,
    ttftMs: number,
    webCalls: number,
    invalidCitations: number,
    source: Source,
    chatModel: string | undefined,
    status: "ok" | "error",
    errorMessage: string | null
};

export async function saveRequest(row: RequestRow, steps: Step[]): Promise<void> {
    // one transaction: the request row and all of its steps are saved together or not at all
    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        const { rows } = await client.query(`
            insert into requests (conversation_id, question, input_tokens, output_tokens, attempts, latency_ms, ttft_ms, web_calls, invalid_citations, source, chat_model, status, error_message)
            values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
            returning id`,
            [row.conversationId, row.question, row.inputTokens, row.outputTokens, row.attempts, row.latencyMs, row.ttftMs,
             row.webCalls, row.invalidCitations, row.source, row.chatModel, row.status, row.errorMessage]);
        const requestId = rows[0].id;

        for (const step of steps) {
            await client.query(`
                insert into request_steps (request_id, seq, node, attempt, detail, input_tokens, output_tokens, latency_ms)
                values ($1, $2, $3, $4, $5, $6, $7, $8)`,
                [requestId, step.seq, step.node, step.attempt, step.detail, step.inputTokens, step.outputTokens, step.ms]);
        }

        await client.query("COMMIT");
    } catch (err) {
        await client.query("ROLLBACK");
        throw err;
    } finally {
        client.release();
    }
}
