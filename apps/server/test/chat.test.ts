import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { app } from "../src/app.ts";
import { ANSWER_STREAM_PATH, MAX_CONVERSATION_CHARS, MAX_TURNS } from "../src/routes/chatRoute.ts";
import type { Turn } from "../src/services/answerService.ts";
import { aliceSession, seedAlice } from "./fixtures.ts";

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
function fakeOpenRouter(reply: () => Response) {
  const realFetch = globalThis.fetch;
  vi.stubGlobal("fetch", (input: FetchArgs[0], init?: FetchArgs[1]) => {
    if (!requestedUrl(input).startsWith(OPENROUTER_ORIGIN)) {
      return realFetch(input, init);
    }

    sent.push(JSON.parse(init?.body as string) as ChatModelRequest);
    return Promise.resolve(reply());
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

beforeEach(() => {
  sent = [];
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe(`POST ${ANSWER_STREAM_PATH}`, () => {
  it("rejects an unauthenticated ask without spending anything", async () => {
    fakeOpenRouter(() => deltaStream(["never reached"]));

    const res = await request(app)
      .post(ANSWER_STREAM_PATH)
      .send({ turns: userTurns(1) });

    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ name: "Unauthenticated" });
    expect(sent).toEqual([]);
  });

  it("rejects a body that carries no turns", async () => {
    await seedAlice();
    fakeOpenRouter(() => deltaStream(["never reached"]));

    const res = await request(app)
      .post(ANSWER_STREAM_PATH)
      .set(await aliceSession())
      .send({ turns: [] });

    expect(res.status).toBe(400);
    expect(sent).toEqual([]);
  });

  it("rejects an oversized conversation", async () => {
    await seedAlice();
    fakeOpenRouter(() => deltaStream(["never reached"]));

    const res = await request(app)
      .post(ANSWER_STREAM_PATH)
      .set(await aliceSession())
      .send({ turns: [{ role: "user", content: "x".repeat(MAX_CONVERSATION_CHARS + 1) }] });

    expect(res.status).toBe(413);
    expect(sent).toEqual([]);
  });

  it("measures the size cap against the turns it will actually send", async () => {
    await seedAlice();
    fakeOpenRouter(() => deltaStream(["ok"]));

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
    expect(sent[0]?.messages.slice(1)).toEqual(userTurns(MAX_TURNS));
  });

  it("sends the model at most the last ten turns", async () => {
    await seedAlice();
    fakeOpenRouter(() => deltaStream(["ok"]));

    const asked = userTurns(MAX_TURNS + 4);
    const res = await request(app)
      .post(ANSWER_STREAM_PATH)
      .set(await aliceSession())
      .send({ turns: asked });

    expect(res.status).toBe(200);
    const messages = sent[0]?.messages ?? [];
    expect(messages[0]?.role).toBe("system");
    expect(messages.slice(1)).toEqual(asked.slice(-MAX_TURNS));
  });

  it("asks for the chat model with reasoning switched off", async () => {
    await seedAlice();
    fakeOpenRouter(() => deltaStream(["ok"]));

    await request(app)
      .post(ANSWER_STREAM_PATH)
      .set(await aliceSession())
      .send({ turns: userTurns(1) });

    expect(sent[0]?.model).toBe("~deepseek/deepseek-v4-flash-latest");
    expect(sent[0]?.stream).toBe(true);
    expect(sent[0]?.reasoning).toEqual({ enabled: false });
  });

  it("streams the Answer as delta events and ends with done", async () => {
    await seedAlice();
    fakeOpenRouter(() => deltaStream(["Labrador ", "builds ", "software."]));

    const res = await request(app)
      .post(ANSWER_STREAM_PATH)
      .set(await aliceSession())
      .send({ turns: userTurns(1) });

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/event-stream");
    expect(res.text).toBe(
      [
        `event: delta\ndata: ${JSON.stringify({ text: "Labrador " })}\n\n`,
        `event: delta\ndata: ${JSON.stringify({ text: "builds " })}\n\n`,
        `event: delta\ndata: ${JSON.stringify({ text: "software." })}\n\n`,
        `event: done\ndata: {}\n\n`,
      ].join(""),
    );
  });

  it("reports a chat model that refuses the request", async () => {
    await seedAlice();
    fakeOpenRouter(() => new Response("no credit", { status: 402 }));

    const res = await request(app)
      .post(ANSWER_STREAM_PATH)
      .set(await aliceSession())
      .send({ turns: userTurns(1) });

    expect(res.status).toBe(502);
  });
});
