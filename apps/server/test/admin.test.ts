import { chunk, EMBEDDING_DIMENSIONS, page } from "@wiki/db/schema";
import request from "supertest";
import { describe, expect, it } from "vitest";

import { app } from "../src/app.ts";
import { adminAuth, alice, aliceAuth, seedAdmin, seedAlice } from "./fixtures.ts";
import { testDb } from "./harness.ts";

describe("GET /admin/users", () => {
  it("returns 401 when unauthenticated", async () => {
    const res = await request(app).get("/admin/users");

    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ name: "Unauthenticated" });
  });

  it("returns 403 for a non-admin user", async () => {
    await seedAlice();

    const res = await request(app).get("/admin/users").set(aliceAuth());

    expect(res.status).toBe(403);
  });

  it("returns 200 with users for an admin", async () => {
    await seedAlice();
    await seedAdmin();

    const res = await request(app).get("/admin/users").set(adminAuth());

    expect(res.status).toBe(200);
    expect(res.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: alice.id,
          name: alice.name,
        }),
      ]),
    );
    expect(res.body[0]).not.toHaveProperty("postCount");
    expect(res.body[0]).not.toHaveProperty("replyCount");
  });
});

describe("GET /admin/pages", () => {
  it("returns 401 when unauthenticated", async () => {
    const res = await request(app).get("/admin/pages");

    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ name: "Unauthenticated" });
  });

  it("returns 403 for a non-admin user", async () => {
    await seedAlice();

    const res = await request(app).get("/admin/pages").set(aliceAuth());

    expect(res.status).toBe(403);
  });

  it("returns Pages with their Chunks, omitting identifiers and embeddings", async () => {
    await seedAdmin();
    // Styling is stored first, and its later Chunk is inserted before the
    // earlier one, so an unordered scan would invert both grouping and order.
    const styling = await seedPage({ filename: "Styling.md" });
    await seedPageChunk({
      pageId: styling.id,
      heading: "Colors",
      body: "Primary is Carnegie red.",
      ordinal: 1,
    });
    await seedPageChunk({
      pageId: styling.id,
      heading: null,
      body: "The frontend is styled with Tailwind CSS.",
      ordinal: 0,
    });
    const auth = await seedPage({ filename: "Auth.md" });
    await seedPageChunk({
      pageId: auth.id,
      heading: "Sign in",
      body: "Committee members sign in with Keycloak.",
      ordinal: 0,
    });

    const res = await request(app).get("/admin/pages").set(adminAuth());

    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      {
        sourceTitle: "test-wiki",
        filename: "Auth.md",
        publicUrl: "https://wiki.example.com/Auth",
        chunks: [
          {
            heading: "Sign in",
            body: "Committee members sign in with Keycloak.",
          },
        ],
      },
      {
        sourceTitle: "test-wiki",
        filename: "Styling.md",
        publicUrl: "https://wiki.example.com/Styling",
        chunks: [
          {
            heading: null,
            body: "The frontend is styled with Tailwind CSS.",
          },
          {
            heading: "Colors",
            body: "Primary is Carnegie red.",
          },
        ],
      },
    ]);
    expect(JSON.stringify(res.body)).not.toContain(auth.id);
    expect(JSON.stringify(res.body)).not.toContain("embedding");
  });

  it("labels Pages with their Source title and orders catalog Sources first", async () => {
    await seedAdmin();
    await seedPage({ filename: "Home.md", sourceId: "scottystack-wiki" });
    await seedPage({ filename: "Home.md", sourceId: "labrador-wiki" });

    const res = await request(app).get("/admin/pages").set(adminAuth());

    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      expect.objectContaining({
        sourceTitle: "Labrador Wiki Wiki",
        filename: "Home.md",
      }),
      expect.objectContaining({
        sourceTitle: "ScottyStack Wiki",
        filename: "Home.md",
      }),
    ]);
  });
});

async function seedPage(opts: { filename: string; sourceId?: string }) {
  const [inserted] = await testDb
    .insert(page)
    .values({
      sourceId: opts.sourceId ?? "test-wiki",
      filename: opts.filename,
      publicUrl: `https://wiki.example.com/${opts.filename.replace(/\.md$/, "")}`,
    })
    .returning({ id: page.id });

  if (!inserted) {
    throw new Error(`Failed to store Page ${opts.filename}`);
  }

  return inserted;
}

async function seedPageChunk(opts: {
  pageId: string;
  heading: string | null;
  body: string;
  ordinal: number;
}) {
  await testDb.insert(chunk).values({
    pageId: opts.pageId,
    heading: opts.heading,
    body: opts.body,
    ordinal: opts.ordinal,
    embedding: Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0),
  });
}
