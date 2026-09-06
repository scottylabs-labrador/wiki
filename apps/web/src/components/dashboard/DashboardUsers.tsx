import { useState } from "react";

import { DashboardUsersPanelSkeleton } from "@/components/dashboard/DashboardUsersTableSkeleton";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table.tsx";
import { $api } from "@/lib/apiClient";

const PAGE_SIZE = 10;

export function DashboardUsers() {
  const [page, setPage] = useState(0);

  const {
    data: users,
    isLoading: usersLoading,
    isError: usersError,
    error: usersErrorDetail,
  } = $api.useQuery("get", "/admin/users", {
    params: { query: { page, limit: PAGE_SIZE } },
  });

  if (usersLoading) {
    return <DashboardUsersPanelSkeleton />;
  }

  if (usersError) {
    return (
      <div className="text-sm text-destructive">
        Error loading users: {usersErrorDetail ? String(usersErrorDetail) : "Unknown error"}
      </div>
    );
  }

  const list = users ?? [];
  const hasNextPage = list.length === PAGE_SIZE;
  const hasPrevPage = page > 0;

  return (
    <div>
      <p className="mb-6 text-sm text-muted-foreground">All users.</p>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>User ID</TableHead>
            <TableHead>User name</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {list.length === 0 ? (
            <TableRow>
              <TableCell colSpan={2} className="text-center text-sm text-muted-foreground">
                No users found.
              </TableCell>
            </TableRow>
          ) : (
            list.map((row) => (
              <TableRow key={row.id}>
                <TableCell className="font-mono text-sm">{row.id}</TableCell>
                <TableCell>{row.name}</TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
      <div className="mt-4 flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={!hasPrevPage}
          onClick={() => setPage((p) => p - 1)}
        >
          Previous
        </Button>
        <span className="text-sm text-muted-foreground">Page {page + 1}</span>
        <Button
          variant="outline"
          size="sm"
          disabled={!hasNextPage}
          onClick={() => setPage((p) => p + 1)}
        >
          Next
        </Button>
      </div>
    </div>
  );
}
