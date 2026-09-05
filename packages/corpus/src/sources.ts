import { gitWiki } from "./gitWiki.ts";
import { htmlPage } from "./htmlPage.ts";
import type { Source } from "./ingestService.ts";
import { scottyStackWiki } from "./scottyStackWiki.ts";

/** The Labrador committee's own wiki. */
export const labradorWiki: Source = gitWiki({
  id: "labrador-wiki",
  cloneUrl: "https://github.com/scottylabs-labrador/wiki.wiki.git",
  wikiUrl: "https://github.com/scottylabs-labrador/wiki/wiki",
});

/** Goldador's member-facing governance Page. */
export const goldadorPage: Source = htmlPage({
  id: "goldador",
  url: "https://scottylabs-labrador.github.io/goldador/",
  filename: "Goldador.html",
});

/**
 * Every Source the Corpus is built from.
 *
 * Adding a fourth that fits an existing adapter is a single entry here.
 */
export const sources: Source[] = [scottyStackWiki, labradorWiki, goldadorPage];
