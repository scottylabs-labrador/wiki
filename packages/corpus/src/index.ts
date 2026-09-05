export { CHUNKER_VERSION, splitIntoChunks, type PageChunk } from "./chunker.ts";
export { EMBEDDING_DIMENSIONS, openRouterEmbedder, type Embedder } from "./embeddings.ts";
export {
  ingest,
  type CorpusDatabase,
  type IngestOutcome,
  type Source,
  type SourcePage,
} from "./ingestService.ts";
export { isPage, pageUrl, scottyStackWiki, SOURCE_ID } from "./scottyStackWiki.ts";
