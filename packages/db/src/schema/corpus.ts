import { relations } from "drizzle-orm";
import { index, integer, pgTable, text, timestamp, uuid, vector } from "drizzle-orm/pg-core";

/** Dimension of the embeddings the Corpus is built with. */
export const EMBEDDING_DIMENSIONS = 1536;

/**
 * What the last completed ingestion of a Source produced.
 *
 * A run compares this against upstream before embedding anything: the same
 * upstream commit, embedding model and chunker mean the stored Chunks are
 * already what this run would produce, so it does no work.
 */
export const sourceIngest = pgTable("source_ingest", {
  sourceId: text("source_id").primaryKey(),
  upstreamSha: text("upstream_sha").notNull(),
  embeddingModel: text("embedding_model").notNull(),
  chunkerVersion: integer("chunker_version").notNull(),
  ingestedAt: timestamp("ingested_at").notNull(),
});

export const page = pgTable(
  "page",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sourceId: text("source_id").notNull(),
    // The upstream filename exactly as the Source spells it. Never
    // Unicode-normalised: see ADR-0002.
    filename: text("filename").notNull(),
    publicUrl: text("public_url").notNull(),
  },
  (table) => [index("page_sourceId_idx").on(table.sourceId)],
);

export const chunk = pgTable(
  "chunk",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    pageId: uuid("page_id")
      .notNull()
      .references(() => page.id, { onDelete: "cascade" }),
    // Null for a Chunk that no heading introduces, which cites its Page whole.
    heading: text("heading"),
    anchor: text("anchor"),
    body: text("body").notNull(),
    ordinal: integer("ordinal").notNull(),
    embedding: vector("embedding", { dimensions: EMBEDDING_DIMENSIONS }).notNull(),
  },
  // No vector index: at this Corpus size a sequential scan beats HNSW. See ADR-0001.
  (table) => [index("chunk_pageId_idx").on(table.pageId)],
);

export const pageRelations = relations(page, ({ many }) => ({
  chunks: many(chunk),
}));

export const chunkRelations = relations(chunk, ({ one }) => ({
  page: one(page, {
    fields: [chunk.pageId],
    references: [page.id],
  }),
}));
