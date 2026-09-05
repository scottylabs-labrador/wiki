import { useEffect, useRef } from "react";

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
        <p className="max-w-md text-center text-sm text-muted-foreground">
          Ask anything about ScottyLabs Labrador. Nothing here is saved, so reloading the page
          starts a new conversation.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-6 overflow-y-auto p-6">
      {/* Turns are only ever appended, so a turn's position is stable identity. */}
      {turns.map((turn, index) =>
        turn.role === "user" ? (
          <p
            key={index}
            className="ml-auto max-w-[80%] rounded-2xl bg-muted px-4 py-2 text-sm whitespace-pre-wrap"
          >
            {turn.content}
          </p>
        ) : (
          <div key={index} className="max-w-[80%]">
            <AnswerMarkdown>{turn.content}</AnswerMarkdown>
            {turn.content === "" && streaming && (
              <p className="text-sm text-muted-foreground">Writing an answer…</p>
            )}
          </div>
        ),
      )}
      <div ref={bottom} />
    </div>
  );
}
