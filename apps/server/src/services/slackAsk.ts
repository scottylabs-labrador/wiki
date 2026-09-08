import type { Citation } from "@wiki/corpus";

import { addReaction, postThreadReply, removeReaction, type SlackMention } from "../lib/slack.ts";
import { captureUnexpectedError } from "../middlewares/errorHandler.ts";
import { openAnswerStream } from "./answerService.ts";

export const ACK_REACTION = "eyes";
export const GROUNDED_REACTION = "white_check_mark";
export const UNGROUNDED_REACTION = "warning";
export const FAILED_REACTION = "x";

export const CANNOT_PRODUCE_TEXT = "The Wiki Agent could not produce an Answer.";

/**
 * Delivers one standalone Ask from a Slack mention.
 *
 * Does not go through `POST /chat/answers`: that adapter requires a Member
 * session and spends the hourly quota. Slack Asks are open; see ADR-0004.
 * The stream is drained here because Slack gets one complete thread reply,
 * not token deltas.
 */
export async function deliverSlackAsk(mention: SlackMention): Promise<void> {
  try {
    await addReaction(mention, ACK_REACTION);
  } catch (error) {
    captureUnexpectedError(error);
  }

  try {
    const question = questionFromMention(mention.text);
    if (!question) {
      await postThreadReply(mention, CANNOT_PRODUCE_TEXT);
      await flipReaction(mention, FAILED_REACTION);
      return;
    }

    const answer = await collectAnswer(question);
    await postThreadReply(mention, formatSlackAnswer(answer.text, answer.citations));
    try {
      await flipReaction(mention, answer.grounded ? GROUNDED_REACTION : UNGROUNDED_REACTION);
    } catch (error) {
      captureUnexpectedError(error);
    }
  } catch (error) {
    captureUnexpectedError(error);
    try {
      await postThreadReply(mention, CANNOT_PRODUCE_TEXT);
      await flipReaction(mention, FAILED_REACTION);
    } catch (deliveryError) {
      captureUnexpectedError(deliveryError);
    }
  }
}

/** Leftover text after Slack's mention token is stripped; empty means there was no Ask. */
export function questionFromMention(text: string): string {
  return text
    .replace(/<@[A-Z0-9]+(?:\|[^>]+)?>/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function formatSlackAnswer(text: string, citations: Citation[]): string {
  const body = markdownLinksToSlack(text);
  if (citations.length === 0) {
    return body;
  }
  const links = citations.map((citation) => `<${citation.url}|${citation.title}>`).join("\n");
  return `${body}\n\n${links}`;
}

/**
 * Turns GitHub-flavoured markdown links into Slack mrkdwn. Code is left alone
 * so a sample `[text](url)` stays a sample. Slack's API does not understand
 * `[text](url)`, only `<url|text>`.
 */
function markdownLinksToSlack(text: string): string {
  return text.replace(
    /```[\s\S]*?```|`[^`]*`|!?\[([^\]]*)\]\((https?:\/\/[^\s)]+)(?:\s+(?:"[^"]*"|'[^']*'))?\)/g,
    (match, label: string | undefined, url: string | undefined) => {
      if (url === undefined || match.startsWith("![")) {
        return match;
      }
      return `<${url}|${label}>`;
    },
  );
}

async function flipReaction(mention: SlackMention, name: string): Promise<void> {
  try {
    await removeReaction(mention, ACK_REACTION);
  } catch (error) {
    captureUnexpectedError(error);
  }
  await addReaction(mention, name);
}

async function collectAnswer(question: string): Promise<{
  text: string;
  citations: Citation[];
  grounded: boolean;
}> {
  const stream = await openAnswerStream(
    [{ role: "user", content: question }],
    AbortSignal.timeout(60_000),
  );
  let text = "";
  for await (const delta of stream.deltas) {
    text += delta;
  }
  return { text, citations: stream.citations, grounded: stream.grounded };
}
