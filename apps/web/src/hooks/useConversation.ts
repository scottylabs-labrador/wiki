import { useEffect, useRef, useState } from "react";

import { askAgent, type Turn } from "@/lib/answerStream.ts";

interface Conversation {
  turns: Turn[];
  /** True while an Answer is still being written. */
  streaming: boolean;
  error: string | null;
  ask: (question: string) => void;
}

/**
 * Holds one conversation with the wiki agent for as long as the tab is open.
 *
 * Deliberately React state and nothing else: a conversation is not saved, so
 * reloading the page starts a new one and there is no history to list.
 */
export function useConversation(): Conversation {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef<AbortController | null>(null);

  // Leaving the page should stop the Answer rather than let it keep billing.
  useEffect(() => () => inFlight.current?.abort(), []);

  function ask(question: string) {
    if (streaming) {
      return;
    }

    const history: Turn[] = [...turns, { role: "user", content: question }];
    setTurns([...history, { role: "assistant", content: "" }]);
    setStreaming(true);
    setError(null);

    const controller = new AbortController();
    inFlight.current = controller;

    void askAgent({
      turns: history,
      signal: controller.signal,
      onDelta: (text) => setTurns((current) => appendToAnswer(current, text)),
    })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) {
          return;
        }
        setError(cause instanceof Error ? cause.message : "The agent could not answer.");
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setStreaming(false);
        }
      });
  }

  return { turns, streaming, error, ask };
}

function appendToAnswer(turns: Turn[], text: string): Turn[] {
  const answer = turns.at(-1);
  if (!answer || answer.role !== "assistant") {
    return turns;
  }
  return [...turns.slice(0, -1), { ...answer, content: answer.content + text }];
}
