import { sourceCatalog } from "@wiki/common";
import { ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { $api } from "@/lib/apiClient";
import { cn } from "@/lib/utils";

type AdminPage = {
  sourceTitle: string;
  filename: string;
  publicUrl: string;
  chunks: Array<{ heading: string | null; body: string }>;
};

function sourceOrder(title: string): number {
  const index = sourceCatalog.findIndex((source) => source.title === title);
  return index === -1 ? sourceCatalog.length : index;
}

function sourceUrl(title: string): string | undefined {
  return sourceCatalog.find((source) => source.title === title)?.url;
}

const sourceLinkClassName =
  "text-sm text-blue-600 underline underline-offset-4 break-all dark:text-blue-400";

function pageKey(page: AdminPage): string {
  return `${page.filename}:${page.publicUrl}`;
}

function groupBySource(pages: AdminPage[]): Array<{ title: string; pages: AdminPage[] }> {
  const grouped = new Map<string, AdminPage[]>();
  for (const page of pages) {
    const list = grouped.get(page.sourceTitle) ?? [];
    list.push(page);
    grouped.set(page.sourceTitle, list);
  }
  return [...grouped.entries()]
    .sort(([left], [right]) => sourceOrder(left) - sourceOrder(right))
    .map(([title, groupedPages]) => ({ title, pages: groupedPages }));
}

function TabStrip({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
}) {
  return (
    <div role="tablist" aria-label={label} className="mb-4 flex flex-wrap gap-2">
      {options.map((option) => (
        <Button
          key={option.value}
          role="tab"
          aria-selected={value === option.value}
          variant={value === option.value ? "default" : "outline"}
          size="sm"
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </Button>
      ))}
    </div>
  );
}

function ChunkCollapsible({ heading, body }: { heading: string | null; body: string }) {
  const [open, setOpen] = useState(false);

  return (
    <details className="group" onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary className="flex cursor-pointer list-none items-center gap-1 text-sm font-medium [&::-webkit-details-marker]:hidden">
        <ChevronRight
          aria-hidden
          className="size-3 shrink-0 transition-transform group-open:rotate-90"
        />
        {heading ?? "Page"}
      </summary>
      {open && (
        <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed break-words">{body}</p>
      )}
    </details>
  );
}

export function DashboardChunks() {
  const { data: pages, isLoading, isError, error } = $api.useQuery("get", "/admin/pages");
  const [sourceTitle, setSourceTitle] = useState<string | null>(null);
  const [selectedPageKey, setSelectedPageKey] = useState<string | null>(null);

  const list = pages ?? [];
  const sources = useMemo(() => groupBySource(list), [list]);
  const selectedSource = sources.find((source) => source.title === sourceTitle) ?? sources[0];
  const selectedSourceUrl = selectedSource ? sourceUrl(selectedSource.title) : undefined;
  const selectedPage =
    selectedSource?.pages.find((page) => pageKey(page) === selectedPageKey) ??
    selectedSource?.pages[0];

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Loading chunks…</p>;
  }

  if (isError) {
    return (
      <div className="text-sm text-destructive">
        Error loading chunks: {error ? String(error) : "Unknown error"}
      </div>
    );
  }

  return (
    <div>
      <p className="mb-6 text-sm text-muted-foreground">Chunks grouped by Source and Page.</p>
      {sources.length === 0 || !selectedSource || !selectedPage ? (
        <p className="text-sm text-muted-foreground">No pages found.</p>
      ) : (
        <div>
          <TabStrip
            label="Sources"
            value={selectedSource.title}
            options={sources.map((source) => ({ value: source.title, label: source.title }))}
            onChange={(title) => {
              setSourceTitle(title);
              const next = sources.find((source) => source.title === title);
              setSelectedPageKey(next ? pageKey(next.pages[0]!) : null);
            }}
          />
          {selectedSourceUrl ? (
            <a
              href={selectedSourceUrl}
              target="_blank"
              rel="noreferrer"
              className={cn("mb-4 block", sourceLinkClassName)}
            >
              {selectedSourceUrl}
            </a>
          ) : null}
          <TabStrip
            label="Pages"
            value={pageKey(selectedPage)}
            options={selectedSource.pages.map((page) => ({
              value: pageKey(page),
              label: page.filename,
            }))}
            onChange={setSelectedPageKey}
          />
          <a
            href={selectedPage.publicUrl}
            target="_blank"
            rel="noreferrer"
            className={sourceLinkClassName}
          >
            {selectedPage.publicUrl}
          </a>
          {selectedPage.chunks.length === 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">No chunks on this Page.</p>
          ) : (
            <ol className="mt-4 flex flex-col gap-4">
              {selectedPage.chunks.map((chunk, index) => (
                <li key={`${pageKey(selectedPage)}-${index}`} className="min-w-0">
                  <ChunkCollapsible heading={chunk.heading} body={chunk.body} />
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </div>
  );
}
