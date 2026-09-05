import { ingest, openRouterEmbedder, scottyStackWiki } from "@wiki/corpus";
import { createDb } from "@wiki/db";

import { env } from "./env.ts";

/**
 * Populates the Corpus from the ScottyStack wiki, then exits.
 *
 * Terminating matters as much as the ingestion does: a scheduled run still
 * going when the next is due means the next is silently skipped, so a process
 * that hangs stops the Corpus updating with nothing to show for it.
 */
async function main() {
  const db = createDb(env.DATABASE_URL);
  try {
    const outcome = await ingest({
      db,
      source: scottyStackWiki,
      embedder: openRouterEmbedder({
        apiKey: env.OPENROUTER_API_KEY,
        model: env.OPENROUTER_EMBEDDING_MODEL,
      }),
    });

    console.log(
      outcome.unchanged
        ? `${outcome.sourceId} is already at ${outcome.upstreamSha}, so nothing was embedded.`
        : `Ingested ${outcome.pages} Pages as ${outcome.chunks} Chunks from ${outcome.sourceId} at ${outcome.upstreamSha}.`,
    );
  } finally {
    await db.$client.end();
  }
}

main().catch((error: unknown) => {
  console.error("Ingestion failed:", error);
  process.exit(1);
});
