/**
 * A Source the agent is allowed to answer from, identified by a public URL a
 * reader can open. Ingest fetches from the same record the interface lists.
 */
export type SourceCatalogEntry =
  | {
      kind: "git-wiki";
      id: string;
      title: string;
      url: string;
      cloneUrl: string;
    }
  | {
      kind: "html-page";
      id: string;
      title: string;
      url: string;
      filename: string;
    };

/** The ScottyStack wiki, cloned anonymously over HTTPS. */
export const scottyStackWikiSource = {
  kind: "git-wiki",
  id: "scottystack-wiki",
  title: "ScottyStack Wiki",
  url: "https://github.com/scottylabs-labrador/ScottyStack/wiki",
  cloneUrl: "https://github.com/scottylabs-labrador/ScottyStack.wiki.git",
} as const satisfies SourceCatalogEntry;

/** The Labrador committee's own wiki. */
export const labradorWikiSource = {
  kind: "git-wiki",
  id: "labrador-wiki",
  title: "Labrador Wiki Wiki",
  url: "https://github.com/scottylabs-labrador/wiki/wiki",
  cloneUrl: "https://github.com/scottylabs-labrador/wiki.wiki.git",
} as const satisfies SourceCatalogEntry;

/** Goldador's member-facing governance Page. */
export const goldadorPageSource = {
  kind: "html-page",
  id: "goldador",
  title: "Goldador",
  url: "https://scottylabs-labrador.github.io/goldador/",
  filename: "Goldador.html",
} as const satisfies SourceCatalogEntry;

/**
 * Every Source the Corpus is built from, and every link the interface shows.
 *
 * Adding a fourth that fits an existing adapter is a single entry here.
 */
export const sourceCatalog: readonly SourceCatalogEntry[] = [
  labradorWikiSource,
  scottyStackWikiSource,
  goldadorPageSource,
];

/** Catalog title for a Source id, or the id itself when the catalog has no entry. */
export function sourceTitleFor(sourceId: string): string {
  return sourceCatalog.find((source) => source.id === sourceId)?.title ?? sourceId;
}

/**
 * The text of a Citation link: Source, then Page title. When they are the
 * same word (Goldador), the Source is omitted.
 */
export function citationLabel(citation: { sourceTitle: string; title: string }): string {
  if (citation.sourceTitle === citation.title) {
    return citation.title;
  }
  return `${citation.sourceTitle}: ${citation.title}`;
}
