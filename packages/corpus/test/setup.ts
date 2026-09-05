import { beforeEach } from "vitest";

beforeEach(async () => {
  const { resetDb } = await import("./harness.ts");
  await resetDb();
});
