import { chunk, EMBEDDING_DIMENSIONS, page } from "@wiki/db/schema";
import { describe, expect, it } from "vitest";

import { retrieve } from "../src/retrieve.ts";
import { resetDb, testDb } from "./harness.ts";

const AUTH_BODY = "Committee members sign in with Keycloak.";
const STYLING_BODY = "The frontend is styled with Tailwind CSS.";
const AUTH_QUESTION = "What does ScottyStack use for authentication?";

function unitVector(axis: number): number[] {
  const vector = Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0);
  vector[axis] = 1;
  return vector;
}

/** Unit vector whose cosine with `unitVector(0)` is `along`. */
function cosineAlongFirst(along: number): number[] {
  const vector = Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0);
  vector[0] = along;
  vector[1] = Math.sqrt(1 - along * along);
  return vector;
}

const FILLER_COUNT = 8;

async function storeFillers(embedding: number[]) {
  for (let index = 0; index < FILLER_COUNT; index += 1) {
    await storeChunk({
      filename: `Filler${index}.md`,
      body: `Filler passage ${index} about committee process and onboarding.`,
      embedding,
    });
  }
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

  it("drops Chunks that fall below the similarity threshold", async () => {
    await storeChunk({ filename: "Styling.md", body: STYLING_BODY, embedding: unitVector(1) });
    await storeChunk({ filename: "Auth.md", body: AUTH_BODY, embedding: unitVector(0) });

    const embedder = fakeEmbedder("fake-embed-v1", { [AUTH_QUESTION]: unitVector(0) });
    const retrieved = await retrieve({
      db: testDb,
      embedder,
      question: AUTH_QUESTION,
      minSimilarity: 0.5,
    });

    expect(retrieved.map((item) => item.body)).toEqual([AUTH_BODY]);
    expect(retrieved[0]?.similarity).toBeCloseTo(1);
  });

  it("returns nothing when no Chunk is similar enough", async () => {
    await storeChunk({ filename: "Styling.md", body: STYLING_BODY, embedding: unitVector(1) });

    const embedder = fakeEmbedder("fake-embed-v1", { [AUTH_QUESTION]: unitVector(0) });
    const retrieved = await retrieve({
      db: testDb,
      embedder,
      question: AUTH_QUESTION,
      minSimilarity: 0.5,
    });

    expect(retrieved).toEqual([]);
  });

  it("promotes a BM25-rank-1 Chunk that cosine ranked outside the cap when it still passes the threshold", async () => {
    const identifier = "unique_token_aaa selects the embedding model.";
    const question = "What does unique_token_aaa do?";
    await storeFillers(unitVector(0));
    await storeChunk({ filename: "Ident.md", body: identifier, embedding: cosineAlongFirst(0.4) });

    const retrieved = await retrieve({
      db: testDb,
      embedder: fakeEmbedder("fake-embed-v1", { [question]: unitVector(0) }),
      question,
      minSimilarity: 0.3,
    });

    expect(retrieved.map((item) => item.body)).toContain(identifier);
    expect(retrieved[0]?.body).toBe(identifier);
    expect(retrieved[0]?.similarity).toBeCloseTo(0.4);
  });

  it("drops a BM25-rank-1 Chunk whose cosine is below the threshold", async () => {
    const identifier = "unique_token_bbb selects the embedding model.";
    const question = "What does unique_token_bbb do?";
    await storeChunk({ filename: "Ident.md", body: identifier, embedding: unitVector(1) });

    const retrieved = await retrieve({
      db: testDb,
      embedder: fakeEmbedder("fake-embed-v1", { [question]: unitVector(0) }),
      question,
      minSimilarity: 0.5,
    });

    expect(retrieved).toEqual([]);
  });

  it("ranks by cosine alone when the question is only stopwords", async () => {
    await storeChunk({ filename: "Styling.md", body: STYLING_BODY, embedding: unitVector(0) });
    await storeChunk({ filename: "Auth.md", body: AUTH_BODY, embedding: unitVector(1) });

    const retrieved = await retrieve({
      db: testDb,
      embedder: fakeEmbedder("fake-embed-v1", { "What is it?": unitVector(0) }),
      question: "What is it?",
    });

    expect(retrieved[0]?.body).toBe(STYLING_BODY);
  });

  it("rebuilds BM25 after the Corpus is replaced so a new identifier can be promoted", async () => {
    const first = "unique_token_ccc selects the embedding model.";
    const firstQuestion = "What does unique_token_ccc do?";
    await storeFillers(unitVector(0));
    await storeChunk({ filename: "Ident.md", body: first, embedding: cosineAlongFirst(0.4) });
    await retrieve({
      db: testDb,
      embedder: fakeEmbedder("fake-embed-v1", { [firstQuestion]: unitVector(0) }),
      question: firstQuestion,
      minSimilarity: 0.3,
    });

    await resetDb();

    const second = "unique_token_ddd selects the embedding model.";
    const secondQuestion = "What does unique_token_ddd do?";
    await storeFillers(unitVector(0));
    await storeChunk({ filename: "Ident.md", body: second, embedding: cosineAlongFirst(0.4) });
    const retrieved = await retrieve({
      db: testDb,
      embedder: fakeEmbedder("fake-embed-v1", { [secondQuestion]: unitVector(0) }),
      question: secondQuestion,
      minSimilarity: 0.3,
    });

    expect(retrieved[0]?.body).toBe(second);
  });
});
