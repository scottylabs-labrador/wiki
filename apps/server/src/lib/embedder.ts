import { openRouterEmbedder, type Embedder } from "@wiki/corpus";

import { env } from "../env.ts";

/**
 * Embeds questions with the same model the Corpus was built with.
 *
 * A mismatch still "works" and silently ranks the wrong Chunks, which is why
 * this is the ingest embedder rather than a second one.
 */
export const embedder: Embedder = openRouterEmbedder({
  apiKey: env.OPENROUTER_API_KEY,
  model: env.OPENROUTER_EMBEDDING_MODEL,
});
