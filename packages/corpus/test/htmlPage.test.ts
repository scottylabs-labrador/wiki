import { afterEach, describe, expect, it, vi } from "vitest";

import { htmlPage, htmlToMarkdown } from "../src/htmlPage.ts";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("htmlToMarkdown", () => {
  it("keeps the Page's text and heading ids, and drops its stylesheet", () => {
    const markdown = htmlToMarkdown(`
      <html>
        <head>
          <style>.hero { color: red; background: linear-gradient(#fff, #000); }</style>
          <link rel="stylesheet" href="theme.css" />
        </head>
        <body>
          <h1 id="hero-heading">Goldador</h1>
          <h2 id="permissions-heading">
            <a href="#permissions" class="heading-anchor">Role Permissions</a>
          </h2>
          <p>What each role can access.</p>
          <h3 id="member">
            <a href="#member" class="heading-anchor">Member</a>
          </h3>
          <ul><li>GitHub organization member.</li></ul>
        </body>
      </html>
    `);

    expect(markdown).toContain("# Goldador {#hero-heading}");
    expect(markdown).toContain("## Role Permissions {#permissions}");
    expect(markdown).toContain("### Member {#member}");
    expect(markdown).toContain("What each role can access.");
    expect(markdown).toContain("GitHub organization member.");
    expect(markdown).not.toContain("linear-gradient");
    expect(markdown).not.toContain("theme.css");
    expect(markdown).not.toContain("color: red");
  });
});

describe("htmlPage", () => {
  it("fingerprints the fetched HTML so an unchanged Page is not re-cloned", async () => {
    const html = "<html><body><h1 id='hero'>Goldador</h1><p>Membership.</p></body></html>";
    const fetched: string[] = [];
    vi.stubGlobal("fetch", (input: Parameters<typeof fetch>[0]) => {
      fetched.push(
        typeof input === "string" ? input : input instanceof Request ? input.url : input.href,
      );
      return Promise.resolve(new Response(html, { headers: { "Content-Type": "text/html" } }));
    });

    const source = htmlPage({
      id: "goldador",
      url: "https://example.com/goldador/",
      filename: "Goldador.html",
    });

    const sha = await source.headSha();
    const pages = await source.fetchPages();

    expect(fetched).toEqual(["https://example.com/goldador/"]);
    expect(sha).toMatch(/^[0-9a-f]{64}$/);
    expect(pages[0]?.filename).toBe("Goldador.html");
    expect(pages[0]?.markdown).toContain("Goldador");
    expect(source.pageUrl("Goldador.html")).toBe("https://example.com/goldador/");
  });
});
