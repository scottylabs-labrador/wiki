import { SendHorizontal } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

export function Composer({
  disabled,
  onAsk,
}: {
  disabled: boolean;
  onAsk: (question: string) => void;
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
      className="flex items-end gap-2 border-t border-border p-4"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <Textarea
        aria-label="Your question"
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
      <Button type="submit" size="lg" disabled={!ready}>
        <SendHorizontal aria-hidden />
        Ask
      </Button>
    </form>
  );
}
