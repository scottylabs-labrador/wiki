import { sourceCatalog } from "@wiki/common";
import { chunk, page } from "@wiki/db/schema";
import { asc, eq } from "drizzle-orm";

import { db } from "../lib/db.ts";

/** A stored Chunk, without the identifiers and embedding an admin cannot read. */
export interface CorpusChunk {
  heading: string | null;
  body: string;
}

/** A Page and the Chunks it currently holds, in reading order. */
export interface CorpusPage {
  sourceTitle: string;
  filename: string;
  publicUrl: string;
  chunks: CorpusChunk[];
}

function titleFor(sourceId: string): string {
  return sourceCatalog.find((source) => source.id === sourceId)?.title ?? sourceId;
}

function sourceOrder(sourceId: string): number {
  const index = sourceCatalog.findIndex((source) => source.id === sourceId);
  return index === -1 ? sourceCatalog.length : index;
}

export const corpusService = {
  /**
   * Every Page in the Corpus, each with its Chunks.
   *
   * Embeddings and row ids stay off the wire: the admin dashboard only needs
   * the text a reader would recognize. Pages keep their Source title so the
   * dashboard can tab by Source, then by Page.
   */
  listPages: async (): Promise<CorpusPage[]> => {
    const rows = await db
      .select({
        id: page.id,
        sourceId: page.sourceId,
        filename: page.filename,
        publicUrl: page.publicUrl,
        heading: chunk.heading,
        body: chunk.body,
        ordinal: chunk.ordinal,
      })
      .from(page)
      .leftJoin(chunk, eq(chunk.pageId, page.id))
      .orderBy(asc(page.filename), asc(page.publicUrl), asc(chunk.ordinal));

    const grouped = new Map<string, CorpusPage & { sourceId: string }>();
    for (const row of rows) {
      let group = grouped.get(row.id);
      if (!group) {
        group = {
          sourceId: row.sourceId,
          sourceTitle: titleFor(row.sourceId),
          filename: row.filename,
          publicUrl: row.publicUrl,
          chunks: [],
        };
        grouped.set(row.id, group);
      }
      if (row.body !== null) {
        group.chunks.push({ heading: row.heading, body: row.body });
      }
    }

    return [...grouped.values()]
      .sort((left, right) => {
        const bySource = sourceOrder(left.sourceId) - sourceOrder(right.sourceId);
        if (bySource !== 0) {
          return bySource;
        }
        return (
          left.filename.localeCompare(right.filename) ||
          left.publicUrl.localeCompare(right.publicUrl)
        );
      })
      .map(({ sourceId: _sourceId, ...page }) => page);
  },
};
