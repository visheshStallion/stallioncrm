import Link from "next/link";
import { Button } from "@/components/ui/button";

// Also used for records outside the user's scope – existence is never revealed.
export default function NotFound() {
  return (
    <main className="flex min-h-[60vh] flex-col items-center justify-center gap-3 p-8 text-center">
      <p className="text-5xl font-bold text-muted-foreground">404</p>
      <h1 className="text-xl font-semibold">Not found</h1>
      <p className="max-w-md text-sm text-muted-foreground">
        The page or record does not exist, or you do not have access to it.
      </p>
      <Button asChild variant="outline">
        <Link href="/">Back to home</Link>
      </Button>
    </main>
  );
}
