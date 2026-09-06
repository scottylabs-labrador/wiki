import { sourceCatalog } from "@wiki/common";

import { useSession } from "@/lib/authClient";

/** The Sources the agent answers from, as links a member can open. */
export function UsefulLinks() {
  const { data: auth } = useSession();
  if (!auth?.user) {
    return null;
  }

  return (
    <aside
      aria-labelledby="useful-links-heading"
      className="flex w-56 shrink-0 flex-col gap-3 border-r border-border bg-muted/40 p-4"
    >
      <h2 id="useful-links-heading" className="text-base font-semibold">
        Useful Links
      </h2>
      <ul className="list-disc space-y-2 pl-5">
        {sourceCatalog.map((source) => (
          <li key={source.id}>
            <a
              href={source.url}
              target="_blank"
              rel="noreferrer"
              className="text-sm text-blue-600 underline underline-offset-4 dark:text-blue-400"
            >
              {source.title}
            </a>
          </li>
        ))}
      </ul>
    </aside>
  );
}
