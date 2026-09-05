-- The Corpus stores Chunk embeddings in a `vector` column, so pgvector has to
-- exist before the next migration can declare one. `IF NOT EXISTS` only skips
-- creating an extension already created in this database; the server must
-- already carry pgvector's files, which is why every Postgres this runs against
-- uses a pgvector-capable image.
CREATE EXTENSION IF NOT EXISTS vector;
