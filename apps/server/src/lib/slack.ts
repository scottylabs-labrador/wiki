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
  /** Present on an app_mention. Required for the bot to call Real-time Search. */
  action_token?: string;
}

/** One public Slack message returned to the model and to the thread footer. */
export interface SlackHit {
  authorName: string;
  channelName: string;
  content: string;
  permalink: string;
  before: string[];
  after: string[];
}

/** Matches the wiki retrieval cap. Slack allows at most 20. */
const SLACK_SEARCH_LIMIT = 8;

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
  if (!opts.timestamp || !opts.signature || !env.SLACK_SIGNING_SECRET) {
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

/**
 * Searches public channels for one mention.
 *
 * The bot token can call this only with the mention's action token, and only
 * for public channels. See ADR-0006.
 */
export async function searchPublicMessages(
  actionToken: string,
  query: string,
  signal?: AbortSignal,
): Promise<SlackHit[]> {
  const result = (await slackMethod(
    "assistant.search.context",
    {
      query,
      action_token: actionToken,
      channel_types: ["public_channel"],
      content_types: ["messages"],
      include_context_messages: true,
      limit: SLACK_SEARCH_LIMIT,
    },
    signal,
  )) as SlackSearchResponse;

  return (result.results?.messages ?? []).slice(0, SLACK_SEARCH_LIMIT).flatMap(slackHitFrom);
}

interface SlackSearchResponse {
  results?: {
    messages?: SlackSearchMessage[];
  };
}

interface SlackSearchMessage {
  author_name?: string;
  channel_name?: string;
  content?: string;
  permalink?: string;
  context_messages?: {
    before?: SlackContextMessage[];
    after?: SlackContextMessage[];
  };
}

interface SlackContextMessage {
  text?: string;
}

function slackHitFrom(message: SlackSearchMessage): SlackHit[] {
  const content = message.content?.trim();
  const permalink = message.permalink?.trim();
  if (!content || !permalink) {
    return [];
  }
  return [
    {
      authorName: message.author_name?.trim() ?? "",
      channelName: message.channel_name?.trim() ?? "",
      content,
      permalink,
      before: contextLines(message.context_messages?.before),
      after: contextLines(message.context_messages?.after),
    },
  ];
}

function contextLines(messages: SlackContextMessage[] | undefined): string[] {
  if (!messages) {
    return [];
  }
  return messages.flatMap((message) => {
    const text = message.text?.trim();
    return text ? [text] : [];
  });
}

async function slackMethod(
  method: string,
  body: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<unknown> {
  if (!env.SLACK_BOT_TOKEN) {
    throw new Error("SLACK_BOT_TOKEN is required to call Slack");
  }

  const response = await fetch(`${SLACK_API}/${method}`, {
    method: "POST",
    ...(signal ? { signal } : {}),
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
  return result;
}
