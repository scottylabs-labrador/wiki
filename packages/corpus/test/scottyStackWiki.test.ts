import { describe, expect, it } from "vitest";

import { isPage, pageUrl } from "../src/scottyStackWiki.ts";

const WIKI = "https://github.com/scottylabs-labrador/ScottyStack/wiki";

describe("pageUrl", () => {
  it("links to the Page a wiki filename publishes as", () => {
    expect(pageUrl("Style-Guides.md")).toBe(`${WIKI}/Style-Guides`);
  });

  // ADR-0002: transliterating either of these to ASCII produces a 404.
  it("percent-encodes lookalike punctuation rather than normalising it", () => {
    expect(pageUrl("Full\u2010Stack-Type\u2010Safety.md")).toBe(
      `${WIKI}/Full%E2%80%90Stack-Type%E2%80%90Safety`,
    );
    expect(pageUrl("ScottyStack\uFF0B.md")).toBe(`${WIKI}/ScottyStack%EF%BC%8B`);
  });
});

describe("isPage", () => {
  it("counts a markdown document a reader can open", () => {
    expect(isPage("Home.md")).toBe(true);
    expect(isPage("Contribution.md")).toBe(true);
  });

  it("rejects wiki furniture and non-markdown files", () => {
    // Chrome that surrounds every Page rather than being one.
    expect(isPage("_Sidebar.md")).toBe(false);
    expect(isPage("_Footer.md")).toBe(false);
    expect(isPage("_Header.md")).toBe(false);
    expect(isPage("diagram.png")).toBe(false);
  });
});
