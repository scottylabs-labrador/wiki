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
export const CHUNKER_VERSION = 1;

const ATX_HEADING = /^#{1,6}[ \t]+(.*)$/;
const SETEXT_UNDERLINE = /^[ \t]*(?:=+|-+)[ \t]*$/;
const CODE_FENCE = /^[ \t]*(`{3,}|~{3,})/;

/**
 * Splits a Page at its markdown headings, keeping each heading with its text.
 *
 * A Page with nothing to retrieve yields no Chunks at all, rather than one
 * empty Chunk: an embedded empty string is a vector that answers every query
 * and cites a Page that says nothing. Such a Page is still ingested, so it can
 * be cited as a whole once someone writes it.
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
    current = { heading, anchor: slugger.slug(heading), body: "" };
  }

  const source = markdown.split("\n");
  for (let index = 0; index < source.length; index += 1) {
    const line = source[index] ?? "";

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

    // A shell comment inside a fence looks exactly like an ATX heading, and
    // this wiki is largely setup instructions.
    if (fence !== null) {
      lines.push(line);
      continue;
    }

    const atxHeading = ATX_HEADING.exec(line)?.[1]?.trim();
    if (atxHeading !== undefined) {
      startSection(atxHeading);
      lines.push(line);
      continue;
    }

    // GitHub anchors an underlined heading too. The underline has to fall under
    // a line standing on its own, which is what keeps a thematic break rule
    // trailing a paragraph from reading as a heading.
    const underlined =
      line.trim() !== "" &&
      SETEXT_UNDERLINE.test(source[index + 1] ?? "") &&
      (lines.length === 0 || lines[lines.length - 1]?.trim() === "");
    if (underlined) {
      startSection(line.trim());
      lines.push(line, source[index + 1] ?? "");
      index += 1;
      continue;
    }

    lines.push(line);
  }
  flush();

  return chunks;
}
