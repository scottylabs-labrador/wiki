import { chunk as chunkTable, page as pageTable } from "@wiki/db/schema";
import { cosineDistance, eq } from "drizzle-orm";

import { bm25IndexFor, bm25Ranks } from "./bm25.ts";
import type { Embedder } from "./embeddings.ts";
import type { CorpusDatabase } from "./ingestService.ts";

/** Nearest neighbours only: stuffing the whole Corpus is what ADR-0001 rejected. */
const MAX_CHUNKS = 8;

/** Reciprocal Rank Fusion constant. See ADR-0005. */
const RRF_K = 60;

/** A stored Chunk, with the Page identity a later Citation can deep-link. */
export interface RetrievedChunk {
  body: string;
  heading: string | null;
  anchor: string | null;
  url: string;
  filename: string;
  /** Cosine similarity to the question, 1 when identical and 0 when orthogonal. */
  similarity: number;
}

interface RankedChunk extends RetrievedChunk {
  id: string;
}

function cosineRanks(chunks: RankedChunk[]): Map<string, number> {
  const ordered = [...chunks].sort(
    (left, right) => right.similarity - left.similarity || left.id.localeCompare(right.id),
  );
  const ranks = new Map<string, number>();
  for (const [offset, chunk] of ordered.entries()) {
    ranks.set(chunk.id, offset + 1);
  }
  return ranks;
}

function rrfScore(cosineRank: number, lexicalRank: number | undefined): number {
  return 1 / (RRF_K + cosineRank) + (lexicalRank === undefined ? 0 : 1 / (RRF_K + lexicalRank));
}

/**
 * The Chunks to ground an Answer, ranked by Reciprocal Rank Fusion of cosine
 * similarity and BM25 over Chunk bodies, then dropped below the cosine
 * threshold. Sequential scan is the point: at this Corpus size it beats an
 * approximate index. See ADR-0001 and ADR-0005.
 */
export async function retrieve({
  db,
  embedder,
  question,
  minSimilarity = 0,
}: {
  db: CorpusDatabase;
  embedder: Embedder;
  question: string;
  /** Drop neighbours below this cosine similarity. Vector search cannot report "nothing found" on its own. */
  minSimilarity?: number;
}): Promise<RetrievedChunk[]> {
  const [present] = await db.select({ id: chunkTable.id }).from(chunkTable).limit(1);
  if (!present) {
    return [];
  }

  const [queryEmbedding] = await embedder.embed([question]);
  if (!queryEmbedding) {
    throw new Error(`${embedder.model} returned no vector for the question`);
  }

  const distance = cosineDistance(chunkTable.embedding, queryEmbedding);
  const neighbours = await db
    .select({
      id: chunkTable.id,
      body: chunkTable.body,
      heading: chunkTable.heading,
      anchor: chunkTable.anchor,
      url: pageTable.publicUrl,
      filename: pageTable.filename,
      distance,
    })
    .from(chunkTable)
    .innerJoin(pageTable, eq(chunkTable.pageId, pageTable.id));

  const chunks: RankedChunk[] = neighbours.map((neighbour) => ({
    id: neighbour.id,
    body: neighbour.body,
    heading: neighbour.heading,
    anchor: neighbour.anchor,
    url: neighbour.url,
    filename: neighbour.filename,
    similarity: 1 - Number(neighbour.distance),
  }));

  const dense = cosineRanks(chunks);
  const lexical = bm25Ranks(
    bm25IndexFor(chunks.map((chunk) => ({ id: chunk.id, body: chunk.body }))),
    question,
  );

  return chunks
    .map((chunk) => ({
      chunk,
      fused: rrfScore(dense.get(chunk.id) ?? chunks.length, lexical.get(chunk.id)),
    }))
    .sort(
      (left, right) => right.fused - left.fused || right.chunk.similarity - left.chunk.similarity,
    )
    .map(({ chunk }) => chunk)
    .filter((retrieved) => retrieved.similarity >= minSimilarity)
    .slice(0, MAX_CHUNKS)
    .map(({ body, heading, anchor, url, filename, similarity }) => ({
      body,
      heading,
      anchor,
      url,
      filename,
      similarity,
    }));
}
