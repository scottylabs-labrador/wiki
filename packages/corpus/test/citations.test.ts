import { citationLabel } from "@wiki/common";
import { describe, expect, it } from "vitest";

import { citationsFrom } from "../src/citations.ts";
import type { RetrievedChunk } from "../src/retrieve.ts";

function chunk(overrides: Partial<RetrievedChunk> & Pick<RetrievedChunk, "url" | "filename">) {
  return {
    body: "documented text",
    heading: null,
    anchor: null,
    similarity: 1,
    sourceId: "scottystack-wiki",
    ...overrides,
  };
}

describe("citationsFrom", () => {
  it("deduplicates to the most similar Chunk of each Page, deep-links it, and caps at three", () => {
    const citations = citationsFrom([
      chunk({
        filename: "Auth.md",
        url: "https://wiki.example.com/Auth",
        heading: "Keycloak",
        anchor: "keycloak",
        similarity: 0.91,
      }),
      chunk({
        filename: "Auth.md",
        url: "https://wiki.example.com/Auth",
        heading: "Sessions",
        anchor: "sessions",
        similarity: 0.7,
      }),
      chunk({
        filename: "Frontend.md",
        url: "https://wiki.example.com/Frontend",
        heading: "Styling",
        anchor: "styling",
        similarity: 0.8,
      }),
      chunk({
        filename: "Backend.md",
        url: "https://wiki.example.com/Backend",
        heading: "API",
        anchor: "api",
        similarity: 0.6,
      }),
      chunk({
        filename: "Ops.md",
        url: "https://wiki.example.com/Ops",
        heading: "Deploy",
        anchor: "deploy",
        similarity: 0.55,
      }),
    ]);

    expect(citations).toEqual([
      {
        title: "Auth",
        url: "https://wiki.example.com/Auth#keycloak",
        sourceTitle: "ScottyStack Wiki",
      },
      {
        title: "Frontend",
        url: "https://wiki.example.com/Frontend#styling",
        sourceTitle: "ScottyStack Wiki",
      },
      {
        title: "Backend",
        url: "https://wiki.example.com/Backend#api",
        sourceTitle: "ScottyStack Wiki",
      },
    ]);
  });

  it("names the Source from the catalog, and falls back to the Source id", () => {
    expect(
      citationsFrom([
        chunk({
          filename: "Home.md",
          url: "https://github.com/example/wiki/Home",
          sourceId: "labrador-wiki",
        }),
        chunk({
          filename: "Auth.md",
          url: "https://wiki.example.com/Auth",
          sourceId: "unknown-wiki",
          similarity: 0.5,
        }),
      ]),
    ).toEqual([
      {
        title: "Home",
        url: "https://github.com/example/wiki/Home",
        sourceTitle: "Labrador Wiki Wiki",
      },
      {
        title: "Auth",
        url: "https://wiki.example.com/Auth",
        sourceTitle: "unknown-wiki",
      },
    ]);
  });

  it("links a heading-less Chunk to the Page as a whole", () => {
    expect(
      citationsFrom([
        chunk({ filename: "Contribution.md", url: "https://wiki.example.com/Contribution" }),
      ]),
    ).toEqual([
      {
        title: "Contribution",
        url: "https://wiki.example.com/Contribution",
        sourceTitle: "ScottyStack Wiki",
      },
    ]);
  });

  it("leaves lookalike punctuation in the URL alone", () => {
    const url = "https://github.com/example/wiki/Full%E2%80%90Stack-Type%E2%80%90Safety";
    const citations = citationsFrom([
      chunk({
        filename: "Full\u2010Stack-Type\u2010Safety.md",
        url,
        anchor: "overview",
      }),
    ]);

    expect(citations[0]?.url).toBe(`${url}#overview`);
    expect(citations[0]?.url).not.toContain("Full-Stack");
  });
});

describe("citationLabel", () => {
  it("prefixes the Page title with the Source, unless they are the same", () => {
    expect(citationLabel({ sourceTitle: "ScottyStack Wiki", title: "Auth" })).toBe(
      "ScottyStack Wiki: Auth",
    );
    expect(citationLabel({ sourceTitle: "Goldador", title: "Goldador" })).toBe("Goldador");
  });
});
