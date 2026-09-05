import { chunk, page, sourceIngest } from "@wiki/db/schema";
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
 * calls this whether or not anything moved upstream.
 *
 * Embedding happens before the write and the write happens in one transaction,
 * so a failure at any point leaves the previous Corpus exactly as it was.
 */
export async function ingest(deps: {
  db: CorpusDatabase;
  source: Source;
  embedder: Embedder;
}): Promise<IngestOutcome> {
  const { db, source, embedder } = deps;
  const upstreamSha = await source.headSha();

  const [previous] = await db
    .select()
    .from(sourceIngest)
    .where(eq(sourceIngest.sourceId, source.id));

  if (
    previous?.upstreamSha === upstreamSha &&
    previous.embeddingModel === embedder.model &&
    previous.chunkerVersion === CHUNKER_VERSION
  ) {
    return { sourceId: source.id, upstreamSha, unchanged: true, pages: 0, chunks: 0 };
  }

  const pages = await source.fetchPages();
  const split = pages.map((sourcePage) => ({
    ...sourcePage,
    chunks: splitIntoChunks(sourcePage.markdown),
  }));

  const bodies = split.flatMap((sourcePage) => sourcePage.chunks.map((one) => one.body));
  const embeddings = await embedder.embed(bodies);
  if (embeddings.length !== bodies.length) {
    throw new Error(`Embedded ${embeddings.length} of ${bodies.length} Chunks`);
  }

  // Pair each Chunk with its vector up front, so the transaction below is
  // nothing but writes.
  const vectors = embeddings[Symbol.iterator]();
  const embedded = split.map((sourcePage) => ({
    filename: sourcePage.filename,
    chunks: sourcePage.chunks.map((one, ordinal) => {
      const { value: embedding } = vectors.next();
      if (!embedding) {
        throw new Error(`Missing an embedding for ${sourcePage.filename}`);
      }
      return { ...one, ordinal, embedding };
    }),
  }));

  await db.transaction(async (tx) => {
    // Chunks cascade from their Page.
    await tx.delete(page).where(eq(page.sourceId, source.id));

    for (const sourcePage of embedded) {
      const [inserted] = await tx
        .insert(page)
        .values({
          sourceId: source.id,
          filename: sourcePage.filename,
          publicUrl: source.pageUrl(sourcePage.filename),
        })
        .returning({ id: page.id });

      if (!inserted) {
        throw new Error(`Failed to store Page ${sourcePage.filename}`);
      }

      if (sourcePage.chunks.length > 0) {
        await tx
          .insert(chunk)
          .values(sourcePage.chunks.map((one) => ({ ...one, pageId: inserted.id })));
      }
    }

    await tx
      .insert(sourceIngest)
      .values({
        sourceId: source.id,
        upstreamSha,
        embeddingModel: embedder.model,
        chunkerVersion: CHUNKER_VERSION,
        ingestedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: sourceIngest.sourceId,
        set: {
          upstreamSha,
          embeddingModel: embedder.model,
          chunkerVersion: CHUNKER_VERSION,
          ingestedAt: new Date(),
        },
      });
  });

  return {
    sourceId: source.id,
    upstreamSha,
    unchanged: false,
    pages: embedded.length,
    chunks: bodies.length,
  };
}
