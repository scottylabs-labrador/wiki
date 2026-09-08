import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { userSession } from "./fixtures.ts";
import { setAdminPages, setAdminUsers, setSession } from "./msw/handlers.ts";
import { renderApp } from "./render.tsx";

describe("dashboard", () => {
  it("redirects guests home", async () => {
    await renderApp("/dashboard");

    expect(await screen.findByRole("heading", { name: "Labrador Wiki Agent" })).toBeDefined();
  });

  it("shows the user table for an admin", async () => {
    setSession(userSession("admin"));
    setAdminUsers([{ id: "alice", name: "Alice" }]);
    await renderApp("/dashboard");

    expect(await screen.findByRole("heading", { name: "Admin Dashboard" })).toBeDefined();
    await waitFor(() => {
      expect(screen.getByText("Alice")).toBeDefined();
    });
  });

  it("nests Source and Page tabs on the Chunks tab", async () => {
    setSession(userSession("admin"));
    setAdminUsers([{ id: "alice", name: "Alice" }]);
    setAdminPages([
      {
        sourceTitle: "ScottyStack Wiki",
        filename: "Auth.md",
        publicUrl: "https://wiki.example.com/Auth",
        chunks: [
          { heading: "Sign in", body: "Committee members sign in with Keycloak." },
          { heading: "Roles", body: "Admins can open the dashboard." },
        ],
      },
      {
        sourceTitle: "ScottyStack Wiki",
        filename: "Styling.md",
        publicUrl: "https://wiki.example.com/Styling",
        chunks: [{ heading: null, body: "The frontend is styled with Tailwind CSS." }],
      },
      {
        sourceTitle: "Labrador Wiki Wiki",
        filename: "Home.md",
        publicUrl: "https://wiki.example.com/Home",
        chunks: [{ heading: "Welcome", body: "Labrador documents committee process." }],
      },
    ]);
    await renderApp("/dashboard");
    expect(await screen.findByRole("heading", { name: "Admin Dashboard" })).toBeDefined();

    await userEvent.click(screen.getByRole("tab", { name: "Chunks" }));

    expect(await screen.findByRole("tab", { name: "Labrador Wiki Wiki" })).toBeDefined();
    expect(screen.getByRole("tab", { name: "ScottyStack Wiki" })).toBeDefined();
    expect(
      screen.getByRole("link", { name: "https://github.com/scottylabs-labrador/wiki/wiki" }),
    ).toBeDefined();
    expect(screen.getByRole("tab", { name: "Home.md" })).toBeDefined();
    expect(screen.getByRole("link", { name: "https://wiki.example.com/Home" })).toBeDefined();
    expect(screen.getByText("Welcome")).toBeDefined();
    expect(screen.queryByRole("tab", { name: "Auth.md" })).toBeNull();
    expect(screen.queryByText("Sign in")).toBeNull();
    expect(screen.queryByText("Labrador documents committee process.")).toBeNull();
    expect(screen.queryByText("Alice")).toBeNull();

    await userEvent.click(screen.getByRole("tab", { name: "ScottyStack Wiki" }));
    expect(
      screen.getByRole("link", {
        name: "https://github.com/scottylabs-labrador/ScottyStack/wiki",
      }),
    ).toBeDefined();
    expect(screen.getByRole("link", { name: "https://wiki.example.com/Auth" })).toBeDefined();
    expect(screen.getByRole("tab", { name: "Auth.md" })).toBeDefined();
    expect(screen.getByRole("tab", { name: "Styling.md" })).toBeDefined();
    expect(screen.getByText("Sign in")).toBeDefined();
    expect(screen.queryByText("Welcome")).toBeNull();
    expect(screen.queryByText("Committee members sign in with Keycloak.")).toBeNull();

    await userEvent.click(screen.getByRole("tab", { name: "Styling.md" }));
    expect(screen.getByText("Untitled")).toBeDefined();
    expect(screen.queryByText("Sign in")).toBeNull();

    await userEvent.click(screen.getByText("Untitled"));
    expect(screen.getByText("The frontend is styled with Tailwind CSS.")).toBeDefined();
  });
});
