import type { Citation } from "@/lib/answerStream.ts";

export function AnswerCitations({ citations }: { citations: Citation[] }) {
  if (citations.length === 0) {
    return null;
  }

  return (
    <nav aria-label="Citations" className="mt-3">
      <p className="text-xs font-medium text-muted-foreground">Drawn from</p>
      <ul className="mt-1 flex flex-col gap-1">
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
      This Answer is not drawn from Labrador documentation.
    </p>
  );
}
