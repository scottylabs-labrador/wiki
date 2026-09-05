import { fromNodeHeaders } from "better-auth/node";
import type { Request, Response } from "express";
import { z } from "zod";

import { auth } from "../lib/auth.ts";
import {
  AuthenticationError,
  BadGatewayError,
  BadRequestError,
  captureUnexpectedError,
  PayloadTooLargeError,
} from "../middlewares/errorHandler.ts";
import { openAnswerStream, type Turn } from "../services/answerService.ts";

/** Where the browser posts a conversation to have the next Answer streamed back. */
export const ANSWER_STREAM_PATH = "/chat/answers";

/**
 * How many trailing turns of a conversation are sent to the chat model.
 *
 * A long-lived tab keeps asking with everything it has said so far, so without
 * a limit the prompt — and the bill — would grow all afternoon.
 */
export const MAX_TURNS = 10;

/**
 * How many characters of conversation one request may carry.
 *
 * Measured against the turns that are actually sent rather than everything that
 * arrived, since the surplus is dropped instead of rejected. So this guards how
 * large the recent turns may be, not how many turns a tab has accumulated.
 */
export const MAX_CONVERSATION_CHARS = 24_000;

const conversationSchema = z.object({
  turns: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().min(1),
      }),
    )
    .min(1),
});

const SSE_HEADERS = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
  // Reverse proxies buffer responses by default, which would collect the whole
  // Answer before releasing any of it and undo the streaming.
  "X-Accel-Buffering": "no",
};

/**
 * Streams the next Answer in a conversation.
 *
 * Hand-written rather than a TSOA controller because server-sent events cannot
 * be described in an OpenAPI spec. Every authenticated realm member may ask;
 * there is no group restriction beyond being signed in.
 *
 * Only a failure raised before the first byte may be thrown: `errorHandler`
 * answers with a status, and once the stream has begun the status is spent.
 * Anything that goes wrong after that is reported as an `error` event instead.
 */
export async function streamAnswer(req: Request, res: Response) {
  const userId = await signedInUserId(req);
  if (!userId) {
    // Rejected before the request reaches OpenRouter, so an anonymous caller
    // can never spend the committee's credit.
    throw new AuthenticationError();
  }

  const body = conversationSchema.safeParse(req.body);
  if (!body.success) {
    throw new BadRequestError("Expected a non-empty list of turns.");
  }

  const turns: Turn[] = body.data.turns.slice(-MAX_TURNS);
  const chars = turns.reduce((total, turn) => total + turn.content.length, 0);
  if (chars > MAX_CONVERSATION_CHARS) {
    throw new PayloadTooLargeError(
      `A conversation may carry at most ${MAX_CONVERSATION_CHARS} characters.`,
    );
  }

  // Abandoning the tab must stop the upstream call, which is still being billed.
  const upstream = new AbortController();
  res.on("close", () => upstream.abort());

  let deltas: AsyncIterable<string>;
  try {
    deltas = await openAnswerStream(turns, upstream.signal);
  } catch (error) {
    captureUnexpectedError(`Could not open an Answer stream for ${userId}: ${String(error)}`);
    throw new BadGatewayError("The chat model is unavailable.");
  }

  res.writeHead(200, SSE_HEADERS);
  try {
    for await (const text of deltas) {
      writeEvent(res, "delta", { text });
    }
    // Ticket #4 adds a `citations` event here, once an Answer has Citations.
    writeEvent(res, "done", {});
  } catch (error) {
    captureUnexpectedError(`Answer stream for ${userId} broke off: ${String(error)}`);
    // The stream is already committed to a 200, so the only way to tell the
    // browser the Answer is incomplete is an event it can recognise.
    writeEvent(res, "error", { message: "The Answer stopped part way through." });
  }
  res.end();
}

/**
 * Resolves the stable user id of the signed-in member, or null.
 *
 * Reads the Better Auth session rather than going through TSOA's `@Security`
 * decorator, which a hand-written route cannot use.
 */
async function signedInUserId(req: Request): Promise<string | null> {
  try {
    const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
    return session?.user.id ?? null;
  } catch (error) {
    captureUnexpectedError(error);
    return null;
  }
}

function writeEvent(res: Response, event: string, data: unknown) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}
