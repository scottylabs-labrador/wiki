import { describe, expect, it } from "vitest";

import { splitIntoChunks } from "../src/chunker.ts";

describe("splitIntoChunks", () => {
  it("starts a Chunk at each heading", () => {
    const chunks = splitIntoChunks(
      ["## Client", "", "React and TanStack Router.", "", "## Styling", "", "Tailwind."].join("\n"),
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

  it("splits at every heading level, and keeps each heading with its body", () => {
    const chunks = splitIntoChunks(
      ["## Troubleshooting", "", "### Port in use", "", "Kill it.", "", "#### Windows"].join("\n"),
    );

    expect(chunks.map((chunk) => chunk.heading)).toEqual([
      "Troubleshooting",
      "Port in use",
      "Windows",
    ]);
    expect(chunks[1]?.body).toBe("### Port in use\n\nKill it.");
  });

  it("starts a Chunk at an underlined heading, which GitHub also anchors", () => {
    const chunks = splitIntoChunks(
      ["Overview", "========", "", "What this is.", "", "Details", "-------", "", "More."].join(
        "\n",
      ),
    );

    expect(chunks.map((chunk) => chunk.heading)).toEqual(["Overview", "Details"]);
    expect(chunks.map((chunk) => chunk.anchor)).toEqual(["overview", "details"]);
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
});
