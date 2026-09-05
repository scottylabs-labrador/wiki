import fs from "node:fs";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import git from "isomorphic-git";
import http from "isomorphic-git/http/node";

import type { Source, SourcePage } from "./ingestService.ts";

/** Identifies this Source's Pages and Chunks in the Corpus. */
export const SOURCE_ID = "scottystack-wiki";

/**
 * GitHub wikis are ordinary git repositories, and the REST API does not expose
 * their content at all. This one is public, so it clones without credentials,
 * which is what lets an unattended run fetch it with no token to hold.
 */
const CLONE_URL = "https://github.com/scottylabs-labrador/ScottyStack.wiki.git";

const WIKI_URL = "https://github.com/scottylabs-labrador/ScottyStack/wiki";

/**
 * The public URL a wiki filename is published at.
 *
 * The filename is percent-encoded exactly as the Source spells it and is never
 * Unicode-normalised: some Page titles use lookalike punctuation, and
 * transliterating it to ASCII produces a 404. See ADR-0002.
 */
export function pageUrl(filename: string): string {
  return `${WIKI_URL}/${encodeURIComponent(filename.replace(/\.md$/, ""))}`;
}

/**
 * Whether a file in the wiki repository is a Page a reader can open.
 *
 * Files whose names begin with an underscore are the chrome GitHub renders
 * around every Page, such as `_Sidebar`, and have no URL of their own.
 */
export function isPage(filename: string): boolean {
  return filename.endsWith(".md") && !filename.startsWith("_");
}

/** The ScottyStack wiki, cloned anonymously over HTTPS. */
export const scottyStackWiki: Source = {
  id: SOURCE_ID,
  pageUrl,

  async headSha() {
    const info = await git.getRemoteInfo({ http, url: CLONE_URL });
    const sha = info.HEAD && info.refs?.heads?.[info.HEAD.replace("refs/heads/", "")];
    if (typeof sha !== "string") {
      throw new Error(`${CLONE_URL} did not report a HEAD commit`);
    }
    return sha;
  },

  async fetchPages() {
    const dir = await mkdtemp(path.join(tmpdir(), "scottystack-wiki-"));
    try {
      await git.clone({ fs, http, dir, url: CLONE_URL, singleBranch: true, depth: 1 });

      // Only the repository's top level, because that is the whole of what
      // GitHub publishes as Pages.
      const pages: SourcePage[] = [];
      for (const filename of (await readdir(dir)).filter(isPage)) {
        pages.push({ filename, markdown: await readFile(path.join(dir, filename), "utf8") });
      }
      return pages;
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  },
};
