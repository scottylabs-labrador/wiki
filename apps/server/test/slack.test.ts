import { createHmac } from "node:crypto";

import { chunk, EMBEDDING_DIMENSIONS, page, questionRate } from "@wiki/db/schema";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { app } from "../src/app.ts";
import { env } from "../src/env.ts";
import { SLACK_EVENTS_PATH, clearSeenSlackEvents } from "../src/routes/slackRoute.ts";
import type { Turn } from "../src/services/answerService.ts";
import {
  ACK_REACTION,
  CANNOT_PRODUCE_TEXT,
  FAILED_REACTION,
  GROUNDED_REACTION,
  UNGROUNDED_REACTION,
  formatSlackAnswer,
} from "../src/services/slackAsk.ts";
import { embedByText } from "./embedderState.ts";
import { testDb } from "./harness.ts";

const OPENROUTER_ORIGIN = "https://openrouter.ai";
const SLACK_API_PREFIX = "https://slack.com/api/";

interface ChatModelRequest {
  model: string;
  messages: Turn[];
  stream: boolean;
}

interface SlackCall {
  method: string;
  body: Record<string, unknown>;
}

let sent: ChatModelRequest[] = [];
let slackCalls: SlackCall[] = [];

type FetchArgs = Parameters<typeof fetch>;

function fakeNetwork(opts: { answer: () => Response | Promise<Response> }) {
  const realFetch = globalThis.fetch;
  vi.stubGlobal("fetch", (input: FetchArgs[0], init?: FetchArgs[1]) => {
    const url = requestedUrl(input);
    if (url.startsWith(OPENROUTER_ORIGIN)) {
      const body = JSON.parse(init?.body as string) as ChatModelRequest;
      sent.push(body);
      if (!body.stream) {
        return Promise.resolve(
          Response.json({
            choices: [{ message: { content: "standalone query" } }],
          }),
        );
      }
      return Promise.resolve(opts.answer());
    }
    if (url.startsWith(SLACK_API_PREFIX)) {
      slackCalls.push({
        method: url.slice(SLACK_API_PREFIX.length),
        body: JSON.parse(init?.body as string) as Record<string, unknown>,
      });
      return Promise.resolve(Response.json({ ok: true }));
    }
    return realFetch(input, init);
  });
}

function requestedUrl(input: FetchArgs[0]): string {
  if (typeof input === "string") {
    return input;
  }
  return input instanceof Request ? input.url : input.href;
}

