import { chunk, EMBEDDING_DIMENSIONS, page, questionRate } from "@wiki/db/schema";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { app } from "../src/app.ts";
import {
  ANSWER_STREAM_PATH,
  MAX_CONVERSATION_CHARS,
  MAX_TURNS,
  QUOTA_PATH,
} from "../src/routes/chatRoute.ts";
import type { Turn } from "../src/services/answerService.ts";
import { QUESTIONS_PER_WINDOW } from "../src/services/rateLimit.ts";
import { embedByText } from "./embedderState.ts";
import { alice, aliceSession, seedAlice } from "./fixtures.ts";
import { testDb } from "./harness.ts";

const OPENROUTER_ORIGIN = "https://openrouter.ai";

interface ChatModelRequest {
  model: string;
  messages: Turn[];
  stream: boolean;
  reasoning: { enabled: boolean };
}

/** Every request the code under test tried to send to OpenRouter. */
let sent: ChatModelRequest[] = [];

type FetchArgs = Parameters<typeof fetch>;

/**
 * Fakes OpenRouter at the HTTP boundary, leaving every other request alone so
 * Better Auth still reaches the test database.
 */
function fakeOpenRouter(opts: { answer: () => Response; rewrite?: string }) {
  const realFetch = globalThis.fetch;
  vi.stubGlobal("fetch", (input: FetchArgs[0], init?: FetchArgs[1]) => {
    if (!requestedUrl(input).startsWith(OPENROUTER_ORIGIN)) {
      return realFetch(input, init);
    }

    const body = JSON.parse(init?.body as string) as ChatModelRequest;
    sent.push(body);
    if (!body.stream) {
      return Promise.resolve(
        Response.json({
          choices: [{ message: { content: opts.rewrite ?? "standalone query" } }],
        }),
      );
    }
    return Promise.resolve(opts.answer());
  });
}

function requestedUrl(input: FetchArgs[0]): string {
  if (typeof input === "string") {
    return input;
  }
  return input instanceof Request ? input.url : input.href;
}

/** An OpenRouter response that emits `texts` as deltas and then finishes. */
function deltaStream(texts: string[]) {
  const frames = [
    // OpenRouter interleaves keep-alive comments, which carry no delta.
    ": OPENROUTER PROCESSING\n\n",
    ...texts.map(
      (text) => `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`,
    ),
    "data: [DONE]\n\n",
  ];

  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const frame of frames) {
          controller.enqueue(encoder.encode(frame));
        }
        controller.close();
      },
    }),
    { headers: { "Content-Type": "text/event-stream" } },
  );
}

function userTurns(count: number): Turn[] {
  return Array.from({ length: count }, (_unused, index) => ({
    role: "user" as const,
    content: `question ${index}`,
  }));
}

function streamedRequest() {
  return sent.find((request) => request.stream);
}

function ungroundedCitations() {
  return `event: citations\ndata: ${JSON.stringify({ citations: [], grounded: false })}\n\n`;
}

function unitVector(axis: number): number[] {
  const vector = Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0);
  vector[axis] = 1;
  return vector;
}

