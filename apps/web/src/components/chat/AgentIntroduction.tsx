import { BookOpen } from "lucide-react";

import { SignInButton } from "@/components/user/SignInButton";

/** What a signed-out visitor sees where the composer would be. */
export function AgentIntroduction() {
  return (
    <div className="mx-auto flex max-w-md flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
      <BookOpen className="size-8 text-muted-foreground" aria-hidden />
      <h1 className="text-2xl font-semibold">Ask the Labrador wiki agent</h1>
      <p className="text-sm text-muted-foreground">
        The wiki agent answers questions about ScottyLabs Labrador so you can ask how something
        works instead of reading the whole wiki yourself. Conversations are never saved, so closing
        the tab ends one.
      </p>
      <p className="text-sm text-muted-foreground">
        Sign in with your Andrew ID to ask a question.
      </p>
      <SignInButton />
    </div>
  );
}