function deltaStream(texts: string[]) {
  const frames = [
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

function signedHeaders(rawBody: string, timestamp = String(Math.floor(Date.now() / 1000))) {
  const digest = createHmac("sha256", env.SLACK_SIGNING_SECRET)
    .update(`v0:${timestamp}:${rawBody}`)
    .digest("hex");
  return {
    "Content-Type": "application/json",
    "X-Slack-Request-Timestamp": timestamp,
    "X-Slack-Signature": `v0=${digest}`,
  };
}

function mention(opts?: { text?: string; eventId?: string }) {
  return {
    type: "event_callback" as const,
    event_id: opts?.eventId ?? "Ev123",
    event: {
      type: "app_mention",
      text: opts?.text ?? "<@U0BOT> How does ingest work?",
      ts: "1234567890.123456",
      channel: "C0LAB",
    },
  };
}

function postEvent(payload: unknown, timestamp?: string) {
  const rawBody = JSON.stringify(payload);
  return request(app).post(SLACK_EVENTS_PATH).set(signedHeaders(rawBody, timestamp)).send(rawBody);
}

async function waitForDelivery() {
  await vi.waitFor(() => {
    expect(slackCalls.some((call) => call.method === "chat.postMessage")).toBe(true);
    expect(
      slackCalls.some(
        (call) => call.method === "reactions.add" && call.body["name"] !== ACK_REACTION,
      ),
    ).toBe(true);
  });
}

function postedText(): string {
  const posted = slackCalls.find((call) => call.method === "chat.postMessage");
  const text = posted?.body["text"];
  return typeof text === "string" ? text : "";
}

function outcomeReaction(): string | undefined {
  return slackCalls
    .filter((call) => call.method === "reactions.add")
    .map((call) => String(call.body["name"]))
    .find((name) => name !== ACK_REACTION);
}

function unitVector(axis: number): number[] {
  const vector = Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0);
  vector[axis] = 1;
  return vector;
}

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

beforeEach(() => {
  sent = [];
  slackCalls = [];
  clearSeenSlackEvents();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe(`POST ${SLACK_EVENTS_PATH}`, () => {
  it("rejects an unsigned request", async () => {
    const res = await request(app)
      .post(SLACK_EVENTS_PATH)
      .set("Content-Type", "application/json")
      .send({ type: "url_verification", challenge: "abc" });

    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ name: "Unauthenticated" });
    expect(sent).toEqual([]);
    expect(slackCalls).toEqual([]);
  });

  it("rejects a request whose timestamp is too old to trust", async () => {
    const stale = String(Math.floor(Date.now() / 1000) - 10 * 60);
    const res = await postEvent({ type: "url_verification", challenge: "abc" }, stale);

    expect(res.status).toBe(401);
  });

  it("returns the url_verification challenge", async () => {
    const res = await postEvent({ type: "url_verification", challenge: "abc" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ challenge: "abc" });
  });

  it("acknowledges a mention before the Answer is ready", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    fakeNetwork({ answer: () => gate.then(() => deltaStream(["later"])) });

    const res = await postEvent(mention());

    expect(res.status).toBe(200);
    expect(slackCalls.some((call) => call.method === "chat.postMessage")).toBe(false);

    release();
    await waitForDelivery();
    expect(postedText()).toBe("later");
  });

  it("posts a grounded Answer with Citation links and flips the reaction", async () => {
    await seedChunk({
      filename: "Auth.md",
      body: "Committee members sign in with Keycloak.",
      heading: "Keycloak",
      anchor: "keycloak",
      publicUrl: "https://wiki.example.com/Auth",
    });
    fakeNetwork({
      answer: () =>
        deltaStream([
          "Use [Keycloak](https://wiki.example.com/Auth#keycloak) via [this link](https://github.com/example/ScottyStack).",
        ]),
    });

    const res = await postEvent(
      mention({ text: "<@U0BOT> What does ScottyStack use for authentication?" }),
    );

    expect(res.status).toBe(200);
    await waitForDelivery();

    expect(postedText()).toBe(
      "Use <https://wiki.example.com/Auth#keycloak|Keycloak> via <https://github.com/example/ScottyStack|this link>.\n\n<https://wiki.example.com/Auth#keycloak|Auth>",
    );
    expect(outcomeReaction()).toBe(GROUNDED_REACTION);
    expect(slackCalls.some((call) => call.method === "reactions.remove")).toBe(true);
    expect(sent[0]?.messages.slice(1)).toEqual([
      { role: "user", content: "What does ScottyStack use for authentication?" },
    ]);
  });

  it("posts an ungrounded Answer and marks it as such", async () => {
    await seedChunk({
      filename: "Styling.md",
      body: "The frontend is styled with Tailwind CSS.",
      embedding: unitVector(1),
    });
    embedByText["What is Goldador?"] = unitVector(0);
    fakeNetwork({ answer: () => deltaStream(["I am not sure."]) });

    const res = await postEvent(mention({ text: "<@U0BOT> What is Goldador?" }));

    expect(res.status).toBe(200);
    await waitForDelivery();
    expect(postedText()).toBe("I am not sure.");
    expect(outcomeReaction()).toBe(UNGROUNDED_REACTION);
  });

  it("treats a mention with no leftover text as cannot-produce", async () => {
    fakeNetwork({ answer: () => deltaStream(["never reached"]) });

    const res = await postEvent(mention({ text: "<@U0BOT>" }));

    expect(res.status).toBe(200);
    await waitForDelivery();
    expect(postedText()).toBe(CANNOT_PRODUCE_TEXT);
    expect(outcomeReaction()).toBe(FAILED_REACTION);
    expect(sent).toEqual([]);
  });

  it("posts a cannot-produce thread when the chat model refuses", async () => {
    fakeNetwork({ answer: () => new Response("no credit", { status: 402 }) });

    const res = await postEvent(mention());

    expect(res.status).toBe(200);
    await waitForDelivery();
    expect(postedText()).toBe(CANNOT_PRODUCE_TEXT);
    expect(outcomeReaction()).toBe(FAILED_REACTION);
  });

  it("does not require a session and does not spend the Member quota", async () => {
    fakeNetwork({ answer: () => deltaStream(["ok"]) });

    const res = await postEvent(mention());

    expect(res.status).toBe(200);
    await waitForDelivery();
    expect(await testDb.select().from(questionRate)).toEqual([]);
  });

  it("ignores a retried event_id so Slack does not get two Answers", async () => {
    fakeNetwork({ answer: () => deltaStream(["once"]) });

    await postEvent(mention({ eventId: "EvDUP" }));
    await waitForDelivery();
    expect(sent).toHaveLength(1);

    const res = await postEvent(mention({ eventId: "EvDUP" }));
    expect(res.status).toBe(200);
    expect(sent).toHaveLength(1);
    expect(slackCalls.filter((call) => call.method === "chat.postMessage")).toHaveLength(1);
  });

  it("ignores events that are not app_mention", async () => {
    fakeNetwork({ answer: () => deltaStream(["never reached"]) });

    const res = await postEvent({
      type: "event_callback",
      event_id: "EvMSG",
      event: { type: "message", text: "hi", ts: "1", channel: "C0LAB" },
    });

    expect(res.status).toBe(200);
    expect(sent).toEqual([]);
    expect(slackCalls).toEqual([]);
  });
});

describe("formatSlackAnswer", () => {
  it("turns markdown links into Slack links and appends Citation titles", () => {
    expect(
      formatSlackAnswer("Use it via [this link](https://github.com/example/ScottyStack).", [
        { title: "Quickstart", url: "https://wiki.example.com/Quickstart#template" },
      ]),
    ).toBe(
      "Use it via <https://github.com/example/ScottyStack|this link>.\n\n<https://wiki.example.com/Quickstart#template|Quickstart>",
    );
  });

  it("leaves markdown links inside code alone", () => {
    expect(
      formatSlackAnswer(
        "Write `[docs](https://example.com)` or:\n\n```\n[docs](https://example.com)\n```",
        [],
      ),
    ).toBe("Write `[docs](https://example.com)` or:\n\n```\n[docs](https://example.com)\n```");
  });
});
