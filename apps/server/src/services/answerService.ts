import { citationsFrom, retrieve, type Citation, type RetrievedChunk } from "@wiki/corpus";

import { env } from "../env.ts";
import { db } from "../lib/db.ts";
import { embedder } from "../lib/embedder.ts";
import type { SlackHit } from "../lib/slack.ts";
import { captureUnexpectedError } from "../middlewares/errorHandler.ts";

/** One question or one Answer in a conversation, as the chat model sees it. */
export interface Turn {
  role: "user" | "assistant";
  content: string;
}

export interface AnswerStream {
  grounded: boolean;
  citations: Citation[];
  /** Public Slack messages supplied to the model. Empty unless a mention searched. */
  slackHits: SlackHit[];
  deltas: AsyncIterable<string>;
}

/** One public-channel search the mention path may run. Absent on the web. */
export interface MentionSearch {
  search(query: string): Promise<SlackHit[]>;
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

const SLACK_TOOL_GUIDANCE = [
  "You may call search_slack once when the documentation does not answer the",
  "question, on any topic. Do not call it when the documentation already answers.",
  "If no documentation was given, search. When a tool result lists Slack messages,",
  "base that part of the Answer on them rather than guessing. Do not invent Slack",
  "links.",
].join(" ");

const SEARCH_SLACK_TOOL = {
  type: "function",
  function: {
    name: "search_slack",
    description: [
      "Search public Slack channels. Use this when the documentation does not",
      "answer the question, including when no documentation was given. Do not",
      "use it when the documentation already answers.",
    ].join(" "),
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "What to search for, as a question or as keywords.",
        },
      },
      required: ["query"],
    },
  },
} as const;

/** One frame of a streamed Answer, as OpenRouter writes it on the wire. */
interface DeltaFrame {
  choices?: Array<{ delta?: { content?: string | null } }>;
  error?: { message?: string };
}

interface ToolCall {
  id?: string;
  type?: string;
  function?: { name?: string; arguments?: string };
}

interface CompletionFrame {
  choices?: Array<{
    message?: { content?: string | null; tool_calls?: ToolCall[] };
  }>;
  error?: { message?: string };
}

type ChatMessage =
  | { role: "system" | "user" | "assistant"; content: string }
  | {
      role: "assistant";
      content: null;
      tool_calls: Array<{
        id: string;
        type: "function";
        function: { name: "search_slack"; arguments: string };
      }>;
    }
  | { role: "tool"; tool_call_id: string; content: string };

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
 *
 * `mentionSearch`, when passed, lets the model call Slack once before it
 * answers. The web path omits it, so that request stays a single streamed
 * completion with no tools. See ADR-0006.
 */
export async function openAnswerStream(
  turns: Turn[],
  signal: AbortSignal,
  mentionSearch?: MentionSearch,
): Promise<AnswerStream> {
  const chunks = await similarChunks(turns, signal);
  const citations = citationsFrom(chunks);
  const prompt = systemPrompt(chunks, mentionSearch !== undefined);
  if (!mentionSearch) {
    return {
      grounded: chunks.length > 0,
      citations,
      slackHits: [],
      deltas: readDeltas(await streamCompletion(prompt, turns, signal)),
    };
  }
  return openMentionStream(turns, signal, prompt, chunks.length > 0, citations, mentionSearch);
}

/**
 * One Slack search, then an Answer. A missing or failed search still answers
 * from the wiki, and the model cannot call the tool again.
 */
async function openMentionStream(
  turns: Turn[],
  signal: AbortSignal,
  prompt: string,
  wikiGrounded: boolean,
  citations: Citation[],
  mentionSearch: MentionSearch,
): Promise<AnswerStream> {
  const decision = await complete(prompt, turns, signal, true);
  const call = searchCall(decision);
  if (call === "none") {
    return {
      grounded: wikiGrounded,
      citations,
      slackHits: [],
      deltas: once(decision.choices?.[0]?.message?.content?.trim() ?? ""),
    };
  }
  if (call === "unusable") {
    return wikiStream(turns, signal, prompt, wikiGrounded, citations);
  }

  let hits: SlackHit[];
  try {
    hits = await mentionSearch.search(call.query);
  } catch (error) {
    if (signal.aborted) {
      throw error;
    }
    captureUnexpectedError(error);
    return wikiStream(turns, signal, prompt, wikiGrounded, citations);
  }

  const messages: ChatMessage[] = [
    { role: "system", content: prompt },
    ...turns,
    { role: "assistant", content: null, tool_calls: [call.toolCall] },
    { role: "tool", tool_call_id: call.toolCall.id, content: formatHits(hits) },
  ];
  return {
    grounded: wikiGrounded || hits.length > 0,
    citations,
    slackHits: hits,
    deltas: readDeltas(await streamCompletionMessages(messages, signal)),
  };
}

