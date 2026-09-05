import { http, HttpResponse } from "msw";

import { API_URL } from "../fixtures.ts";

export let session: ReturnType<typeof import("../fixtures.ts").userSession> | null = null;
export let adminUsers: Array<{
  id: string;
  name: string;
}> = [];
export let answerDeltas: string[] = [];
export let askedBodies: Array<{ turns: Array<{ role: string; content: string }> }> = [];

export function setSession(next: typeof session) {
  session = next;
}

export function setAdminUsers(next: typeof adminUsers) {
  adminUsers = next;
}

/** Resolves when a held stream is allowed to write the rest of its deltas. */
let resumed: Promise<void> | null = null;

/** The pieces of text the fake Answer stream will emit, in order. */
export function setAnswerDeltas(next: typeof answerDeltas) {
  answerDeltas = next;
  askedBodies = [];
  resumed = null;
}

/**
 * Stops the fake Answer stream after its first delta.
 *
 * Returns the release, so a test can assert on a half-written Answer without
 * racing a timer.
 */
export function holdAnswerStream() {
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
  http.post(`${API_URL}/chat/answers`, async ({ request }) => {
    askedBodies.push((await request.json()) as (typeof askedBodies)[number]);
    if (!session) {
      return new HttpResponse(null, { status: 401 });
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
    ...deltas.map((text) => `event: delta\ndata: ${JSON.stringify({ text })}\n\n`),
    "event: done\ndata: {}\n\n",
  ];

  // One frame per pull, so a reader sees the Answer arrive in pieces.
  let nextFrame = 0;
  return new ReadableStream({
    async pull(controller) {
      if (nextFrame > 0 && resumed) {
        await resumed;
      }
      const frame = frames[nextFrame];
      nextFrame += 1;
      if (frame === undefined) {
        controller.close();
        return;
      }
      controller.enqueue(encoder.encode(frame));
    },
  });
}
