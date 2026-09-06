import { BookOpen } from "lucide-react";

import { SignInButton } from "@/components/user/SignInButton";

/** What a signed-out visitor sees where the composer would be. */
export function AgentIntroduction() {
  return (
    <div className="mx-auto flex max-w-md flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
      <BookOpen className="size-8 text-muted-foreground" aria-hidden />
      <h1 className="text-2xl font-semibold">Labrador Wiki Agent</h1>
      <p className="text-sm text-muted-foreground">
        Sign in with your Andrew ID to ask a question.
      </p>
      <SignInButton />
    </div>
  );
}