async function wikiStream(
  turns: Turn[],
  signal: AbortSignal,
  prompt: string,
  wikiGrounded: boolean,
  citations: Citation[],
): Promise<AnswerStream> {
  return {
    grounded: wikiGrounded,
    citations,
    slackHits: [],
    deltas: readDeltas(await streamCompletion(prompt, turns, signal)),
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

function systemPrompt(chunks: RetrievedChunk[], slackSearch = false): string {
  const base =
    chunks.length === 0
      ? UNGROUNDED
      : `${GROUNDED}\n\n${chunks.map((item) => item.body).join("\n\n")}`;
  if (!slackSearch) {
    return base;
  }
  return `${base}\n\n${SLACK_TOOL_GUIDANCE}`;
}

async function streamCompletion(
  prompt: string,
  turns: Turn[],
  signal: AbortSignal,
): Promise<ReadableStream<Uint8Array>> {
  return streamCompletionMessages([{ role: "system", content: prompt }, ...turns], signal);
}

async function streamCompletionMessages(
  messages: ChatMessage[],
  signal: AbortSignal,
): Promise<ReadableStream<Uint8Array>> {
  const response = await postChat(messages, signal, true);
  if (!response.body) {
    throw new Error(`OpenRouter returned ${response.status} with no body`);
  }
  return response.body;
}

/** A non-streaming completion. `withTool` offers search_slack and nothing else. */
async function complete(
  prompt: string,
  turns: Turn[],
  signal: AbortSignal,
  withTool: boolean,
): Promise<CompletionFrame> {
  const response = await postChat(
    [{ role: "system", content: prompt }, ...turns],
    signal,
    false,
    withTool,
  );
  const body = (await response.json()) as CompletionFrame;
  if (body.error) {
    throw new Error(`OpenRouter failed: ${body.error.message ?? "unknown reason"}`);
  }
  return body;
}

async function postChat(
  messages: ChatMessage[],
  signal: AbortSignal,
  stream: boolean,
  withTool = false,
): Promise<Response> {
  const response = await fetch(CHAT_MODEL_URL, {
    method: "POST",
    signal,
    headers: {
      Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: env.OPENROUTER_MODEL,
      messages,
      ...(withTool ? { tools: [SEARCH_SLACK_TOOL] } : {}),
      stream,
      // Reasoning is on by default for this model, so it has to be switched off
      // explicitly for an Answer to start arriving instantly. `enabled: false`
      // rather than `effort: "none"`: the model lists efforts max/high/low only,
      // and would reject "none".
      reasoning: { enabled: false },
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenRouter returned ${response.status}: ${await response.text()}`);
  }
  return response;
}

type SearchCall =
  | "none"
  | "unusable"
  | {
      query: string;
      toolCall: {
        id: string;
        type: "function";
        function: { name: "search_slack"; arguments: string };
      };
    };

/** The one search_slack call in a decision, if the model made a usable one. */
function searchCall(frame: CompletionFrame): SearchCall {
  const calls = frame.choices?.[0]?.message?.tool_calls;
  if (!calls || calls.length === 0) {
    return "none";
  }
  const call = calls.find((item) => item.function?.name === "search_slack");
  const id = call?.id;
  const args = call?.function?.arguments;
  if (!id || !args) {
    return "unusable";
  }
  try {
    const parsed = JSON.parse(args) as { query?: unknown };
    const query = typeof parsed.query === "string" ? parsed.query.trim() : "";
    if (!query) {
      return "unusable";
    }
    return {
      query,
      toolCall: {
        id,
        type: "function",
        function: { name: "search_slack", arguments: args },
      },
    };
  } catch {
    return "unusable";
  }
}

function formatHits(hits: SlackHit[]): string {
  if (hits.length === 0) {
    return "No matching public Slack messages.";
  }
  return hits.map(formatHit).join("\n\n");
}

function formatHit(hit: SlackHit): string {
  const where = [hit.channelName ? `#${hit.channelName}` : "", hit.authorName]
    .filter(Boolean)
    .join(" - ");
  const lines = [where, hit.permalink, hit.content];
  if (hit.before.length > 0) {
    lines.push(`Before: ${hit.before.join(" ")}`);
  }
  if (hit.after.length > 0) {
    lines.push(`After: ${hit.after.join(" ")}`);
  }
  return lines.filter(Boolean).join("\n");
}

async function* once(text: string): AsyncGenerator<string> {
  if (text) {
    yield text;
  }
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
