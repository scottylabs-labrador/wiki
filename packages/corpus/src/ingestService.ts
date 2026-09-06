import {
  chunk as chunkTable,
  page as pageTable,
  sourceIngest as sourceIngestTable,
} from "@wiki/db/schema";
import { eq } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";

import { CHUNKER_VERSION, splitIntoChunks } from "./chunker.ts";
import type { Embedder } from "./embeddings.ts";

/** One document as its Source serves it, before it is split or embedded. */
export interface SourcePage {
  filename: string;
  markdown: string;
}

/**
 * Where a Source's Pages come from.
 *
 * `headSha` is separate from `fetchPages` so an unchanged Source costs one
 * request rather than a clone.
 */
export interface Source {
  id: string;
  headSha(): Promise<string>;
  fetchPages(): Promise<SourcePage[]>;
  pageUrl(filename: string): string;
}

/**
 * Any Postgres the Corpus can be written to.
 *
 * Deliberately the driver-agnostic base rather than the server's pooled
 * client, so tests can run ingestion against an in-process database.
 */
export type CorpusDatabase = PgDatabase<PgQueryResultHKT>;

export interface IngestOutcome {
  sourceId: string;
  upstreamSha: string;
  /** True when the Corpus already held this exact ingestion, so nothing ran. */
  unchanged: boolean;
  pages: number;
  chunks: number;
}

/**
 * Replaces a Source's share of the Corpus with what it currently publishes.
 *
 * Nothing is embedded or written when the Source's commit, the embedding model
 * and the chunker all match the last completed run, because a nightly schedule
 * calls this whether or not anything moved upstream. `bypassStaleCheck` skips
 * that fingerprint and rebuilds anyway.
 *
 * Embedding happens before the write and the write happens in one transaction,
 * so a failure at any point leaves the previous Corpus exactly as it was.
 */
export async function ingest({
  db,
  source,
  embedder,
  bypassStaleCheck = false,
}: {
  db: CorpusDatabase;
  source: Source;
  embedder: Embedder;
  /** Rebuild even when the fingerprint matches the last completed run. */
  bypassStaleCheck?: boolean;
}): Promise<IngestOutcome> {
  const upstreamSha = await source.headSha();
  const fingerprint = {
    upstreamSha,
    embeddingModel: embedder.model,
    chunkerVersion: CHUNKER_VERSION,
  };

  const [previous] = await db
    .select()
    .from(sourceIngestTable)
    .where(eq(sourceIngestTable.sourceId, source.id));

  if (
    !bypassStaleCheck &&
    previous?.upstreamSha === fingerprint.upstreamSha &&
    previous.embeddingModel === fingerprint.embeddingModel &&
    previous.chunkerVersion === fingerprint.chunkerVersion
  ) {
    return { sourceId: source.id, upstreamSha, unchanged: true, pages: 0, chunks: 0 };
  }

  const chunkedPages = (await source.fetchPages()).map((sourcePage) => ({
    filename: sourcePage.filename,
    chunks: splitIntoChunks(sourcePage.markdown),
  }));

  const bodies = chunkedPages.flatMap((sourcePage) =>
    sourcePage.chunks.map((pageChunk) => pageChunk.body),
  );
  const embeddings = await embedder.embed(bodies);

  // Pair each Chunk with its vector up front, so the transaction below is
  // nothing but writes.
  const vectors = embeddings[Symbol.iterator]();
  const embeddedPages = chunkedPages.map((sourcePage) => ({
    filename: sourcePage.filename,
    chunks: sourcePage.chunks.map((pageChunk, ordinal) => {
      const { value: embedding } = vectors.next();
      if (!embedding) {
        throw new Error(
          `${embedder.model} returned ${embeddings.length} vectors for ${bodies.length} Chunks`,
        );
      }
      return { ...pageChunk, ordinal, embedding };
    }),
  }));

  await db.transaction(async (tx) => {
    // Chunks cascade from their Page.
    await tx.delete(pageTable).where(eq(pageTable.sourceId, source.id));

    for (const sourcePage of embeddedPages) {
      const [inserted] = await tx
        .insert(pageTable)
        .values({
          sourceId: source.id,
          filename: sourcePage.filename,
          publicUrl: source.pageUrl(sourcePage.filename),
        })
        .returning({ id: pageTable.id });

      if (!inserted) {
        throw new Error(`Failed to store Page ${sourcePage.filename}`);
      }

      if (sourcePage.chunks.length > 0) {
        await tx
          .insert(chunkTable)
          .values(sourcePage.chunks.map((pageChunk) => ({ ...pageChunk, pageId: inserted.id })));
      }
    }

    const completed = { ...fingerprint, ingestedAt: new Date() };
    await tx
      .insert(sourceIngestTable)
      .values({ sourceId: source.id, ...completed })
      .onConflictDoUpdate({ target: sourceIngestTable.sourceId, set: completed });
  });

  return {
    sourceId: source.id,
    upstreamSha,
    unchanged: false,
    pages: embeddedPages.length,
    chunks: bodies.length,
  };
}

/**
 * Ingests each Source on its own, so a failure in one cannot roll back another.
 */
export async function ingestAll({
  db,
  sources,
  embedder,
  bypassStaleCheck = false,
}: {
  db: CorpusDatabase;
  sources: Source[];
  embedder: Embedder;
  bypassStaleCheck?: boolean;
}): Promise<{ outcomes: IngestOutcome[]; failures: Array<{ sourceId: string; error: unknown }> }> {
  const outcomes: IngestOutcome[] = [];
  const failures: Array<{ sourceId: string; error: unknown }> = [];

  for (const source of sources) {
    try {
      outcomes.push(await ingest({ db, source, embedder, bypassStaleCheck }));
    } catch (error) {
      failures.push({ sourceId: source.id, error });
    }
  }

  return { outcomes, failures };
}
