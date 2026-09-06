import { ChevronRight } from "lucide-react";
import { useState } from "react";

import type { Citation } from "@/lib/answerStream.ts";

export function AnswerCitations({ citations }: { citations: Citation[] }) {
  const [open, setOpen] = useState(false);

  if (citations.length === 0) {
    return null;
  }

  return (
    <nav aria-label="Citations" className="mt-3">
      <details className="group" onToggle={(event) => setOpen(event.currentTarget.open)}>
        <summary className="flex cursor-pointer list-none items-center gap-1 text-xs font-medium text-muted-foreground [&::-webkit-details-marker]:hidden">
          <ChevronRight aria-hidden className="size-3 transition-transform group-open:rotate-90" />
          Cited Documents
        </summary>
        {open && (
          <ul className="mt-1 list-disc space-y-1 pl-5">
            {citations.map((citation) => (
              <li key={citation.url}>
                <a
                  href={citation.url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-blue-600 underline underline-offset-4 break-all dark:text-blue-400"
                >
                  {citation.url}
                </a>
              </li>
            ))}
          </ul>
        )}
      </details>
    </nav>
  );
}

export function ConsultingPages({ citations }: { citations: Citation[] }) {
  if (citations.length === 0) {
    return null;
  }

  return (
    <p className="text-sm text-muted-foreground">
      Looking at {citations.map((citation) => citation.title).join(", ")}…
    </p>
  );
}

export function UngroundedNotice() {
  return (
    <p role="status" className="mt-3 text-sm text-muted-foreground">
      This answer is not drawn from Labrador documentation!
    </p>
  );
}
