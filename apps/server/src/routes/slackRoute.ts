import type { Request, Response } from "express";
import { z } from "zod";

import { verifySlackSignature } from "../lib/slack.ts";
import { captureUnexpectedError } from "../middlewares/errorHandler.ts";
import { deliverSlackAsk } from "../services/slackAsk.ts";

/** Where Slack posts Events API payloads, including the url_verification challenge. */
export const SLACK_EVENTS_PATH = "/slack/events";

/** Slack retries for a few minutes; this is long enough to ignore those without a table. */
const DEDUPE_MS = 10 * 60 * 1000;

const seenEvents = new Map<string, number>();

const urlVerificationSchema = z.object({
  type: z.literal("url_verification"),
  challenge: z.string(),
});

const eventCallbackSchema = z.object({
  type: z.literal("event_callback"),
  event_id: z.string(),
  event: z.object({
    type: z.string(),
    text: z.string().optional(),
    ts: z.string().optional(),
    channel: z.string().optional(),
    thread_ts: z.string().optional(),
  }),
});

/**
 * Accepts a Slack Events API POST.
 *
 * Slack requires a 200 within three seconds or it retries the same event, which
 * would open a second Answer. The Ask is therefore started after the response
 * is committed, and `event_id` is remembered so a retry still does not double-post.
 */
export function receiveSlackEvent(req: Request, res: Response): void {
  try {
    const rawBody = Buffer.isBuffer(req.body) ? req.body.toString("utf8") : "";
    if (
      !verifySlackSignature({
        rawBody,
        timestamp: header(req, "x-slack-request-timestamp"),
        signature: header(req, "x-slack-signature"),
      })
    ) {
      res.status(401).json({ name: "Unauthenticated" });
      return;
    }

    let payload: unknown;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      res.status(400).json({ name: "BadRequest", message: "Expected JSON." });
      return;
    }

    const challenge = urlVerificationSchema.safeParse(payload);
    if (challenge.success) {
      res.status(200).json({ challenge: challenge.data.challenge });
      return;
    }

    const callback = eventCallbackSchema.safeParse(payload);
    const event = callback.success ? callback.data.event : undefined;
    if (
      !callback.success ||
      event?.type !== "app_mention" ||
      !event.text ||
      !event.ts ||
      !event.channel
    ) {
      res.status(200).end();
      return;
    }

    if (!claimSlackEvent(callback.data.event_id)) {
      res.status(200).end();
      return;
    }

    res.status(200).end();
    void deliverSlackAsk({
      channel: event.channel,
      text: event.text,
      ts: event.ts,
      ...(event.thread_ts ? { thread_ts: event.thread_ts } : {}),
    }).catch(captureUnexpectedError);
  } catch (error) {
    captureUnexpectedError(error);
    if (!res.headersSent) {
      res.status(500).json({ message: "Internal Server Error" });
    }
  }
}

/** Remembers an Events API id so a Slack retry does not start a second Ask. */
export function claimSlackEvent(eventId: string, now = Date.now()): boolean {
  pruneSeenEvents(now);
  if (seenEvents.has(eventId)) {
    return false;
  }
  seenEvents.set(eventId, now);
  return true;
}

export function clearSeenSlackEvents(): void {
  seenEvents.clear();
}

function pruneSeenEvents(now: number): void {
  for (const [eventId, seenAt] of seenEvents) {
    if (now - seenAt > DEDUPE_MS) {
      seenEvents.delete(eventId);
    }
  }
}

function header(req: Request, name: string): string | undefined {
  const value = req.header(name);
  return Array.isArray(value) ? value[0] : value;
}
