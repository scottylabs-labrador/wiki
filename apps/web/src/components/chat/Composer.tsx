import { SendHorizontal } from "lucide-react";
import { useState } from "react";

import { QuotaBar } from "@/components/chat/QuotaBar";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { Quota } from "@/lib/answerStream.ts";

export function Composer({
  disabled,
  onAsk,
  quota,
}: {
  disabled: boolean;
  onAsk: (question: string) => void;
  quota: Quota | null;
}) {
  const [question, setQuestion] = useState("");
  const ready = !disabled && question.trim().length > 0;

  function submit() {
    if (!ready) {
      return;
    }
    onAsk(question.trim());
    setQuestion("");
  }

  return (
    <form
      className="sticky bottom-0 z-40 shrink-0 border-t border-border bg-background p-4"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <div className="mx-auto flex w-full max-w-3xl items-end gap-2">
        <Textarea
          aria-label="Your question"
          className="min-h-9"
          placeholder="Ask a question about Labrador"
          rows={1}
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          onKeyDown={(event) => {
            // Enter asks; shift-enter is how you write a multi-line question.
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              submit();
            }
          }}
        />
        <div className="group relative flex flex-col items-stretch">
          <Button
            type="submit"
            size="lg"
            disabled={!ready}
            className={quota ? "rounded-b-none" : undefined}
          >
            <SendHorizontal aria-hidden />
            Ask
          </Button>
          {quota && <QuotaBar quota={quota} />}
        </div>
      </div>
    </form>
  );
}
