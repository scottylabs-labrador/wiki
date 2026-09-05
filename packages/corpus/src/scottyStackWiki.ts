import { gitWiki, isPage, wikiPageUrl } from "./gitWiki.ts";
import type { Source } from "./ingestService.ts";

/** Identifies this Source's Pages and Chunks in the Corpus. */
export const SOURCE_ID = "scottystack-wiki";

const WIKI_URL = "https://github.com/scottylabs-labrador/ScottyStack/wiki";

/** @see wikiPageUrl */
export function pageUrl(filename: string): string {
  return wikiPageUrl(WIKI_URL, filename);
}

export { isPage };

/** The ScottyStack wiki, cloned anonymously over HTTPS. */
export const scottyStackWiki: Source = gitWiki({
  id: SOURCE_ID,
  cloneUrl: "https://github.com/scottylabs-labrador/ScottyStack.wiki.git",
  wikiUrl: WIKI_URL,
});