beforeEach(() => {
  sent = [];
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe(`POST ${ANSWER_STREAM_PATH}`, () => {
  it("rejects an unauthenticated ask without spending anything", async () => {
    fakeOpenRouter({ answer: () => deltaStream(["never reached"]) });

    const res = await request(app)
      .post(ANSWER_STREAM_PATH)
      .send({ turns: userTurns(1) });

    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ name: "Unauthenticated" });
    expect(sent).toEqual([]);
  });

  it("rejects a body that carries no turns", async () => {
    await seedAlice();
    fakeOpenRouter({ answer: () => deltaStream(["never reached"]) });

    const res = await request(app)
      .post(ANSWER_STREAM_PATH)
      .set(await aliceSession())
      .send({ turns: [] });

    expect(res.status).toBe(400);
    expect(sent).toEqual([]);
  });

  it("rejects an oversized conversation", async () => {
    await seedAlice();
    fakeOpenRouter({ answer: () => deltaStream(["never reached"]) });

    const res = await request(app)
      .post(ANSWER_STREAM_PATH)
      .set(await aliceSession())
      .send({ turns: [{ role: "user", content: "x".repeat(MAX_CONVERSATION_CHARS + 1) }] });

    expect(res.status).toBe(413);
    expect(sent).toEqual([]);
  });

  it("measures the size cap against the turns it will actually send", async () => {
    await seedAlice();
    fakeOpenRouter({ answer: () => deltaStream(["ok"]) });

    // Well past the cap in total, but the turns the model is given are small,
    // and the surplus in front of them is dropped rather than rejected.
    const bulky = Array.from({ length: 4 }, () => ({
      role: "user" as const,
      content: "x".repeat(MAX_CONVERSATION_CHARS),
    }));

    const res = await request(app)
      .post(ANSWER_STREAM_PATH)
      .set(await aliceSession())
      .send({ turns: [...bulky, ...userTurns(MAX_TURNS)] });

    expect(res.status).toBe(200);
    expect(streamedRequest()?.messages.slice(1)).toEqual(userTurns(MAX_TURNS));
  });

  it("sends the model at most the last ten turns", async () => {
    await seedAlice();
    fakeOpenRouter({ answer: () => deltaStream(["ok"]) });

    const asked = userTurns(MAX_TURNS + 4);
    const res = await request(app)
      .post(ANSWER_STREAM_PATH)
      .set(await aliceSession())
      .send({ turns: asked });

    expect(res.status).toBe(200);
    const messages = streamedRequest()?.messages ?? [];
    expect(messages[0]?.role).toBe("system");
    expect(messages.slice(1)).toEqual(asked.slice(-MAX_TURNS));
  });

  it("asks for the chat model with reasoning switched off", async () => {
    await seedAlice();
    fakeOpenRouter({ answer: () => deltaStream(["ok"]) });

    await request(app)
      .post(ANSWER_STREAM_PATH)
      .set(await aliceSession())
      .send({ turns: userTurns(1) });

    expect(streamedRequest()?.model).toBe("~deepseek/deepseek-v4-flash-latest");
    expect(streamedRequest()?.stream).toBe(true);
    expect(streamedRequest()?.reasoning).toEqual({ enabled: false });
  });

  it("streams the Answer as delta events and ends with done", async () => {
    await seedAlice();
    fakeOpenRouter({ answer: () => deltaStream(["Labrador ", "builds ", "software."]) });

    const res = await request(app)
      .post(ANSWER_STREAM_PATH)
      .set(await aliceSession())
      .send({ turns: userTurns(1) });

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/event-stream");
    expect(res.text).toBe(
      [
        ungroundedCitations(),
        `event: delta\ndata: ${JSON.stringify({ text: "Labrador " })}\n\n`,
        `event: delta\ndata: ${JSON.stringify({ text: "builds " })}\n\n`,
        `event: delta\ndata: ${JSON.stringify({ text: "software." })}\n\n`,
        `event: done\ndata: {}\n\n`,
      ].join(""),
    );
  });

  it("reports a chat model that refuses the request", async () => {
    await seedAlice();
    fakeOpenRouter({ answer: () => new Response("no credit", { status: 402 }) });

    const res = await request(app)
      .post(ANSWER_STREAM_PATH)
      .set(await aliceSession())
      .send({ turns: userTurns(1) });

    expect(res.status).toBe(502);
  });

  it("grounds the chat model in a retrieved Chunk body", async () => {
    await seedAlice();
    const documented = "ScottyStack authenticates members through Keycloak, not Auth0 or Clerk.";
    await seedChunk({ body: documented });
    fakeOpenRouter({ answer: () => deltaStream(["ok"]) });

    const res = await request(app)
      .post(ANSWER_STREAM_PATH)
      .set(await aliceSession())
      .send({
        turns: [{ role: "user", content: "What does ScottyStack use for authentication?" }],
      });

    expect(res.status).toBe(200);
    expect(streamedRequest()?.messages[0]?.content).toContain(documented);
  });

  it("still streams an Answer when the Corpus is empty", async () => {
    await seedAlice();
    fakeOpenRouter({ answer: () => deltaStream(["ok"]) });

    const res = await request(app)
      .post(ANSWER_STREAM_PATH)
      .set(await aliceSession())
      .send({ turns: userTurns(1) });

    expect(res.status).toBe(200);
    expect(sent).toHaveLength(1);
  });

  it("emits Citations from retrieved Chunks before the Answer starts", async () => {
    await seedAlice();
    await seedChunk({
      filename: "Auth.md",
      body: "Committee members sign in with Keycloak.",
      heading: "Keycloak",
      anchor: "keycloak",
      publicUrl: "https://wiki.example.com/Auth",
    });
    fakeOpenRouter({ answer: () => deltaStream(["ok"]) });

    const res = await request(app)
      .post(ANSWER_STREAM_PATH)
      .set(await aliceSession())
      .send({
        turns: [{ role: "user", content: "What does ScottyStack use for authentication?" }],
      });

    expect(res.status).toBe(200);
    expect(res.text.startsWith("event: citations\n")).toBe(true);
    expect(res.text).toContain(
      JSON.stringify({
        citations: [{ title: "Auth", url: "https://wiki.example.com/Auth#keycloak" }],
        grounded: true,
      }),
    );
  });

  it("emits no Citations when nothing in the Corpus is similar enough", async () => {
    await seedAlice();
    await seedChunk({
      filename: "Styling.md",
      body: "The frontend is styled with Tailwind CSS.",
      embedding: unitVector(1),
    });
    embedByText["What is Goldador?"] = unitVector(0);
    fakeOpenRouter({ answer: () => deltaStream(["ok"]) });

    const res = await request(app)
      .post(ANSWER_STREAM_PATH)
      .set(await aliceSession())
      .send({ turns: [{ role: "user", content: "What is Goldador?" }] });

    expect(res.status).toBe(200);
    expect(res.text.startsWith(ungroundedCitations())).toBe(true);
    expect(streamedRequest()?.messages[0]?.content).not.toContain("Tailwind");
  });

  it("does not ask the model to write Citations", async () => {
    await seedAlice();
    fakeOpenRouter({ answer: () => deltaStream(["ok"]) });

    await request(app)
      .post(ANSWER_STREAM_PATH)
      .set(await aliceSession())
      .send({ turns: userTurns(1) });

    expect(streamedRequest()?.messages[0]?.content).not.toMatch(/citation/i);
  });

  it("incurs no extra model round trip for the first question of a session", async () => {
    await seedAlice();
    fakeOpenRouter({ answer: () => deltaStream(["ok"]) });

    await request(app)
      .post(ANSWER_STREAM_PATH)
      .set(await aliceSession())
      .send({ turns: userTurns(1) });

    expect(sent).toHaveLength(1);
    expect(sent[0]?.stream).toBe(true);
  });

  it("retrieves from a rewritten follow-up without changing the question the model answers", async () => {
    await seedAlice();
    const styling = "The frontend is styled with Tailwind CSS.";
    const auth = "Committee members sign in with Keycloak.";
    await seedChunk({ filename: "Styling.md", body: styling, embedding: unitVector(1) });
    await seedChunk({ filename: "Auth.md", body: auth, embedding: unitVector(0) });

    const rewritten = "What does ScottyStack use for styling?";
    embedByText[rewritten] = unitVector(1);
    fakeOpenRouter({ answer: () => deltaStream(["ok"]), rewrite: rewritten });

    const followUp = {
      turns: [
        { role: "user" as const, content: "What does ScottyStack use for authentication?" },
        { role: "assistant" as const, content: "Keycloak." },
        { role: "user" as const, content: "What about the second one?" },
      ],
    };

    const res = await request(app)
      .post(ANSWER_STREAM_PATH)
      .set(await aliceSession())
      .send(followUp);

    expect(res.status).toBe(200);
    expect(sent[0]?.stream).toBe(false);
    expect(streamedRequest()?.messages.slice(1)).toEqual(followUp.turns);
    expect(streamedRequest()?.messages[0]?.content).toContain(styling);
    expect(streamedRequest()?.messages[0]?.content).not.toContain(auth);
  });

  it("refuses a 61st question in the hour before spending anything", async () => {
    await seedAlice();
    await testDb.insert(questionRate).values({
      userId: alice.id,
      windowStartedAt: new Date(),
      count: QUESTIONS_PER_WINDOW,
    });
    fakeOpenRouter({ answer: () => deltaStream(["never reached"]) });

    const res = await request(app)
      .post(ANSWER_STREAM_PATH)
      .set(await aliceSession())
      .send({ turns: userTurns(1) });

    expect(res.status).toBe(429);
    expect(res.body.name).toBe("TooManyRequests");
    expect(typeof res.body.resetAt).toBe("string");
    expect(sent).toEqual([]);
  });

  it("allows another question once the hour has rolled over", async () => {
    await seedAlice();
    await testDb.insert(questionRate).values({
      userId: alice.id,
      windowStartedAt: new Date(Date.now() - 61 * 60 * 1000),
      count: QUESTIONS_PER_WINDOW,
    });
    fakeOpenRouter({ answer: () => deltaStream(["ok"]) });

    const res = await request(app)
      .post(ANSWER_STREAM_PATH)
      .set(await aliceSession())
      .send({ turns: userTurns(1) });

    expect(res.status).toBe(200);
    expect(sent).toHaveLength(1);
  });
});

