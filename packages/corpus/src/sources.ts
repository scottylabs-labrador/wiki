import {
  goldadorPageSource,
  labradorWikiSource,
  scottyStackWikiSource,
  sourceCatalog,
  type SourceCatalogEntry,
} from "@wiki/common";

import { gitWiki } from "./gitWiki.ts";
import { htmlPage } from "./htmlPage.ts";
import type { Source } from "./ingestService.ts";

function sourceFrom(entry: SourceCatalogEntry): Source {
  switch (entry.kind) {
    case "git-wiki":
      return gitWiki({ id: entry.id, cloneUrl: entry.cloneUrl, wikiUrl: entry.url });
    case "html-page":
      return htmlPage({ id: entry.id, url: entry.url, filename: entry.filename });
  }
}

export const scottyStackWiki: Source = sourceFrom(scottyStackWikiSource);
export const labradorWiki: Source = sourceFrom(labradorWikiSource);
export const goldadorPage: Source = sourceFrom(goldadorPageSource);

/**
 * Every Source the Corpus is built from, in `@wiki/common`'s catalog order.
 *
 * Adding a fourth that fits an existing adapter is a single entry in
 * `@wiki/common`'s source catalog.
 */
export const sources: Source[] = sourceCatalog.map(sourceFrom);
