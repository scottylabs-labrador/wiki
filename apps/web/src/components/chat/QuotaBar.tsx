import { formatResetAt, type Quota } from "@/lib/answerStream.ts";

/** Remaining questions this hour, as a bar under Ask. Hover or a press names the count and reset. */
export function QuotaBar({ quota }: { quota: Quota }) {
  const label = `${quota.remaining}/${quota.limit} prompts remaining. Refreshes hourly at ${formatResetAt(quota.resetAt)}.`;
  const remaining = quota.limit === 0 ? 0 : Math.min(1, Math.max(0, quota.remaining / quota.limit));

  return (
    <div className="w-full">
      <div
        role="progressbar"
        tabIndex={0}
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={quota.limit}
        aria-valuenow={quota.remaining}
        className="h-1.5 w-full overflow-hidden rounded-b-lg border-x border-b border-border bg-white outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <div className="h-full bg-green-500" style={{ width: `${remaining * 100}%` }} />
      </div>
      <p
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-1 hidden -translate-x-1/2 rounded-md bg-foreground px-2 py-1 text-xs whitespace-nowrap text-background group-hover:block group-focus-within:block group-active:block"
      >
        {label}
      </p>
    </div>
  );
}