describe(`GET ${QUOTA_PATH}`, () => {
  it("tells a member how many questions this hour still allows", async () => {
    await seedAlice();
    await testDb.insert(questionRate).values({
      userId: alice.id,
      windowStartedAt: new Date(),
      count: 12,
    });

    const res = await request(app)
      .get(QUOTA_PATH)
      .set(await aliceSession());

    expect(res.status).toBe(200);
    expect(res.body.remaining).toBe(QUESTIONS_PER_WINDOW - 12);
    expect(typeof res.body.resetAt).toBe("string");
  });

  it("rejects an unauthenticated quota check", async () => {
    const res = await request(app).get(QUOTA_PATH);
    expect(res.status).toBe(401);
  });
});

async function seedChunk(opts: {
  body: string;
  filename?: string;
  heading?: string | null;
  anchor?: string | null;
  publicUrl?: string;
  embedding?: number[];
}) {
  const filename = opts.filename ?? "Auth.md";
  const [inserted] = await testDb
    .insert(page)
    .values({
      sourceId: "test-wiki",
      filename,
      publicUrl: opts.publicUrl ?? `https://wiki.example.com/${filename.replace(/\.md$/, "")}`,
    })
    .returning({ id: page.id });

  if (!inserted) {
    throw new Error("Failed to store Page");
  }

  await testDb.insert(chunk).values({
    pageId: inserted.id,
    body: opts.body,
    heading: opts.heading ?? null,
    anchor: opts.anchor ?? null,
    ordinal: 0,
    embedding: opts.embedding ?? Array.from({ length: EMBEDDING_DIMENSIONS }, () => 1),
  });
}
