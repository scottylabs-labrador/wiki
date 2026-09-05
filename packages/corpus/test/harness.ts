import path from "node:path";
import { fileURLToPath } from "node:url";

import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeEach } from "vitest";

const migrationsFolder = path.resolve(fileURLToPath(new URL("../../db/drizzle", import.meta.url)));

// Chunk embeddings live in a `vector` column, so the migrations only replay
// against a PGlite carrying pgvector.
const pglite = new PGlite({ extensions: { vector } });
export const testDb = drizzle({ client: pglite });

await migrate(testDb, { migrationsFolder });

export async function resetDb() {
  await testDb.execute(
    sql`TRUNCATE TABLE "source_ingest", "page", "chunk", "question_rate" CASCADE`,
  );
}

// Importing this file is what boots PGlite. Unit tests that never touch the
// Corpus must not load it: on CI the first beforeEach otherwise exceeds
// Vitest's 10s hookTimeout while pgvector starts.
beforeEach(resetDb);
