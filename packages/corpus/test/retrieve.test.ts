import { chunk, EMBEDDING_DIMENSIONS, page } from "@wiki/db/schema";
import { describe, expect, it } from "vitest";

import { retrieve } from "../src/retrieve.ts";
import { testDb } from "./harness.ts";

const AUTH_BODY = "Committee members sign in with Keycloak.";
const STYLING_BODY = "The frontend is styled with Tailwind CSS.";
const AUTH_QUESTION = "What does ScottyStack use for authentication?";

function unitVector(axis: number): number[] {
  const vector = Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0);
  vector[axis] = 1;
  return vector;
}

function fakeEmbedder(model: string, embeddings: Record<string, number[]>) {
  const embedded: string[] = [];
  return {
    model,
    embed: (texts: string[]) => {
      embedded.push(...texts);
      return Promise.resolve(
        texts.map((text) => {
          const vector = embeddings[text];
          if (!vector) {
            throw new Error(`no embedding stubbed for ${JSON.stringify(text)}`);
          }
          return vector;
        }),
      );
    },
    get embedded() {
      return embedded;
    },
  };
}

async function storeChunk(opts: { filename: string; body: string; embedding: number[] }) {
  const [inserted] = await testDb
    .insert(page)
    .values({
      sourceId: "test-wiki",
      filename: opts.filename,
      publicUrl: `https://wiki.example.com/${opts.filename.replace(/\.md$/, "")}`,
    })
    .returning({ id: page.id });

  if (!inserted) {
    throw new Error(`Failed to store Page ${opts.filename}`);
  }

  await testDb.insert(chunk).values({
    pageId: inserted.id,
    body: opts.body,
    ordinal: 0,
    embedding: opts.embedding,
  });
}

describe("retrieve", () => {
  it("returns the Chunk whose embedding is closer to the question first", async () => {
    // The distractor is stored first so an unordered scan would surface it.
    await storeChunk({ filename: "Styling.md", body: STYLING_BODY, embedding: unitVector(1) });
    await storeChunk({ filename: "Auth.md", body: AUTH_BODY, embedding: unitVector(0) });

    const embedder = fakeEmbedder("fake-embed-v1", { [AUTH_QUESTION]: unitVector(0) });
    const retrieved = await retrieve({ db: testDb, embedder, question: AUTH_QUESTION });

    expect(retrieved[0]?.body).toBe(AUTH_BODY);
  });

  it("returns nothing from an empty Corpus without embedding the question", async () => {
    const embedder = fakeEmbedder("fake-embed-v1", {});
    const retrieved = await retrieve({
      db: testDb,
      embedder,
      question: AUTH_QUESTION,
    });

    expect(retrieved).toEqual([]);
    expect(embedder.embedded).toEqual([]);
  });

  it("embeds the question with the same embedder the Corpus was built with", async () => {
    await storeChunk({ filename: "Auth.md", body: AUTH_BODY, embedding: unitVector(0) });

    const embedder = fakeEmbedder("openai/text-embedding-3-small", {
      [AUTH_QUESTION]: unitVector(0),
    });
    await retrieve({ db: testDb, embedder, question: AUTH_QUESTION });

    expect(embedder.model).toBe("openai/text-embedding-3-small");
    expect(embedder.embedded).toEqual([AUTH_QUESTION]);
  });
});
