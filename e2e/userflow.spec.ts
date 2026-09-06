import { expect, test } from "@playwright/test";

import { signIn } from "./auth.ts";
import { adminUser, resetDb, seedAdmin, seedAlice } from "./db.ts";

test.beforeEach(async () => {
  await resetDb();
});

test("a guest can see the app shell", async ({ page }) => {
  await page.goto("/");

  // Both the navbar and the signed-out page offer a sign-in button, so each
  // assertion says which one it means.
  const nav = page.getByRole("navigation");
  await expect(nav.getByRole("button", { name: "Sign In" })).toBeVisible();
  await expect(nav.getByText("Wiki")).toBeVisible();

  const main = page.getByRole("main");
  await expect(main.getByRole("heading", { name: "Labrador Wiki Agent" })).toBeVisible();
  await expect(main.getByRole("button", { name: "Sign In" })).toBeVisible();
  await expect(main.getByLabel("Your question")).toBeHidden();
});

test("an admin can open the dashboard and see users", async ({ page, context }) => {
  await seedAlice();
  await seedAdmin();
  await signIn(context, adminUser.sessionToken);
  await page.goto("/dashboard");

  await expect(page.getByRole("heading", { name: "Admin Dashboard" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "Alice", exact: true })).toBeVisible();
  await expect(page.getByRole("cell", { name: "alice", exact: true })).toBeVisible();

  await page.getByRole("tab", { name: "Chunks" }).click();
  await expect(page.getByText("Chunks grouped by Source and Page.")).toBeVisible();
});
