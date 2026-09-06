export { EMBEDDING_DIMENSIONS } from "@wiki/db/schema";

export { citationsFrom, MAX_CITATIONS, type Citation } from "./citations.ts";
export { CHUNKER_VERSION, splitIntoChunks, type PageChunk } from "./chunker.ts";
export { openRouterEmbedder, type Embedder } from "./embeddings.ts";
export { gitWiki, isPage, wikiPageUrl } from "./gitWiki.ts";
export { htmlPage, htmlToMarkdown } from "./htmlPage.ts";
export {
  ingest,
  ingestAll,
  type CorpusDatabase,
  type IngestOutcome,
  type Source,
  type SourcePage,
} from "./ingestService.ts";
export { retrieve, type RetrievedChunk } from "./retrieve.ts";
export { goldadorPage, labradorWiki, scottyStackWiki, sources } from "./sources.ts";
export { pageUrl, SOURCE_ID } from "./scottyStackWiki.ts";
