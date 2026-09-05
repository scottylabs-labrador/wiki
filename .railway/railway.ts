import { database, defineRailway, github, preserve, project, service, volume } from "railway/iac";

export default defineRailway(() => {
  const Wiki = github("scottylabs-labrador/Wiki", {
    branch: "demo",
    checkSuites: false,
  });

  // Railway's managed Postgres image does not carry pgvector, and the Corpus
  // stores Chunk embeddings in a `vector` column. Pinned to the same major
  // version the volume was written by, since Postgres will not start against a
  // data directory from another one.
  const Postgres = database("Postgres", "postgres", { image: "pgvector/pgvector:pg17" });
  Postgres.networking = { privateNetworkEndpoint: "postgres" };
  const postgresVolume = volume("postgres-volume");
  const _wikiweb = service("@wiki/web", {
    source: Wiki,
    build: {
      builder: "DOCKERFILE",
      dockerfilePath: "/apps/web/Dockerfile",
      watchPatterns: [
        "/apps/web/**",
        "/packages/common/**",
        "/packages/access-control/**",
        "/packages/db/**",
      ],
    },
    deploy: { sleepApplication: true },
    networking: { privateNetworkEndpoint: "wikiweb" },
    env: {
      VITE_PUBLIC_POSTHOG_HOST: preserve(),
      VITE_PUBLIC_POSTHOG_KEY: preserve(),
      VITE_SERVER_URL: "${{@wiki/server.SERVER_URL}}",
    },
  });
  const _wikiserver = service("@wiki/server", {
    source: Wiki,
    build: {
      builder: "DOCKERFILE",
      dockerfilePath: "/apps/server/Dockerfile",
      watchPatterns: [
        "/apps/server/**",
        "/packages/common/**",
        "/packages/access-control/**",
        "/packages/corpus/**",
        "/packages/db/**",
      ],
    },
    deploy: {
      preDeployCommand: ["bunx drizzle-kit migrate --config=/app/apps/server/drizzle.config.ts"],
      sleepApplication: true,
    },
    networking: { privateNetworkEndpoint: "wikiserver" },
    env: {
      ADMIN_GROUP: "wiki-admins",
      ALLOWED_ORIGINS_REGEX: "https://stack.scottylabs.org",
      AUTH_CLIENT_ID: "wiki-prod",
      AUTH_CLIENT_SECRET: preserve(),
      AUTH_ISSUER: "https://idp.scottylabs.org/realms/labrador",
      AUTH_JWKS_URI: "https://idp.scottylabs.org/realms/labrador/protocol/openid-connect/certs",
      BETTER_AUTH_URL: "https://stack.scottylabs.org",
      DATABASE_URL: "${{Postgres.DATABASE_URL}}",
      // Credit ceiling lives on this key in OpenRouter, as a backstop independent
      // of the per-member question limit.
      OPENROUTER_API_KEY: preserve(),
      OPENROUTER_MODEL: preserve(),
      OPENROUTER_EMBEDDING_MODEL: "openai/text-embedding-3-small",
      // Trust-critical: neighbours below this cosine similarity are treated as
      // irrelevant, so a question the wiki has never covered is not decorated
      // with Citations. Adjustable without a code deploy. See ADR-0002.
      RETRIEVAL_MIN_SIMILARITY: "0.3",
      SENTRY_DSN: preserve(),
      SERVER_URL: "https://api.stack.scottylabs.org",
    },
  });

  const ingestEnv = {
    DATABASE_URL: "${{Postgres.DATABASE_URL}}",
    OPENROUTER_API_KEY: preserve(),
    OPENROUTER_EMBEDDING_MODEL: "openai/text-embedding-3-small",
  };
  const ingestBuild = {
    builder: "DOCKERFILE" as const,
    dockerfilePath: "/apps/ingest/Dockerfile",
    watchPatterns: ["/apps/ingest/**", "/packages/corpus/**", "/packages/db/**"],
  };

  // A one-shot job rather than a server: it populates the Corpus and exits, so
  // it must never be restarted on completion. A fresh deploy runs this service
  // once so the Corpus is populated without waiting on the nightly schedule.
  const _wikiingest = service("@wiki/ingest", {
    source: Wiki,
    build: ingestBuild,
    deploy: { restartPolicyType: "NEVER" },
    env: ingestEnv,
  });

  // Nightly refresh. Cron jobs do not run on deploy, which is why the service
  // above exists separately rather than relying on scheduler behaviour.
  const _wikiingestNightly = service("@wiki/ingest-nightly", {
    source: Wiki,
    build: ingestBuild,
    deploy: { restartPolicyType: "NEVER", cronSchedule: "0 7 * * *" },
    env: ingestEnv,
  });

  return project("Wiki", {
    resources: [Postgres, _wikiweb, _wikiserver, _wikiingest, _wikiingestNightly, postgresVolume],
  });
});
