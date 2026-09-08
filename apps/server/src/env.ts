/** biome-ignore-all lint/style/useNamingConvention: environment variables are in SCREAMING_CASE */
import { z } from "zod";

// Define the schema as an object with all of the env variables and their types
const envSchema = z.object({
  ADMIN_GROUP: z.string(),
  ALLOWED_ORIGINS_REGEX: z.string(),
  AUTH_ISSUER: z.url(),
  AUTH_CLIENT_ID: z.string(),
  AUTH_CLIENT_SECRET: z.string(),
  AUTH_JWKS_URI: z.url(),
  BETTER_AUTH_URL: z.url(), // https://www.better-auth.com/docs/installation#set-environment-variables
  DATABASE_URL: z.string(),
  OPENROUTER_API_KEY: z.string(),
  OPENROUTER_MODEL: z.string(),
  OPENROUTER_EMBEDDING_MODEL: z.string().default("openai/text-embedding-3-small"),
  /** Cosine similarity below which retrieved Chunks are treated as irrelevant. See ADR-0002. */
  RETRIEVAL_MIN_SIMILARITY: z.coerce.number().min(0).max(1).default(0.3),
  SENTRY_DSN: z.string().optional(),
  SERVER_URL: z.url(),
  SERVER_PORT: z.coerce.number().default(80),
  SLACK_BOT_TOKEN: z.string(),
  SLACK_SIGNING_SECRET: z.string(),
});

// Validate `process.env` against our schema and return the result
const env = envSchema.parse(process.env);

// Export the result so we can use it in the project
export { env };
