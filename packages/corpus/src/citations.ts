import type { RetrievedChunk } from "./retrieve.ts";

/** How many Pages an Answer may cite. */
export const MAX_CITATIONS = 3;

/** A link to the section of a Page that an Answer drew on. */
export interface Citation {
  title: string;
  url: string;
}

/**
 * Citations for an Answer, computed from the Chunks retrieval actually returned.
 *
 * One entry per Page, deep-linked to that Page's most similar Chunk, ranked by
 * that similarity and capped. The model is never asked to write these, because
 * it invents plausible URLs. See ADR-0002.
 */
export function citationsFrom(chunks: RetrievedChunk[]): Citation[] {
  const bestByPage = new Map<string, RetrievedChunk>();
  for (const retrieved of chunks) {
    const current = bestByPage.get(retrieved.url);
    if (!current || retrieved.similarity > current.similarity) {
      bestByPage.set(retrieved.url, retrieved);
    }
  }

  return [...bestByPage.values()]
    .sort((left, right) => right.similarity - left.similarity)
    .slice(0, MAX_CITATIONS)
    .map((retrieved) => ({
      title: pageTitle(retrieved.filename),
      url: retrieved.anchor ? `${retrieved.url}#${retrieved.anchor}` : retrieved.url,
    }));
}

function pageTitle(filename: string): string {
  return filename.replace(/\.(md|html)$/i, "");
}
