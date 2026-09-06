import { createFileRoute } from "@tanstack/react-router";

import { AgentIntroduction } from "@/components/chat/AgentIntroduction";
import { Composer } from "@/components/chat/Composer";
import { ConversationTranscript } from "@/components/chat/ConversationTranscript";
import { Skeleton } from "@/components/ui/skeleton";
import { useConversation } from "@/hooks/useConversation";
import { formatResetAt } from "@/lib/answerStream.ts";
import { useSession } from "@/lib/authClient";

export const Route = createFileRoute("/")({
  component: ChatComponent,
});

function ChatComponent() {
  const { data: auth, isPending: sessionPending } = useSession();
  const { turns, streaming, error, quota, ask } = useConversation(Boolean(auth?.user));

  if (sessionPending) {
    return (
      <div className="flex flex-1 flex-col gap-4 p-6">
        <Skeleton className="h-6 w-1/3" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  if (!auth?.user) {
    return <AgentIntroduction />;
  }

  const exhausted = quota?.remaining === 0;

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col">
      <ConversationTranscript turns={turns} streaming={streaming} />
      {error && (
        <p role="alert" className="mx-auto w-full max-w-3xl px-6 pb-2 text-sm text-destructive">
          {error}
        </p>
      )}
      {exhausted && quota && (
        <p
          role="status"
          className="mx-auto w-full max-w-3xl px-6 pb-2 text-sm text-muted-foreground"
        >
          You have asked as many questions as this hour allows. You can ask again at{" "}
          {formatResetAt(quota.resetAt)}.
        </p>
      )}
      <Composer disabled={streaming || exhausted} onAsk={ask} />
    </div>
  );
}
