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
export const CHUNKER_VERSION = 4;

const SECTION_HEADING = /^#{1,2}[ \t]+(.*)$/;
const CODE_FENCE = /^[ \t]*(`{3,}|~{3,})/;
/** Pandoc-style id so an HTML Source can keep the anchors it already publishes. */
const EXPLICIT_ANCHOR = /^(.*?)\s*\{#([^\s}]+)\}\s*$/;

/**
 * Embedding models reject a Chunk over 8192 tokens. Three characters per
 * token is conservative for English, so this stays under that window without
 * pulling in a tokenizer.
 */
const MAX_CHUNK_CHARS = 8192 * 3;

/**
 * Splits a Page at its `#` and `##` headings, keeping each heading with its text.
 *
 * Nested headings (`###` and below) stay inside the section they sit under. A
 * section larger than the embedding window is split further, still citing the
 * same heading. A Page with nothing to retrieve yields no Chunks at all,
 * rather than one empty Chunk: an embedded empty string is a vector that
 * answers every query and cites a Page that says nothing. Such a Page is still
 * ingested, so it can be cited as a whole once someone writes it.
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

  return chunks.flatMap(splitOversized);
}

/**
 * Cuts a section that would not fit in one embedding request, keeping the
 * heading and anchor so each piece still deep-links to the same place.
 */
function splitOversized(chunk: PageChunk): PageChunk[] {
  if (chunk.body.length <= MAX_CHUNK_CHARS) {
    return [chunk];
  }

  return splitBody(chunk.body).map((body) => ({ ...chunk, body }));
}

function splitBody(body: string): string[] {
  const pieces: string[] = [];
  let remaining = body;

  while (remaining.length > MAX_CHUNK_CHARS) {
    const window = remaining.slice(0, MAX_CHUNK_CHARS);
    const cut =
      lastBreak(window, "\n\n") ??
      lastBreak(window, "\n") ??
      lastBreak(window, " ") ??
      MAX_CHUNK_CHARS;
    const piece = remaining.slice(0, cut).trim();
    if (piece) {
      pieces.push(piece);
    }
    remaining = remaining.slice(cut).trimStart();
  }

  const tail = remaining.trim();
  if (tail) {
    pieces.push(tail);
  }
  return pieces;
}

function lastBreak(window: string, separator: string): number | undefined {
  const index = window.lastIndexOf(separator);
  // A break at the start would not advance and would loop forever.
  if (index <= 0) {
    return undefined;
  }
  return index + separator.length;
}
