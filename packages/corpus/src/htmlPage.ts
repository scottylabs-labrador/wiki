import { createHash } from "node:crypto";

import type { Source, SourcePage } from "./ingestService.ts";

/**
 * Turns a hand-written HTML Page into markdown the chunker can split.
 *
 * Stylesheets, scripts and other chrome are dropped so the Corpus holds the
 * words a member would read, not the colours they were drawn in. Heading ids
 * the Page already publishes are kept as `{#anchor}` so Citations deep-link
 * the same way the Page does.
 */
export function htmlToMarkdown(html: string): string {
  const withoutChrome = html
    .replace(/<script\b[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[\s\S]*?<\/style>/gi, "")
    .replace(/<link\b[^>]*>/gi, "")
    .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, "")
    .replace(/<svg\b[\s\S]*?<\/svg>/gi, "");

  const withHeadings = withoutChrome.replace(
    /<h([1-6])([^>]*)>([\s\S]*?)<\/h\1>/gi,
    (_unused, level: string, attrs: string, inner: string) => {
      const text = decodeEntities(stripTags(inner.replace(/<br\s*\/?>/gi, " "))).trim();
      const anchor = headingAnchor(attrs, inner);
      const mark = "#".repeat(Number(level));
      return `\n\n${mark} ${text}${anchor ? ` {#${anchor}}` : ""}\n\n`;
    },
  );

  const withLists = withHeadings.replace(
    /<li\b[^>]*>([\s\S]*?)<\/li>/gi,
    (_unused, inner: string) => `- ${decodeEntities(stripTags(inner)).trim()}\n`,
  );

  const withBreaks = withLists
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|section|article|tr|blockquote)>/gi, "\n\n");

  const text = decodeEntities(stripTags(withBreaks))
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return text;
}

/**
 * A single static HTML Page, fetched over HTTPS.
 *
 * `headSha` hashes the HTML so an unchanged Page costs one GET and no
 * embeddings, matching how a git wiki costs one remote-info before a clone.
 */
export function htmlPage(opts: { id: string; url: string; filename: string }): Source {
  const { id, url, filename } = opts;
  let cached: { sha: string; markdown: string } | null = null;

  async function load() {
    if (cached) {
      return cached;
    }

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`${url} returned ${response.status}`);
    }

    const html = await response.text();
    cached = {
      sha: createHash("sha256").update(html).digest("hex"),
      markdown: htmlToMarkdown(html),
    };
    return cached;
  }

  return {
    id,
    pageUrl: () => url,
    async headSha() {
      return (await load()).sha;
    },
    async fetchPages(): Promise<SourcePage[]> {
      return [{ filename, markdown: (await load()).markdown }];
    },
  };
}

function headingAnchor(attrs: string, inner: string): string | undefined {
  const fromLink = /href\s*=\s*["']#([^"']+)["']/.exec(inner)?.[1];
  if (fromLink) {
    return fromLink;
  }
  return /\bid\s*=\s*["']([^"']+)["']/.exec(attrs)?.[1];
}

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, " ");
}

function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_unused, code: string) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_unused, code: string) =>
      String.fromCharCode(Number.parseInt(code, 16)),
    )
    .replace(/[ \t]{2,}/g, " ");
}
