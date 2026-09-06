import { defineRailway, github, image, preserve, project, service, volume } from "railway/iac";

export default defineRailway(() => {
  const Wiki = github("scottylabs-labrador/wiki", {
    branch: "main",
    checkSuites: false,
  });

  // Railway's managed Postgres image does not carry pgvector, and the Corpus
  // stores Chunk embeddings in a `vector` column. This is a custom-image
  // service (not database()) so IaC matches the live resource. Pinned to the
  // same major version the volume was written by, since Postgres will not
  // start against a data directory from another one. Railway first provisioned
  // this volume on 18, so the image is pg18 rather than pg17.
  const postgresVolume = volume("postgres", {
    region: "us-east4-eqdc4a",
    sizeMB: 50000,
  });
  const Postgres = service("Postgres", {
    source: image("pgvector/pgvector:pg18"),
    deploy: { requiredMountPath: "/var/lib/postgresql/data" },
    networking: { privateNetworkEndpoint: "postgres" },
    volumeMounts: {
      "/var/lib/postgresql/data": postgresVolume,
    },
    env: {
      DATABASE_URL: preserve(),
      PGDATA: preserve(),
      PGDATABASE: preserve(),
      PGHOST: preserve(),
      PGPASSWORD: preserve(),
      PGPORT: preserve(),
      PGUSER: preserve(),
      POSTGRES_DB: preserve(),
      POSTGRES_PASSWORD: preserve(),
      POSTGRES_USER: preserve(),
      RAILWAY_DEPLOYMENT_DRAINING_SECONDS: preserve(),
      SSL_CERT_DAYS: preserve(),
    },
  });
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
      ALLOWED_ORIGINS_REGEX: "https://wiki.scottylabs.org",
      AUTH_CLIENT_ID: "wiki-prod",
      AUTH_CLIENT_SECRET: preserve(),
      AUTH_ISSUER: "https://idp.scottylabs.org/realms/labrador",
      AUTH_JWKS_URI: "https://idp.scottylabs.org/realms/labrador/protocol/openid-connect/certs",
      BETTER_AUTH_URL: "https://wiki.scottylabs.org",
      DATABASE_URL: "${{Postgres.DATABASE_URL}}",
      // Credit ceiling lives on this key in OpenRouter, as a backstop independent
      // of the per-member question limit.
      OPENROUTER_API_KEY: preserve(),
      OPENROUTER_MODEL: "~deepseek/deepseek-v4-flash-latest",
      OPENROUTER_EMBEDDING_MODEL: "openai/text-embedding-3-small",
      // Trust-critical: neighbours below this cosine similarity are treated as
      // irrelevant, so a question the wiki has never covered is not decorated
      // with Citations. Adjustable without a code deploy. See ADR-0002.
      RETRIEVAL_MIN_SIMILARITY: "0.3",
      SENTRY_DSN: preserve(),
      SERVER_URL: "https://api.wiki.scottylabs.org",
    },
  });

  // A one-shot job rather than a server: it populates the Corpus and exits, so
  // it must never be restarted on completion. A run that hangs would cause
  // Railway to skip the next scheduled one.
  const _wikiingest = service("@wiki/ingest", {
    source: Wiki,
    build: {
      builder: "DOCKERFILE",
      dockerfilePath: "/apps/ingest/Dockerfile",
      watchPatterns: ["/apps/ingest/**", "/packages/corpus/**", "/packages/db/**"],
    },
    deploy: {
      restartPolicyType: "NEVER",
      cronSchedule: "0 7 * * *",
    },
    env: {
      DATABASE_URL: "${{Postgres.DATABASE_URL}}",
      OPENROUTER_API_KEY: preserve(),
      OPENROUTER_EMBEDDING_MODEL: "openai/text-embedding-3-small",
    },
  });

  return project("Wiki", {
    resources: [Postgres, _wikiweb, _wikiserver, _wikiingest, postgresVolume],
  });
});
