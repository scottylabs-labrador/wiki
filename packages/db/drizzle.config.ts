// https://orm.drizzle.team/docs/get-started/postgresql-new#step-5---setup-drizzle-config-file
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  out: "./drizzle",
  schema: "./src/schema",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env["DATABASE_URL"] as string,
    // This was `require` for Railway's managed Postgres and its self-signed
    // certificates. That image does not carry pgvector, so the database now
    // runs the official pgvector image, which serves no TLS at all. Migrations
    // only ever reach it over Railway's private network.
    ssl: false,
  },
});
