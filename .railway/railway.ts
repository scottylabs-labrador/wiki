import { defineRailway, github, postgres, preserve, project, service, volume } from "railway/iac";

export default defineRailway(() => {
  const ScottyStack = github("scottylabs-labrador/ScottyStack", {
    branch: "demo",
    checkSuites: false,
  });

  const Postgres = postgres("Postgres");
  Postgres.networking = { privateNetworkEndpoint: "postgres" };
  const postgresVolume = volume("postgres-volume");
  const _scottystackweb = service("@scottystack/web", {
    source: ScottyStack,
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
    networking: { privateNetworkEndpoint: "scottystackweb" },
    env: {
      VITE_PUBLIC_POSTHOG_HOST: preserve(),
      VITE_PUBLIC_POSTHOG_KEY: preserve(),
      VITE_SERVER_URL: "${{@scottystack/server.SERVER_URL}}",
    },
  });
  const _scottystackserver = service("@scottystack/server", {
    source: ScottyStack,
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
    networking: { privateNetworkEndpoint: "scottystackserver" },
    env: {
      ADMIN_GROUP: "scottystack-admins",
      ALLOWED_ORIGINS_REGEX: "https://stack.scottylabs.org",
      AUTH_CLIENT_ID: "scottystack-prod",
      AUTH_CLIENT_SECRET: preserve(),
      AUTH_ISSUER: "https://idp.scottylabs.org/realms/labrador",
      AUTH_JWKS_URI: "https://idp.scottylabs.org/realms/labrador/protocol/openid-connect/certs",
      BETTER_AUTH_URL: "https://stack.scottylabs.org",
      DATABASE_URL: "${{Postgres.DATABASE_URL}}",
      SENTRY_DSN: preserve(),
      SERVER_URL: "https://api.stack.scottylabs.org",
    },
  });

  return project("ScottyStack", {
    resources: [Postgres, _scottystackweb, _scottystackserver, postgresVolume],
  });
});
