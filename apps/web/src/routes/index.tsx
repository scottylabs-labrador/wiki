import { createFileRoute } from "@tanstack/react-router";

import { AgentIntroduction } from "@/components/chat/AgentIntroduction";
import { Composer } from "@/components/chat/Composer";
import { ConversationTranscript } from "@/components/chat/ConversationTranscript";
import { Skeleton } from "@/components/ui/skeleton";
import { useConversation } from "@/hooks/useConversation";
import { useSession } from "@/lib/authClient";

export const Route = createFileRoute("/")({
  component: ChatComponent,
});

function ChatComponent() {
  const { data: auth, isPending: sessionPending } = useSession();
  const { turns, streaming, error, ask } = useConversation();

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

  return (
    <div className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col">
      <ConversationTranscript turns={turns} streaming={streaming} />
      {error && (
        <p role="alert" className="px-6 pb-2 text-sm text-destructive">
          {error}
        </p>
      )}
      <Composer disabled={streaming} onAsk={ask} />
      <p className="px-4 pb-4 text-xs text-muted-foreground">
        Answers are not yet drawn from Labrador documentation, so check anything that matters.
      </p>
    </div>
  );
}
