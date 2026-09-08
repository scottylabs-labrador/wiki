import { createHmac, timingSafeEqual } from "node:crypto";

import { env } from "../env.ts";

const SLACK_API = "https://slack.com/api";

/** Slack rejects Events API requests older than this; replayed bodies are a common attack. */
const MAX_REQUEST_AGE_SECONDS = 60 * 5;

export interface SlackMention {
  channel: string;
  text: string;
  ts: string;
  thread_ts?: string;
}

/**
 * Checks the HMAC Slack attaches to every Events API request.
 *
 * The comparison is timing-safe and the timestamp is bounded so a captured
 * body cannot be replayed minutes later.
 */
export function verifySlackSignature(opts: {
  rawBody: string;
  timestamp: string | undefined;
  signature: string | undefined;
  now?: number;
}): boolean {
  if (!opts.timestamp || !opts.signature) {
    return false;
  }

  const timestamp = Number(opts.timestamp);
  const now = opts.now ?? Math.floor(Date.now() / 1000);
  if (!Number.isFinite(timestamp) || Math.abs(now - timestamp) > MAX_REQUEST_AGE_SECONDS) {
    return false;
  }

  const digest = `v0=${createHmac("sha256", env.SLACK_SIGNING_SECRET)
    .update(`v0:${opts.timestamp}:${opts.rawBody}`)
    .digest("hex")}`;
  const expected = Buffer.from(digest);
  const actual = Buffer.from(opts.signature);
  if (expected.length !== actual.length) {
    return false;
  }
  return timingSafeEqual(expected, actual);
}

export async function addReaction(mention: SlackMention, name: string): Promise<void> {
  await slackMethod("reactions.add", {
    channel: mention.channel,
    name,
    timestamp: mention.ts,
  });
}

export async function removeReaction(mention: SlackMention, name: string): Promise<void> {
  await slackMethod("reactions.remove", {
    channel: mention.channel,
    name,
    timestamp: mention.ts,
  });
}

/**
 * Posts under the mentioning message, or in the thread that message already
 * belongs to, so the channel timeline stays a list of Asks rather than Answers.
 */
export async function postThreadReply(mention: SlackMention, text: string): Promise<void> {
  await slackMethod("chat.postMessage", {
    channel: mention.channel,
    thread_ts: mention.thread_ts ?? mention.ts,
    text,
    unfurl_links: false,
  });
}

async function slackMethod(method: string, body: Record<string, unknown>): Promise<void> {
  const response = await fetch(`${SLACK_API}/${method}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.SLACK_BOT_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const result = (await response.json()) as { ok?: boolean; error?: string };
  if (!result.ok) {
    throw new Error(`Slack ${method} failed: ${result.error ?? response.status}`);
  }
}
