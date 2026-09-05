import { questionRate } from "@wiki/db/schema";
import { eq } from "drizzle-orm";

import { db } from "../lib/db.ts";

/** A member may ask this many questions in each hour-long window. */
export const QUESTIONS_PER_WINDOW = 60;

const WINDOW_MS = 60 * 60 * 1000;

export type Quota =
  | { allowed: true; remaining: number; resetAt: Date }
  | { allowed: false; remaining: 0; resetAt: Date };

function windowState(row: { windowStartedAt: Date; count: number } | undefined, now: Date): Quota {
  if (!row || now.getTime() - row.windowStartedAt.getTime() >= WINDOW_MS) {
    return {
      allowed: true,
      remaining: QUESTIONS_PER_WINDOW,
      resetAt: new Date(now.getTime() + WINDOW_MS),
    };
  }

  const resetAt = new Date(row.windowStartedAt.getTime() + WINDOW_MS);
  if (row.count >= QUESTIONS_PER_WINDOW) {
    return { allowed: false, remaining: 0, resetAt };
  }
  return { allowed: true, remaining: QUESTIONS_PER_WINDOW - row.count, resetAt };
}

/**
 * Records one question against a member's hour, or refuses it.
 *
 * Only the member, a count and a window are written. The check is meant to run
 * before any call to the model provider, so exhaustion cannot spend credit.
 * The window starts at the first question and lasts one hour; a trailing log of
 * asks is not stored.
 */
export async function consumeQuestion(userId: string, now = new Date()): Promise<Quota> {
  return await db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(questionRate)
      .where(eq(questionRate.userId, userId))
      .for("update");

    const quota = windowState(row, now);
    if (!row || quota.remaining === QUESTIONS_PER_WINDOW) {
      const resetAt = new Date(now.getTime() + WINDOW_MS);
      await tx
        .insert(questionRate)
        .values({ userId, windowStartedAt: now, count: 1 })
        .onConflictDoUpdate({
          target: questionRate.userId,
          set: { windowStartedAt: now, count: 1 },
        });
      return { allowed: true, remaining: QUESTIONS_PER_WINDOW - 1, resetAt };
    }

    if (!quota.allowed) {
      return quota;
    }

    await tx
      .update(questionRate)
      .set({ count: row.count + 1 })
      .where(eq(questionRate.userId, userId));
    return { allowed: true, remaining: quota.remaining - 1, resetAt: quota.resetAt };
  });
}

/** How many questions a member has left in the current window, without spending one. */
export async function peekQuota(userId: string, now = new Date()): Promise<Quota> {
  const [row] = await db.select().from(questionRate).where(eq(questionRate.userId, userId));
  return windowState(row, now);
}
