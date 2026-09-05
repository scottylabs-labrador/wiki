import { chunk, page, sourceIngest } from "@wiki/db/schema";
import { asc, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { EMBEDDING_DIMENSIONS } from "../src/embeddings.ts";
import { ingest } from "../src/ingestService.ts";
import { testDb } from "./harness.ts";

const SOURCE_ID = "test-wiki";

/** A Source that serves fixture Pages, counting how often it is cloned. */
function fakeSource(opts: { sha: string; pages: Record<string, string> }) {
  let clones = 0;
  return {
    id: SOURCE_ID,
    headSha: () => Promise.resolve(opts.sha),
    fetchPages: () => {
      clones += 1;
      return Promise.resolve(
        Object.entries(opts.pages).map(([filename, markdown]) => ({ filename, markdown })),
      );
    },
    pageUrl: (filename: string) => `https://wiki.example.com/${filename.replace(/\.md$/, "")}`,
    get clones() {
      return clones;
    },
  };
}

/**
 * An embedder whose vectors vary with the text but never call out to a model,
 * counting how many Chunks it was asked to embed.
 */
function fakeEmbedder(model = "fake-embed-v1") {
  let embedded = 0;
  return {
    model,
    embed: (texts: string[]) => {
      embedded += texts.length;
      return Promise.resolve(
        texts.map((text) => Array.from({ length: EMBEDDING_DIMENSIONS }, () => text.length / 100)),
      );
    },
    get embedded() {
      return embedded;
    },
  };
}

async function storedChunks() {
  return await testDb
    .select({ heading: chunk.heading, anchor: chunk.anchor, url: page.publicUrl })
    .from(chunk)
    .innerJoin(page, eq(chunk.pageId, page.id))
    .orderBy(asc(page.filename), asc(chunk.ordinal));
}

/** Every row the Corpus holds, ids included, so an unchanged run is provably so. */
async function allRows() {
  const [pages, chunks, ingests] = await Promise.all([
    testDb.select().from(page).orderBy(asc(page.filename)),
    testDb.select().from(chunk).orderBy(asc(chunk.pageId), asc(chunk.ordinal)),
    testDb.select().from(sourceIngest),
  ]);
  return { pages, chunks, ingests };
}

async function storedModel() {
  const [row] = await testDb.select().from(sourceIngest);
  return row?.embeddingModel;
}

describe("ingest", () => {
  it("stores each Page's Chunks with what a Citation needs to deep-link them", async () => {
    const source = fakeSource({
      sha: "abc123",
      pages: {
        "Frontend.md": ["## Client", "", "React.", "", "## Styling", "", "Tailwind."].join("\n"),
      },
    });

    await ingest({ db: testDb, source, embedder: fakeEmbedder() });

    expect(await storedChunks()).toEqual([
      { heading: "Client", anchor: "client", url: "https://wiki.example.com/Frontend" },
      { heading: "Styling", anchor: "styling", url: "https://wiki.example.com/Frontend" },
    ]);
  });

  it("ingests a stub Page as it is rather than skipping it", async () => {
    const source = fakeSource({
      sha: "abc123",
      pages: { "Contribution.md": "See the base contributing guide." },
    });

    await ingest({ db: testDb, source, embedder: fakeEmbedder() });

    expect(await storedChunks()).toEqual([
      { heading: null, anchor: null, url: "https://wiki.example.com/Contribution" },
    ]);
  });

  it("embeds nothing and changes nothing when the Source has not moved", async () => {
    const source = fakeSource({ sha: "abc123", pages: { "Auth.md": "## Auth\n\nKeycloak." } });
    const embedder = fakeEmbedder();

    await ingest({ db: testDb, source, embedder });
    const afterFirst = await allRows();

    const outcome = await ingest({ db: testDb, source, embedder });

    expect(outcome.unchanged).toBe(true);
    expect(await allRows()).toEqual(afterFirst);
    // One Chunk embedded by the first run, and none by the second.
    expect(embedder.embedded).toBe(1);
    // The second run did not even clone.
    expect(source.clones).toBe(1);
  });

  it("rebuilds when the same commit is chunked or embedded differently", async () => {
    const source = fakeSource({ sha: "abc123", pages: { "Auth.md": "## Auth\n\nKeycloak." } });

    await ingest({ db: testDb, source, embedder: fakeEmbedder("embed-v1") });
    const outcome = await ingest({ db: testDb, source, embedder: fakeEmbedder("embed-v2") });

    expect(outcome.unchanged).toBe(false);
    expect(await storedModel()).toBe("embed-v2");
  });

  it("leaves the previous Corpus intact when embedding fails partway", async () => {
    const first = fakeSource({ sha: "abc123", pages: { "Auth.md": "## Auth\n\nKeycloak." } });
    await ingest({ db: testDb, source: first, embedder: fakeEmbedder() });
    const afterFirst = await allRows();

    const moved = fakeSource({ sha: "def456", pages: { "Auth.md": "## Auth\n\nRewritten." } });
    const broken = {
      model: "fake-embed-v1",
      embed: () => Promise.reject(new Error("embeddings provider is down")),
    };

    await expect(ingest({ db: testDb, source: moved, embedder: broken })).rejects.toThrow(
      "embeddings provider is down",
    );
    expect(await allRows()).toEqual(afterFirst);
  });

  it("leaves the previous Corpus intact when a write fails partway", async () => {
    const first = fakeSource({ sha: "abc123", pages: { "Auth.md": "## Auth\n\nKeycloak." } });
    await ingest({ db: testDb, source: first, embedder: fakeEmbedder() });
    const afterFirst = await allRows();

    const moved = fakeSource({
      sha: "def456",
      pages: { "Auth.md": "## Auth\n\nRewritten.", "Backend.md": "## Backend\n\nExpress." },
    });
    // A vector of the wrong width is rejected by the column, midway through
    // writing the second Page.
    let call = 0;
    const wrongWidth = {
      model: "fake-embed-v1",
      embed: (texts: string[]) =>
        Promise.resolve(
          texts.map(() => {
            call += 1;
            return Array.from({ length: call === 1 ? EMBEDDING_DIMENSIONS : 3 }, () => 0.1);
          }),
        ),
    };

    await expect(ingest({ db: testDb, source: moved, embedder: wrongWidth })).rejects.toThrow();
    expect(await allRows()).toEqual(afterFirst);
  });
});
