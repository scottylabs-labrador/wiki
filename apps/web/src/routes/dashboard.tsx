import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";

import { DashboardChunks } from "@/components/dashboard/DashboardChunks";
import { DashboardUsers } from "@/components/dashboard/DashboardUsers";
import { DashboardUsersTableSkeleton } from "@/components/dashboard/DashboardUsersTableSkeleton";
import { Button } from "@/components/ui/button";
import { useSession } from "@/lib/authClient";

type DashboardTab = "users" | "chunks";

export const Route = createFileRoute("/dashboard")({
  component: DashboardPage,
});

function DashboardPage() {
  const { data: auth, isPending: sessionPending } = useSession();
  const navigate = useNavigate();
  const [tab, setTab] = useState<DashboardTab>("users");

  if (sessionPending) {
    return <DashboardUsersTableSkeleton />;
  }

  if (!auth?.user) {
    void navigate({ to: "/" });
    return null;
  }

  const isAdmin = auth.user.role === "admin";
  if (!isAdmin) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6">
        <p className="text-sm text-muted-foreground">You do not have access to this page.</p>
        <Link to="/" className="text-sm text-primary underline">
          Go home
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col p-6">
      <h1 className="mb-4 text-2xl font-semibold">Admin Dashboard</h1>
      <div role="tablist" aria-label="Admin sections" className="mb-6 flex gap-2">
        <Button
          role="tab"
          aria-selected={tab === "users"}
          aria-controls="dashboard-users"
          variant={tab === "users" ? "default" : "outline"}
          size="sm"
          onClick={() => setTab("users")}
        >
          Users
        </Button>
        <Button
          role="tab"
          aria-selected={tab === "chunks"}
          aria-controls="dashboard-chunks"
          variant={tab === "chunks" ? "default" : "outline"}
          size="sm"
          onClick={() => setTab("chunks")}
        >
          Chunks
        </Button>
      </div>
      {tab === "users" ? (
        <div id="dashboard-users" role="tabpanel">
          <DashboardUsers />
        </div>
      ) : (
        <div id="dashboard-chunks" role="tabpanel">
          <DashboardChunks />
        </div>
      )}
    </div>
  );
}
