import { UsefulLinksMenu } from "@/components/UsefulLinks.tsx";
import { UserProfile } from "@/components/user/UserProfile.tsx";

export function NavBar() {
  return (
    <nav className="sticky top-0 z-50 flex shrink-0 items-center justify-between bg-gray-800 px-3 py-3 text-white shadow-lg md:px-6 md:py-4">
      <div className="flex min-w-0 items-center gap-1">
        <UsefulLinksMenu />
        <span className="truncate text-lg font-semibold md:text-xl">Labrador Wiki Agent</span>
      </div>
      <UserProfile />
    </nav>
  );
}
