import { integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * How many questions a member has asked in the current hour.
 *
 * Only an identifier, a count and a window are stored: never the questions or
 * Answers themselves. This exists to stop runaway loops, not to retain a
 * conversation.
 */
export const questionRate = pgTable("question_rate", {
  userId: text("user_id").primaryKey(),
  windowStartedAt: timestamp("window_started_at").notNull(),
  count: integer("count").notNull(),
});
