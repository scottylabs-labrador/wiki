import { useEffect, useRef, useState } from "react";

import {
  askAgent,
  fetchQuota,
  QUESTIONS_PER_WINDOW,
  QuotaExceededError,
  type Quota,
  type Turn,
} from "@/lib/answerStream.ts";

interface Conversation {
  turns: Turn[];
  /** True while an Answer is still being written. */
  streaming: boolean;
  error: string | null;
  quota: Quota | null;
  ask: (question: string) => void;
}

/**
 * Holds one conversation with the wiki agent for as long as the tab is open.
 *
 * Deliberately React state and nothing else: a conversation is not saved, so
 * reloading the page starts a new one and there is no history to list.
 */
export function useConversation(enabled = true): Conversation {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [quota, setQuota] = useState<Quota | null>(null);
  const inFlight = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!enabled) {
      return;
    }
    const controller = new AbortController();
    void fetchQuota(controller.signal)
      .then((next) => {
        if (!controller.signal.aborted && next) {
          setQuota(next);
        }
      })
      .catch(() => {
        // Aborted on unmount, or the quota endpoint was unreachable.
      });
    return () => {
      controller.abort();
      inFlight.current?.abort();
    };
  }, [enabled]);

  function ask(question: string) {
    if (streaming || quota?.remaining === 0) {
      return;
    }

    const history: Turn[] = [...turns, { role: "user", content: question }];
    setTurns([...history, { role: "assistant", content: "" }]);
    setStreaming(true);
    setError(null);
    setQuota((current) =>
      current ? { ...current, remaining: Math.max(0, current.remaining - 1) } : current,
    );

    const controller = new AbortController();
    inFlight.current = controller;

    void askAgent({
      turns: history,
      signal: controller.signal,
      onDelta: (text) => setTurns((current) => appendToAnswer(current, text)),
      onCitations: (citations, grounded) =>
        setTurns((current) => attachCitations(current, citations, grounded)),
    })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) {
          return;
        }
        if (cause instanceof QuotaExceededError) {
          setQuota((current) => ({
            remaining: 0,
            limit: current?.limit ?? QUESTIONS_PER_WINDOW,
            resetAt: cause.resetAt,
          }));
        }
        setError(cause instanceof Error ? cause.message : "The agent could not answer.");
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setStreaming(false);
        }
      });
  }

  return { turns, streaming, error, quota, ask };
}

function appendToAnswer(turns: Turn[], text: string): Turn[] {
  const answer = turns.at(-1);
  if (!answer || answer.role !== "assistant") {
    return turns;
  }
  return [...turns.slice(0, -1), { ...answer, content: answer.content + text }];
}

function attachCitations(
  turns: Turn[],
  citations: NonNullable<Turn["citations"]>,
  grounded: boolean,
): Turn[] {
  const answer = turns.at(-1);
  if (!answer || answer.role !== "assistant") {
    return turns;
  }
  return [...turns.slice(0, -1), { ...answer, citations, grounded }];
}
