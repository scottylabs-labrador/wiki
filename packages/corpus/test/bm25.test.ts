import { describe, expect, it } from "vitest";

import { bm25Ranks, buildBm25Index } from "../src/bm25.ts";

const RARE = "OPENROUTER_EMBEDDING_MODEL selects the embedding model.";
const AUTH = "Committee members sign in with Keycloak.";

describe("bm25Ranks", () => {
  it("ranks a Chunk that contains a rare identifier above one that does not", () => {
    const index = buildBm25Index([
      { id: "auth", body: AUTH },
      { id: "rare", body: RARE },
    ]);

    const ranks = bm25Ranks(index, "What does OPENROUTER_EMBEDDING_MODEL do?");

    expect(ranks.get("rare")).toBe(1);
    expect(ranks.has("auth")).toBe(false);
  });

  it("yields no ranks when the question is only stopwords", () => {
    const index = buildBm25Index([
      { id: "auth", body: AUTH },
      { id: "rare", body: RARE },
    ]);

    expect(bm25Ranks(index, "What is it?")).toEqual(new Map());
  });
});
