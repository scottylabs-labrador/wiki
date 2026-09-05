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
const CODE_FENCE = /^\s*(```|~~~)/;

/** Splits a Page at its markdown headings, keeping each heading with its text. */
export function splitIntoChunks(markdown: string): PageChunk[] {
  const slugger = new GithubSlugger();
  const chunks: PageChunk[] = [];
  let current: PageChunk = { heading: null, anchor: null, body: "" };
  const lines: string[] = [];
  let inCodeFence = false;

  const flush = () => {
    const body = lines.join("\n").trim();
    lines.length = 0;
    if (body) {
      chunks.push({ ...current, body });
    }
  };

  for (const line of markdown.split("\n")) {
    if (CODE_FENCE.test(line)) {
      inCodeFence = !inCodeFence;
    }

    // A shell comment inside a fence looks exactly like an ATX heading, and
    // this wiki is largely setup instructions.
    const heading = inCodeFence ? undefined : ATX_HEADING.exec(line)?.[1]?.trim();
    if (heading === undefined) {
      lines.push(line);
      continue;
    }

    flush();
    current = { heading, anchor: slugger.slug(heading), body: "" };
    lines.push(line);
  }
  flush();

  return chunks;
}
