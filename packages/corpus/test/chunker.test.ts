import { describe, expect, it } from "vitest";

import { splitIntoChunks } from "../src/chunker.ts";

describe("splitIntoChunks", () => {
  it("starts a Chunk at each # or ## heading", () => {
    const chunks = splitIntoChunks(
      ["# Client", "", "React and TanStack Router.", "", "## Styling", "", "Tailwind."].join("\n"),
    );

    expect(chunks.map((chunk) => chunk.heading)).toEqual(["Client", "Styling"]);
  });

  it("does not treat a comment inside a code fence as a heading", () => {
    const chunks = splitIntoChunks(
      ["## Quickstart", "", "```bash", "# install the toolchain", "bun install", "```"].join("\n"),
    );

    expect(chunks.map((chunk) => chunk.heading)).toEqual(["Quickstart"]);
  });

  it("yields one Chunk for a Page with no headings", () => {
    const chunks = splitIntoChunks("Follow the base contributing guide.");

    expect(chunks).toEqual([
      { heading: null, anchor: null, body: "Follow the base contributing guide." },
    ]);
  });

  it("gives text before the first heading its own Chunk, citable only as the Page", () => {
    const chunks = splitIntoChunks(
      ["Settings every repo needs.", "", "## Branch protection", "", "Require review."].join("\n"),
    );

    expect(chunks[0]).toEqual({
      heading: null,
      anchor: null,
      body: "Settings every repo needs.",
    });
    expect(chunks[1]?.heading).toBe("Branch protection");
  });

  it("keeps a section that is only a heading", () => {
    const chunks = splitIntoChunks(["## Toolings", "", "## AI", "", "Use it well."].join("\n"));

    expect(chunks.map((chunk) => chunk.heading)).toEqual(["Toolings", "AI"]);
  });

  it("keeps nested headings inside their # or ## section", () => {
    const chunks = splitIntoChunks(
      [
        "# Title",
        "",
        "Intro.",
        "",
        "## Troubleshooting",
        "",
        "### Port in use",
        "",
        "Kill it.",
        "",
        "#### Windows",
      ].join("\n"),
    );

    expect(chunks.map((chunk) => chunk.heading)).toEqual(["Title", "Troubleshooting"]);
    expect(chunks[0]?.body).toBe("# Title\n\nIntro.");
    expect(chunks[1]?.body).toBe(
      ["## Troubleshooting", "", "### Port in use", "", "Kill it.", "", "#### Windows"].join("\n"),
    );
  });

  it("does not split at an underlined heading", () => {
    const chunks = splitIntoChunks(
      ["Overview", "========", "", "What this is.", "", "## Details", "", "More."].join("\n"),
    );

    expect(chunks.map((chunk) => chunk.heading)).toEqual([null, "Details"]);
  });

  it("does not mistake a thematic break for an underlined heading", () => {
    const chunks = splitIntoChunks(["Above the rule.", "", "---", "", "Below it."].join("\n"));

    expect(chunks.map((chunk) => chunk.heading)).toEqual([null]);
  });

  it("only lets a code fence be closed by its own marker", () => {
    const chunks = splitIntoChunks(
      ["## Quickstart", "", "```bash", "~~~", "# still inside the fence", "```", "", "Done."].join(
        "\n",
      ),
    );

    expect(chunks.map((chunk) => chunk.heading)).toEqual(["Quickstart"]);
  });

  it("yields no Chunk for a Page with nothing to retrieve", () => {
    expect(splitIntoChunks("")).toEqual([]);
    expect(splitIntoChunks("   \n\n  ")).toEqual([]);
  });

  it("anchors a heading the way GitHub slugs it, disambiguating repeats", () => {
    const chunks = splitIntoChunks(
      ["## Dev Container Setup Guide", "", "text", "", "## Dev Container Setup Guide"].join("\n"),
    );

    expect(chunks.map((chunk) => chunk.anchor)).toEqual([
      "dev-container-setup-guide",
      "dev-container-setup-guide-1",
    ]);
  });

  it("uses an explicit {#anchor} so an HTML Page can keep the ids it publishes", () => {
    const chunks = splitIntoChunks(
      ["## Role Permissions {#permissions}", "", "What each role can access."].join("\n"),
    );

    expect(chunks[0]).toMatchObject({
      heading: "Role Permissions",
      anchor: "permissions",
    });
  });

  it("splits a heading section that would overflow the embedding window", () => {
    const passage = "The onboarding video covers Goldador, Railway, and the template.\n\n";
    const chunks = splitIntoChunks(`## Transcript\n\n${passage.repeat(800)}`);

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.heading === "Transcript")).toBe(true);
    expect(chunks.every((chunk) => chunk.anchor === "transcript")).toBe(true);
    // text-embedding-3-small rejects inputs over 8192 tokens (~4 characters each).
    expect(chunks.every((chunk) => chunk.body.length <= 8192 * 4)).toBe(true);
    expect(
      chunks.reduce((count, chunk) => count + (chunk.body.match(/Goldador/g)?.length ?? 0), 0),
    ).toBe(800);
  });
});
