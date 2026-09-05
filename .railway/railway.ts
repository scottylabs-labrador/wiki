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
      SENTRY_DSN: preserve(),
      SERVER_URL: "https://api.stack.scottylabs.org",
    },
  });

  // A one-shot job rather than a server: it populates the Corpus and exits, so
  // it must never be restarted on completion. The nightly schedule is added in
  // the ticket that refreshes every Source.
  const _wikiingest = service("@wiki/ingest", {
    source: Wiki,
    build: {
      builder: "DOCKERFILE",
      dockerfilePath: "/apps/ingest/Dockerfile",
      watchPatterns: ["/apps/ingest/**", "/packages/corpus/**", "/packages/db/**"],
    },
    deploy: { restartPolicyType: "NEVER" },
    env: {
      DATABASE_URL: "${{Postgres.DATABASE_URL}}",
      OPENROUTER_API_KEY: preserve(),
      OPENROUTER_EMBEDDING_MODEL: "openai/text-embedding-3-small",
      SENTRY_DSN: preserve(),
    },
  });

  return project("Wiki", {
    resources: [Postgres, _wikiweb, _wikiserver, _wikiingest, postgresVolume],
  });
});
