import { ingestAll, openRouterEmbedder, sources } from "@wiki/corpus";
import { createDb } from "@wiki/db";

import { env } from "./env.ts";

/**
 * Populates the Corpus from every Source, then exits.
 *
 * Terminating matters as much as the ingestion does: a scheduled run still
 * going when the next is due means the next is silently skipped, so a process
 * that hangs stops the Corpus updating with nothing to show for it.
 *
 * Each Source is committed on its own, so a clone that fails cannot roll back
 * one that already succeeded.
 */
async function main() {
  const db = createDb(env.DATABASE_URL);
  try {
    const { outcomes, failures } = await ingestAll({
      db,
      sources,
      embedder: openRouterEmbedder({
        apiKey: env.OPENROUTER_API_KEY,
        model: env.OPENROUTER_EMBEDDING_MODEL,
      }),
    });

    for (const outcome of outcomes) {
      console.log(
        outcome.unchanged
          ? `${outcome.sourceId} is already at ${outcome.upstreamSha}, so nothing was embedded.`
          : `Ingested ${outcome.pages} Pages as ${outcome.chunks} Chunks from ${outcome.sourceId} at ${outcome.upstreamSha}.`,
      );
    }

    for (const failure of failures) {
      console.error(`Ingestion of ${failure.sourceId} failed:`, failure.error);
    }

    if (failures.length > 0) {
      process.exitCode = 1;
    }
  } finally {
    await db.$client.end();
  }
}

main().catch((error: unknown) => {
  console.error("Ingestion failed:", error);
  process.exit(1);
});
