import { citationsFrom, retrieve, type Citation, type RetrievedChunk } from "@wiki/corpus";

import { env } from "../env.ts";
import { db } from "../lib/db.ts";
import { embedder } from "../lib/embedder.ts";

/** One question or one Answer in a conversation, as the chat model sees it. */
export interface Turn {
  role: "user" | "assistant";
  content: string;
}

export interface AnswerStream {
  grounded: boolean;
  citations: Citation[];
  deltas: AsyncIterable<string>;
}

const CHAT_MODEL_URL = "https://openrouter.ai/api/v1/chat/completions";

const ROLE = [
  "You are the wiki agent for ScottyLabs Labrador, a student software committee",
  "at Carnegie Mellon University. Answer in GitHub-flavoured markdown, and keep",
  "answers short unless asked for detail.",
].join(" ");

const UNGROUNDED = [
  ROLE,
  "You have not been given any Labrador documentation to read, so say plainly",
  "when you are guessing or unsure rather than inventing committee specifics",
  "such as names, dates, or links.",
].join(" ");

const GROUNDED = [
  ROLE,
  "Base your Answer on the documentation below rather than guessing. If it does",
  "not cover the question, say so rather than inventing committee specifics such",
  "as names, dates, or links.",
].join(" ");

const REWRITE = [
  "Rewrite the member's latest question as a standalone documentation search",
  "query that makes sense without the earlier conversation. Return only the",
  "query, with no quotes or explanation. If it is already standalone, return it",
  "unchanged.",
].join(" ");

/** One frame of a streamed Answer, as OpenRouter writes it on the wire. */
interface DeltaFrame {
  choices?: Array<{ delta?: { content?: string | null } }>;
  error?: { message?: string };
}

interface CompletionFrame {
  choices?: Array<{ message?: { content?: string | null } }>;
  error?: { message?: string };
}

/**
 * Opens a streamed Answer to a conversation.
 *
 * Awaiting the returned promise waits only for the chat model to accept the
 * request, so a caller can still report a plain HTTP failure before it commits
 * to streaming. Iterating the result then yields the Answer as text arrives.
 *
 * Citations are computed from the Chunks retrieval returned, never written by
 * the model. See ADR-0002.
 *
 * Every turn given is sent, so the caller decides how much conversation the
 * prompt — and the bill — carries. A follow-up is rewritten into a standalone
 * query before retrieval; that rewrite never changes the turns shown to the
 * member or sent as the Answer's conversation.
 */
export async function openAnswerStream(turns: Turn[], signal: AbortSignal): Promise<AnswerStream> {
  const chunks = await similarChunks(turns, signal);
  const citations = citationsFrom(chunks);
  const response = await fetch(CHAT_MODEL_URL, {
    method: "POST",
    signal,
    headers: {
      Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: env.OPENROUTER_MODEL,
      messages: [{ role: "system", content: systemPrompt(chunks) }, ...turns],
      stream: true,
      // Reasoning is on by default for this model, so it has to be switched off
      // explicitly for an Answer to start arriving instantly. `enabled: false`
      // rather than `effort: "none"`: the model lists efforts max/high/low only,
      // and would reject "none".
      reasoning: { enabled: false },
    }),
  });

  if (!response.ok || !response.body) {
    throw new Error(`OpenRouter returned ${response.status}: ${await response.text()}`);
  }

  return {
    grounded: chunks.length > 0,
    citations,
    deltas: readDeltas(response.body),
  };
}

/** Retrieves the Chunks most similar to what the member meant, or none. */
async function similarChunks(turns: Turn[], signal: AbortSignal): Promise<RetrievedChunk[]> {
  const question = await retrievalQuery(turns, signal);
  if (!question) {
    return [];
  }
  return await retrieve({
    db,
    embedder,
    question,
    minSimilarity: env.RETRIEVAL_MIN_SIMILARITY,
  });
}

/**
 * The query retrieval should run, which for a follow-up is a standalone rewrite
 * of the latest question. The first question of a conversation is already
 * standalone, so it pays no extra round trip.
 */
async function retrievalQuery(turns: Turn[], signal: AbortSignal): Promise<string | undefined> {
  const question = lastQuestion(turns);
  if (!question) {
    return undefined;
  }
  if (userTurnCount(turns) <= 1) {
    return question;
  }

  try {
    return (await rewriteAsStandalone(turns, signal)) || question;
  } catch {
    return question;
  }
}

function lastQuestion(turns: Turn[]): string | undefined {
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = turns[index];
    if (turn?.role === "user") {
      return turn.content;
    }
  }
  return undefined;
}

function userTurnCount(turns: Turn[]): number {
  return turns.filter((turn) => turn.role === "user").length;
}

async function rewriteAsStandalone(turns: Turn[], signal: AbortSignal): Promise<string> {
  const response = await fetch(CHAT_MODEL_URL, {
    method: "POST",
    signal,
    headers: {
      Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: env.OPENROUTER_MODEL,
      messages: [{ role: "system", content: REWRITE }, ...turns],
      stream: false,
      reasoning: { enabled: false },
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenRouter returned ${response.status}: ${await response.text()}`);
  }

  const body = (await response.json()) as CompletionFrame;
  if (body.error) {
    throw new Error(`OpenRouter failed to rewrite: ${body.error.message ?? "unknown reason"}`);
  }
  return body.choices?.[0]?.message?.content?.trim() ?? "";
}

function systemPrompt(chunks: RetrievedChunk[]): string {
  if (chunks.length === 0) {
    return UNGROUNDED;
  }
  return `${GROUNDED}\n\n${chunks.map((item) => item.body).join("\n\n")}`;
}

/** Yields the text of each delta frame, skipping keep-alives and framing. */
async function* readDeltas(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  for await (const data of readEventData(body)) {
    if (data === "[DONE]") {
      return;
    }

    let frame: DeltaFrame;
    try {
      frame = JSON.parse(data) as DeltaFrame;
    } catch {
      // Not every frame OpenRouter sends carries a delta.
      continue;
    }

    if (frame.error) {
      throw new Error(`OpenRouter failed mid-stream: ${frame.error.message ?? "unknown reason"}`);
    }

    const text = frame.choices?.[0]?.delta?.content;
    if (text) {
      yield text;
    }
  }
}

/** Yields the payload of every `data:` line in an SSE body. */
async function* readEventData(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      for (let lineEnd = buffer.indexOf("\n"); lineEnd !== -1; lineEnd = buffer.indexOf("\n")) {
        const line = buffer.slice(0, lineEnd).trim();
        buffer = buffer.slice(lineEnd + 1);
        if (line.startsWith("data:")) {
          yield line.slice("data:".length).trim();
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
