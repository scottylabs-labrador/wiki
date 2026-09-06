import { scottyStackWikiSource } from "@wiki/common";

import { isPage, wikiPageUrl } from "./gitWiki.ts";

/** Identifies this Source's Pages and Chunks in the Corpus. */
export const SOURCE_ID = scottyStackWikiSource.id;

/** @see wikiPageUrl */
export function pageUrl(filename: string): string {
  return wikiPageUrl(scottyStackWikiSource.url, filename);
}

export { isPage };
