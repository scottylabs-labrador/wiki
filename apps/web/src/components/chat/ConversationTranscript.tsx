import { useEffect, useRef } from "react";

import {
  AnswerCitations,
  ConsultingPages,
  UngroundedNotice,
} from "@/components/chat/AnswerCitations";
import { AnswerMarkdown } from "@/components/chat/AnswerMarkdown";
import type { Turn } from "@/lib/answerStream.ts";

export function ConversationTranscript({
  turns,
  streaming,
}: {
  turns: Turn[];
  streaming: boolean;
}) {
  const bottom = useRef<HTMLDivElement>(null);

  // Keep the newest text in view while the Answer is being written.
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [turns]);

  if (turns.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <p className="max-w-md text-center text-base text-muted-foreground">
          Ask anything about ScottyLabs Labrador. Note that nothing is saved, so reloading the page
          starts a new conversation.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-6 overflow-y-auto p-6">
      {/* Turns are only ever appended, so a turn's position is stable identity. */}
      {turns.map((turn, index) => {
        const inProgress = streaming && index === turns.length - 1;
        return turn.role === "user" ? (
          <p
            key={index}
            className="ml-auto max-w-[80%] rounded-2xl bg-muted px-4 py-2 text-sm whitespace-pre-wrap"
          >
            {turn.content}
          </p>
        ) : (
          <div key={index} className="max-w-[80%]">
            {inProgress && turn.citations && turn.citations.length > 0 && (
              <ConsultingPages citations={turn.citations} />
            )}
            <AnswerMarkdown>{turn.content}</AnswerMarkdown>
            {turn.content === "" && inProgress && !turn.citations?.length && (
              <p className="text-sm text-muted-foreground">Writing an answer…</p>
            )}
            {!inProgress && turn.grounded === false && <UngroundedNotice />}
            {!inProgress && turn.citations && <AnswerCitations citations={turn.citations} />}
          </div>
        );
      })}
      <div ref={bottom} />
    </div>
  );
}
