import { http, HttpResponse } from "msw";

import { API_URL } from "../fixtures.ts";

export let session: ReturnType<typeof import("../fixtures.ts").userSession> | null = null;
export let adminUsers: Array<{
  id: string;
  name: string;
}> = [];
export let answerDeltas: string[] = [];
export let answerCitations: Array<{ title: string; url: string }> = [];
export let answerGrounded = false;
export let quota = { remaining: 60, limit: 60, resetAt: "2026-09-05T18:00:00.000Z" };
export let askedBodies: Array<{ turns: Array<{ role: string; content: string }> }> = [];

export function setSession(next: typeof session) {
  session = next;
}

export function setAdminUsers(next: typeof adminUsers) {
  adminUsers = next;
}

export function setQuota(next: typeof quota) {
  quota = next;
}

/** Resolves when a held stream is allowed to write the rest of its frames. */
let resumed: Promise<void> | null = null;
let holdBeforeDeltas = false;

/** The pieces of text the fake Answer stream will emit, in order. */
export function setAnswerDeltas(next: typeof answerDeltas) {
  answerDeltas = next;
  askedBodies = [];
  resumed = null;
  holdBeforeDeltas = false;
  answerCitations = [];
  answerGrounded = false;
}

export function setAnswerCitations(
  citations: typeof answerCitations,
  grounded = citations.length > 0,
) {
  answerCitations = citations;
  answerGrounded = grounded;
}

/**
 * Stops the fake Answer stream after its first delta.
 *
 * Returns the release, so a test can assert on a half-written Answer without
 * racing a timer.
 */
export function holdAnswerStream() {
  holdBeforeDeltas = false;
  return armHold();
}

/**
 * Stops the fake Answer stream after Citations and before any delta.
 *
 * Returns the release, so a test can assert that Pages are named while the
 * Answer is still being written.
 */
export function holdBeforeAnswerText() {
  holdBeforeDeltas = true;
  return armHold();
}

function armHold() {
  let release = () => {};
  resumed = new Promise<void>((resolve) => {
    release = resolve;
  });
  return () => release();
}

export const handlers = [
  http.get(`${API_URL}/api/auth/*`, () => {
    return HttpResponse.json(session);
  }),
  http.post(`${API_URL}/api/auth/*`, () => {
    return HttpResponse.json(session);
  }),
  http.get(`${API_URL}/admin/users`, () => {
    return HttpResponse.json(adminUsers);
  }),
  http.get(`${API_URL}/chat/quota`, () => {
    if (!session) {
      return new HttpResponse(null, { status: 401 });
    }
    return HttpResponse.json(quota);
  }),
  http.post(`${API_URL}/chat/answers`, async ({ request }) => {
    askedBodies.push((await request.json()) as (typeof askedBodies)[number]);
    if (!session) {
      return new HttpResponse(null, { status: 401 });
    }
    if (quota.remaining <= 0) {
      return HttpResponse.json(
        { name: "TooManyRequests", resetAt: quota.resetAt },
        { status: 429 },
      );
    }
    return new HttpResponse(answerEvents(answerDeltas), {
      headers: { "Content-Type": "text/event-stream" },
    });
  }),
];

/** Frames the deltas the way the server's hand-written SSE route does. */
function answerEvents(deltas: string[]) {
  const encoder = new TextEncoder();
  const frames = [
    `event: citations\ndata: ${JSON.stringify({ citations: answerCitations, grounded: answerGrounded })}\n\n`,
    ...deltas.map((text) => `event: delta\ndata: ${JSON.stringify({ text })}\n\n`),
    "event: done\ndata: {}\n\n",
  ];

  // One frame per pull, so a reader sees the Answer arrive in pieces.
  let nextFrame = 0;
  let deltasSent = 0;
  return new ReadableStream({
    async pull(controller) {
      const frame = frames[nextFrame];
      const isDelta = frame?.includes("event: delta");
      if (resumed && isDelta && (holdBeforeDeltas || deltasSent >= 1)) {
        await resumed;
      }
      nextFrame += 1;
      if (frame === undefined) {
        controller.close();
        return;
      }
      if (isDelta) {
        deltasSent += 1;
      }
      controller.enqueue(encoder.encode(frame));
    },
  });
}
