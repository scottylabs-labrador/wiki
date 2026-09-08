import GithubSlugger from "github-slugger";

/**
 * A passage of a Page, small enough to retrieve on its own.
 *
 * `heading` and `anchor` are null for a passage no heading introduces, which
 * can only be cited by linking to its Page as a whole.
 */
export interface PageChunk {
  heading: string | null;
  anchor: string | null;
  body: string;
}

/**
 * How this module splits a Page, bumped whenever that changes.
 *
 * It is part of an ingestion's fingerprint: a new chunker produces different
 * Chunks from the same commit, so the Corpus has to be rebuilt even though
 * nothing moved upstream.
 */
export const CHUNKER_VERSION = 3;

const SECTION_HEADING = /^#{1,2}[ \t]+(.*)$/;
const CODE_FENCE = /^[ \t]*(`{3,}|~{3,})/;
/** Pandoc-style id so an HTML Source can keep the anchors it already publishes. */
const EXPLICIT_ANCHOR = /^(.*?)\s*\{#([^\s}]+)\}\s*$/;

/**
 * Splits a Page at its `#` and `##` headings, keeping each heading with its text.
 *
 * Nested headings (`###` and below) stay inside the section they sit under. A Page with nothing
 * to retrieve yields no Chunks at all, rather than one empty Chunk: an
 * embedded empty string is a vector that answers every query and cites a Page
 * that says nothing. Such a Page is still ingested, so it can be cited as a
 * whole once someone writes it.
 */
export function splitIntoChunks(markdown: string): PageChunk[] {
  const slugger = new GithubSlugger();
  const chunks: PageChunk[] = [];
  let current: PageChunk = { heading: null, anchor: null, body: "" };
  const lines: string[] = [];
  let fence: string | null = null;

  // Closes off the section being read. A section that turned out to hold no
  // text is dropped, so a Page cannot contribute an empty Chunk.
  function flush() {
    const body = lines.join("\n").trim();
    lines.length = 0;
    if (body) {
      chunks.push({ ...current, body });
    }
  }

  function startSection(heading: string) {
    flush();
    const explicit = EXPLICIT_ANCHOR.exec(heading);
    const title = explicit?.[1]?.trim() || heading;
    const anchor = explicit?.[2] ?? slugger.slug(title);
    current = { heading: title, anchor, body: "" };
  }

  for (const line of markdown.split("\n")) {
    const marker = CODE_FENCE.exec(line)?.[1]?.[0];
    if (marker !== undefined) {
      // A fence ends only on the character that opened it, so the other marker
      // in between is ordinary text.
      if (fence === null) {
        fence = marker;
      } else if (fence === marker) {
        fence = null;
      }
      lines.push(line);
      continue;
    }

    // A shell comment inside a fence looks exactly like a heading, and this
    // wiki is largely setup instructions.
    if (fence !== null) {
      lines.push(line);
      continue;
    }

    const sectionHeading = SECTION_HEADING.exec(line)?.[1]?.trim();
    if (sectionHeading !== undefined) {
      startSection(sectionHeading);
      lines.push(line);
      continue;
    }

    lines.push(line);
  }
  flush();

  return chunks;
}
