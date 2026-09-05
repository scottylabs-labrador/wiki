import type { User } from "@scottystack/access-control";

import { useSession } from "@/lib/authClient";

export function useUser(): User {
  const { data: auth } = useSession();
  return auth?.user ?? { id: "", role: "guest" };
}
