import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { userSession } from "./fixtures.ts";
import {
  askedBodies,
  holdAnswerStream,
  holdBeforeAnswerText,
  setAnswerCitations,
  setAnswerDeltas,
  setQuota,
  setSession,
} from "./msw/handlers.ts";
import { renderApp } from "./render.tsx";

async function ask(question: string) {
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText("Your question"), question);
  await user.click(screen.getByRole("button", { name: "Ask" }));
}

async function expandCitedDocuments(index = 0) {
  const user = userEvent.setup();
  await user.click(screen.getAllByText("Cited Documents")[index]!);
}

describe("chat", () => {
  it("explains the agent to a signed-out visitor instead of offering a composer", async () => {
    await renderApp("/");

    expect(await screen.findByRole("heading", { name: "Labrador Wiki Agent" })).toBeDefined();
    expect(screen.getByText(/Sign in with your Andrew ID to ask a question/)).toBeDefined();
    // The navbar has a sign-in button of its own, so look inside the page.
    expect(within(screen.getByRole("main")).getByRole("button", { name: "Sign In" })).toBeDefined();
    expect(screen.queryByLabelText("Your question")).toBeNull();
    expect(screen.queryByRole("button", { name: "Ask" })).toBeNull();
    expect(screen.queryByRole("complementary", { name: "Useful Links" })).toBeNull();
  });

  it("offers a composer to a signed-in member and has no history list", async () => {
    setSession(userSession());
    await renderApp("/");

    expect(await screen.findByLabelText("Your question")).toBeDefined();
    expect(screen.queryByRole("heading", { name: "History" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Labrador Wiki Agent" })).toBeNull();
  });

  it("lists the Sources the agent answers from as Useful Links", async () => {
    setSession(userSession());
    await renderApp("/");

    const sidebar = await screen.findByRole("complementary", { name: "Useful Links" });
    const links = within(within(sidebar).getByRole("list"))
      .getAllByRole("link")
      .map((link) => ({ name: link.textContent, href: link.getAttribute("href") }));
    expect(links).toEqual([
      {
        name: "Labrador Wiki Wiki",
        href: "https://github.com/scottylabs-labrador/wiki/wiki",
      },
      {
        name: "ScottyStack Wiki",
        href: "https://github.com/scottylabs-labrador/ScottyStack/wiki",
      },
      {
        name: "Goldador",
        href: "https://scottylabs-labrador.github.io/goldador/",
      },
    ]);
  });

  it("asks a member to Slack Yuxiang Huang with questions or feedback", async () => {
    setSession(userSession());
    await renderApp("/");

    const sidebar = await screen.findByRole("complementary", { name: "Useful Links" });
    expect(within(sidebar).getByRole("link", { name: "Slack" }).getAttribute("href")).toBe(
      "https://go.scottylabs.org/slack",
    );
    expect(sidebar.textContent).toMatch(
      /Slack Yuxiang Huang if you have any questions or feedback\./,
    );
  });

  it("renders a streamed Answer as markdown", async () => {
    setSession(userSession());
    setAnswerDeltas(["Labrador ships **", "web apps** and a ", "[wiki](https://example.org).\n"]);
    await renderApp("/");

    await ask("What does Labrador do?");

    await waitFor(() => {
      expect(screen.getByText("web apps").tagName).toBe("STRONG");
    });
    // A URL the model wrote keeps its words but is not clickable: only the
    // Citations the server computes may ever be links.
    expect(screen.getByText("wiki")).toBeDefined();
    expect(within(screen.getByRole("main")).queryByRole("link")).toBeNull();
  });

  it("renders the GitHub-flavoured markdown the model is asked for", async () => {
    setSession(userSession());
    setAnswerDeltas([
      "| Source | Pages |\n| --- | --- |\n| ScottyStack wiki | 12 |\n\n",
      "~~Grounding~~ arrives in a later ticket.\n",
    ]);
    await renderApp("/");

    await ask("What can you read?");

    await waitFor(() => {
      expect(screen.getByRole("table")).toBeDefined();
    });
    expect(screen.getAllByRole("columnheader").map((header) => header.textContent)).toEqual([
      "Source",
      "Pages",
    ]);
    expect(screen.getByRole("cell", { name: "ScottyStack wiki" })).toBeDefined();
    expect(screen.getByText("Grounding").tagName).toBe("DEL");
  });

  it("shows the beginning of an Answer before the end of it arrives", async () => {
    setSession(userSession());
    setAnswerDeltas(["Labrador is a committee. ", "It ships software."]);
    const release = holdAnswerStream();
    await renderApp("/");

    await ask("What is Labrador?");

    await waitFor(() => {
      expect(screen.getByText(/Labrador is a committee\./)).toBeDefined();
    });
    expect(screen.queryByText(/It ships software\./)).toBeNull();

    release();
    await waitFor(() => {
      expect(screen.getByText(/It ships software\./)).toBeDefined();
    });
  });

  it("sends the question with the turns that came before it", async () => {
    setSession(userSession());
    setAnswerDeltas(["First answer."]);
    await renderApp("/");

    await ask("First question?");
    await waitFor(() => {
      expect(screen.getByText("First answer.")).toBeDefined();
    });

    await ask("Second question?");
    await waitFor(() => {
      expect(askedBodies).toHaveLength(2);
    });
    expect(askedBodies[1]?.turns).toEqual([
      { role: "user", content: "First question?" },
      { role: "assistant", content: "First answer." },
      { role: "user", content: "Second question?" },
    ]);
  });

  it("survives markdown that is still half-written", async () => {
    setSession(userSession());
    setAnswerDeltas(["Run this:\n\n```ts\nconst answer = ", "await ask(); // and a [half link"]);
    await renderApp("/");

    await ask("How do I ask?");

    await waitFor(() => {
      expect(screen.getByText(/const answer = await ask/)).toBeDefined();
    });
    expect(screen.getByText(/half link/)).toBeDefined();
  });

  it("drops the markup an Answer is not allowed to contain", async () => {
    setSession(userSession());
    setAnswerDeltas([
      // Markdown the parser really does turn into elements, so the sanitiser
      // schema is what has to refuse them.
      "Look: ![a pixel](https://tracker.example/pixel.png)\n\n",
      "- [x] a checkbox\n\n",
      "And [click me](data:text/html,<script>alert(1)</script>).\n",
    ]);
    await renderApp("/");

    await ask("Are you safe?");

    await waitFor(() => {
      expect(screen.getByText("click me")).toBeDefined();
    });

    // `img` and `input` are not on the allowlist, so an Answer can neither make
    // the browser fetch from a third party nor put controls on the page.
    const main = screen.getByRole("main");
    expect(main.querySelector("img")).toBeNull();
    expect(main.querySelector("input")).toBeNull();
    expect(main.querySelector("[src]")).toBeNull();

    // Nothing the model wrote is navigable, whatever protocol it chose.
    expect(main.querySelector("[href]")).toBeNull();
    expect(main.innerHTML).not.toContain("data:text/html");
  });

  it("tells a member when the Answer cannot be fetched", async () => {
    setSession(userSession());
    await renderApp("/");

    // The fake stream only answers a request it can see a session for, and
    // clearing it here is the same as a session that expired mid-conversation.
    setSession(null);
    await ask("Still there?");

    expect(await screen.findByRole("alert")).toBeDefined();
  });

  it("shows Citations as links once the Answer is finished", async () => {
    setSession(userSession());
    setAnswerDeltas(["Keycloak."]);
    setAnswerCitations([{ title: "Auth", url: "https://github.com/example/wiki/Auth#keycloak" }]);
    await renderApp("/");

    await ask("How do members sign in?");

    expect(await screen.findByText("Cited Documents")).toBeDefined();
    expect(
      screen.queryByRole("link", { name: "https://github.com/example/wiki/Auth#keycloak" }),
    ).toBeNull();

    await expandCitedDocuments();

    const citation = screen.getByRole("link", {
      name: "https://github.com/example/wiki/Auth#keycloak",
    });
    expect(citation.getAttribute("href")).toBe("https://github.com/example/wiki/Auth#keycloak");
  });

  it("says so when the Answer is not drawn from Labrador documentation", async () => {
    setSession(userSession());
    setAnswerDeltas(["I do not know."]);
    setAnswerCitations([], false);
    await renderApp("/");

    await ask("What is the weather?");

    expect(
      await screen.findByText("This answer is not drawn from Labrador documentation!"),
    ).toBeDefined();
    expect(screen.queryByRole("link", { name: "Auth" })).toBeNull();
  });

  it("names the Pages being consulted before the Answer has finished", async () => {
    setSession(userSession());
    setAnswerDeltas(["Keycloak."]);
    setAnswerCitations([{ title: "Auth", url: "https://example.com/Auth" }]);
    const release = holdBeforeAnswerText();
    await renderApp("/");

    await ask("How do members sign in?");

    await waitFor(() => {
      expect(screen.getByText(/Looking at Auth/)).toBeDefined();
    });
    expect(screen.queryByText("Keycloak.")).toBeNull();

    release();
    await waitFor(() => {
      expect(screen.getByText("Keycloak.")).toBeDefined();
    });
    expect(screen.getByText("Cited Documents")).toBeDefined();
    expect(screen.queryByRole("link", { name: "https://example.com/Auth" })).toBeNull();

    await expandCitedDocuments();
    expect(screen.getByRole("link", { name: "https://example.com/Auth" })).toBeDefined();
  });

  it("keeps Citations on finished Answers while a later Answer is still being written", async () => {
    setSession(userSession());
    setAnswerDeltas(["Keycloak."]);
    setAnswerCitations([{ title: "Auth", url: "https://example.com/Auth" }]);
    await renderApp("/");

    await ask("How do members sign in?");
    expect(await screen.findByText("Cited Documents")).toBeDefined();
    await expandCitedDocuments();
    expect(screen.getByRole("link", { name: "https://example.com/Auth" })).toBeDefined();

    setAnswerDeltas(["Members."]);
    setAnswerCitations([{ title: "Onboarding", url: "https://example.com/Onboarding" }]);
    const release = holdBeforeAnswerText();
    await ask("Who can join?");

    await waitFor(() => {
      expect(screen.getByText(/Looking at Onboarding/)).toBeDefined();
    });
    expect(screen.getByRole("link", { name: "https://example.com/Auth" })).toBeDefined();
    expect(screen.queryByRole("link", { name: "https://example.com/Onboarding" })).toBeNull();

    release();
    await waitFor(() => {
      expect(screen.getAllByText("Cited Documents")).toHaveLength(2);
    });
    expect(screen.queryByRole("link", { name: "https://example.com/Onboarding" })).toBeNull();

    await expandCitedDocuments(1);
    expect(screen.getByRole("link", { name: "https://example.com/Onboarding" })).toBeDefined();
  });

  it("shows remaining questions under Ask, and the count and hourly refresh", async () => {
    setSession(userSession());
    setQuota({ remaining: 12, limit: 60, resetAt: "2026-09-05T18:00:00.000Z" });
    await renderApp("/");

    const bar = await screen.findByRole("progressbar", { name: /12\/60 prompts remaining/ });
    expect(bar.getAttribute("aria-valuenow")).toBe("12");
    expect(bar.getAttribute("aria-valuemax")).toBe("60");
    expect((await screen.findByRole("tooltip")).textContent).toMatch(
      /12\/60 prompts remaining\. Refreshes hourly at/,
    );
  });

  it("disables the composer when the hour's questions are used up", async () => {
    setSession(userSession());
    setQuota({ remaining: 0, limit: 60, resetAt: "2026-09-05T18:00:00.000Z" });
    await renderApp("/");

    expect(await screen.findByText(/this hour allows/)).toBeDefined();

    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Your question"), "Still allowed?");
    const askButton = screen.getByRole("button", { name: "Ask" });
    expect(
      askButton.hasAttribute("disabled") || askButton.getAttribute("aria-disabled") === "true",
    ).toBe(true);
  });
});
