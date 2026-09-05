import { chunk as chunkTable, page as pageTable } from "@wiki/db/schema";
import { cosineDistance, eq } from "drizzle-orm";

import type { Embedder } from "./embeddings.ts";
import type { CorpusDatabase } from "./ingestService.ts";

/** Nearest neighbours only: stuffing the whole Corpus is what ADR-0001 rejected. */
const MAX_CHUNKS = 8;

/** A stored Chunk, with the Page identity a later Citation can deep-link. */
export interface RetrievedChunk {
  body: string;
  heading: string | null;
  anchor: string | null;
  url: string;
}

/**
 * The Chunks most similar to a question, by cosine distance against stored
 * embeddings. Sequential scan is the point: at this Corpus size it beats an
 * approximate index. See ADR-0001.
 */
export async function retrieve({
  db,
  embedder,
  question,
}: {
  db: CorpusDatabase;
  embedder: Embedder;
  question: string;
}): Promise<RetrievedChunk[]> {
  const [present] = await db.select({ id: chunkTable.id }).from(chunkTable).limit(1);
  if (!present) {
    return [];
  }

  const [queryEmbedding] = await embedder.embed([question]);
  if (!queryEmbedding) {
    throw new Error(`${embedder.model} returned no vector for the question`);
  }

  return await db
    .select({
      body: chunkTable.body,
      heading: chunkTable.heading,
      anchor: chunkTable.anchor,
      url: pageTable.publicUrl,
    })
    .from(chunkTable)
    .innerJoin(pageTable, eq(chunkTable.pageId, pageTable.id))
    .orderBy(cosineDistance(chunkTable.embedding, queryEmbedding))
    .limit(MAX_CHUNKS);
}
