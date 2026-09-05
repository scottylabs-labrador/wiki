import { env } from "@/env.ts";

/** One question or one Answer in a conversation. */
export interface Turn {
  role: "user" | "assistant";
  content: string;
}

const ANSWER_STREAM_URL = `${env.VITE_SERVER_URL}/chat/answers`;

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
}): Promise<void> {
  const response = await fetch(ANSWER_STREAM_URL, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ turns: options.turns }),
    signal: options.signal,
  });

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
      } else if (event?.name === "error") {
        throw new Error("The Answer stopped part way through. Ask again.");
      } else if (event?.name === "done") {
        return;
      }
    }
  }
}

/** An event the Answer stream carries. Only a delta says anything further. */
type StreamEvent = { name: "delta"; text: string } | { name: "done" } | { name: "error" };

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
  if (name !== "delta") {
    return null;
  }

  const text = readText(data);
  return text === null ? null : { name: "delta", text };
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

function refusalMessage(status: number): string {
  if (status === 401) {
    return "Your session has expired. Sign in again to keep asking.";
  }
  if (status === 413) {
    return "This conversation has grown too long. Refresh to start over.";
  }
  return "The agent could not answer just now. Try asking again.";
}
