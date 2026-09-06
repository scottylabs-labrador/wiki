import { env } from "@/env.ts";

/** One question or one Answer in a conversation. */
export interface Turn {
  role: "user" | "assistant";
  content: string;
  citations?: Citation[];
  /** Set once the server has said whether this Answer drew on the Corpus. */
  grounded?: boolean;
}

/** A link to the section of a Page that an Answer drew on. */
export interface Citation {
  title: string;
  url: string;
}

const ANSWER_STREAM_URL = `${env.VITE_SERVER_URL}/chat/answers`;
export const QUOTA_URL = `${env.VITE_SERVER_URL}/chat/quota`;

export class QuotaExceededError extends Error {
  resetAt: Date;
  constructor(resetAt: Date) {
    super(`You can ask again at ${formatResetAt(resetAt)}.`);
    this.name = "QuotaExceededError";
    this.resetAt = resetAt;
  }
}

export interface Quota {
  remaining: number;
  limit: number;
  resetAt: Date;
}

/** Matches the server's hour-long window; used if a 429 arrives before quota was fetched. */
export const QUESTIONS_PER_WINDOW = 60;

/** How many questions this hour still allows, or null if the check failed. */
export async function fetchQuota(signal?: AbortSignal): Promise<Quota | null> {
  const response = await fetch(QUOTA_URL, { credentials: "include", signal });
  if (!response.ok) {
    return null;
  }
  const body = (await response.json()) as { remaining?: number; limit?: number; resetAt?: string };
  if (typeof body.remaining !== "number" || typeof body.resetAt !== "string") {
    return null;
  }
  return {
    remaining: body.remaining,
    limit: typeof body.limit === "number" ? body.limit : QUESTIONS_PER_WINDOW,
    resetAt: new Date(body.resetAt),
  };
}

export function formatResetAt(resetAt: Date): string {
  return resetAt.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

/**
 * Asks the wiki agent a question and reports the Answer as it is written.
 *
 * `EventSource` cannot be used here: it only issues GET requests, so it has no
 * way to carry the earlier turns the agent needs to follow up a question.
 *
 * Resolves once the Answer is complete, and rejects with a message fit to show
 * a member if it never arrives.
 *
 * The whole conversation is sent: how much of it reaches the chat model is the
 * server's decision, and a client trimming to a limit of its own could only
 * disagree with the one that is actually enforced.
 */
export async function askAgent(options: {
  turns: Turn[];
  signal: AbortSignal;
  onDelta: (text: string) => void;
  onCitations: (citations: Citation[], grounded: boolean) => void;
}): Promise<void> {
  const response = await fetch(ANSWER_STREAM_URL, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      turns: options.turns.map(({ role, content }) => ({ role, content })),
    }),
    signal: options.signal,
  });

  if (response.status === 429) {
    throw await quotaExceeded(response);
  }

  if (!response.ok || !response.body) {
    throw new Error(refusalMessage(response.status));
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      return;
    }

    buffer += decoder.decode(value, { stream: true });
    for (
      let frameEnd = buffer.indexOf("\n\n");
      frameEnd !== -1;
      frameEnd = buffer.indexOf("\n\n")
    ) {
      const frame = buffer.slice(0, frameEnd);
      buffer = buffer.slice(frameEnd + 2);

      const event = readEvent(frame);
      if (event?.name === "delta") {
        options.onDelta(event.text);
      } else if (event?.name === "citations") {
        options.onCitations(event.citations, event.grounded);
      } else if (event?.name === "error") {
        throw new Error("The Answer stopped part way through. Ask again.");
      } else if (event?.name === "done") {
        return;
      }
    }
  }
}

type StreamEvent =
  | { name: "delta"; text: string }
  | { name: "citations"; citations: Citation[]; grounded: boolean }
  | { name: "done" }
  | { name: "error" };

/** Reads one SSE frame, or null for a frame there is nothing to do about. */
function readEvent(frame: string): StreamEvent | null {
  let name = "";
  let data = "";

  for (const line of frame.split("\n")) {
    if (line.startsWith("event:")) {
      name = line.slice("event:".length).trim();
    } else if (line.startsWith("data:")) {
      data += line.slice("data:".length).trim();
    }
  }

  if (name === "done") {
    return { name: "done" };
  }
  if (name === "error") {
    return { name: "error" };
  }
  if (name === "citations") {
    return readCitations(data);
  }
  if (name !== "delta") {
    return null;
  }

  const text = readText(data);
  return text === null ? null : { name: "delta", text };
}

function readCitations(data: string): StreamEvent | null {
  try {
    const parsed = JSON.parse(data) as { citations?: Citation[]; grounded?: boolean };
    if (!Array.isArray(parsed.citations) || typeof parsed.grounded !== "boolean") {
      return null;
    }
    return { name: "citations", citations: parsed.citations, grounded: parsed.grounded };
  } catch {
    return null;
  }
}

/** The text a delta frame carries, or null if it turns out not to carry any. */
function readText(data: string): string | null {
  try {
    const parsed = JSON.parse(data) as { text?: string };
    return parsed.text ?? null;
  } catch {
    return null;
  }
}

async function quotaExceeded(response: Response): Promise<QuotaExceededError> {
  try {
    const body = (await response.json()) as { resetAt?: string };
    if (typeof body.resetAt === "string") {
      return new QuotaExceededError(new Date(body.resetAt));
    }
  } catch {
    // Fall through to a generic refusal if the body is not the quota shape.
  }
  return new QuotaExceededError(new Date(Date.now() + 60 * 60 * 1000));
}

function refusalMessage(status: number): string {
  if (status === 401) {
    return "Your session has expired. Sign in again to keep asking.";
  }
  if (status === 413) {
    return "This conversation has grown too long. Refresh to start over.";
  }
  if (status === 429) {
    return "You have asked as many questions as this hour allows.";
  }
  return "The agent could not answer just now. Try asking again.";
}
