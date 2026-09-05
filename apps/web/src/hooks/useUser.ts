import type { User } from "@wiki/access-control";

import { useSession } from "@/lib/authClient";

export function useUser(): User {
  const { data: auth } = useSession();
  return auth?.user ?? { id: "", role: "guest" };
}
