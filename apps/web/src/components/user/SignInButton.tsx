import { Button } from "@/components/ui/button";
import { signIn } from "@/lib/authClient";

export function SignInButton() {
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() => signIn()}
      className="border-white/30 bg-gray-200 text-gray-800 hover:bg-gray-300"
    >
      Sign In
    </Button>
  );
}
