/** biome-ignore-all lint/style/useNamingConvention: environment variables are in SCREAMING_CASE */
import { z } from "zod";

// Ingestion reads the Corpus and an embeddings provider, and nothing else. It
// deliberately does not carry the server's auth configuration.
const envSchema = z.object({
  DATABASE_URL: z.string(),
  OPENROUTER_API_KEY: z.string(),
  OPENROUTER_EMBEDDING_MODEL: z.string().default("openai/text-embedding-3-small"),
});

const env = envSchema.parse(process.env);

export { env };
