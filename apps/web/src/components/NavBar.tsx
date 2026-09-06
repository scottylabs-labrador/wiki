import { UserProfile } from "@/components/user/UserProfile.tsx";

export function NavBar() {
  return (
    <nav className="sticky top-0 z-50 flex shrink-0 items-center justify-between bg-gray-800 px-6 py-4 text-white shadow-lg">
      <span className="text-xl font-semibold">Labrador Wiki Agent</span>
      <UserProfile />
    </nav>
  );
}
