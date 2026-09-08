import { beforeEach, vi } from "vitest";

/** Seeds env vars before app modules that validate process.env are imported. */
process.env["ADMIN_GROUP"] ??= "test-admins";
process.env["ALLOWED_ORIGINS_REGEX"] ??= ".*";
process.env["AUTH_ISSUER"] ??= "https://auth.example.com";
process.env["AUTH_CLIENT_ID"] ??= "test-client-id";
process.env["AUTH_CLIENT_SECRET"] ??= "test-client-secret";
process.env["AUTH_JWKS_URI"] ??= "https://auth.example.com/.well-known/jwks.json";
process.env["BETTER_AUTH_URL"] ??= "https://auth.example.com";
process.env["BETTER_AUTH_SECRET"] ??= "test-auth-secret-Q2m8xV4pL7rT1nB6kY0wJ9sD3fH5cZ";
process.env["DATABASE_URL"] ??= "postgres://localhost:5432/test";
process.env["OPENROUTER_API_KEY"] ??= "test-openrouter-key";
process.env["OPENROUTER_MODEL"] ??= "~deepseek/deepseek-v4-flash-latest";
process.env["OPENROUTER_EMBEDDING_MODEL"] ??= "openai/text-embedding-3-small";
process.env["SERVER_URL"] ??= "https://api.example.com";
process.env["SLACK_BOT_TOKEN"] ??= "xoxb-test-token";
process.env["SLACK_SIGNING_SECRET"] ??= "test-slack-signing-secret";

vi.mock("../src/lib/db.ts", async () => {
  const { testDb } = await import("./harness.ts");
  return { db: testDb };
});

vi.mock("../src/lib/embedder.ts", async () => {
  const { EMBEDDING_DIMENSIONS } = await import("@wiki/db/schema");
  const { embedByText } = await import("./embedderState.ts");
  const ones = Array.from({ length: EMBEDDING_DIMENSIONS }, () => 1);
  return {
    embedder: {
      model: process.env["OPENROUTER_EMBEDDING_MODEL"] ?? "openai/text-embedding-3-small",
      embed: (texts: string[]) => Promise.resolve(texts.map((text) => embedByText[text] ?? ones)),
    },
  };
});

vi.mock("jwks-rsa", async () => {
  const { publicKeyPem } = await import("./keys.ts");
  return {
    default: () => ({
      getSigningKey: (
        _kid: string | undefined,
        cb: (err: Error | null, key?: { getPublicKey: () => string }) => void,
      ) => {
        cb(null, { getPublicKey: () => publicKeyPem });
      },
    }),
  };
});

beforeEach(async () => {
  const { resetDb } = await import("./harness.ts");
  const { resetEmbedByText } = await import("./embedderState.ts");
  await resetDb();
  resetEmbedByText();
});
