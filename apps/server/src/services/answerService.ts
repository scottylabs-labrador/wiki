import { retrieve, type RetrievedChunk } from "@wiki/corpus";

import { env } from "../env.ts";
import { db } from "../lib/db.ts";
import { embedder } from "../lib/embedder.ts";

/** One question or one Answer in a conversation, as the chat model sees it. */
export interface Turn {
  role: "user" | "assistant";
  content: string;
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

/** One frame of a streamed Answer, as OpenRouter writes it on the wire. */
interface DeltaFrame {
  choices?: Array<{ delta?: { content?: string | null } }>;
  error?: { message?: string };
}

/**
 * Opens a streamed Answer to a conversation.
 *
 * Awaiting the returned promise waits only for the chat model to accept the
 * request, so a caller can still report a plain HTTP failure before it commits
 * to streaming. Iterating the result then yields the Answer as text arrives.
 *
 * Every turn given is sent, so the caller decides how much conversation the
 * prompt — and the bill — carries.
 */
export async function openAnswerStream(
  turns: Turn[],
  signal: AbortSignal,
): Promise<AsyncIterable<string>> {
  const chunks = await similarChunks(turns);
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

  return readDeltas(response.body);
}

/** Retrieves the Chunks most similar to the latest question, or none. */
async function similarChunks(turns: Turn[]): Promise<RetrievedChunk[]> {
  const question = lastQuestion(turns);
  if (!question) {
    return [];
  }
  return await retrieve({ db, embedder, question });
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
