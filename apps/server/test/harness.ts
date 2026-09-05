import path from "node:path";
import { fileURLToPath } from "node:url";

import { PGlite } from "@electric-sql/pglite";
import { account, session, user } from "@wiki/db/schema";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import jwt from "jsonwebtoken";

import { privateKeyPem } from "./keys.ts";

const migrationsFolder = path.resolve(
  fileURLToPath(new URL("../../../packages/db/drizzle", import.meta.url)),
);

const pglite = new PGlite();
export const testDb = drizzle({ client: pglite });

await migrate(testDb, { migrationsFolder });

export async function resetDb() {
  await testDb.execute(sql`TRUNCATE TABLE "session", "account", "verification", "user" CASCADE`);
}

export async function seedUser(opts: {
  id: string;
  name: string;
  email: string;
  accountId: string;
}) {
  const now = new Date();
  await testDb.insert(user).values({
    id: opts.id,
    name: opts.name,
    email: opts.email,
    full_email: opts.email,
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  });
  await testDb.insert(account).values({
    id: `${opts.id}-account`,
    accountId: opts.accountId,
    providerId: "keycloak",
    userId: opts.id,
    // The custom session decodes this to work out the user's role, so a signed-in
    // request fails without it.
    accessToken: bearerToken({ sub: opts.accountId }),
    accessTokenExpiresAt: new Date(now.getTime() + 60 * 60 * 1000),
    createdAt: now,
    updatedAt: now,
  });
  await testDb.insert(session).values({
    id: `${opts.id}-session`,
    token: sessionToken(opts.id),
    userId: opts.id,
    expiresAt: new Date(now.getTime() + 60 * 60 * 1000),
    createdAt: now,
    updatedAt: now,
  });
}

export function bearerToken(opts: { sub: string; groups?: string[] }) {
  return jwt.sign({ sub: opts.sub, groups: opts.groups }, privateKeyPem, {
    algorithm: "RS256",
    issuer: process.env["AUTH_ISSUER"],
    audience: process.env["AUTH_CLIENT_ID"],
    keyid: "test-kid",
    expiresIn: "1h",
  });
}

export function authHeader(opts: { sub: string; groups?: string[] }) {
  return { Authorization: `Bearer ${bearerToken(opts)}` };
}

function sessionToken(userId: string) {
  return `${userId}-session-token`;
}

// Better Auth prefixes its cookies when the base URL is https.
const cookieName = `${
  process.env["SERVER_URL"]?.startsWith("https:") ? "__Secure-" : ""
}better-auth.session_token`;

/**
 * Builds the cookie header Better Auth accepts for a seeded user's session.
 *
 * Better Auth signs the session cookie with an HMAC of the session token, so a
 * bare token in the header is rejected.
 */
export async function sessionHeader(opts: { id: string }) {
  const token = sessionToken(opts.id);
  const secret = process.env["BETTER_AUTH_SECRET"] ?? "";
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(token));
  const encoded = btoa(String.fromCharCode(...new Uint8Array(signature)));
  return { Cookie: `${cookieName}=${token}.${encoded}` };
}
